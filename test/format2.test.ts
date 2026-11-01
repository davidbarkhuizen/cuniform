import test from "node:test";
import assert from "node:assert/strict";

import { Format2Error, readFormat2, weightStats } from "../src/network/Format2";
import { allEntries } from "../src/network/NetworkModel";
import { array, attentionWeights, dense, file, flatClassifier, sequenceModel } from "./support/format2";

test("a flat classifier reads as one entry per layer, weights row-major", () => {
    const model = readFormat2(flatClassifier());

    assert.equal(model.implementation, "rust");
    assert.equal(model.shape, "multiclass");
    assert.deepEqual(model.input, { kind: "flat", dimension: 4 });
    assert.equal(model.stacks.length, 1);

    const [hidden, output] = model.stacks[0].entries;

    assert.equal(hidden.id, "s0/L0");
    assert.equal(hidden.kind, "dense");
    assert.equal(hidden.inWidth, 4);
    assert.equal(hidden.outWidth, 3);
    assert.deepEqual(hidden.parameters.map(p => p.name), ["W", "b"]);
    assert.deepEqual(hidden.parameters[0].shape, [3, 4]);
    assert.ok(hidden.parameters[0].data instanceof Float32Array);
    assert.deepEqual(Array.from(hidden.parameters[0].data.subarray(0, 5)), [0, 1, 2, 3, 4], "row-major");
    assert.equal(hidden.components.length, 1);
    assert.equal(hidden.components[0].units, 3);
    assert.equal(hidden.components[0].id, "s0/L0/dense");

    assert.equal(output.spec.output, true);
    assert.equal(model.width, 3);
});

test("weight statistics are computed once, in the reader", () => {
    const stats = weightStats(new Float32Array([-2, 0, 2, 4]));

    assert.deepEqual(stats, { count: 4, min: -2, max: 4, mean: 1, rms: Math.sqrt(6) });
    assert.deepEqual(weightStats(new Float32Array(0)), { count: 0, min: 0, max: 0, mean: 0, rms: 0 });

    const model = readFormat2(flatClassifier());
    assert.equal(model.stacks[0].entries[0].parameters[0].stats.max, 11);
});

test("the reader refuses what it cannot show, by name", () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
        [{ ...flatClassifier(), format: 1 }, /not a format-2 file: format is 1/],
        [{ ...flatClassifier(), implementation: "python" }, /pure-Python/],
        [{ format: 2, implementation: "rust", shape: "ensemble", classifiers: [] }, /ensemble/],
        [{ ...flatClassifier(), implementation: "jax" }, /unknown implementation "jax"/],
        [{ ...flatClassifier(), shape: "tree" }, /unknown shape "tree"/],
        [{ ...flatClassifier(), shape: "window_recurrent" }, /has a recurrence/],
        [{ ...flatClassifier(), recurrence: {} }, /has a recurrence/],
        [{ ...flatClassifier(), weights: [[]] }, /weights: 1 entries, expected 2/],
    ];

    for (const [json, message] of cases)
        assert.throws(() => readFormat2(json), (error: unknown) => error instanceof Format2Error && message.test(error.message));

    assert.throws(() => readFormat2(null), Format2Error);
    assert.throws(() => readFormat2([]), Format2Error);
});

test("a weight shape that disagrees with the spec is refused, citing the entry's path", () => {
    const json = flatClassifier();
    (json.weights as unknown[])[1] = [array([2, 5]), array([2])];

    assert.throws(
        () => readFormat2(json),
        /layer 1 \(dense\): W has shape \[2, 5\], expected \[2, 3\]/
    );

    const ragged = flatClassifier();
    (ragged.weights as unknown[])[0] = [[[0, 0, 0, 0], [0, 0, 0], [0, 0, 0, 0]], array([3])];

    assert.throws(() => readFormat2(ragged), /layer 0 \(dense\).*ragged/);
});

test("a linear dense layer without a bias has W alone; an affine one has W and b", () => {
    const json = file(
        [dense(3, { activation: "linear" }), { kind: "batch_norm", activation: "sigmoid" }, dense(2, { output: true })],
        [[array([3, 4])], [array([3]), array([3]), array([3]), array([3])], [array([2, 3]), array([2])]]
    );

    const entries = readFormat2(json).stacks[0].entries;

    assert.deepEqual(entries[0].parameters.map(p => p.name), ["W"]);
    assert.deepEqual(entries[1].parameters.map(p => p.name), ["gamma", "beta", "running_mean", "running_var"]);
    assert.equal(entries[1].components[0].units, 3);
});

test("residuals expand exactly as expand_specs: fork, body, add, with the two paired", () => {
    const model = readFormat2(sequenceModel());
    const entries = model.stacks[0].entries;

    assert.deepEqual(entries.map(e => e.kind), [
        "embedding", "position",
        "fork", "layer_norm", "attention", "add",
        "fork", "dense", "dense", "add",
        "dense",
    ]);
    assert.deepEqual(entries.map(e => e.path).slice(2, 6), [
        "layer 2, block fork",
        "layer 2, block body 0",
        "layer 2, block body 1",
        "layer 2, block add",
    ]);
    assert.equal(entries[2].partner, 5);
    assert.equal(entries[5].partner, 2);
    assert.equal(entries[2].components.length, 0, "a fork computes nothing");
    assert.equal(entries[5].components.length, 1, "an add sums");
    assert.equal(model.width, 4);
    assert.equal(entries[1].parameters[0].shape[0], 5, "the position table is T x d");
});

test("an attention entry splits into its heads and its output projection", () => {
    const d = 4, heads = 2, keySize = 2;
    const json = sequenceModel();
    (json.weights as unknown[])[4] = attentionWeights(d, heads, keySize, i => i);

    const attention = readFormat2(json).stacks[0].entries[4];

    assert.equal(attention.spec.causal, true);
    assert.deepEqual(attention.components.map(c => c.kind), ["head", "head", "attention_output"]);
    assert.deepEqual(attention.components.map(c => c.id), ["s0/L4/head0", "s0/L4/head1", "s0/L4/out"]);
    assert.equal(attention.components[0].units, keySize);

    const head1 = attention.components[1];
    const wq = head1.parameters.find(p => p.name === "Wq")!;
    assert.deepEqual(wq.shape, [keySize, d]);
    assert.deepEqual(Array.from(wq.data), [8, 9, 10, 11, 12, 13, 14, 15], "head 1's rows of Wq");

    // Wo is (d, heads * keySize): head 1 owns columns 2 and 3 of every row.
    const wo = head1.parameters.find(p => p.name === "Wo")!;
    assert.deepEqual(wo.shape, [d, keySize]);
    assert.deepEqual(Array.from(wo.data), [2, 3, 6, 7, 10, 11, 14, 15]);
});

test("an attention entry's key_size overrides d / heads", () => {
    const json = sequenceModel();
    (json.layers as any[])[2].body[1] = { kind: "attention", heads: 2, key_size: 3 };
    (json.weights as unknown[])[4] = attentionWeights(4, 2, 3);

    const attention = readFormat2(json).stacks[0].entries[4];
    assert.equal(attention.components[0].units, 3);
});

test("optimizer_state and rng are ignored, so a view payload without them reads the same", () => {
    const full = { ...sequenceModel(), optimizer_state: { t: 3, layers: [] }, rng: { state: "0x1" } };

    assert.deepEqual(readFormat2(full), readFormat2(sequenceModel()));
});

test("an unknown kind is kept as a generic entry, and later weights stay aligned", () => {
    const json = file(
        [dense(3), { kind: "hypernet", order: 2 }, dense(2, { output: true })],
        [[array([3, 4]), array([3])], [array([6])], [array([2, 3]), array([2])]]
    );

    const entries = readFormat2(json).stacks[0].entries;

    assert.equal(entries[1].kind, "unknown");
    assert.equal(entries[1].sourceKind, "hypernet");
    assert.equal(entries[1].spec.order, 2);
    assert.deepEqual(entries[1].parameters[0].shape, [6]);
    assert.deepEqual(entries[2].parameters[0].shape, [2, 3], "the entry after an unknown one reads its own weights");
    assert.equal(entries[2].inWidth, null, "the width after an unknown entry is not guessed");
});

test("conv, pool and batch norm track the image; a dense layer after them flattens it", () => {
    const json = file(
        [
            { kind: "conv", kernel_size: 3, channel_count: 2, stride: 1, activation: "linear" },
            { kind: "batch_norm", activation: "relu" },
            { kind: "pool", pool_size: 2, stride: null },
            dense(5, { output: true }),
        ],
        [
            [array([2, 1 * 3 * 3])],
            [array([2]), array([2]), array([2]), array([2])],
            [],
            [array([5, 2 * 3 * 3]), array([5])],
        ],
        { input: { height: 8, width: 8, channels: 1 } }
    );

    const entries = readFormat2(json).stacks[0].entries;

    assert.equal(entries[0].outWidth, 2 * 6 * 6);
    assert.equal(entries[2].outWidth, 2 * 3 * 3);
    assert.equal(entries[3].inWidth, 18);
});

/** A window-recurrent model with two coded factors over branches; `merge` recombines them. */
function branchedWindow(merge: boolean, reads: number[] | null = null): Record<string, unknown> {
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

test("branches expand into split, lanes and branch ends; factor g reads branch g's end", () => {
    const model = readFormat2(branchedWindow(false));
    const entries = model.stacks[0].entries;
    const window = entries.filter(e => e.factor === null);

    assert.deepEqual(window.map(e => e.kind), [
        "embedding", "split",
        "state_input", "layer_norm", "branch",
        "state_input", "layer_norm", "branch",
        "state_input", "layer_norm",
        "dense",
    ]);
    assert.deepEqual(window.map(e => e.lane), [null, null, 0, 0, 0, 1, 1, 1, 2, 2, null]);
    assert.equal(window[4].path, "layer 1, branch 0 end");
    assert.equal(window[5].inWidth, 4, "each branch starts from the split's tokens");

    const factors = model.recurrence!.factors;
    assert.deepEqual(factors.map(f => f.reads), [4, 7]);
    assert.equal(factors[1].codes, null);
});

test("merged branches end in a merge paired with its split; reads redirect the factors", () => {
    const merged = readFormat2(branchedWindow(true)).stacks[0].entries;
    const merge = merged.find(e => e.kind === "merge")!;

    assert.equal(merge.partner, 1);
    assert.equal(merged[merge.partner!].kind, "split");

    const read = readFormat2(branchedWindow(false, [1, 1]));
    assert.deepEqual(read.recurrence!.factors.map(f => f.reads), [7, 7]);
});

test("the recurrent parts follow the window: per factor q, the cell, codes if coded, the initial state", () => {
    const model = readFormat2(branchedWindow(false));
    const parts = allEntries(model).filter(e => e.factor !== null);

    assert.deepEqual(parts.map(e => [e.factor, e.kind]), [
        [0, "pooling"], [0, "cell"], [0, "codes"], [0, "initial_state"],
        [1, "pooling"], [1, "cell"], [1, "initial_state"],
    ]);
    assert.deepEqual(parts[1].parameters.map(p => p.name), ["W", "U", "b"]);
    assert.equal(parts[2].components[0].units, 3, "a codes component has one unit per code");
    assert.equal(parts[0].index, 11, "the parts' indices continue the window's");
});

test("with the cross term the cell reads the other factors' states too", () => {
    const json = branchedWindow(false);
    (json.recurrence as any).cross = true;

    assert.throws(() => readFormat2(json), /factor 0 cell \(recurrence\): W has shape \[6, 4\], expected \[6, 7\]/);

    const weights = json.weights as unknown[];
    weights[12] = [array([6, 4 + 3]), array([6, 2]), array([6])];
    weights[16] = [array([9, 4 + 2]), array([9, 3]), array([9])];

    assert.equal(readFormat2(json).recurrence!.cross, true);
});

test("a state input's projection is d x the total state width", () => {
    const json = branchedWindow(false);
    (json.weights as unknown[])[2] = [array([4, 2])];

    assert.throws(() => readFormat2(json), /layer 1, branch 0 layer 0 \(state_input\): P has shape \[4, 2\], expected \[4, 5\]/);
});

test("a recurrence saved before the factored state reads as one factor", () => {
    const json = file(
        [{ kind: "embedding", vocabulary: 6, size: 4 }, { kind: "state_input" }, dense(5, { output: true })],
        [
            [array([6, 4])], [array([4, 2])], [array([5, 4]), array([5])],
            [array([4])], [array([6, 4]), array([6, 2]), array([6])], [array([3, 2])], [array([2])],
        ],
        {
            shape: "window_recurrent",
            input: { dimension: 2 },
            recurrence: { state_size: 2, codes: { count: 3, commitment: 0.25 }, cell: { kind: "gru", update_bias: 1.0 }, pooling: { kind: "attention" } },
        }
    );

    const recurrence = readFormat2(json).recurrence!;

    assert.equal(recurrence.factors.length, 1);
    assert.equal(recurrence.factors[0].stateSize, 2);
    assert.equal(recurrence.factors[0].reads, 2, "without branches the pooling reads the output layer's tokens");
    assert.equal(recurrence.cross, false);
});
