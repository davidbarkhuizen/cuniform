import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/graph/Graph";
import { K } from "../src/core/K";
import { Projector } from "../src/view/Projector";
import { Tag } from "../src/graph/Tag";
import { handleNodeSelectionAttempt } from "../src/ui/Selection";
import { singleNode } from "./support/physics";

const W = 600;
const H = 600;

/** 600x600 model on a 600x600 canvas under the identity camera: one canvas unit is one model unit. */
const PROJECTOR = Projector.forCanvas(W, H);

/** Two nodes 10 model units apart on the exact 1:1 canvas fixture. */
function build() {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 10, y: 0, z: 0 }, "b");
    graph.addNode(a);
    graph.addNode(b);

    return { graph, a, b };
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

    assert.equal(handleNodeSelectionAttempt(graph, canvasAt(0, 0), PROJECTOR), true);
    assert.equal(a.isSelected, true);
});

test("the nearer of two nodes inside the hit radius wins", () => {
    const { graph, a, b } = build();

    // Model (8, 0) is 8 from a and 2 from b; both are inside the 15-unit radius.
    assert.ok(K.ui.minimumNodeSelectionRadiusPx > 8, "both nodes must be in range");

    handleNodeSelectionAttempt(graph, canvasAt(8, 0), PROJECTOR);

    assert.equal(b.isSelected, true);
    assert.equal(a.isSelected, false);
});

test("clicking an already-selected node deselects it", () => {
    const { graph, a } = build();

    handleNodeSelectionAttempt(graph, canvasAt(0, 0), PROJECTOR);
    assert.equal(a.isSelected, true);

    const changed = handleNodeSelectionAttempt(graph, canvasAt(0, 0), PROJECTOR);

    assert.equal(a.isSelected, false);
    assert.equal(changed, true, "deselecting is still a change");
});

test("clicking empty space clears the selection and reports a change", () => {
    const { graph, a } = build();

    handleNodeSelectionAttempt(graph, canvasAt(0, 0), PROJECTOR);
    assert.equal(a.isSelected, true);

    const changed = handleNodeSelectionAttempt(graph, canvasAt(200, 200), PROJECTOR);

    assert.equal(changed, true);
    assert.equal(a.isSelected, false);
});

test("clicking empty space with nothing selected reports no change", () => {
    const { graph, a, b } = build();

    assert.equal(handleNodeSelectionAttempt(graph, canvasAt(200, 200), PROJECTOR), false);
    assert.equal(a.isSelected, false);
    assert.equal(b.isSelected, false);
});

test("a click outside the hit radius of every node clears rather than selects", () => {
    const { graph, a, b } = build();

    handleNodeSelectionAttempt(graph, canvasAt(0, 0), PROJECTOR);
    assert.equal(a.isSelected, true);

    // 20 units away from a and 10 from b, so b is still inside the 15 radius.
    handleNodeSelectionAttempt(graph, canvasAt(20, 0), PROJECTOR);
    assert.equal(b.isSelected, true);
    assert.equal(a.isSelected, false);
});

test("the hit radius is exclusive at exactly the selection radius", () => {
    const r = K.ui.minimumNodeSelectionRadiusPx;
    const { graph, a } = singleNode();

    assert.equal(handleNodeSelectionAttempt(graph, canvasAt(r, 0), PROJECTOR), false, "exactly r is outside");
    assert.equal(a.isSelected, false);

    assert.equal(handleNodeSelectionAttempt(graph, canvasAt(r - 0.001, 0), PROJECTOR), true);
    assert.equal(a.isSelected, true);
});

test("selecting a second node replaces the first rather than adding to it", () => {
    const { graph, a, b } = build();

    handleNodeSelectionAttempt(graph, canvasAt(0, 0), PROJECTOR);
    handleNodeSelectionAttempt(graph, canvasAt(10, 0), PROJECTOR);

    assert.equal(b.isSelected, true);
    assert.equal(a.isSelected, false);
    assert.equal(graph.selectedVertex(), b);
});

test("the hit radius is 15 screen pixels at any canvas scale", () => {
    // Offsets are screen distances: under the old model-space radius the 300px and 1200px cases disagreed with the 600px case.
    for (const size of [300, 600, 1200]) {
        const projector = Projector.forCanvas(size, size);
        const scale = size / W;

        const hit = singleNode();
        const at = projector.toCanvas(hit.a.position);
        assert.equal(
            handleNodeSelectionAttempt(hit.graph, { x: at.x + 14, y: at.y }, projector),
            true,
            `14 px should hit at scale ${scale}`
        );
        assert.equal(hit.a.isSelected, true, `14 px should select at scale ${scale}`);

        const miss = singleNode();
        const missAt = projector.toCanvas(miss.a.position);
        assert.equal(
            handleNodeSelectionAttempt(miss.graph, { x: missAt.x + 16, y: missAt.y }, projector),
            false,
            `16 px should miss at scale ${scale}`
        );
        assert.equal(miss.a.isSelected, false, `16 px should not select at scale ${scale}`);
    }
});

test("a zero-size viewport selects nothing and does not throw", () => {
    const { graph, a } = singleNode();

    assert.doesNotThrow(() => {
        assert.equal(handleNodeSelectionAttempt(graph, { x: 0, y: 0 }, Projector.forCanvas(0, 0)), false);
    });
    assert.equal(a.isSelected, false);
});

// -------------------------------------------------------------- depth awareness

test("an equidistant screen hit resolves to the nearer node", () => {
    const graph = new Graph();
    // Both project to the canvas centre, so the tie-break must favour the -z (nearer) node.
    const near = new Tag({ x: 0, y: 0, z: -100 }, "near");
    const far = new Tag({ x: 0, y: 0, z: 100 }, "far");
    graph.addNode(near);
    graph.addNode(far);

    handleNodeSelectionAttempt(graph, canvasAt(0, 0), PROJECTOR);

    assert.equal(near.isSelected, true, "the front node takes the click");
    assert.equal(far.isSelected, false);
});

test("the depth tie-break does not override a genuinely nearer screen hit", () => {
    const graph = new Graph();
    // The far node is dead centre and the near one 5 px off, so screen distance still decides.
    const near = new Tag({ x: 5, y: 0, z: -100 }, "near");
    const far = new Tag({ x: 0, y: 0, z: 100 }, "far");
    graph.addNode(near);
    graph.addNode(far);

    handleNodeSelectionAttempt(graph, canvasAt(0, 0), PROJECTOR);

    assert.equal(far.isSelected, true, "the closer screen point wins even though it is farther away");
    assert.equal(near.isSelected, false);
});

test("a culled node is not selectable", () => {
    const graph = new Graph();
    // The z = -distance node has depth 0, inside the near plane: not drawn, not selectable.
    const visible = new Tag({ x: 0, y: 0, z: 0 }, "visible");
    const culled = new Tag({ x: 0, y: 0, z: -K.camera.distance }, "culled");
    graph.addNode(visible);
    graph.addNode(culled);

    handleNodeSelectionAttempt(graph, canvasAt(0, 0), PROJECTOR);

    assert.equal(visible.isSelected, true);
    assert.equal(culled.isSelected, false);
});

test("clicking where only a culled node is clears rather than selects", () => {
    const graph = new Graph();
    const culled = new Tag({ x: 0, y: 0, z: -K.camera.distance }, "culled");
    graph.addNode(culled);

    const changed = handleNodeSelectionAttempt(graph, canvasAt(0, 0), PROJECTOR);

    assert.equal(changed, false, "nothing was selected and nothing became selected");
    assert.equal(culled.isSelected, false);
});
