// A render graph's static attributes (workplan D4, D10): struct-of-arrays indexed like `vertices` and
// `edges`, plus the band table. The network builder owns them; the physics and render workers receive
// copies at init, and nothing here changes per frame. A graph without attributes (the test fixture) draws
// and steps as before: generic nodes, plain edges, no bands.

/** What a node draws as. The renderer maps each to a glyph and a family colour (D8). */
export const NodeKind = {
    generic: 0,
    embedding: 1,
    position: 2,
    patches: 3,
    stateInput: 4,
    dense: 5,
    output: 6,
    layerNorm: 7,
    batchNorm: 8,
    head: 9,
    attentionOutput: 10,
    conv: 11,
    pool: 12,
    tokenMean: 13,
    add: 14,
    merge: 15,
    pooling: 16,
    cell: 17,
    codes: 18,
    initialState: 19,
    unknown: 20,
    unit: 21,
} as const;

export type NodeKindValue = typeof NodeKind[keyof typeof NodeKind];

/** Colour encodes family (D8); bands carry their family so an outline can take its tint. */
export const Family = {
    input: 0,
    normalisation: 1,
    attention: 2,
    feedForward: 3,
    output: 4,
    recurrence: 5,
    other: 6,
} as const;

export type FamilyValue = typeof Family[keyof typeof Family];

export function nodeFamily(kind: number): FamilyValue {
    switch (kind) {
        case NodeKind.embedding:
        case NodeKind.position:
        case NodeKind.patches:
            return Family.input;
        case NodeKind.layerNorm:
        case NodeKind.batchNorm:
            return Family.normalisation;
        case NodeKind.head:
        case NodeKind.attentionOutput:
            return Family.attention;
        case NodeKind.dense:
        case NodeKind.conv:
        case NodeKind.pool:
        case NodeKind.tokenMean:
        case NodeKind.add:
        case NodeKind.merge:
            return Family.feedForward;
        case NodeKind.output:
            return Family.output;
        case NodeKind.stateInput:
        case NodeKind.pooling:
        case NodeKind.cell:
        case NodeKind.codes:
        case NodeKind.initialState:
            return Family.recurrence;
        default:
            return Family.other;
    }
}

/** What an edge means. `dotted` is a flag on top of the kind: the data leaving a dropout. */
export const EdgeKind = {
    flow: 0,
    residual: 1,
    recurrent: 2,
    cross: 3,
    weight: 4,
    dotted: 0x80,
} as const;

/** Variant marks drawn over a glyph (D8), one bit each, plus the activation in bits 8-11. */
export const Mark = {
    causal: 1 << 0,
    rotary: 1 << 1,
    dropout: 1 << 2,
    segments: 1 << 3,
    hatched: 1 << 4,
    hollow: 1 << 5,
    // A unit of an expanded component: drawn as a plain dot in its component's family colour.
    unit: 1 << 6,
    activationShift: 8,
    activationMask: 0xf << 8,
} as const;

export const Activation = {
    none: 0,
    sigmoid: 1,
    relu: 2,
    linear: 3,
    softmax: 4,
    gelu: 5,
    other: 15,
} as const;

/** A band's values in the table: y centre, half thickness, the x and z footprint bounds, its family. */
export const BAND_STRIDE = 7;
export const BAND_Y = 0;
export const BAND_HALF = 1;
export const BAND_X_MIN = 2;
export const BAND_X_MAX = 3;
export const BAND_Z_MIN = 4;
export const BAND_Z_MAX = 5;
export const BAND_FAMILY = 6;

/** No band: a node the clamp leaves free. */
export const NO_BAND = -1;

export interface GraphAttributes {
    kind: Uint8Array;
    band: Int32Array;
    /** The component a node belongs to, an index into the builder's component list. */
    group: Int32Array;
    marks: Uint16Array;
    edgeKind: Uint8Array;
    /** Signed, normalised to [-1, 1]: width and alpha from |weight|, hue from the sign. */
    weight: Float32Array;
    bands: Float64Array;
}

export function emptyAttributes(nodes: number, edges: number, bands: number): GraphAttributes {
    return {
        kind: new Uint8Array(nodes),
        band: new Int32Array(nodes).fill(NO_BAND),
        group: new Int32Array(nodes),
        marks: new Uint16Array(nodes),
        edgeKind: new Uint8Array(edges),
        weight: new Float32Array(edges),
        bands: new Float64Array(bands * BAND_STRIDE),
    };
}

/** Fresh arrays with the same contents, for a message whose buffers are transferred. */
export function copyAttributes(a: GraphAttributes): GraphAttributes {
    return {
        kind: a.kind.slice(),
        band: a.band.slice(),
        group: a.group.slice(),
        marks: a.marks.slice(),
        edgeKind: a.edgeKind.slice(),
        weight: a.weight.slice(),
        bands: a.bands.slice(),
    };
}

/** The buffers to transfer with an init message carrying `a`. */
export function attributeBuffers(a: GraphAttributes): ArrayBuffer[] {
    return [a.kind, a.band, a.group, a.marks, a.edgeKind, a.weight, a.bands].map(view => view.buffer as ArrayBuffer);
}

export function bandCount(a: GraphAttributes): number {
    return a.bands.length / BAND_STRIDE;
}

/** Why `a` cannot index a graph of this size, or null when it fits. */
export function attributeMismatch(a: GraphAttributes, nodes: number, edges: number): string | null {
    for (const [name, view] of [["kind", a.kind], ["band", a.band], ["group", a.group], ["marks", a.marks]] as const)
        if (view.length !== nodes)
            return `${name} has ${view.length} entries for ${nodes} nodes`;

    for (const [name, view] of [["edgeKind", a.edgeKind], ["weight", a.weight]] as const)
        if (view.length !== edges)
            return `${name} has ${view.length} entries for ${edges} edges`;

    if (a.bands.length % BAND_STRIDE !== 0)
        return `the band table's length ${a.bands.length} is not a multiple of ${BAND_STRIDE}`;

    const bands = bandCount(a);

    for (let i = 0; i < nodes; i++)
        if (a.band[i] < NO_BAND || a.band[i] >= bands)
            return `node ${i} is in band ${a.band[i]}, outside the table's ${bands}`;

    return null;
}
