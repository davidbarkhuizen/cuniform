import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/physics/ForceDirectedGraph";
import { Graph } from "../src/graph/Graph";
import { K } from "../src/core/K";
import { Tag } from "../src/graph/Tag";
import { assertClose } from "./support/assert";
import {
    ANALYTIC_EQUILIBRIUM,
    CANVAS_H,
    CANVAS_W,
    REPULSION_CONSTANT,
    maxAbsPosition,
    pairAt,
} from "./support/physics";

/**
 * The r -> 0 singularity used to fling a node ~1340 units in one step; reachable
 * because a drag pins only the dragged node, so the other absorbs the force.
 */

test("the minimum interaction radius is a positive, finite guard", () => {
    const minR = K.physics.minimumInteractionRadius;

    assert.ok(Number.isFinite(minR) && minR > 0, `guard radius was ${minR}`);

    // The guard must not reach r = 10, the smallest radius tested in forces.test.ts.
    assert.ok(minR <= 10, `guard radius ${minR} would alter the reference law at r = 10`);
});

test("repulsion magnitude is clamped below the minimum interaction radius", () => {
    const minR = K.physics.minimumInteractionRadius;
    const exponent = K.physics.repulsionExponent;

    const bound = REPULSION_CONSTANT / Math.pow(minR, exponent);

    for (const r of [0.001, 0.5, 0.857, minR - 0.001]) {
        const { a, fdg } = pairAt(r);
        const f = fdg.netElectrostaticForceAtNode(a);

        assertClose(
            Math.abs(f.x),
            bound,
            1e-9,
            `r=${r}: |F| was ${Math.abs(f.x)}, expected the clamped bound ${bound}`
        );
        assert.ok(f.x < 0, `r=${r}: the clamped force must still push away`);
        assertClose(f.y, 0, 1e-12, `r=${r}: the clamped force must stay radial`);
    }
});

test("repulsion is exactly the reference law at and above the guard radius", () => {
    const minR = K.physics.minimumInteractionRadius;
    const exponent = K.physics.repulsionExponent;

    for (const r of [minR, 10, 30, ANALYTIC_EQUILIBRIUM, 100, 300]) {
        const { a, fdg } = pairAt(r);
        const f = fdg.netElectrostaticForceAtNode(a);
        const expected = REPULSION_CONSTANT / Math.pow(r, exponent);

        assertClose(
            Math.abs(f.x),
            expected,
            1e-9,
            `r=${r}: |F| was ${Math.abs(f.x)}, expected the unclamped ${expected}`
        );
    }
});

test("dragging a node onto another cannot fling the free node across the world", () => {
    // One canvas pixel (600/700 model units) is the closest a pointer-driven
    // drag can place two node centres apart.
    const onePixel = K.space.W_0 / 700;

    const graph = new Graph();
    const pinned = new Tag({ x: 0, y: 0, z: 0 }, "pinned");
    const free = new Tag({ x: onePixel, y: 0, z: 0 }, "free");
    graph.addNode(pinned);
    graph.addNode(free);
    graph.addEdge(pinned, free);

    const fdg = new ForceDirectedGraph(graph);

    // The unbounded law would move the free node ~1340 units in the first step.
    const before = { x: free.position.x, y: free.position.y, z: free.position.z };
    pinned.position = { x: 0, y: 0, z: 0 };
    fdg.step(CANVAS_W, CANVAS_H, tag => tag === pinned);
    const firstStep = Math.hypot(
        free.position.x - before.x,
        free.position.y - before.y,
        free.position.z - before.z
    );

    assert.ok(firstStep < 20, `first step moved ${firstStep} units, expected a bounded nudge`);

    // A pinned node's position is never integrated, so parking the pointer once is enough.
    pinned.position = { x: 0, y: 0, z: 0 };
    const maxDistanceFromOrigin = maxAbsPosition(fdg, graph, 3000, tag => tag === pinned);

    assert.ok(
        maxDistanceFromOrigin < 150,
        `free node wandered ${maxDistanceFromOrigin} units from the pinned node`
    );
    assert.ok(
        Number.isFinite(free.position.x) && Number.isFinite(free.position.y) && Number.isFinite(free.position.z),
        "the free node's position must stay finite"
    );

    // The guard must not change where the pair settles: the undisturbed single-edge equilibrium.
    const settled = Math.hypot(
        free.position.x - pinned.position.x,
        free.position.y - pinned.position.y,
        free.position.z - pinned.position.z
    );
    assertClose(settled, ANALYTIC_EQUILIBRIUM, 1.0, `settled at r=${settled}, expected ~${ANALYTIC_EQUILIBRIUM}`);
});

test("a cluster of near-coincident nodes stays finite and bounded", () => {
    const graph = new Graph();
    const tags: Tag[] = [];

    for (let i = 0; i < 5; i++) {
        const tag = new Tag({ x: i * 0.05, y: 0, z: 0 }, `n${i}`);
        graph.addNode(tag);
        tags.push(tag);
    }
    for (let i = 1; i < tags.length; i++)
        graph.addEdge(tags[0], tags[i]);

    const fdg = new ForceDirectedGraph(graph);

    const maxAbs = maxAbsPosition(fdg, graph, 3000);

    assert.ok(
        tags.every(v =>
            Number.isFinite(v.position.x) &&
            Number.isFinite(v.position.y) &&
            Number.isFinite(v.position.z)
        ),
        "every position must stay finite"
    );
    assert.ok(maxAbs < 500, `a near-coincident cluster reached ${maxAbs} units`);
});
