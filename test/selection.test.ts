import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { Tag } from "../src/Tag";
import { handleNodeSelectionAttempt } from "../src/Selection";
import { Viewport } from "../src/Viewport";

const W = 600;
const H = 600;

/** One viewport for the whole suite: 600x600 model on a 600x600 canvas. */
const VIEWPORT = Viewport.forCanvas(W, H);

/**
 * Two nodes 10 model units apart, with a 600x600 model on a 600x600 canvas so
 * one canvas unit is one model unit and the mapping is exact.
 */
function build() {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 10, y: 0, z: 0 }, "b");
    graph.addNode(a);
    graph.addNode(b);

    return { graph, a, b };
}

/** A single node at the model origin. */
function single() {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    graph.addNode(a);

    return { graph, a };
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
    const { graph, a } = build();

    assert.equal(handleNodeSelectionAttempt(graph, canvasAt(0, 0), VIEWPORT), true);
    assert.equal(a.isSelected, true);
});

test("the nearer of two nodes inside the hit radius wins", () => {
    const { graph, a, b } = build();

    // Model (8, 0) is 8 from a and 2 from b; both are inside the 15-unit radius.
    assert.ok(K.ui.minimumNodeSelectionRadiusPx > 8, "both nodes must be in range");

    handleNodeSelectionAttempt(graph, canvasAt(8, 0), VIEWPORT);

    assert.equal(b.isSelected, true);
    assert.equal(a.isSelected, false);
});

test("clicking an already-selected node deselects it", () => {
    const { graph, a } = build();

    handleNodeSelectionAttempt(graph, canvasAt(0, 0), VIEWPORT);
    assert.equal(a.isSelected, true);

    const changed = handleNodeSelectionAttempt(graph, canvasAt(0, 0), VIEWPORT);

    assert.equal(a.isSelected, false);
    assert.equal(changed, true, "deselecting is still a change");
});

test("clicking empty space clears the selection and reports a change", () => {
    const { graph, a } = build();

    handleNodeSelectionAttempt(graph, canvasAt(0, 0), VIEWPORT);
    assert.equal(a.isSelected, true);

    const changed = handleNodeSelectionAttempt(graph, canvasAt(200, 200), VIEWPORT);

    assert.equal(changed, true);
    assert.equal(a.isSelected, false);
});

test("clicking empty space with nothing selected reports no change", () => {
    const { graph, a, b } = build();

    assert.equal(handleNodeSelectionAttempt(graph, canvasAt(200, 200), VIEWPORT), false);
    assert.equal(a.isSelected, false);
    assert.equal(b.isSelected, false);
});

test("a click outside the hit radius of every node clears rather than selects", () => {
    const { graph, a, b } = build();

    handleNodeSelectionAttempt(graph, canvasAt(0, 0), VIEWPORT);
    assert.equal(a.isSelected, true);

    // 20 units away from a and 10 from b, so b is still inside the 15 radius.
    handleNodeSelectionAttempt(graph, canvasAt(20, 0), VIEWPORT);
    assert.equal(b.isSelected, true);
    assert.equal(a.isSelected, false);
});

test("the hit radius is exclusive at exactly the selection radius", () => {
    const r = K.ui.minimumNodeSelectionRadiusPx;
    const { graph, a } = single();

    assert.equal(handleNodeSelectionAttempt(graph, canvasAt(r, 0), VIEWPORT), false, "exactly r is outside");
    assert.equal(a.isSelected, false);

    assert.equal(handleNodeSelectionAttempt(graph, canvasAt(r - 0.001, 0), VIEWPORT), true);
    assert.equal(a.isSelected, true);
});

test("selecting a second node replaces the first rather than adding to it", () => {
    const { graph, a, b } = build();

    handleNodeSelectionAttempt(graph, canvasAt(0, 0), VIEWPORT);
    handleNodeSelectionAttempt(graph, canvasAt(10, 0), VIEWPORT);

    assert.equal(b.isSelected, true);
    assert.equal(a.isSelected, false);
    assert.equal(graph.selectedVertex(), b);
});

test("the hit radius is 15 screen pixels at any canvas scale", () => {
    // The click is built from the node's own mapped canvas position plus a
    // pixel offset, so the test states a screen distance directly and cannot
    // accidentally re-derive it in model units. Under the old model-space
    // radius the 300px case would need 28 model units and the 1200px case only
    // 7, so both would disagree with the 600px case.
    for (const size of [300, 600, 1200]) {
        const viewport = Viewport.forCanvas(size, size);
        const scale = size / W;

        const hit = single();
        const at = viewport.toCanvas(hit.a.position);
        assert.equal(
            handleNodeSelectionAttempt(hit.graph, { x: at.x + 14, y: at.y }, viewport),
            true,
            `14 px should hit at scale ${scale}`
        );
        assert.equal(hit.a.isSelected, true, `14 px should select at scale ${scale}`);

        const miss = single();
        const missAt = viewport.toCanvas(miss.a.position);
        assert.equal(
            handleNodeSelectionAttempt(miss.graph, { x: missAt.x + 16, y: missAt.y }, viewport),
            false,
            `16 px should miss at scale ${scale}`
        );
        assert.equal(miss.a.isSelected, false, `16 px should not select at scale ${scale}`);
    }
});

test("a zero-size viewport selects nothing and does not throw", () => {
    const { graph, a } = single();

    assert.doesNotThrow(() => {
        assert.equal(handleNodeSelectionAttempt(graph, { x: 0, y: 0 }, Viewport.forCanvas(0, 0)), false);
    });
    assert.equal(a.isSelected, false);
});
