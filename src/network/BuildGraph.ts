// The render graph built from a NetworkModel (workplan §4.2, D4, D7, D8): one node per component at the
// component level (L0), the data flow between them as edges, and each node's band. Pure and deterministic:
// nodes are inserted in expanded-entry order, then component order, so invariant 4 still means something.

import {
    Activation,
    BAND_FAMILY,
    BAND_HALF,
    BAND_STRIDE,
    BAND_X_MAX,
    BAND_X_MIN,
    BAND_Y,
    BAND_Z_MAX,
    BAND_Z_MIN,
    EdgeKind,
    emptyAttributes,
    Family,
    FamilyValue,
    GraphAttributes,
    Mark,
    NO_BAND,
    NodeKind,
    NodeKindValue,
    nodeFamily,
} from "../graph/Attributes";
import { Graph } from "../graph/Graph";
import { K } from "../core/K";
import { point3 } from "../core/Point3D";
import { Tag } from "../graph/Tag";
import { Component, Entry, NetworkModel } from "./NetworkModel";

export interface BuiltGraph {
    graph: Graph;
    /** Each node's stable id (a component's id at L0), indexed like `graph.vertices`. */
    ids: string[];
    /** The components the nodes' `group` indexes, and the entry each belongs to. */
    components: Component[];
    componentEntries: Entry[];
    /** Each band's key, `stack|layer|lane`, indexed like the band table. */
    bandKeys: string[];
}

interface PendingNode {
    id: string;
    label: string;
    kind: NodeKindValue;
    marks: number;
    group: number;
    band: number;
}

interface PendingEdge {
    a: number;
    b: number;
    kind: number;
    weight: number;
}

interface BandSpec {
    key: string;
    stack: number;
    layer: number;
    lane: number | null;
    lanes: number;
    family: FamilyValue;
    thin: boolean;
    members: number[];
}

function nodeKindOf(entry: Entry, component: Component): NodeKindValue {
    switch (component.kind) {
        case "embedding": return NodeKind.embedding;
        case "position": return NodeKind.position;
        case "patches": return NodeKind.patches;
        case "state_input": return NodeKind.stateInput;
        case "dense": return entry.spec.output === true ? NodeKind.output : NodeKind.dense;
        case "layer_norm": return NodeKind.layerNorm;
        case "batch_norm": return NodeKind.batchNorm;
        case "head": return NodeKind.head;
        case "attention_output": return NodeKind.attentionOutput;
        case "attention": return NodeKind.head;
        case "conv": return NodeKind.conv;
        case "pool": return NodeKind.pool;
        case "token_mean": return NodeKind.tokenMean;
        case "add": return NodeKind.add;
        case "merge": return NodeKind.merge;
        case "pooling": return NodeKind.pooling;
        case "cell": return NodeKind.cell;
        case "codes": return NodeKind.codes;
        case "initial_state": return NodeKind.initialState;
        default: return NodeKind.unknown;
    }
}

const ACTIVATIONS: Record<string, number> = {
    sigmoid: Activation.sigmoid,
    relu: Activation.relu,
    linear: Activation.linear,
    softmax: Activation.softmax,
    gelu: Activation.gelu,
};

function marksOf(entry: Entry, kind: NodeKindValue): number {
    const spec = entry.spec;
    let marks = 0;

    if (kind === NodeKind.head || kind === NodeKind.attentionOutput) {
        if (spec.causal === true)
            marks |= Mark.causal;

        if (spec.positions === "rotary")
            marks |= Mark.rotary;

        if (typeof spec.dropout === "number" && spec.dropout > 0)
            marks |= Mark.dropout;
    }

    if (kind === NodeKind.dense || kind === NodeKind.output || kind === NodeKind.conv) {
        const name = typeof spec.activation === "string" ? spec.activation : kind === NodeKind.conv ? "relu" : "sigmoid";
        marks |= (ACTIVATIONS[name] ?? Activation.other) << Mark.activationShift;

        if (typeof spec.dropout === "number" && spec.dropout > 0)
            marks |= Mark.dropout;
    }

    if (kind === NodeKind.embedding && spec.segments === true)
        marks |= Mark.segments;

    if (kind === NodeKind.batchNorm)
        marks |= Mark.hatched;

    if (kind === NodeKind.tokenMean || kind === NodeKind.pool || kind === NodeKind.position || kind === NodeKind.initialState)
        marks |= Mark.hollow;

    return marks;
}

function labelOf(entry: Entry, component: Component, kind: NodeKindValue): string {
    const spec = entry.spec;
    const factor = entry.factor === null ? "" : ` f${entry.factor}`;

    switch (kind) {
        case NodeKind.embedding: return `embedding ${spec.vocabulary}×${spec.size}`;
        case NodeKind.position: return "position";
        case NodeKind.patches: return `patches ${spec.patch_size}`;
        case NodeKind.stateInput: return "state input";
        case NodeKind.dense: return `dense ${spec.size} ${spec.activation ?? "sigmoid"}`;
        case NodeKind.output: return `output ${spec.size} ${spec.activation ?? "sigmoid"}`;
        case NodeKind.layerNorm: return "layer norm";
        case NodeKind.batchNorm: return "batch norm";
        case NodeKind.head: return `${component.name} · d_k ${component.units}`;
        case NodeKind.attentionOutput: return "Wo";
        case NodeKind.conv: return `conv ${spec.kernel_size}×${spec.kernel_size}, ${spec.channel_count}`;
        case NodeKind.pool: return `pool ${spec.pool_size}`;
        case NodeKind.tokenMean: return "token mean";
        case NodeKind.add: return "+";
        case NodeKind.merge: return "Σ";
        case NodeKind.pooling: return `pooling${factor}`;
        case NodeKind.cell: return `GRU${factor} · s ${component.units}`;
        case NodeKind.codes: return `codes${factor} · ${component.units}`;
        case NodeKind.initialState: return `initial state${factor}`;
        default: return `${entry.sourceKind} (unsupported)`;
    }
}

/** Builds the component-level render graph. `expanded` is reserved for the unit level (D7 L1). */
export function buildGraph(model: NetworkModel, _expanded: ReadonlySet<string> = new Set()): BuiltGraph {

    const nodes: PendingNode[] = [];
    const edges: PendingEdge[] = [];
    const bands: BandSpec[] = [];
    const bandIndex = new Map<string, number>();
    const components: Component[] = [];
    const componentEntries: Entry[] = [];

    const bandFor = (stack: number, layer: number, lane: number | null, lanes: number, family: FamilyValue, thin: boolean): number => {
        const key = `${stack}|${layer}|${lane ?? "-"}`;
        const known = bandIndex.get(key);

        if (known !== undefined)
            return known;

        bands.push({ key, stack, layer, lane, lanes, family, thin, members: [] });
        bandIndex.set(key, bands.length - 1);
        return bands.length - 1;
    };

    // Normalised by the largest component RMS, so a flow edge's weight is in (0, 1].
    let maxRms = 0;

    for (const stack of model.stacks)
        for (const entry of stack.entries)
            for (const component of entry.components)
                maxRms = Math.max(maxRms, component.parameters[0]?.stats.rms ?? 0);

    const flowWeight = (component: Component) =>
        maxRms > 0 ? Math.max((component.parameters[0]?.stats.rms ?? 0) / maxRms, 0.05) : 1;

    model.stacks.forEach((stack, s) => {

        const entries = stack.entries;
        const windowEntries = entries.filter(entry => entry.factor === null);
        const parts = entries.filter(entry => entry.factor !== null);

        // Node indices feeding each entry, recorded so a factor's pooling can read any entry's input.
        const before = new Map<number, number[]>();

        let frontier: number[] = [];
        let layer = 0;
        let dotted = false;
        let lastBand = NO_BAND;

        const forkFrontiers = new Map<number, number[]>();
        let splitLayer = 0;
        let splitFrontier: number[] = [];
        let laneTop = 0;
        let laneCount = 1;
        const branchEnds: number[][] = [];
        const stateInputs: number[] = [];

        const addFlow = (from: number[], to: number, weight: number) => {
            const kind = EdgeKind.flow | (dotted ? EdgeKind.dotted : 0);

            for (const a of from)
                edges.push({ a, b: to, kind, weight });
        };

        const addNodes = (entry: Entry, band: number): number[] => {
            return entry.components.map(component => {
                const kind = nodeKindOf(entry, component);
                const index = nodes.length;

                nodes.push({
                    id: component.id,
                    label: labelOf(entry, component, kind),
                    kind,
                    marks: marksOf(entry, kind),
                    group: components.length,
                    band,
                });
                bands[band].members.push(index);
                components.push(component);
                componentEntries.push(entry);
                return index;
            });
        };

        for (const entry of windowEntries) {

            before.set(entry.index, frontier);

            if (entry.kind === "split") {
                splitLayer = layer;
                splitFrontier = frontier;
                laneTop = layer;
                laneCount = typeof entry.spec.branches === "number" ? entry.spec.branches : 1;
                branchEnds.length = 0;
                continue;
            }

            if (entry.kind === "branch") {
                branchEnds.push(frontier);
                laneTop = Math.max(laneTop, layer);
                layer = splitLayer;
                frontier = splitFrontier;
                continue;
            }

            // Leaving the branches: the layers carry on above the tallest branch.
            if (entry.lane === null && laneCount > 1 && entry.kind !== "merge") {
                layer = Math.max(laneTop, layer);
                laneCount = 1;
            }

            if (entry.kind === "fork") {
                forkFrontiers.set(entry.index, frontier);
                continue;
            }

            if (entry.kind === "dropout") {
                dotted = true;
                continue;
            }

            if (entry.components.length === 0)
                continue;

            if (entry.kind === "add") {
                // The "+" sits at the join, in the band of the body's last layer.
                const [plus] = addNodes(entry, lastBand === NO_BAND ? bandFor(s, layer++, entry.lane, laneCount, Family.feedForward, true) : lastBand);
                addFlow(frontier, plus, 1);
                dotted = false;

                for (const a of forkFrontiers.get(entry.partner ?? -1) ?? [])
                    edges.push({ a, b: plus, kind: EdgeKind.residual, weight: 1 });

                frontier = [plus];
                continue;
            }

            if (entry.kind === "merge") {
                layer = Math.max(laneTop, layer);
                laneCount = 1;
                const [sigma] = addNodes(entry, bandFor(s, layer++, null, 1, Family.feedForward, true));

                for (const end of [...branchEnds, frontier])
                    addFlow(end, sigma, 1);

                dotted = false;
                frontier = [sigma];
                lastBand = nodes[sigma].band;
                continue;
            }

            const kind = nodeKindOf(entry, entry.components[0]);
            const family = nodeFamily(kind);
            const thin = family === Family.normalisation || kind === NodeKind.tokenMean;
            const lanes = entry.lane === null ? 1 : laneCount;
            const band = bandFor(s, layer++, entry.lane, lanes, family, thin);
            const added = addNodes(entry, band);

            lastBand = band;

            if (entry.kind === "state_input")
                stateInputs.push(...added);

            if (entry.kind === "attention" && added.length > 1) {
                const out = added[added.length - 1];
                const heads = added.slice(0, -1);

                heads.forEach((head, h) => addFlow(frontier, head, flowWeight(entry.components[h])));
                dotted = false;

                for (const head of heads)
                    edges.push({ a: head, b: out, kind: EdgeKind.flow, weight: flowWeight(entry.components[entry.components.length - 1]) });

                frontier = [out];
                continue;
            }

            added.forEach((node, c) => addFlow(frontier, node, flowWeight(entry.components[c])));
            dotted = false;
            frontier = added;
        }

        if (parts.length === 0 || model.recurrence === null)
            return;

        // The recurrent parts sit above the window, one z-lane per factor: pooling and initial state, then
        // the cell, then the codes.
        const top = Math.max(layer, laneTop);
        const factorCount = model.recurrence.factors.length;
        const cells: number[] = [];
        const states: number[] = [];

        for (const factor of model.recurrence.factors) {
            const own = parts.filter(entry => entry.factor === factor.index);
            const nodeOf = (kind: string, row: number): number | null => {
                const entry = own.find(e => e.kind === kind);
                return entry ? addNodes(entry, bandFor(s, top + row, factor.index, factorCount, Family.recurrence, false))[0] : null;
            };

            const pooling = nodeOf("pooling", 0);
            const initial = nodeOf("initial_state", 0);
            const cell = nodeOf("cell", 1);
            const codes = nodeOf("codes", 2);

            if (pooling === null || cell === null)
                continue;

            for (const a of before.get(factor.reads) ?? [])
                edges.push({ a, b: pooling, kind: EdgeKind.flow, weight: 1 });

            edges.push({ a: pooling, b: cell, kind: EdgeKind.flow, weight: 1 });

            if (initial !== null)
                edges.push({ a: initial, b: cell, kind: EdgeKind.flow, weight: 1 });

            if (codes !== null)
                edges.push({ a: cell, b: codes, kind: EdgeKind.flow, weight: 1 });

            cells.push(cell);
            states.push(codes ?? cell);
        }

        for (const state of states)
            for (const input of stateInputs)
                edges.push({ a: state, b: input, kind: EdgeKind.recurrent, weight: 1 });

        if (model.recurrence.cross)
            for (let g = 0; g < cells.length; g++)
                for (let h = g + 1; h < cells.length; h++)
                    edges.push({ a: cells[g], b: cells[h], kind: EdgeKind.cross, weight: 1 });
    });

    const table = bandTable(bands, model.stacks.length);
    const attributes = emptyAttributes(nodes.length, edges.length, bands.length);
    attributes.bands.set(table);

    const graph = new Graph();
    const seeds = seedPositions(nodes, bands, table);

    nodes.forEach((node, i) => {
        graph.addNode(new Tag(seeds[i], node.label));
        attributes.kind[i] = node.kind;
        attributes.band[i] = node.band;
        attributes.group[i] = node.group;
        attributes.marks[i] = node.marks;
    });

    edges.forEach((edge, j) => {
        graph.addEdge(graph.vertices[edge.a], graph.vertices[edge.b]);
        attributes.edgeKind[j] = edge.kind;
        attributes.weight[j] = edge.weight;
    });

    graph.attributes = attributes;

    return {
        graph,
        ids: nodes.map(node => node.id),
        components,
        componentEntries,
        bandKeys: bands.map(band => band.key),
    };
}

/** Band geometry (D5, D6): layers up model y from the input, stacks along x, lanes along z. */
function bandTable(bands: BandSpec[], stacks: number): Float64Array {
    const net = K.network;
    const table = new Float64Array(bands.length * BAND_STRIDE);

    const layers = bands.reduce((most, band) => Math.max(most, band.layer + 1), 0);
    const pitch = net.bandThickness + net.bandGap;
    const side = (n: number) => Math.max(net.minFootprint, net.unitSpacing * Math.ceil(Math.sqrt(n)));

    // Lanes line up across layers, so each lane is as deep as the deepest band in any lane.
    const laneSide = bands.reduce((most, band) => band.lane === null ? most : Math.max(most, side(band.members.length)), net.minFootprint);
    const stackPitch = bands.reduce((most, band) => Math.max(most, side(band.members.length)), net.minFootprint) + net.stackGap;

    bands.forEach((band, i) => {
        const o = i * BAND_STRIDE;
        const width = band.lane === null ? side(band.members.length) : laneSide;
        const xCentre = (band.stack - (stacks - 1) / 2) * stackPitch;

        let zMin = -width / 2;
        let zMax = width / 2;

        if (band.lane !== null) {
            const total = band.lanes * laneSide + (band.lanes - 1) * net.laneGap;
            zMin = -total / 2 + band.lane * (laneSide + net.laneGap);
            zMax = zMin + laneSide;
        }

        table[o + BAND_Y] = (band.layer - (layers - 1) / 2) * pitch;
        table[o + BAND_HALF] = (band.thin ? net.thinBandThickness : net.bandThickness) / 2;
        table[o + BAND_X_MIN] = xCentre - width / 2;
        table[o + BAND_X_MAX] = xCentre + width / 2;
        table[o + BAND_Z_MIN] = zMin;
        table[o + BAND_Z_MAX] = zMax;
        table[o + BAND_FAMILY] = band.family;
    });

    return table;
}

/** Each band's members on a grid across its footprint, at the band's centre height. */
function seedPositions(nodes: PendingNode[], bands: BandSpec[], table: Float64Array) {
    const out = nodes.map(() => point3(0, 0, 0));

    bands.forEach((band, i) => {
        const o = i * BAND_STRIDE;
        const n = band.members.length;
        const columns = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / columns);
        const xSpan = table[o + BAND_X_MAX] - table[o + BAND_X_MIN];
        const zSpan = table[o + BAND_Z_MAX] - table[o + BAND_Z_MIN];

        band.members.forEach((node, k) => {
            const column = k % columns;
            const row = Math.floor(k / columns);

            out[node] = point3(
                table[o + BAND_X_MIN] + (column + 0.5) * xSpan / columns,
                table[o + BAND_Y],
                table[o + BAND_Z_MIN] + (row + 0.5) * zSpan / rows
            );
        });
    });

    return out;
}

/** The attributes of a built graph, which `buildGraph` always sets. */
export function attributesOf(built: BuiltGraph): GraphAttributes {
    return built.graph.attributes!;
}
