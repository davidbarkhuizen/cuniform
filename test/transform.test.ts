import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/physics/ForceDirectedGraph";
import { Graph } from "../src/graph/Graph";
import { K } from "../src/core/K";
import { Projector } from "../src/view/Projector";
import { Tag } from "../src/graph/Tag";
import { Viewport } from "../src/view/Viewport";
import { assertClose } from "./support/assert";
import { stepsUntilQuiet } from "./support/physics";

const W0 = K.space.W_0;
const H0 = K.space.H_0;
const D0 = K.space.D_0;

test("the model space is the reference 600 cube", () => {
    assert.equal(W0, 600);
    assert.equal(H0, 600);
    assert.equal(D0, 600);
    assert.equal(K.ui.minimumNodeSelectionRadiusPx, 15.0);
});

test("a molecule seed starts at the springs' rest length", () => {
    // Separate knobs that must stay equal: the repulsion guard depends on it.
    assert.equal(K.molecule.seedSpacing, K.physics.equilibriumDisplacement);
});

test("toCanvas maps the model origin to the canvas centre", () => {
    assert.deepEqual(Viewport.forCanvas(800, 600).toCanvas({ x: 0, y: 0 }), { x: 400, y: 300 });
});

test("increasing model y moves up the canvas", () => {
    const up = Viewport.forCanvas(800, 600).toCanvas({ x: 0, y: 100 });
    assert.ok(up.y < 300, `expected y above centre, got ${up.y}`);
});

test("the scale is uniform when the canvas aspect ratio differs from the model square", () => {
    const viewport = Viewport.forCanvas(1200, 600);
    const horizontal = viewport.toCanvas({ x: 100, y: 0 });
    const vertical = viewport.toCanvas({ x: 0, y: 100 });

    const dx = horizontal.x - 600;
    const dy = 300 - vertical.y;

    assertClose(dx, dy, 1e-9, `x scale ${dx} != y scale ${dy}`);
});

test("toModel is the exact inverse of toCanvas, at any canvas aspect ratio", () => {
    const canvases: Array<[number, number]> = [[800, 600], [600, 800], [700, 700], [1024, 768]];
    const points = [{ x: 0, y: 0 }, { x: 123.4, y: -56.7 }, { x: -299, y: 299 }];

    for (const [w, h] of canvases) {
        const viewport = Viewport.forCanvas(w, h);

        for (const p of points) {
            const back = viewport.toModel(viewport.toCanvas(p));
            const where = `${w}x${h} point ${p.x},${p.y} round-tripped to ${back.x},${back.y}`;
            assertClose(back.x, p.x, 1e-9, where);
            assertClose(back.y, p.y, 1e-9, where);
        }
    }
});

test("step() caches translatedPosition and depth through the projector", () => {
    const graph = new Graph();
    const a = new Tag({ x: 100, y: -40, z: 0 }, "a");
    graph.addNode(a);

    const fdg = new ForceDirectedGraph(graph);
    const projector = Projector.forCanvas(800, 600);

    fdg.step(800, 600, () => false, projector);

    // The cache is written from the post-step position, so re-projecting it must reproduce it.
    const expected = projector.project(a.position);

    assert.deepEqual(a.translatedPosition, projector.viewport.toCanvas(expected.screen));
    assert.equal(a.depth, expected.depth);
    assert.deepEqual(
        a.translatedPosition,
        Viewport.forCanvas(800, 600).toCanvas(a.position),
        "the default identity camera still reduces to the 2D mapping"
    );
});

test("nothing clamps a node to the model cube", () => {
    // No model-cube clamp: the lone radial force is the component anchor's proportional pull with a dead zone
    // (see test/anchor.test.ts).
    const graph = new Graph();
    const far = new Tag({ x: 5000, y: -5000, z: 5000 }, "far");
    graph.addNode(far);

    const solver = new ForceDirectedGraph(graph);

    const r = Math.hypot(far.position.x, far.position.y, far.position.z);
    const pull = K.physics.componentAnchorStrength * (r - K.physics.componentAnchorRadius);
    const expected = pull * K.physics.timeStep;

    solver.step(800, 600);

    const displacement = Math.hypot(far.position.x - 5000, far.position.y + 5000, far.position.z - 5000);

    assertClose(displacement, expected, 1e-9, `the anchor must pull gently, moved ${displacement}`);
    assert.ok(
        Math.hypot(far.position.x, far.position.y, far.position.z) < r,
        `the pull must be toward the origin, distance went ${r} -> ${Math.hypot(far.position.x, far.position.y, far.position.z)}`
    );

    // A hard clamp or a constant-magnitude pull would fail one of these traits.
    let previous = { x: far.position.x, y: far.position.y, z: far.position.z };
    let outermost = 0;
    let teleport = 0;

    for (let guard = 0; guard < 5000; guard++) {
        solver.step(800, 600);

        const travel = Math.hypot(
            far.position.x - previous.x,
            far.position.y - previous.y,
            far.position.z - previous.z
        );

        teleport = Math.max(teleport, travel);
        outermost = Math.max(outermost, Math.hypot(far.position.x, far.position.y, far.position.z));
        previous = { x: far.position.x, y: far.position.y, z: far.position.z };

        if (solver.lastMaxDisplacement < K.physics.settleEpsilon)
            break;
    }

    assert.ok(teleport < r / 4, `a step must not teleport the node, worst step moved ${teleport}`);
    assert.ok(outermost <= r, `the node must never be flung outward, reached ${outermost}`);
    assert.ok(
        Math.hypot(far.position.x, far.position.y, far.position.z) <= K.physics.componentAnchorRadius * 1.1,
        `a lone node must settle around the dead zone, at ${Math.hypot(far.position.x, far.position.y, far.position.z)}`
    );
    assert.ok(
        Number.isFinite(far.position.x) && Number.isFinite(far.position.y) && Number.isFinite(far.position.z),
        "a drifting node must stay finite"
    );

    // The anchor has a root at the origin, so the node stops rather than orbiting in a limit cycle.
    const last = stepsUntilQuiet(solver);

    assert.ok(
        last.travel < K.physics.settleEpsilon,
        `a lone node must stop moving, final travel ${last.travel}`
    );
});
