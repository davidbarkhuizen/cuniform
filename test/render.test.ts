import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { Tag } from "../src/Tag";
import { FakeContext2D } from "./support/dom";

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
    const a = new Tag({ x: 0, y: 0 }, "a");
    const b = new Tag({ x: 50, y: 0 }, "b");
    const c = new Tag({ x: 50, y: 50 }, "c");
    const d = new Tag({ x: 0, y: 50 }, "d");
    [a, b, c, d].forEach(t => graph.addNode(t));
    graph.addEdge(a, b);
    graph.addEdge(b, c);
    graph.addEdge(c, d);

    return { graph, fdg: new ForceDirectedGraph(graph), a, b, c, d };
}

function render(fdg: ForceDirectedGraph): FakeContext2D {
    const context = new FakeContext2D();
    context.canvas = { width: 800, height: 600 };
    fdg.render(context as unknown as CanvasRenderingContext2D);
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
    const { fdg, a } = build();
    a.isSelected = true;

    const context = render(fdg);
    const strokes = edgeStrokes(context, 3);

    assert.equal(strokes[0], EDGE_INCIDENT, "a-b is incident to the selection");
    assert.notEqual(strokes[0], strokes[1], "the incident edge must differ from the rest");
    assert.equal(strokes[1], EDGE_DEFAULT);
    assert.equal(strokes[2], EDGE_DEFAULT);

    // The extra stroke is the selected node's ring, not another edge.
    assert.equal(context.strokes.length, 4);
});

test("both edges incident to an interior selected node are highlighted", () => {
    const { fdg, c } = build();
    c.isSelected = true;

    assert.deepEqual(edgeStrokes(render(fdg), 3), [EDGE_DEFAULT, EDGE_INCIDENT, EDGE_INCIDENT]);
});

test("with no selection every edge uses the default colour", () => {
    const { fdg } = build();

    const context = render(fdg);

    assert.deepEqual(context.strokes, [EDGE_DEFAULT, EDGE_DEFAULT, EDGE_DEFAULT]);
});

test("the selected node is filled with the selected colour", () => {
    const { fdg, b } = build();
    b.isSelected = true;

    const { fills } = render(fdg);

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
    const { fdg } = build();

    const context = render(fdg);

    // One label per vertex, in vertex order.
    assert.deepEqual(context.texts, [K.colours.label, K.colours.label, K.colours.label, K.colours.label]);
});

test("render takes no optional label-spacing parameter", () => {
    // Regression for 5.4: the unused second parameter was removed.
    const { fdg } = build();
    assert.equal(fdg.render.length, 1);
    assert.doesNotThrow(() => render(fdg));
});
