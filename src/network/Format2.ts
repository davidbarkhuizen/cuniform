// The format-2 reader (workplan §4.1): the parsed JSON object in, a NetworkModel out. Format 2 is
// specified in indrajala-ml's indrajala_ml/model/persistence/format2.py; the expansion follows
// layer_specs.expand_specs and the recurrent parts format2_json.recurrence_parameters. It never sees a
// path or a Response, so any model source (file, URL, server) feeds it the same way (D3), and it ignores
// optimizer_state and rng, so a server's view payload without them reads unchanged.

import {
    Component,
    ComponentKind,
    Entry,
    EntryKind,
    Factor,
    Implementation,
    InputSpec,
    ModelShape,
    NetworkModel,
    Parameter,
    Recurrence,
    WeightStats,
} from "./NetworkModel";

/** Every refusal names what was wrong and, for an entry, where it sits. */
export class Format2Error extends Error {
    constructor(message: string) {
        super(message);
        this.name = "Format2Error";
    }
}

const IMPLEMENTATIONS: readonly string[] = ["numpy", "rust"];
const SHAPES: readonly string[] = ["sequence", "multiclass", "single_output", "window_recurrent"];

const KNOWN_KINDS: readonly string[] = [
    "embedding", "position", "patches", "state_input", "dense", "conv", "pool", "batch_norm",
    "layer_norm", "attention", "dropout", "token_mean",
];

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field<T>(spec: Json, name: string, fallback: T): T {
    return name in spec && spec[name] !== null ? spec[name] as T : fallback;
}

// ------------------------------------------------------------------ weights --

/** The shape of a nested JSON array, checked rectangular; a number is a scalar of shape []. */
function shapeOf(value: unknown, where: string): number[] {
    const shape: number[] = [];
    let probe = value;

    while (Array.isArray(probe)) {
        shape.push(probe.length);

        if (probe.length === 0)
            break;

        probe = probe[0];
    }

    if (shape.length === 0 && typeof value !== "number")
        throw new Format2Error(`${where}: expected a number or an array of numbers`);

    return shape;
}

function flatten(value: unknown, shape: readonly number[], where: string): Float32Array {
    const size = shape.reduce((product, n) => product * n, 1);
    const out = new Float32Array(size);
    let at = 0;

    const walk = (node: unknown, depth: number) => {
        if (depth === shape.length) {
            if (typeof node !== "number")
                throw new Format2Error(`${where}: a non-number where a weight belongs`);

            out[at++] = node;
            return;
        }

        if (!Array.isArray(node) || node.length !== shape[depth])
            throw new Format2Error(`${where}: a ragged array (dimension ${depth} is not ${shape[depth]} long)`);

        for (const child of node)
            walk(child, depth + 1);
    };

    walk(value, 0);

    return out;
}

export function weightStats(data: Float32Array): WeightStats {
    const count = data.length;

    if (count === 0)
        return { count: 0, min: 0, max: 0, mean: 0, rms: 0 };

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let squares = 0;

    for (let i = 0; i < count; i++) {
        const w = data[i];

        if (w < min)
            min = w;

        if (w > max)
            max = w;

        sum += w;
        squares += w * w;
    }

    return { count, min, max, mean: sum / count, rms: Math.sqrt(squares / count) };
}

function parameter(name: string, shape: readonly number[], data: Float32Array): Parameter {
    return { name, shape, data, stats: weightStats(data) };
}

/** One expected dimension per axis; null where the reader has lost track and cannot check. */
type Expected = ReadonlyArray<number | null>;

function decodeParameters(
    raw: unknown,
    names: readonly string[],
    expected: ReadonlyArray<Expected | null>,
    where: string
): Parameter[] {
    if (!Array.isArray(raw))
        throw new Format2Error(`${where}: its weights entry is not a list`);

    if (raw.length !== names.length)
        throw new Format2Error(`${where}: ${raw.length} weight arrays, expected ${names.length} (${names.join(", ") || "none"})`);

    return names.map((name, i) => {
        const shape = shapeOf(raw[i], `${where}, ${name}`);
        const want = expected[i];

        if (want !== null) {
            const fits = want.length === shape.length && want.every((n, axis) => n === null || n === shape[axis]);

            if (!fits)
                throw new Format2Error(`${where}: ${name} has shape [${shape.join(", ")}], expected [${want.map(n => n ?? "?").join(", ")}]`);
        }

        return parameter(name, shape, flatten(raw[i], shape, `${where}, ${name}`));
    });
}

/** An unknown kind's weights, decoded without a check, so the weight alignment of later entries survives. */
function decodeUnchecked(raw: unknown, where: string): Parameter[] {
    if (!Array.isArray(raw))
        throw new Format2Error(`${where}: its weights entry is not a list`);

    return raw.map((value, i) => {
        const shape = shapeOf(value, `${where}, parameter ${i}`);
        return parameter(`p${i}`, shape, flatten(value, shape, `${where}, parameter ${i}`));
    });
}

// ---------------------------------------------------------------- expansion --

/** An expanded layer before its weights are read: what `expand_specs` yields, plus where it came from. */
interface Expanded {
    kind: EntryKind;
    sourceKind: string;
    spec: Json;
    path: string;
    lane: number | null;
    partner: number | null;
}

/** Flattens residuals and branches exactly as `expand_specs` does, labelling each entry as `spec_paths` does. */
function expand(layers: unknown[], label: (i: number) => string, lane: number | null, out: Expanded[]): void {

    layers.forEach((layer, i) => {
        const at = label(i);

        if (!isObject(layer) || typeof layer.kind !== "string")
            throw new Format2Error(`${at}: not a layer spec (no kind)`);

        const kind = layer.kind;

        if (kind === "residual") {
            if (!Array.isArray(layer.body))
                throw new Format2Error(`${at}: a residual without a body`);

            const fork = out.length;
            out.push({ kind: "fork", sourceKind: "residual", spec: {}, path: `${at}, block fork`, lane, partner: null });
            expand(layer.body, j => `${at}, block body ${j}`, lane, out);
            out[fork].partner = out.length;
            out.push({ kind: "add", sourceKind: "residual", spec: {}, path: `${at}, block add`, lane, partner: fork });
            return;
        }

        if (kind === "branches" || kind === "merged_branches") {
            const branches = layer.branches;

            if (!Array.isArray(branches) || branches.length === 0 || !branches.every(Array.isArray))
                throw new Format2Error(`${at}: branches without a list of branches`);

            const reads = Array.isArray(layer.reads) ? layer.reads : null;
            const split = out.length;
            out.push({ kind: "split", sourceKind: kind, spec: { branches: branches.length, reads }, path: `${at}, split`, lane, partner: null });

            branches.forEach((branch, b) => {
                expand(branch as unknown[], j => `${at}, branch ${b} layer ${j}`, b, out);

                if (b + 1 < branches.length)
                    out.push({ kind: "branch", sourceKind: kind, spec: { branch: b }, path: `${at}, branch ${b} end`, lane: b, partner: null });
            });

            if (kind === "merged_branches")
                out.push({ kind: "merge", sourceKind: kind, spec: {}, path: `${at}, merge`, lane, partner: split });

            return;
        }

        const spec: Json = {};

        for (const [key, value] of Object.entries(layer))
            if (key !== "kind")
                spec[key] = value;

        const known = KNOWN_KINDS.includes(kind);
        out.push({ kind: known ? kind as EntryKind : "unknown", sourceKind: kind, spec, path: at, lane, partner: null });
    });
}

// ------------------------------------------------------------- shape flow --

/** What flows between layers: a token sequence or flat vector of `width` features, or an image. */
interface Flow {
    tokens: number | null;
    width: number | null;
    image: { height: number; width: number; channels: number } | null;
}

function flowWidth(flow: Flow): number | null {
    return flow.image ? flow.image.height * flow.image.width * flow.image.channels : flow.width;
}

const LOST: Flow = { tokens: null, width: null, image: null };

/** A valid (unpadded) sliding span's output length. */
function slidingSize(size: number, span: number, stride: number): number {
    return Math.floor((size - span) / stride) + 1;
}

interface Reading {
    names: string[];
    expected: Array<Expected | null>;
    after: Flow;
    components: (parameters: Parameter[], id: string) => Component[];
}

function single(kind: ComponentKind, units: number | null) {
    return (parameters: Parameter[], id: string): Component[] =>
        [{ id: `${id}/${kind}`, name: kind, kind, units: units ?? 1, parameters }];
}

function attentionComponents(heads: number, keySize: number, width: number | null) {
    return (parameters: Parameter[], id: string): Component[] => {
        const [wq, bq, wk, bk, wv, bv, wo, bo] = parameters;
        const rows = (p: Parameter, h: number) =>
            parameter(p.name, [keySize, p.shape[1]], p.data.subarray(h * keySize * p.shape[1], (h + 1) * keySize * p.shape[1]));
        const span = (p: Parameter, h: number) =>
            parameter(p.name, [keySize], p.data.subarray(h * keySize, (h + 1) * keySize));

        const out: Component[] = [];

        for (let h = 0; h < heads; h++) {
            // Head h's slice of Wo is a column block, so it is copied rather than viewed.
            const d = wo.shape[0];
            const columns = new Float32Array(d * keySize);

            for (let r = 0; r < d; r++)
                columns.set(wo.data.subarray(r * heads * keySize + h * keySize, r * heads * keySize + (h + 1) * keySize), r * keySize);

            out.push({
                id: `${id}/head${h}`,
                name: `head${h}`,
                kind: "head",
                units: keySize,
                parameters: [rows(wq, h), span(bq, h), rows(wk, h), span(bk, h), rows(wv, h), span(bv, h), parameter("Wo", [d, keySize], columns)],
            });
        }

        out.push({ id: `${id}/out`, name: "out", kind: "attention_output", units: width ?? 1, parameters: [wo, bo] });

        return out;
    };
}

/** What an entry's weights must be, and what flows out of it, given what flows in. */
function readEntry(entry: Expanded, flow: Flow, stateWidth: number | null): Reading {
    const spec = entry.spec;
    const w = flow.width;
    const none = (after: Flow = flow): Reading => ({ names: [], expected: [], after, components: () => [] });
    const parameterFree = (kind: ComponentKind, after: Flow = flow): Reading =>
        ({ names: [], expected: [], after, components: single(kind, flowWidth(after)) });

    switch (entry.kind) {

        case "embedding": {
            const vocabulary = field<number>(spec, "vocabulary", 0);
            const size = field<number>(spec, "size", 0);
            return {
                names: ["E"],
                expected: [[vocabulary, size]],
                after: { tokens: flow.width, width: size, image: null },
                components: single("embedding", size),
            };
        }

        case "patches": {
            const p = field<number>(spec, "patch_size", 0);
            const image = flow.image;

            if (!image)
                throw new Format2Error(`${entry.path} (patches): needs an image input`);

            return parameterFree("patches", {
                tokens: (image.height / p) * (image.width / p),
                width: p * p * image.channels,
                image: null,
            });
        }

        case "position":
            return { names: ["P"], expected: [[flow.tokens, w]], after: flow, components: single("position", w) };

        case "state_input":
            return { names: ["P"], expected: [[w, stateWidth]], after: flow, components: single("state_input", w) };

        case "layer_norm":
            return { names: ["gamma", "beta"], expected: [[w], [w]], after: flow, components: single("layer_norm", w) };

        case "batch_norm": {
            const features = flow.image ? flow.image.channels : w;
            return {
                names: ["gamma", "beta", "running_mean", "running_var"],
                expected: [[features], [features], [features], [features]],
                after: flow,
                components: single("batch_norm", features),
            };
        }

        case "attention": {
            const heads = field<number>(spec, "heads", 1);
            const keySize = field<number | null>(spec, "key_size", null) ?? (w === null ? null : w / heads);
            const inner = keySize === null ? null : heads * keySize;

            if (keySize === null)
                return { names: ["Wq", "bq", "Wk", "bk", "Wv", "bv", "Wo", "bo"], expected: Array(8).fill(null), after: flow, components: single("attention", w) };

            return {
                names: ["Wq", "bq", "Wk", "bk", "Wv", "bv", "Wo", "bo"],
                expected: [[inner, w], [inner], [inner, w], [inner], [inner, w], [inner], [w, inner], [w]],
                after: flow,
                components: attentionComponents(heads, keySize, w),
            };
        }

        case "dense": {
            const size = field<number>(spec, "size", 0);
            const linear = field<string>(spec, "activation", "sigmoid") === "linear";
            const biased = field<boolean>(spec, "bias", false) || !linear;
            const fanIn = flowWidth(flow);
            return {
                names: biased ? ["W", "b"] : ["W"],
                expected: biased ? [[size, fanIn], [size]] : [[size, fanIn]],
                after: { tokens: flow.tokens, width: size, image: null },
                components: single("dense", size),
            };
        }

        case "conv": {
            const image = flow.image;

            if (!image)
                throw new Format2Error(`${entry.path} (conv): needs an image input`);

            const k = field<number>(spec, "kernel_size", 0);
            const channels = field<number>(spec, "channel_count", 0);
            const stride = field<number>(spec, "stride", 1);
            const linear = field<string>(spec, "activation", "relu") === "linear";
            const fanIn = image.channels * k * k;
            return {
                names: linear ? ["W"] : ["W", "b"],
                expected: linear ? [[channels, fanIn]] : [[channels, fanIn], [channels]],
                after: {
                    tokens: null,
                    width: null,
                    image: { height: slidingSize(image.height, k, stride), width: slidingSize(image.width, k, stride), channels },
                },
                components: single("conv", channels),
            };
        }

        case "pool": {
            const image = flow.image;

            if (!image)
                throw new Format2Error(`${entry.path} (pool): needs an image input`);

            const p = field<number>(spec, "pool_size", 0);
            const stride = field<number>(spec, "stride", p);
            const after = {
                tokens: null,
                width: null,
                image: { height: slidingSize(image.height, p, stride), width: slidingSize(image.width, p, stride), channels: image.channels },
            };
            return { names: [], expected: [], after, components: single("pool", image.channels) };
        }

        case "token_mean":
            return parameterFree("token_mean", { tokens: null, width: w, image: null });

        case "add":
        case "merge":
            return parameterFree(entry.kind);

        case "dropout":
        case "fork":
        case "split":
        case "branch":
            return none();

        default:
            throw new Format2Error(`${entry.path}: no reading for kind ${entry.kind}`);
    }
}

// --------------------------------------------------------------- recurrence --

function readRecurrence(raw: unknown): Omit<Recurrence, "factors"> & { factors: Omit<Factor, "reads">[] } {
    if (!isObject(raw))
        throw new Format2Error("recurrence: not an object");

    // Files saved before the factored state (indrajala-ml #739) hold one state at the top level: one factor.
    if (!("factors" in raw) && typeof raw.state_size === "number")
        raw = { ...raw, factors: [{ state_size: raw.state_size, codes: raw.codes ?? null }], cross: false };

    if (!isObject(raw) || !Array.isArray(raw.factors) || raw.factors.length === 0)
        throw new Format2Error("recurrence: needs a non-empty list of factors");

    const cell = isObject(raw.cell) ? raw.cell : {};
    const pooling = isObject(raw.pooling) ? raw.pooling : {};

    return {
        factors: raw.factors.map((factor, index) => {
            if (!isObject(factor) || typeof factor.state_size !== "number")
                throw new Format2Error(`recurrence, factor ${index}: needs a state_size`);

            const codes = isObject(factor.codes)
                ? { count: field<number>(factor.codes, "count", 0), commitment: field<number>(factor.codes, "commitment", 0.25) }
                : null;

            return { index, stateSize: factor.state_size, codes };
        }),
        cross: raw.cross === true,
        cell: { kind: field<string>(cell, "kind", "gru"), updateBias: field<number>(cell, "update_bias", 1.0) },
        pooling: { kind: field<string>(pooling, "kind", "attention"), reads: field<string>(pooling, "reads", "output") },
    };
}

/** Where each factor's pooling reads (`factor_reads`, or the output layer or first state input without branches). */
function factorReads(expanded: Expanded[], factorCount: number, poolingReads: string): number[] {
    const ends = expanded.flatMap((entry, i) => entry.kind === "branch" || entry.kind === "merge" ? [i] : []);

    if (ends.length > 0) {
        const split = expanded.find(entry => entry.kind === "split");
        const reads = split?.spec.reads as number[] | null | undefined;
        return reads ? reads.map(r => ends[r]) : ends.slice(0, factorCount);
    }

    const target = poolingReads === "before_state"
        ? expanded.findIndex(entry => entry.kind === "state_input")
        : expanded.length - 1;

    return Array(factorCount).fill(Math.max(target, 0));
}

// ------------------------------------------------------------------- reader --

function readInput(raw: unknown): InputSpec {
    if (!isObject(raw))
        throw new Format2Error("input: missing");

    if (typeof raw.dimension === "number")
        return { kind: "flat", dimension: raw.dimension };

    if (typeof raw.height === "number" && typeof raw.width === "number" && typeof raw.channels === "number")
        return { kind: "image", height: raw.height, width: raw.width, channels: raw.channels };

    throw new Format2Error("input: neither a dimension nor height, width and channels");
}

/** Reads a format-2 network file's parsed JSON. Throws a Format2Error naming what it refuses. */
export function readFormat2(json: unknown): NetworkModel {

    if (!isObject(json))
        throw new Format2Error("not a format-2 file: the top level is not an object");

    if (json.format !== 2)
        throw new Format2Error(`not a format-2 file: format is ${JSON.stringify(json.format)}`);

    if (json.shape === "ensemble")
        throw new Format2Error("an ensemble's file: cuniform shows one network, not an ensemble of them");

    if (json.implementation === "python")
        throw new Format2Error("a pure-Python file: cuniform reads numpy and rust files only, whose weights share one layout");

    if (typeof json.implementation !== "string" || !IMPLEMENTATIONS.includes(json.implementation))
        throw new Format2Error(`unknown implementation ${JSON.stringify(json.implementation)}`);

    if (typeof json.shape !== "string" || !SHAPES.includes(json.shape))
        throw new Format2Error(`unknown shape ${JSON.stringify(json.shape)}`);

    const windowRecurrent = json.shape === "window_recurrent";

    if (windowRecurrent !== ("recurrence" in json))
        throw new Format2Error(`a window_recurrent file, and only one, has a recurrence: shape is ${json.shape}`);

    if (!Array.isArray(json.layers))
        throw new Format2Error("layers: missing");

    if (!Array.isArray(json.weights))
        throw new Format2Error("weights: missing");

    const weights: unknown[] = json.weights;
    const input = readInput(json.input);
    const recurrence = windowRecurrent ? readRecurrence(json.recurrence) : null;
    const stateWidth = recurrence ? recurrence.factors.reduce((sum, factor) => sum + factor.stateSize, 0) : null;

    const expanded: Expanded[] = [];
    expand(json.layers, i => `layer ${i}`, null, expanded);

    const partCount = recurrence
        ? recurrence.factors.reduce((sum, factor) => sum + (factor.codes ? 4 : 3), 0)
        : 0;

    if (weights.length !== expanded.length + partCount)
        throw new Format2Error(`weights: ${weights.length} entries, expected ${expanded.length + partCount} (one per expanded layer${recurrence ? ", then the recurrent parts" : ""})`);

    const stack = "s0";
    const entries: Entry[] = [];

    let flow: Flow = input.kind === "flat"
        ? { tokens: null, width: input.dimension, image: null }
        : { tokens: null, width: null, image: { height: input.height, width: input.width, channels: input.channels } };

    // A branch starts from its split's flow; the branches' ends then carry on.
    const splitFlows: Flow[] = [];

    expanded.forEach((layer, index) => {
        const id = `${stack}/L${index}`;
        const where = `${layer.path} (${layer.sourceKind})`;

        if (layer.kind === "split")
            splitFlows.push(flow);

        const before = flow;
        let parameters: Parameter[];
        let components: Component[];

        if (layer.kind === "unknown") {
            parameters = decodeUnchecked(weights[index], where);
            components = [{ id: `${id}/unknown`, name: "unknown", kind: "unknown", units: 1, parameters }];
            flow = LOST;
        } else {
            const reading = readEntry(layer, flow, stateWidth);
            parameters = decodeParameters(weights[index], reading.names, reading.expected, where);
            components = reading.components(parameters, id);
            flow = reading.after;
        }

        // A branch end hands its split's flow to the next branch; the last branch's end carries on.
        if (layer.kind === "branch")
            flow = splitFlows[splitFlows.length - 1];

        if (layer.kind === "merge")
            splitFlows.pop();

        if (layer.kind === "add" && layer.partner !== null) {
            const forkWidth = entries[layer.partner].inWidth;

            if (forkWidth !== null && flow.width !== null && forkWidth !== flow.width)
                throw new Format2Error(`${where}: the block's body ends ${flow.width} wide, but its input is ${forkWidth} wide`);
        }

        entries.push({
            id,
            index,
            kind: layer.kind,
            sourceKind: layer.sourceKind,
            spec: layer.spec,
            path: layer.path,
            lane: layer.lane,
            factor: null,
            inWidth: flowWidth(before),
            outWidth: flowWidth(flow),
            partner: layer.partner,
            parameters,
            components,
        });
    });

    let factors: Factor[] = [];

    if (recurrence) {
        const reads = factorReads(expanded, recurrence.factors.length, recurrence.pooling.reads);
        let index = expanded.length;

        factors = recurrence.factors.map((factor, g) => {
            const d = entries[reads[g]]?.inWidth ?? null;
            const s = factor.stateSize;
            const cellInput = d === null ? null : d + (recurrence.cross ? stateWidth! - s : 0);

            const part = (kind: EntryKind, names: string[], expected: Expected[], units: number) => {
                const id = `${stack}/L${index}`;
                const path = `factor ${g} ${kind.replace("_", " ")}`;
                const parameters = decodeParameters(weights[index], names, expected, `${path} (recurrence)`);

                entries.push({
                    id,
                    index,
                    kind,
                    sourceKind: "recurrence",
                    spec: {},
                    path,
                    lane: null,
                    factor: g,
                    inWidth: null,
                    outWidth: null,
                    partner: null,
                    parameters,
                    components: [{ id: `${id}/${kind}`, name: kind, kind, units, parameters }],
                });
                index++;
            };

            part("pooling", ["q"], [[d]], d ?? 1);
            part("cell", ["W", "U", "b"], [[3 * s, cellInput], [3 * s, s], [3 * s]], s);

            if (factor.codes)
                part("codes", ["E"], [[factor.codes.count, s]], factor.codes.count);

            part("initial_state", ["c"], [[s]], s);

            return { ...factor, reads: reads[g] };
        });
    }

    const tokenWidth = entries.find(entry => entry.kind === "embedding" || entry.kind === "patches")?.outWidth ?? null;
    const widest = entries.reduce((most, entry) => Math.max(most, entry.outWidth ?? 0), 0);

    return {
        implementation: json.implementation as Implementation,
        shape: json.shape as ModelShape,
        preset: isObject(json.preset) && typeof json.preset.class === "string" ? json.preset.class : null,
        input,
        stacks: [{ id: stack, entries }],
        recurrence: recurrence ? { ...recurrence, factors } : null,
        width: tokenWidth ?? (widest > 0 ? widest : null),
    };
}
