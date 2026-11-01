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
import { incomingOf } from "./Incoming";

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

/** A component as the graph shows it: one node, or one node per unit when expanded. */
interface Port {
    nodes: number[];
    expanded: boolean;
    component: Component;
    entry: Entry;
}

export interface BuildOptions {
    /** Component ids shown at the unit level (D7 L1); every other component is one node. */
    expanded?: ReadonlySet<string>;
    /** The strongest incoming weights drawn per unit; `K.network.edgesPerUnit` by default. */
    edgesPerUnit?: number;
}

// Above this many pairs, a structural link between two ports (a skip, a loop, the cross term) joins them
// unit by unit, or through their first nodes, instead of all to all.
const LINK_ALL_MAX = 64;

/** A unit node's id: its component's, then its index. */
export function unitId(component: Component, unit: number): string {
    return `${component.id}/u${unit}`;
}

/**
 * Builds the render graph: every component one node (L0), except those in `expanded`, which become one node
 * per unit with weight edges to their strongest inputs (L1).
 */
export function buildGraph(model: NetworkModel, options: BuildOptions = {}): BuiltGraph {

    const expanded = options.expanded ?? new Set<string>();
    const edgesPerUnit = Math.max(1, Math.floor(options.edgesPerUnit ?? K.network.edgesPerUnit));

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

    // Normalised by the largest component RMS, so a component-level flow edge's weight is in (0, 1].
    let maxRms = 0;

    for (const stack of model.stacks)
        for (const entry of stack.entries)
            for (const component of entry.components)
                maxRms = Math.max(maxRms, component.parameters[0]?.stats.rms ?? 0);

    const flowWeight = (component: Component) =>
        maxRms > 0 ? Math.max((component.parameters[0]?.stats.rms ?? 0) / maxRms, 0.05) : 1;

    let dotted = false;

    const flowKind = () => EdgeKind.flow | (dotted ? EdgeKind.dotted : 0);

    const addPort = (entry: Entry, component: Component, band: number): Port => {
        const kind = nodeKindOf(entry, component);
        const group = components.length;
        const open = expanded.has(component.id) && component.units > 1;
        const label = labelOf(entry, component, kind);
        const marks = marksOf(entry, kind);
        const count = open ? component.units : 1;
        const out: number[] = [];

        for (let k = 0; k < count; k++) {
            out.push(nodes.length);
            bands[band].members.push(nodes.length);
            nodes.push({
                id: open ? unitId(component, k) : component.id,
                label: open ? `${label} · ${k}` : label,
                kind,
                marks: open ? Mark.unit : marks,
                group,
                band,
            });
        }

        components.push(component);
        componentEntries.push(entry);

        return { nodes: out, expanded: open, component, entry };
    };

    /** Every pair, or unit by unit, or first to first: a structural link that stays small. */
    const link = (from: number[], to: number[], kind: number, weight: number) => {
        if (from.length * to.length <= LINK_ALL_MAX) {
            for (const a of from)
                for (const b of to)
                    edges.push({ a, b, kind, weight });
        }
        else if (from.length === to.length) {
            from.forEach((a, i) => edges.push({ a, b: to[i], kind, weight }));
        }
        else {
            edges.push({ a: from[0], b: to[0], kind, weight });
        }
    };

    /** The data flow into `to` from the ports feeding it: weight edges between units where both ends are open. */
    const connect = (from: Port[], to: Port) => {
        const kind = flowKind();

        if (!to.expanded) {
            const weight = flowWeight(to.component);

            for (const port of from)
                for (const a of port.nodes)
                    edges.push({ a, b: to.nodes[0], kind, weight });

            return;
        }

        const incoming = incomingOf(to.entry, to.component);
        const features = from.every(port => port.expanded) ? from.flatMap(port => port.nodes) : null;

        if (incoming !== null && features !== null && incoming.rows === to.nodes.length) {

            if (incoming.kind === "matrix" && incoming.cols === features.length) {
                topWeights(incoming.rows, incoming.cols, incoming.at, edgesPerUnit, (r, c, w) =>
                    edges.push({ a: features[c], b: to.nodes[r], kind: EdgeKind.weight | (kind & EdgeKind.dotted), weight: w }));
                return;
            }

            if (incoming.kind === "diagonal" && features.length === incoming.rows) {
                let largest = 0;

                for (let r = 0; r < incoming.rows; r++)
                    largest = Math.max(largest, Math.abs(incoming.at(r)));

                for (let r = 0; r < incoming.rows; r++)
                    edges.push({ a: features[r], b: to.nodes[r], kind: EdgeKind.weight | (kind & EdgeKind.dotted), weight: largest > 0 ? incoming.at(r) / largest : 1 });

                return;
            }
        }

        // The ends do not line up unit for unit (a collapsed source, or a flattened image): each unit hears
        // each source port through that port's first node.
        const weight = flowWeight(to.component);

        for (const port of from)
            for (const b of to.nodes)
                edges.push({ a: port.nodes[0], b, kind, weight });
    };

    model.stacks.forEach((stack, s) => {

        const entries = stack.entries;
        const windowEntries = entries.filter(entry => entry.factor === null);
        const parts = entries.filter(entry => entry.factor !== null);

        // The ports feeding each entry, recorded so a factor's pooling can read any entry's input.
        const before = new Map<number, Port[]>();

        let frontier: Port[] = [];
        let layer = 0;
        let lastBand = NO_BAND;

        const forkFrontiers = new Map<number, Port[]>();
        let splitLayer = 0;
        let splitFrontier: Port[] = [];
        let laneTop = 0;
        let laneCount = 1;
        const branchEnds: Port[][] = [];
        const stateInputs: Port[] = [];

        dotted = false;

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
                const band = lastBand === NO_BAND ? bandFor(s, layer++, entry.lane, laneCount, Family.feedForward, true) : lastBand;
                const plus = addPort(entry, entry.components[0], band);

                connect(frontier, plus);
                dotted = false;

                for (const port of forkFrontiers.get(entry.partner ?? -1) ?? [])
                    link(port.nodes, plus.nodes, EdgeKind.residual, 1);

                frontier = [plus];
                continue;
            }

            if (entry.kind === "merge") {
                layer = Math.max(laneTop, layer);
                laneCount = 1;
                const sigma = addPort(entry, entry.components[0], bandFor(s, layer++, null, 1, Family.feedForward, true));

                for (const end of [...branchEnds, frontier])
                    connect(end, sigma);

                dotted = false;
                frontier = [sigma];
                lastBand = nodes[sigma.nodes[0]].band;
                continue;
            }

            const kind = nodeKindOf(entry, entry.components[0]);
            const family = nodeFamily(kind);
            const thin = family === Family.normalisation || kind === NodeKind.tokenMean;
            const lanes = entry.lane === null ? 1 : laneCount;
            const band = bandFor(s, layer++, entry.lane, lanes, family, thin);
            const ports = entry.components.map(component => addPort(entry, component, band));

            lastBand = band;

            if (entry.kind === "state_input")
                stateInputs.push(...ports);

            if (entry.kind === "attention" && ports.length > 1) {
                const heads = ports.slice(0, -1);
                const out = ports[ports.length - 1];

                for (const head of heads)
                    connect(frontier, head);

                dotted = false;
                connect(heads, out);
                frontier = [out];
                continue;
            }

            for (const port of ports)
                connect(frontier, port);

            dotted = false;
            frontier = ports;
        }

        if (parts.length === 0 || model.recurrence === null)
            return;

        // The recurrent parts sit above the window, one z-lane per factor: pooling and initial state, then
        // the cell, then the codes.
        const top = Math.max(layer, laneTop);
        const factorCount = model.recurrence.factors.length;
        const cells: Port[] = [];
        const states: Port[] = [];

        for (const factor of model.recurrence.factors) {
            const own = parts.filter(entry => entry.factor === factor.index);
            const portOf = (kind: string, row: number): Port | null => {
                const entry = own.find(e => e.kind === kind);
                return entry ? addPort(entry, entry.components[0], bandFor(s, top + row, factor.index, factorCount, Family.recurrence, false)) : null;
            };

            const pooling = portOf("pooling", 0);
            const initial = portOf("initial_state", 0);
            const cell = portOf("cell", 1);
            const codes = portOf("codes", 2);

            if (pooling === null || cell === null)
                continue;

            connect(before.get(factor.reads) ?? [], pooling);
            connect([pooling], cell);

            if (initial !== null)
                link(initial.nodes, cell.nodes, EdgeKind.flow, 1);

            if (codes !== null)
                connect([cell], codes);

            cells.push(cell);
            states.push(codes ?? cell);
        }

        for (const state of states)
            for (const input of stateInputs)
                link(state.nodes, input.nodes, EdgeKind.recurrent, 1);

        if (model.recurrence.cross)
            for (let g = 0; g < cells.length; g++)
                for (let h = g + 1; h < cells.length; h++)
                    link(cells[g].nodes, cells[h].nodes, EdgeKind.cross, 1);
    });

    const kept = capWeightEdges(edges, nodes, K.network.maxWeightEdgesPerBand);
    const table = bandTable(bands, model.stacks.length);
    const attributes = emptyAttributes(nodes.length, kept.length, bands.length);
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

    kept.forEach((edge, j) => {
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

/**
 * Each row's `k` strongest entries by |w|, normalised by the matrix's largest |w| over those kept, handed to
 * `emit` in row order, then strength order. Ties keep the lower column.
 */
function topWeights(
    rows: number,
    cols: number,
    at: (r: number, c: number) => number,
    k: number,
    emit: (r: number, c: number, weight: number) => void
): void {

    const keep = Math.min(k, cols);
    const chosen: Array<[number, number, number]> = [];
    let largest = 0;
    const bestColumn = new Int32Array(keep);
    const bestValue = new Float64Array(keep);

    for (let r = 0; r < rows; r++) {
        let filled = 0;

        for (let c = 0; c < cols; c++) {
            const w = at(r, c);
            const magnitude = Math.abs(w);

            // Insertion into a short sorted list: k is a handful.
            let slot = filled;

            while (slot > 0 && Math.abs(bestValue[slot - 1]) < magnitude)
                slot--;

            if (slot >= keep)
                continue;

            for (let t = Math.min(filled, keep - 1); t > slot; t--) {
                bestColumn[t] = bestColumn[t - 1];
                bestValue[t] = bestValue[t - 1];
            }

            bestColumn[slot] = c;
            bestValue[slot] = w;
            filled = Math.min(filled + 1, keep);
        }

        for (let t = 0; t < filled; t++) {
            chosen.push([r, bestColumn[t], bestValue[t]]);
            largest = Math.max(largest, Math.abs(bestValue[t]));
        }
    }

    for (const [r, c, w] of chosen)
        emit(r, c, largest > 0 ? w / largest : 0);
}

/**
 * A band's weight edges beyond `cap` are dropped, weakest first, so one huge layer cannot flood the frame;
 * every other edge is kept. Order is otherwise unchanged.
 */
function capWeightEdges(edges: PendingEdge[], nodes: PendingNode[], cap: number): PendingEdge[] {

    const perBand = new Map<number, number[]>();

    edges.forEach((edge, j) => {
        if ((edge.kind & ~EdgeKind.dotted) !== EdgeKind.weight)
            return;

        const band = nodes[edge.b].band;
        const list = perBand.get(band) ?? [];
        list.push(j);
        perBand.set(band, list);
    });

    const dropped = new Set<number>();

    for (const list of perBand.values()) {
        if (list.length <= cap)
            continue;

        const ranked = [...list].sort((a, b) => Math.abs(edges[b].weight) - Math.abs(edges[a].weight) || a - b);

        for (const j of ranked.slice(cap))
            dropped.add(j);
    }

    return dropped.size === 0 ? edges : edges.filter((_, j) => !dropped.has(j));
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
