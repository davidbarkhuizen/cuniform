import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { defaultCameraView, Projector } from "../src/Projector";
import { projectGraph } from "../src/Projection";
import { sparseGraph } from "./support/physics";

/**
 * The projection pass moved out of the solver, so these pin the two things the
 * move must not change: the cached values are bit-identical to the independent
 * per-node projector path, and the solver's delegate agrees with the free
 * function.
 */

test("projectGraph reproduces the per-node projector path bit-for-bit", () => {
    const graph = sparseGraph(64, 4242);
    const projector = Projector.forCanvas(800, 600);

    projectGraph(graph, projector);

    for (const node of graph.vertices) {
        const reference = projector.project(node.position);
        const canvas = projector.viewport.toCanvas(reference.screen);

        assert.equal(node.depth, reference.depth, `${node.label} depth`);
        assert.equal(node.translatedPosition.x, canvas.x, `${node.label} x`);
        assert.equal(node.translatedPosition.y, canvas.y, `${node.label} y`);
    }
});

test("a culled node still caches its true, unclamped depth", () => {
    // Culling is a drawing/hit-testing decision; projection reports the raw depth
    // so the cull boundary and the painter sort see the true value.
    const graph = sparseGraph(16, 7);
    const raised = { ...defaultCameraView(), nearPlane: 1e9 };
    const projector = Projector.forCanvas(800, 600, raised);

    projectGraph(graph, projector);

    for (const node of graph.vertices) {
        assert.ok(projector.isCulled(node.depth), `${node.label} must be culled by the raised near plane`);
        assert.ok(node.depth < raised.nearPlane, `${node.label} depth must stay unclamped`);
        assert.equal(node.depth, projector.project(node.position).depth);
    }
});

test("ForceDirectedGraph.project() is exactly projectGraph()", () => {
    const graph = sparseGraph(32, 99);
    const solver = new ForceDirectedGraph(graph);
    const projector = Projector.forCanvas(1280, 800);

    solver.project(projector);

    for (const node of graph.vertices) {
        assert.equal(node.translatedPosition.x, projector.viewport.toCanvas(
            projector.project(node.position).screen
        ).x);
        assert.equal(node.depth, projector.project(node.position).depth);
    }

    // Identical to running the free function over the same graph and projector.
    const replayed = sparseGraph(32, 99);
    projectGraph(replayed, projector);

    for (let i = 0; i < graph.vertices.length; i++) {
        assert.equal(graph.vertices[i].depth, replayed.vertices[i].depth, `node ${i} depth`);
        assert.equal(graph.vertices[i].translatedPosition.x, replayed.vertices[i].translatedPosition.x);
        assert.equal(graph.vertices[i].translatedPosition.y, replayed.vertices[i].translatedPosition.y);
    }
});
