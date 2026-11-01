// Hand-built minimal format-2 objects for the reader's unit tests; no model data is committed.

type Nested = number | Nested[];

/** A nested array of `shape`, filled by `value(flatIndex)`. */
export function array(shape: number[], value: (i: number) => number = () => 0): Nested {
    let at = 0;

    const build = (depth: number): Nested => {
        if (depth === shape.length)
            return value(at++);

        return Array.from({ length: shape[depth] }, () => build(depth + 1));
    };

    return build(0);
}

export function dense(size: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { kind: "dense", size, activation: "sigmoid", dropout: null, output: false, loss: "squared", ...extra };
}

export function file(
    layers: unknown[],
    weights: unknown[],
    extra: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        format: 2,
        implementation: "rust",
        shape: "multiclass",
        input: { dimension: 4 },
        layers,
        update_rule: { rule: "sgd" },
        weights,
        ...extra,
    };
}

/** A two-layer flat classifier: 4 -> 3 (sigmoid) -> 2 (softmax output). */
export function flatClassifier(): Record<string, unknown> {
    return file(
        [dense(3), dense(2, { activation: "softmax", output: true, loss: "cross_entropy" })],
        [[array([3, 4], i => i), array([3])], [array([2, 3]), array([2])]]
    );
}

/** The attention entry's eight arrays for `heads` heads of `keySize` over width `d`. */
export function attentionWeights(d: number, heads: number, keySize: number, value: (i: number) => number = () => 0): unknown[] {
    const inner = heads * keySize;
    return [
        array([inner, d], value), array([inner]),
        array([inner, d], value), array([inner]),
        array([inner, d], value), array([inner]),
        array([d, inner], value), array([d]),
    ];
}

/**
 * A small sequence model: embedding (vocab 7, d 4), position (T 5), one causal two-head attention
 * block and one feed-forward block, then a token-wise softmax output of 3.
 */
export function sequenceModel(): Record<string, unknown> {
    return file(
        [
            { kind: "embedding", vocabulary: 7, size: 4 },
            { kind: "position" },
            { kind: "residual", body: [{ kind: "layer_norm", epsilon: 1e-5 }, { kind: "attention", heads: 2, causal: true }] },
            { kind: "residual", body: [dense(8, { activation: "relu" }), dense(4, { activation: "linear", bias: true })] },
            dense(3, { activation: "softmax", output: true, loss: "cross_entropy" }),
        ],
        [
            [array([7, 4])],
            [array([5, 4])],
            [],
            [array([4]), array([4])],
            attentionWeights(4, 2, 2),
            [],
            [],
            [array([8, 4]), array([8])],
            [array([4, 8]), array([4])],
            [],
            [array([3, 4]), array([3])],
        ],
        { shape: "sequence", input: { dimension: 5 } }
    );
}

/** A window-recurrent model with two coded factors over branches; `merge` recombines them. */
export function branchedWindow(merge: boolean, reads: number[] | null = null): Record<string, unknown> {
    const d = 4;
    const branch = () => [{ kind: "state_input" }, { kind: "layer_norm", epsilon: 1e-5 }];
    const branchCount = merge ? 2 : 3;

    const layers: unknown[] = [
        { kind: "embedding", vocabulary: 6, size: d },
        {
            kind: merge ? "merged_branches" : "branches",
            branches: Array.from({ length: branchCount }, branch),
            ...(reads ? { reads } : {}),
        },
        dense(5, { activation: "softmax", output: true, loss: "cross_entropy" }),
    ];

    const stateWidth = 2 + 3;
    const branchWeights = () => [[array([d, stateWidth])], [array([d]), array([d])]];
    const weights: unknown[] = [[array([6, d])], []];

    for (let b = 0; b < branchCount; b++) {
        weights.push(...branchWeights());

        if (b + 1 < branchCount)
            weights.push([]);
    }

    if (merge)
        weights.push([]);

    weights.push([array([5, d]), array([5])]);

    // Factor 0: state 2, 3 codes; factor 1: state 3, continuous.
    weights.push([array([d])], [array([6, d]), array([6, 2]), array([6])], [array([3, 2])], [array([2])]);
    weights.push([array([d])], [array([9, d]), array([9, 3]), array([9])], [array([3])]);

    return file(layers, weights, {
        shape: "window_recurrent",
        input: { dimension: 2 },
        recurrence: {
            factors: [{ state_size: 2, codes: { count: 3, commitment: 0.25 } }, { state_size: 3, codes: null }],
            cross: false,
            cell: { kind: "gru", update_bias: 1.0 },
            pooling: { kind: "attention" },
        },
    });
}
