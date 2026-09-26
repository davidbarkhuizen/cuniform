import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { Tag } from "../src/Tag";
import { assertClose } from "./support/assert";

const fdg = new ForceDirectedGraph(new Graph());

const W0 = K.space.W_0;
const H0 = K.space.H_0;

test("the model space is the reference 600x600 square", () => {
    assert.equal(W0, 600);
    assert.equal(H0, 600);
    assert.equal(K.ui.minimumNodeSelectionRadius, 15.0);
});

test("translate maps the model origin to the canvas centre", () => {
    assert.deepEqual(fdg.translate({ x: 0, y: 0 }, W0, H0, 800, 600), { x: 400, y: 300 });
});

test("increasing model y moves up the canvas", () => {
    const up = fdg.translate({ x: 0, y: 100 }, W0, H0, 800, 600);
    assert.ok(up.y < 300, `expected y above centre, got ${up.y}`);
});

test("the scale is uniform when the canvas aspect ratio differs from the model square", () => {
    // Model is square; canvas 1200x600 is not. A model offset of 100 units on
    // either axis must map to the same number of pixels.
    const horizontal = fdg.translate({ x: 100, y: 0 }, W0, H0, 1200, 600);
    const vertical = fdg.translate({ x: 0, y: 100 }, W0, H0, 1200, 600);

    const dx = horizontal.x - 600;
    const dy = 300 - vertical.y;

    assertClose(dx, dy, 1e-9, `x scale ${dx} != y scale ${dy}`);
});

test("reverse is the exact inverse of translate, at any canvas aspect ratio", () => {
    const canvases: Array<[number, number]> = [[800, 600], [600, 800], [700, 700], [1024, 768]];
    const points = [{ x: 0, y: 0 }, { x: 123.4, y: -56.7 }, { x: -299, y: 299 }];

    for (const [w, h] of canvases) {
        for (const p of points) {
            const canvas = fdg.translate(p, W0, H0, w, h);
            const back = fdg.reverse(canvas, W0, H0, w, h);
            const where = `${w}x${h} point ${p.x},${p.y} round-tripped to ${back.x},${back.y}`;
            assertClose(back.x, p.x, 1e-9, where);
            assertClose(back.y, p.y, 1e-9, where);
        }
    }
});

test("nothing clamps a node to the model square", () => {
    const graph = new Graph();
    const far = new Tag({ x: 5000, y: -5000 }, "far");
    graph.addNode(far);

    const solver = new ForceDirectedGraph(graph);
    solver.step(800, 600);

    assert.deepEqual(far.position, { x: 5000, y: -5000 }, "an isolated node must be free to drift");
});
