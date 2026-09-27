import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { radius } from "../src/Kernel";
import { Tag } from "../src/Tag";
import { assertClose } from "./support/assert";
import { CANVAS_H, CANVAS_W } from "./support/physics";

test("radius matches Math.hypot across the model-space range", () => {
    const deltas: Array<[number, number, number]> = [
        [0, 0, 0],
        [3, 4, 0],
        [1, 1, 1],
        [-3, 4, -12],
        [600, -600, 600],
        [1e-100, 2e-100, 2e-100],
        [1e-150, 0, 0],
        [1e150, 0, 0],
        [0, -1e150, 1e150],
    ];

    for (const [dx, dy, dz] of deltas) {
        const expected = Math.hypot(dx, dy, dz);

        // assertClose is relative for magnitudes above 1, so this is a relative
        // comparison at scale and an absolute one near zero.
        assertClose(radius(dx, dy, dz), expected, 1e-12, `delta (${dx}, ${dy}, ${dz})`);

        assert.ok(
            Number.isFinite(radius(dx, dy, dz)),
            `delta (${dx}, ${dy}, ${dz}) must stay finite`
        );
    }
});

test("deltas whose squares underflow land in the bounded coincident branch", () => {
    // 1e-162 squared is below the smallest positive double, so sqrt returns 0
    // where hypot still reports the tiny separation. Every kernel has an
    // explicit r === 0 branch, so the outcome is bounded and finite.
    assert.equal(radius(1e-162, 0, 0), 0, "the square must underflow to zero");
    assert.notEqual(Math.hypot(1e-162, 0, 0), 0, "hypot keeps the subnormal separation");

    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 1e-162, y: 0, z: 0 }, "b");
    graph.addNode(a);
    graph.addNode(b);

    const fdg = new ForceDirectedGraph(graph);
    const force = fdg.netElectrostaticForceAtNode(a);

    assert.ok(
        [force.x, force.y, force.z].every(Number.isFinite),
        `an underflowing pair must still produce a finite force, got ${force.x},${force.y},${force.z}`
    );

    // And it separates deterministically through the index tie-break rather
    // than sitting in a fixed point.
    fdg.step(CANVAS_W, CANVAS_H);

    assert.ok(Number.isFinite(a.position.x) && a.position.x < 0, `a stayed at ${a.position.x}`);
    assert.ok(Number.isFinite(b.position.x) && b.position.x > 0, `b stayed at ${b.position.x}`);
});
