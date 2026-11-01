import test from "node:test";
import assert from "node:assert/strict";

import {
    attributeMismatch,
    BAND_STRIDE,
    BAND_Y,
    BAND_Z_MAX,
    BAND_Z_MIN,
    EdgeKind,
    Mark,
    NodeKind,
} from "../src/graph/Attributes";
import { buildGraph } from "../src/network/BuildGraph";
import { readFormat2 } from "../src/network/Format2";
import { Graph } from "../src/graph/Graph";
import { branchedWindow, sequenceModel } from "./support/format2";
import { modelJson, skipUnless } from "./support/models";
import { bandViolations } from "./support/bands";

test("a sequence model builds one node per component, each in a band", () => {
    const built = buildGraph(readFormat2(sequenceModel()));
    const { graph } = built;
    const a = graph.attributes!;

    assert.deepEqual(graph.vertices.map(v => v.label), [
        "embedding 7×4", "position",
        "layer norm", "head0 · d_k 2", "head1 · d_k 2", "Wo", "+",
        "dense 8 relu", "dense 4 linear", "+",
        "output 3 softmax",
    ]);
    assert.equal(attributeMismatch(a, graph.vertices.length, graph.edges.length), null);
    assert.ok(Array.from(a.band).every(b => b >= 0), "every L0 node has a band");
    assert.deepEqual(bandViolations(graph), [], "seeds start inside their bands");
    assert.equal(new Set(built.ids).size, built.ids.length, "ids are unique");
    assert.equal(built.ids[3], "s0/L4/head0");
});

test("layers run up model y from the input, and a layer's heads share its band", () => {
    const { graph } = buildGraph(readFormat2(sequenceModel()));
    const a = graph.attributes!;
    const y = (i: number) => a.bands[a.band[i] * BAND_STRIDE + BAND_Y];

    assert.ok(y(0) < y(1) && y(1) < y(2) && y(2) < y(3), "embedding, position, norm, attention, upward");
    assert.equal(a.band[3], a.band[4], "both heads in one band");
    assert.equal(a.band[3], a.band[5], "Wo in the heads' band");
    assert.equal(a.band[6], a.band[5], "the + sits in the band of the body's last layer");
    assert.ok(y(10) > y(8), "the output is the top band");
});

test("kinds, marks and edge kinds carry the grammar", () => {
    const { graph } = buildGraph(readFormat2(sequenceModel()));
    const a = graph.attributes!;

    assert.equal(a.kind[0], NodeKind.embedding);
    assert.equal(a.kind[3], NodeKind.head);
    assert.equal(a.kind[5], NodeKind.attentionOutput);
    assert.equal(a.kind[6], NodeKind.add);
    assert.equal(a.kind[10], NodeKind.output);
    assert.ok(a.marks[3] & Mark.causal, "a causal head is marked");
    assert.equal(a.marks[3] & Mark.rotary, 0);
    assert.ok(a.marks[1] & Mark.hollow, "a position is outlined");

    const residuals = Array.from(a.edgeKind).filter(k => k === EdgeKind.residual).length;
    assert.equal(residuals, 2, "one skip edge per block");

    for (const w of a.weight)
        assert.ok(w > 0 && w <= 1, `weight ${w} is normalised`);
});

test("the build is deterministic: same ids, labels, positions and edges", () => {
    const one = buildGraph(readFormat2(sequenceModel()));
    const two = buildGraph(readFormat2(sequenceModel()));
    const shape = (g: Graph) => ({
        positions: g.vertices.map(v => ({ ...v.position })),
        edges: g.edges.map(e => [g.vertices.indexOf(e.v1), g.vertices.indexOf(e.v2)]),
    });

    assert.deepEqual(one.ids, two.ids);
    assert.deepEqual(shape(one.graph), shape(two.graph));
    assert.deepEqual(one.graph.attributes, two.graph.attributes);
});

test("branches take z-lanes inside shared layer bands; the recurrent parts sit above the window", () => {
    const { graph } = buildGraph(readFormat2(branchedWindow(false)));
    const a = graph.attributes!;
    const at = (label: string) => graph.vertices.findIndex(v => v.label === label);
    const box = (i: number) => {
        const o = a.band[i] * BAND_STRIDE;
        return { y: a.bands[o + BAND_Y], zMin: a.bands[o + BAND_Z_MIN], zMax: a.bands[o + BAND_Z_MAX] };
    };

    const stateInputs = graph.vertices.flatMap((v, i) => v.label === "state input" ? [i] : []);
    assert.equal(stateInputs.length, 3);

    const boxes = stateInputs.map(box);
    assert.ok(boxes.every(b => b.y === boxes[0].y), "the branches' first layers share one height");
    assert.ok(boxes[0].zMax <= boxes[1].zMin && boxes[1].zMax <= boxes[2].zMin, "lanes are disjoint along z");

    const output = box(at("output 5 softmax"));
    const pooling = box(at("pooling f0"));
    const cell = box(at("GRU f0 · s 2"));
    const codes = box(at("codes f0 · 3"));

    assert.ok(pooling.y > output.y && cell.y > pooling.y && codes.y > cell.y);
    assert.ok(box(at("pooling f0")).zMax <= box(at("pooling f1")).zMin, "factors are lanes too");
    assert.deepEqual(bandViolations(graph), []);
});

test("each factor's state loops back to every state input; a continuous factor loops from its cell", () => {
    const { graph } = buildGraph(readFormat2(branchedWindow(false)));
    const a = graph.attributes!;
    const label = (i: number) => graph.vertices[i].label;

    const loops = graph.edges
        .map((e, j) => ({ e, j }))
        .filter(({ j }) => a.edgeKind[j] === EdgeKind.recurrent)
        .map(({ e }) => `${e.v1.label} -> ${e.v2.label}`);

    assert.equal(loops.length, 2 * 3);
    assert.ok(loops.every(l => l.endsWith("state input")));
    assert.equal(loops.filter(l => l.startsWith("codes f0")).length, 3);
    assert.equal(loops.filter(l => l.startsWith("GRU f1")).length, 3);

    // Factor 0's pooling reads branch 0's end: its layer norm.
    const reads = graph.edges.filter(e => e.v2.label === "pooling f0").map(e => e.v1.label);
    assert.deepEqual(reads, ["layer norm"]);
    assert.ok(label(0));
});

test("merged branches meet at a Σ, fed by every branch's end", () => {
    const { graph } = buildGraph(readFormat2(branchedWindow(true)));
    const sigma = graph.vertices.find(v => v.label === "Σ")!;

    assert.ok(sigma);
    assert.equal(graph.edges.filter(e => e.v2 === sigma).length, 2);
});

test("the cross term joins the factors' cells", () => {
    const json = branchedWindow(false);
    (json.recurrence as any).cross = true;
    const weights = json.weights as any[];
    const zeros = (r: number, c: number) => Array.from({ length: r }, () => Array(c).fill(0));
    weights[12] = [zeros(6, 7), zeros(6, 2), Array(6).fill(0)];
    weights[16] = [zeros(9, 6), zeros(9, 3), Array(9).fill(0)];

    const { graph } = buildGraph(readFormat2(json));
    const a = graph.attributes!;

    assert.equal(Array.from(a.edgeKind).filter(k => k === EdgeKind.cross).length, 1);
});

test("the tinyshakespeare model builds at L0 inside its bands", skipUnless(modelJson("tinyshakespeare")), () => {
    const { graph } = buildGraph(readFormat2(modelJson("tinyshakespeare")));

    // embedding; per block: norm, 4 heads, Wo, +, norm, two dense, +; final norm; output.
    assert.equal(graph.vertices.length, 1 + 2 * (1 + 4 + 1 + 1 + 1 + 2 + 1) + 1 + 1);
    assert.ok(graph.attributes!.marks.some(m => (m & Mark.rotary) !== 0));
    assert.deepEqual(bandViolations(graph), []);
});
