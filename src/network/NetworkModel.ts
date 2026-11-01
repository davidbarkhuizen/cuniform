// The parsed network (workplan D4): stacks hold expanded layer entries, entries hold components, and
// components count their units. Pure data; the render graph is built from it at a level of detail.

/** The array implementations, which share one weight layout (D2). */
export type Implementation = "numpy" | "rust";

export type ModelShape = "sequence" | "multiclass" | "single_output" | "window_recurrent";

export type InputSpec =
    | { kind: "flat"; dimension: number }
    | { kind: "image"; height: number; width: number; channels: number };

export interface WeightStats {
    count: number;
    min: number;
    max: number;
    mean: number;
    rms: number;
}

/** One weight array, row-major, with its statistics computed once by the reader. */
export interface Parameter {
    name: string;
    shape: readonly number[];
    data: Float32Array;
    stats: WeightStats;
}

/**
 * An expanded format-2 layer (`expand_specs`: a residual is fork, body, add; branches are split, the
 * branches with a branch after all but the last, then merge if merged), or one of a window-recurrent
 * network's own parts, which follow the window's layers in the weight list.
 */
export type EntryKind =
    | "embedding"
    | "position"
    | "patches"
    | "state_input"
    | "dense"
    | "conv"
    | "pool"
    | "batch_norm"
    | "layer_norm"
    | "attention"
    | "dropout"
    | "token_mean"
    | "fork"
    | "add"
    | "split"
    | "branch"
    | "merge"
    | "pooling"
    | "cell"
    | "codes"
    | "initial_state"
    | "unknown";

/** An attention entry splits into its heads and its output projection; every other entry is one component. */
export type ComponentKind = EntryKind | "head" | "attention_output";

export interface Component {
    /** Stable across reloads of the same model: the entry's id, then the component's name. */
    id: string;
    name: string;
    kind: ComponentKind;
    /** Features, neurons, channels or codes: the nodes this component becomes at the unit level. */
    units: number;
    parameters: Parameter[];
}

export interface Entry {
    /** `s<stack>/L<expanded index>`. */
    id: string;
    /** The index into `expand_specs`, which is the index into the file's `weights`. */
    index: number;
    kind: EntryKind;
    /** The format-2 kind as written, which differs from `kind` only for an unknown entry. */
    sourceKind: string;
    /** The spec's fields, without `kind`; a branches entry's nested layers are left out. */
    spec: Readonly<Record<string, unknown>>;
    /** Where the entry sits in the layers as written: "layer 2, block body 1". */
    path: string;
    /** The branch this entry lies in, inside a branches layer; null outside one. */
    lane: number | null;
    /** A recurrent part's factor; null for a window layer. */
    factor: number | null;
    /** Features per token (or of the flat vector) entering and leaving; null where the reader lost track. */
    inWidth: number | null;
    outWidth: number | null;
    /** For a fork its add, for an add its fork, for a merge its split; else null. */
    partner: number | null;
    parameters: Parameter[];
    components: Component[];
}

export interface Factor {
    index: number;
    stateSize: number;
    codes: { count: number; commitment: number } | null;
    /** The entry whose input this factor's pooling reads. */
    reads: number;
}

export interface Recurrence {
    factors: Factor[];
    cross: boolean;
    cell: { kind: string; updateBias: number };
    pooling: { kind: string; reads: string };
}

export interface Stack {
    id: string;
    entries: Entry[];
}

export interface NetworkModel {
    implementation: Implementation;
    shape: ModelShape;
    /** A preset's class name; null for a Sequential network's file. */
    preset: string | null;
    input: InputSpec;
    /** One stack today; an encoder-decoder file will add a second without a schema change (D9). */
    stacks: Stack[];
    recurrence: Recurrence | null;
    /** The token width d of a token model, or the widest layer of a flat one; null if unknown. */
    width: number | null;
}

/** Every entry of every stack, in stack then expanded order. */
export function allEntries(model: NetworkModel): Entry[] {
    return model.stacks.flatMap(stack => stack.entries);
}
