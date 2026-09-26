import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { Tag } from "../src/Tag";

const W = 600;
const H = 600;

/**
 * Two nodes 10 model units apart, with a 600x600 model on a 600x600 canvas so
 * one canvas unit is one model unit and the mapping is exact.
 */
function build() {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0 }, "a");
    const b = new Tag({ x: 10, y: 0 }, "b");
    graph.addNode(a);
    graph.addNode(b);

    return { graph, a, b, fdg: new ForceDirectedGraph(graph) };
}

/** A single node at the model origin. */
function single() {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0 }, "a");
    graph.addNode(a);

    return { graph, a, fdg: new ForceDirectedGraph(graph) };
}

/** The canvas point that maps to model (x, y) on the 600x600 fixture. */
function canvasAt(x: number, y: number) {
    return { x: W / 2 + x, y: H / 2 - y };
}

// ------------------------------------------------------------ Graph selection

test("selectedVertex is null until something is selected", () => {
    const { graph, b } = build();

    assert.equal(graph.selectedVertex(), null);

    b.isSelected = true;
    assert.equal(graph.selectedVertex(), b);
});

test("selectedVertex returns the first selected vertex", () => {
    const { graph, a, b } = build();

    a.isSelected = true;
    b.isSelected = true;

    assert.equal(graph.selectedVertex(), a);
});

test("clearSelection deselects every vertex", () => {
    const { graph, a, b } = build();
    a.isSelected = true;
    b.isSelected = true;

    graph.clearSelection();

    assert.ok(graph.vertices.every(v => v.isSelected === false));
    assert.equal(graph.selectedVertex(), null);
});

// ------------------------------------------------- handleNodeSelectionAttempt

test("a click on a node selects it and reports a change", () => {
    const { fdg, a } = build();

    assert.equal(fdg.handleNodeSelectionAttempt(canvasAt(0, 0), W, H), true);
    assert.equal(a.isSelected, true);
});

test("the nearer of two nodes inside the hit radius wins", () => {
    const { fdg, a, b } = build();

    // Model (8, 0) is 8 from a and 2 from b; both are inside the 15-unit radius.
    assert.ok(K.ui.minimumNodeSelectionRadius > 8, "both nodes must be in range");

    fdg.handleNodeSelectionAttempt(canvasAt(8, 0), W, H);

    assert.equal(b.isSelected, true);
    assert.equal(a.isSelected, false);
});

test("clicking an already-selected node deselects it", () => {
    const { fdg, a } = build();

    fdg.handleNodeSelectionAttempt(canvasAt(0, 0), W, H);
    assert.equal(a.isSelected, true);

    const changed = fdg.handleNodeSelectionAttempt(canvasAt(0, 0), W, H);

    assert.equal(a.isSelected, false);
    assert.equal(changed, true, "deselecting is still a change");
});

test("clicking empty space clears the selection and reports a change", () => {
    const { fdg, a } = build();

    fdg.handleNodeSelectionAttempt(canvasAt(0, 0), W, H);
    assert.equal(a.isSelected, true);

    const changed = fdg.handleNodeSelectionAttempt(canvasAt(200, 200), W, H);

    assert.equal(changed, true);
    assert.equal(a.isSelected, false);
});

test("clicking empty space with nothing selected reports no change", () => {
    const { fdg, a, b } = build();

    assert.equal(fdg.handleNodeSelectionAttempt(canvasAt(200, 200), W, H), false);
    assert.equal(a.isSelected, false);
    assert.equal(b.isSelected, false);
});

test("a click outside the hit radius of every node clears rather than selects", () => {
    const { fdg, a, b } = build();

    fdg.handleNodeSelectionAttempt(canvasAt(0, 0), W, H);
    assert.equal(a.isSelected, true);

    // 20 units away from a and 10 from b, so b is still inside the 15 radius.
    fdg.handleNodeSelectionAttempt(canvasAt(20, 0), W, H);
    assert.equal(b.isSelected, true);
    assert.equal(a.isSelected, false);
});

test("the hit radius is exclusive at exactly the selection radius", () => {
    const r = K.ui.minimumNodeSelectionRadius;
    const { fdg, a } = single();

    assert.equal(fdg.handleNodeSelectionAttempt(canvasAt(r, 0), W, H), false, "exactly r is outside");
    assert.equal(a.isSelected, false);

    assert.equal(fdg.handleNodeSelectionAttempt(canvasAt(r - 0.001, 0), W, H), true);
    assert.equal(a.isSelected, true);
});

test("selecting a second node replaces the first rather than adding to it", () => {
    const { fdg, a, b } = build();

    fdg.handleNodeSelectionAttempt(canvasAt(0, 0), W, H);
    fdg.handleNodeSelectionAttempt(canvasAt(10, 0), W, H);

    assert.equal(b.isSelected, true);
    assert.equal(a.isSelected, false);
    assert.equal(fdg.graph.selectedVertex(), b);
});
