/**
 * The frame's display emphasis: which of the graph's two elements is the
 * subject of the picture.
 *
 * `nodes` makes the vertices the subject - edges recede behind them. `edges`
 * makes the structure the subject - edges are drawn over the vertices and
 * heavier. The emphasis is a property of the *frame*, not of a selection: it
 * changes only what the drawer produces, never the graph, the physics, the
 * camera, the selection or the hit-test.
 *
 * The vocabulary lives in `core` because every package already speaks it: the
 * preset values are keyed by it in `K.renderer.emphasis`, the renderer resolves
 * it per frame, and the controller carries it on `State`. `ui` may not import
 * `render`, so a type defined there would force either a duplicate guard or an
 * `app -> render` type dependency.
 *
 * The wire values are numbers, because the frame message carries nothing per
 * frame that is a string. The panel's buttons carry names (`data-emphasis`), so
 * the vocabulary is one table with a guard and a decoder for each direction
 * rather than two lists that can drift.
 */

/** The two configurations. */
export const Emphasis = {
    nodes: 0,
    edges: 1,
} as const;

export type Emphasis = (typeof Emphasis)[keyof typeof Emphasis];

/** The `data-emphasis` values the panel's buttons carry, in panel order. */
export const EMPHASIS_NAMES = ['nodes', 'edges'] as const;
export type EmphasisName = typeof EMPHASIS_NAMES[number];

/** Every wire value, so the guard is read off the enum rather than restated. */
const EMPHASIS_VALUES: readonly number[] = [Emphasis.nodes, Emphasis.edges];

/**
 * True when `value` is one of the two wire values. The runtime half of the
 * vocabulary, the analogue of `isCameraAxis`; the type and the guard cannot
 * drift apart because both are read off one table.
 */
export function isEmphasis(value: unknown): value is Emphasis {
    return typeof value === 'number' && EMPHASIS_VALUES.includes(value);
}

/**
 * Decode a frame's numeric emphasis. An unknown number is the default rather
 * than an error: a version skew between a host and this build must not blank the
 * canvas, and `nodes` is the shipped resting state.
 */
export function emphasisFromWire(value: number): Emphasis {
    return value === Emphasis.edges ? Emphasis.edges : Emphasis.nodes;
}

/** True when `value` names a configuration in the panel's vocabulary. */
export function isEmphasisName(value: unknown): value is EmphasisName {
    return typeof value === 'string' && (EMPHASIS_NAMES as readonly string[]).includes(value);
}

/** The wire value for a `data-emphasis` name. */
export function emphasisValue(name: EmphasisName): Emphasis {
    return name === 'edges' ? Emphasis.edges : Emphasis.nodes;
}

/** The `data-emphasis` name for a wire value: the inverse of `emphasisValue`. */
export function emphasisName(emphasis: Emphasis): EmphasisName {
    return emphasis === Emphasis.edges ? 'edges' : 'nodes';
}
