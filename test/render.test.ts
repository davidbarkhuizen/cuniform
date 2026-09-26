import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { render } from "../src/Renderer";
import { Tag } from "../src/Tag";
import { FakeContext2D } from "./support/dom";
import { readAllSources } from "./support/files";

const NODE_DEFAULT = K.colours.nodeDefault;
const NODE_SELECTED = K.colours.nodeSelected;
const EDGE_DEFAULT = K.colours.edgeDefault;
const EDGE_INCIDENT = K.colours.edgeIncident;

/**
 * A path a - b - c - d, so selecting any interior node has two incident edges
 * and one unrelated edge to compare against.
 */
function build() {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 50, y: 0, z: 0 }, "b");
    const c = new Tag({ x: 50, y: 50, z: 0 }, "c");
    const d = new Tag({ x: 0, y: 50, z: 0 }, "d");
    [a, b, c, d].forEach(t => graph.addNode(t));
    graph.addEdge(a, b);
    graph.addEdge(b, c);
    graph.addEdge(c, d);

    return { graph, a, b, c, d };
}

function draw(graph: Graph): FakeContext2D {
    const context = new FakeContext2D();
    context.canvas = { width: 800, height: 600 };
    render(context as unknown as CanvasRenderingContext2D, graph);
    return context;
}

/**
 * The first `edgeCount` stroke() calls are the edges (render draws every edge
 * before any node); a selected node appends one more stroke for its ring.
 */
function edgeStrokes(context: FakeContext2D, edgeCount: number): string[] {
    return context.strokes.slice(0, edgeCount);
}

test("an edge incident to the selected node is highlighted distinctly", () => {
    const { graph, a } = build();
    a.isSelected = true;

    const context = draw(graph);
    const strokes = edgeStrokes(context, 3);

    assert.equal(strokes[0], EDGE_INCIDENT, "a-b is incident to the selection");
    assert.notEqual(strokes[0], strokes[1], "the incident edge must differ from the rest");
    assert.equal(strokes[1], EDGE_DEFAULT);
    assert.equal(strokes[2], EDGE_DEFAULT);

    // The extra stroke is the selected node's ring, not another edge.
    assert.equal(context.strokes.length, 4);
});

test("both edges incident to an interior selected node are highlighted", () => {
    const { graph, c } = build();
    c.isSelected = true;

    assert.deepEqual(edgeStrokes(draw(graph), 3), [EDGE_DEFAULT, EDGE_INCIDENT, EDGE_INCIDENT]);
});

test("with no selection every edge uses the default colour", () => {
    const { graph } = build();

    const context = draw(graph);

    assert.deepEqual(context.strokes, [EDGE_DEFAULT, EDGE_DEFAULT, EDGE_DEFAULT]);
});

test("the selected node is filled with the selected colour", () => {
    const { graph, b } = build();
    b.isSelected = true;

    const { fills } = draw(graph);

    // One fill per vertex, in vertex order a, b, c, d.
    assert.deepEqual(fills, [NODE_DEFAULT, NODE_SELECTED, NODE_DEFAULT, NODE_DEFAULT]);
});

test("nodes, edges and labels each use a distinct colour", () => {
    // The default node must not disappear into the mesh of edges beneath it,
    // and the label must stay legible against both.
    assert.notEqual(NODE_DEFAULT, EDGE_DEFAULT);
    assert.notEqual(K.colours.label, NODE_DEFAULT);
    assert.notEqual(K.colours.label, EDGE_DEFAULT);
});

test("labels are drawn in the label colour, not the node fill", () => {
    const { graph } = build();

    const context = draw(graph);

    // One label per vertex, in vertex order.
    assert.deepEqual(context.texts, [K.colours.label, K.colours.label, K.colours.label, K.colours.label]);
});

test("render reproduces the pre-refactor draw sequence exactly", () => {
    // Golden capture of every recorder array, in order, taken from the
    // renderer before it moved out of ForceDirectedGraph. The recorders
    // reduce drawing to comparable primitives, so this is a whole-frame
    // equivalence check rather than three colour spot-checks.
    const { graph, b } = build();
    b.isSelected = true;

    const context = draw(graph);

    assert.deepEqual(context.strokes, [EDGE_INCIDENT, EDGE_INCIDENT, EDGE_DEFAULT, NODE_SELECTED]);
    assert.deepEqual(context.fills, [NODE_DEFAULT, NODE_SELECTED, NODE_DEFAULT, NODE_DEFAULT]);
    assert.deepEqual(context.texts, [K.colours.label, K.colours.label, K.colours.label, K.colours.label]);
    assert.deepEqual(context.transforms, [[1, 0, 0, 1, 0, 0]]);
    assert.deepEqual(context.clears, [[0, 0, 800, 600]]);
});

test("render takes no optional label-spacing parameter", () => {
    // Regression for 5.4: the unused second parameter was removed. The
    // extracted signature is render(context, graph) and nothing more; label
    // spacing lives only in K.label.
    const { graph } = build();

    assert.equal(render.length, 2);
    assert.equal(K.label.horizontalSpacing, 5);
    assert.equal(K.label.verticalSpacing, 5);
    assert.doesNotThrow(() => draw(graph));
});

test("the renderer is the only module that draws", () => {
    // The point of the split: drawing sits behind one module boundary, so the
    // solver cannot quietly grow a canvas call. UIController still owns the
    // context it hands to render(), but it issues no drawing call itself.
    const drawingCall = /\b(clearRect|beginPath|moveTo|lineTo|arc|stroke|fill|fillText)\s*\(/;
    const sources = readAllSources();
    const drawers = Object.keys(sources).filter(name => drawingCall.test(sources[name]));

    assert.deepEqual(drawers, ["Renderer.ts"], "drawing must live behind the Renderer module");
});
