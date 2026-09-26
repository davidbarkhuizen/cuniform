import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { Projector } from "../src/Projector";
import { Tag } from "../src/Tag";
import { Viewport } from "../src/Viewport";
import { assertClose } from "./support/assert";
import { readSource } from "./support/files";

const W0 = K.space.W_0;
const H0 = K.space.H_0;
const D0 = K.space.D_0;

test("the model space is the reference 600 cube", () => {
    assert.equal(W0, 600);
    assert.equal(H0, 600);
    assert.equal(D0, 600);
    assert.equal(K.ui.minimumNodeSelectionRadiusPx, 15.0);
});

test("toCanvas maps the model origin to the canvas centre", () => {
    assert.deepEqual(Viewport.forCanvas(800, 600).toCanvas({ x: 0, y: 0 }), { x: 400, y: 300 });
});

test("increasing model y moves up the canvas", () => {
    const up = Viewport.forCanvas(800, 600).toCanvas({ x: 0, y: 100 });
    assert.ok(up.y < 300, `expected y above centre, got ${up.y}`);
});

test("the scale is uniform when the canvas aspect ratio differs from the model square", () => {
    // Model is square, canvas 1200x600 is not: a 100-unit offset must scale the same on both axes.
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

test("the retired mapping wrappers and test-only solver methods stay retired", () => {
    const solver = readSource("ForceDirectedGraph.ts");

    // Both once duplicated Viewport.forCanvas(w, h); callers now ask Viewport directly.
    assert.ok(!/wrapTranslate/.test(solver), "wrapTranslate had no caller; use Viewport directly");
    assert.ok(!/wrapReverse/.test(solver), "wrapReverse duplicated Viewport.forCanvas().toModel()");

    // displacementAtNode duplicated Tag.displacement, the getter production reads.
    assert.ok(!/displacementAtNode/.test(solver), "displacement lives on Tag, not the solver");
});

test("nothing clamps a node to the model cube", () => {
    const graph = new Graph();
    const far = new Tag({ x: 5000, y: -5000, z: 5000 }, "far");
    graph.addNode(far);

    const solver = new ForceDirectedGraph(graph);
    solver.step(800, 600);

    assert.deepEqual(far.position, { x: 5000, y: -5000, z: 5000 }, "an isolated node must be free to drift");
});
