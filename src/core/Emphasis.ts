/**
 * Which of the graph's two elements a frame emphasises: `nodes` draws the
 * vertices over the edges, `edges` the reverse. It changes only what the drawer
 * produces. Wire values are numbers because the frame message carries no strings.
 */

export const Emphasis = {
    nodes: 0,
    edges: 1,
} as const;

export type Emphasis = (typeof Emphasis)[keyof typeof Emphasis];

/** The `data-emphasis` values the panel's buttons carry, in panel order. */
export const EMPHASIS_NAMES = ['nodes', 'edges'] as const;
export type EmphasisName = typeof EMPHASIS_NAMES[number];

const EMPHASIS_VALUES: readonly number[] = [Emphasis.nodes, Emphasis.edges];

export function isEmphasis(value: unknown): value is Emphasis {
    return typeof value === 'number' && EMPHASIS_VALUES.includes(value);
}

/** Unknown values decode to `nodes`: a version skew must not blank the canvas. */
export function emphasisFromWire(value: number): Emphasis {
    return value === Emphasis.edges ? Emphasis.edges : Emphasis.nodes;
}

export function isEmphasisName(value: unknown): value is EmphasisName {
    return typeof value === 'string' && (EMPHASIS_NAMES as readonly string[]).includes(value);
}

export function emphasisValue(name: EmphasisName): Emphasis {
    return name === 'edges' ? Emphasis.edges : Emphasis.nodes;
}

export function emphasisName(emphasis: Emphasis): EmphasisName {
    return emphasis === Emphasis.edges ? 'edges' : 'nodes';
}
