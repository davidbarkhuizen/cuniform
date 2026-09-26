import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { CANVAS_H, CANVAS_W, edgeBetween, newGraph, singleNode } from "./support/physics";

test("the solver runs with no browser globals present", () => {
    assert.equal(typeof (globalThis as any).window, "undefined");

    const graph = newGraph(6, 2);
    const fdg = new ForceDirectedGraph(graph);
    const before = graph.vertices.map(v => ({ x: v.position.x, y: v.position.y, z: v.position.z }));

    fdg.step(CANVAS_W, CANVAS_H);

    const moved = graph.vertices.some(
        (v, i) => v.position.x !== before[i].x || v.position.y !== before[i].y || v.position.z !== before[i].z
    );
    assert.ok(moved, "expected step() to advance the simulation");
});

test("a pinned node holds its position, has no velocity, and its neighbour still reacts", () => {
    const { a, b, fdg } = edgeBetween({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 });

    a.position = { x: 13, y: -7, z: 0 };
    a.velocity = { x: 50, y: 50, z: 0 };
    const bBefore = { x: b.position.x, y: b.position.y };

    fdg.step(CANVAS_W, CANVAS_H, tag => tag === a);

    assert.deepEqual(a.position, { x: 13, y: -7, z: 0 }, "pinned node must not be integrated");
    assert.deepEqual(a.velocity, { x: 0, y: 0, z: 0 }, "pinned node's velocity must be bled off");
    assert.ok(
        b.position.x !== bBefore.x || b.position.y !== bBefore.y,
        "the unpinned neighbour should still move"
    );
});

test("step() refreshes the canvas-space cache but does not draw", () => {
    const { a, fdg } = singleNode();
    const before = { x: a.translatedPosition.x, y: a.translatedPosition.y };

    fdg.step(CANVAS_W, CANVAS_H);

    assert.notDeepEqual(
        { x: a.translatedPosition.x, y: a.translatedPosition.y },
        before,
        "translatedPosition should be recomputed by step()"
    );
});
