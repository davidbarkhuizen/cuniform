import test from "node:test";
import assert from "node:assert/strict";

import { Activation, EdgeKind, emptyAttributes, Family, Mark, NodeKind, nodeFamily } from "../src/graph/Attributes";
import { buildGraph } from "../src/network/BuildGraph";
import { defaultCameraView, Projector } from "../src/view/Projector";
import { Emphasis } from "../src/core/Emphasis";
import { Graph } from "../src/graph/Graph";
import { K } from "../src/core/K";
import { projectGraph } from "../src/view/Projection";
import { readFormat2 } from "../src/network/Format2";
import { render } from "../src/render/Renderer";
import { Tag } from "../src/graph/Tag";
import { FakeContext2D } from "./support/dom";
import { sequenceModel } from "./support/format2";
import { fitView } from "../src/view/Fit";
import { modelJson, skipUnless } from "./support/models";

const W = 800;
const H = 600;

function drawn(graph: Graph, emphasis: Emphasis = Emphasis.nodes, camera = defaultCameraView()): FakeContext2D {
    const context = new FakeContext2D();
    context.canvas = { width: W, height: H };

    projectGraph(graph, Projector.forCanvas(W, H, camera));
    render(context, graph, camera, graph.selectedVertex(), emphasis);

    return context;
}

/** One node of `kind` at the origin with `marks`, and no band. */
function single(kind: number, marks = 0): Graph {
    const graph = new Graph();
    graph.addNode(new Tag({ x: 0, y: 0, z: 0 }, "n"));
    graph.attributes = emptyAttributes(1, 0, 0);
    graph.attributes.kind[0] = kind;
    graph.attributes.marks[0] = marks;

    return graph;
}

// The glyph's outline as path calls: each polygon closes with one lineTo per side after its moveTo.
const GLYPHS: Array<[string, number, { lineTos: number; arcs: number }]> = [
    ["dense: circle", NodeKind.dense, { lineTos: 0, arcs: 1 }],
    ["attention output: circle", NodeKind.attentionOutput, { lineTos: 0, arcs: 1 }],
    ["embedding: square", NodeKind.embedding, { lineTos: 4, arcs: 0 }],
    ["state input: inverted triangle", NodeKind.stateInput, { lineTos: 3, arcs: 0 }],
    ["layer norm: bar", NodeKind.layerNorm, { lineTos: 4, arcs: 0 }],
    ["head: hexagon", NodeKind.head, { lineTos: 6, arcs: 0 }],
    ["conv: rounded square", NodeKind.conv, { lineTos: 8, arcs: 0 }],
    ["cell: rounded square", NodeKind.cell, { lineTos: 8, arcs: 0 }],
    ["unknown: diamond", NodeKind.unknown, { lineTos: 4, arcs: 0 }],
    ["codes: a grid of dots", NodeKind.codes, { lineTos: 0, arcs: 9 }],
];

for (const [name, kind, shape] of GLYPHS) {
    test(`glyph, ${name}, filled in its family colour`, () => {
        const context = drawn(single(kind));

        assert.equal(context.lineTos.length, shape.lineTos, "outline segments");
        assert.equal(context.arcs.length, shape.arcs, "arcs");
        assert.equal(context.fills[0], K.colours.family[nodeFamily(kind)]);
    });
}

test("the state input's triangle points down; the bar is wide and flat", () => {
    const triangle = drawn(single(NodeKind.stateInput));
    const ys = triangle.lineTos.map(([, y]) => y);
    const apex = Math.max(...ys);
    assert.equal(ys.filter(y => y === apex).length, 1, "one vertex at the bottom (canvas y grows down)");

    const bar = drawn(single(NodeKind.layerNorm));
    const xs = bar.lineTos.map(([x]) => x);
    const barYs = bar.lineTos.map(([, y]) => y);
    assert.ok(Math.max(...xs) - Math.min(...xs) > 3 * (Math.max(...barYs) - Math.min(...barYs)));
});

test("a hollow glyph is stroked in its family colour, not filled", () => {
    const context = drawn(single(NodeKind.position, Mark.hollow));

    assert.equal(context.fills.length, 0);
    assert.equal(context.strokes[0], K.colours.family[Family.input]);
});

test("marks: causal triangle, rotary ring, dotted dropout outline", () => {
    const plain = drawn(single(NodeKind.head));
    const causal = drawn(single(NodeKind.head, Mark.causal));
    assert.equal(causal.fills.length, plain.fills.length + 1, "the causal triangle is one more fill");
    assert.equal(causal.fills[1], K.colours.label);

    const rotary = drawn(single(NodeKind.head, Mark.rotary));
    const glyph = drawn(single(NodeKind.dense)).arcs[0][2];
    assert.ok(rotary.arcs.some(([, , r]) => Math.abs(r - glyph * 1.35) < 1e-9), "a ring outside the hexagon");

    const dropout = drawn(single(NodeKind.head, Mark.dropout));
    assert.deepEqual(dropout.dashes, [[2, 2], []], "dashed for the outline, then reset");
});

test("marks: the output's inner ring, the add's plus, the pooling's query dot, the cell's ↻ and the merge's Σ", () => {
    assert.ok(drawn(single(NodeKind.output)).strokes.includes(K.colours.glyphInk));
    assert.equal(drawn(single(NodeKind.add)).lineTos.length, 2, "the + is two strokes");
    assert.equal(drawn(single(NodeKind.pooling)).fills[1], K.colours.glyphInk);
    assert.ok(drawn(single(NodeKind.cell)).textLabels.includes("↻"));
    assert.ok(drawn(single(NodeKind.merge)).textLabels.includes("Σ"));
    assert.ok(drawn(single(NodeKind.batchNorm, Mark.hatched)).strokes.includes(K.colours.glyphInk));
});

test("an activation mark is a letter beside the glyph", () => {
    const relu = drawn(single(NodeKind.dense, Activation.relu << Mark.activationShift));
    assert.ok(relu.textLabels.includes("r"));

    const softmax = drawn(single(NodeKind.output, Activation.softmax << Mark.activationShift));
    assert.ok(softmax.textLabels.includes("s"));
});

test("a selected glyph fills in the selection colour and gets the ring", () => {
    const graph = single(NodeKind.head);
    graph.vertices[0].isSelected = true;

    const context = drawn(graph);
    assert.equal(context.fills[0], K.colours.nodeSelected);
    assert.ok(context.strokes.includes(K.colours.nodeSelected));
});

test("residual skips draw as curves, flow edges as lines, and the data after a dropout dotted", () => {
    const built = buildGraph(readFormat2(sequenceModel())).graph;
    const camera = fitView(built.attributes!.bands)!;
    const context = drawn(built, Emphasis.nodes, camera);

    const residuals = Array.from(built.attributes!.edgeKind).filter(k => k === EdgeKind.residual).length;
    assert.equal(context.curves.length, residuals);

    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 40, y: 0, z: 0 }, "b");
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(a, b);
    graph.attributes = emptyAttributes(2, 1, 0);
    graph.attributes.edgeKind[0] = EdgeKind.flow | EdgeKind.dotted;
    graph.attributes.weight[0] = 1;

    assert.deepEqual(drawn(graph).dashes, [[4, 3], []]);
});

test("an edge's width and alpha follow |weight|, and a unit weight's hue its sign", () => {
    const edge = (kind: number, weight: number) => {
        const graph = new Graph();
        const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
        const b = new Tag({ x: 40, y: 0, z: 0 }, "b");
        graph.addNode(a);
        graph.addNode(b);
        graph.addEdge(a, b);
        graph.attributes = emptyAttributes(2, 1, 0);
        graph.attributes.kind[0] = graph.attributes.kind[1] = NodeKind.unit;
        graph.attributes.edgeKind[0] = kind;
        graph.attributes.weight[0] = weight;

        const context = drawn(graph);
        return { width: context.strokeWidths[0], alpha: context.strokeAlphas[0], colour: context.strokes[0] };
    };

    const strong = edge(EdgeKind.flow, 1);
    const weak = edge(EdgeKind.flow, 0.1);
    assert.ok(strong.width > weak.width);
    assert.ok(strong.alpha > weak.alpha);

    assert.equal(edge(EdgeKind.weight, 0.5).colour, K.colours.weightPositive);
    assert.equal(edge(EdgeKind.weight, -0.5).colour, K.colours.weightNegative);
    assert.equal(edge(EdgeKind.recurrent, 1).colour, K.colours.recurrentEdge);
});

test("band outlines draw first, beneath edges and nodes, in both emphases", () => {
    const built = buildGraph(readFormat2(sequenceModel())).graph;
    const camera = fitView(built.attributes!.bands)!;
    const bands = built.attributes!.bands.length / 7;

    for (const emphasis of [Emphasis.nodes, Emphasis.edges]) {
        const ops = drawn(built, emphasis, camera).ops;

        // Each band is one translucent fill and one faint stroke.
        const lead = ops.slice(0, 2 * bands);
        assert.ok(lead.every(op => op.alpha === 0.06 || op.alpha === 0.22), `bands lead in ${emphasis}`);
        assert.ok(ops.slice(2 * bands).every(op => op.alpha !== 0.06), "no band after the first non-band op");
    }
});

test("the coarse network path batches one fill per kind", () => {
    const graph = new Graph();
    const n = K.renderer.performance.minNodes;

    for (let i = 0; i < n; i++)
        graph.addNode(new Tag({ x: (i % 64) * 8 - 256, y: Math.floor(i / 64) * 8 - 256, z: 0 }, `u${i}`));

    graph.attributes = emptyAttributes(n, 0, 0);

    for (let i = 0; i < n; i++)
        graph.attributes.kind[i] = i % 3 === 0 ? NodeKind.head : i % 3 === 1 ? NodeKind.dense : NodeKind.layerNorm;

    const context = drawn(graph);
    assert.equal(context.fills.length, 3, "one fill per kind present");
});

/** WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
    const channel = (i: number) => {
        const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };

    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
    const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (bright + 0.05) / (dark + 0.05);
}

test("every family colour clears 3:1 against the canvas and the edges, and none is the selection", () => {
    assert.equal(K.colours.family.length, Object.keys(Family).length);

    for (const colour of K.colours.family) {
        assert.ok(contrast(colour, K.colours.glyphInk) >= 3, `${colour} on the canvas`);
        assert.ok(contrast(colour, K.colours.edgeDefault) >= 3, `${colour} against the edges`);
        assert.notEqual(colour, K.colours.nodeSelected);
    }

    assert.equal(new Set(K.colours.family).size, K.colours.family.length, "families are distinct");
});

test("the tinyshakespeare model renders at L0 with its rotary marks and skips", skipUnless(modelJson("tinyshakespeare")), () => {
    const built = buildGraph(readFormat2(modelJson("tinyshakespeare"))).graph;
    const context = drawn(built, Emphasis.nodes, fitView(built.attributes!.bands)!);

    assert.equal(context.curves.length, 4, "one skip per residual block");
    const heads = Array.from(built.attributes!.kind).filter(k => k === NodeKind.head).length;
    assert.ok(context.arcs.length >= heads, "every rotary head has its ring");
});

test("a unit of an expanded component is a plain dot in its component's family colour, without marks", () => {
    const context = drawn(single(NodeKind.head, Mark.unit));

    assert.equal(context.lineTos.length, 0, "no hexagon");
    assert.equal(context.arcs.length, 1, "one dot");
    assert.equal(context.fills[0], K.colours.family[Family.attention]);
    assert.equal(context.textLabels.filter(t => t !== "n").length, 0, "no text marks");
});
