import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { Tag } from "../src/Tag";
import { CANVAS_H, CANVAS_W, maxTravelPerStep, mean, newGraph } from "./support/physics";

test("the solver runs with no browser globals present", () => {
    assert.equal(typeof (globalThis as any).window, "undefined");

    const graph = newGraph(6, 2);
    const fdg = new ForceDirectedGraph(graph);
    const before = graph.vertices.map(v => ({ x: v.position.x, y: v.position.y }));

    fdg.step(CANVAS_W, CANVAS_H);

    const moved = graph.vertices.some(
        (v, i) => v.position.x !== before[i].x || v.position.y !== before[i].y
    );
    assert.ok(moved, "expected step() to advance the simulation");
});

test("a pinned node holds its position while its neighbour still reacts", () => {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0 }, "a");
    const b = new Tag({ x: 100, y: 0 }, "b");
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(a, b);

    const fdg = new ForceDirectedGraph(graph);

    a.position = { x: 13, y: -7 };
    const bBefore = { x: b.position.x, y: b.position.y };

    fdg.step(CANVAS_W, CANVAS_H, tag => tag === a);

    assert.deepEqual(a.position, { x: 13, y: -7 }, "pinned node must not be integrated");
    assert.ok(
        b.position.x !== bBefore.x || b.position.y !== bBefore.y,
        "the unpinned neighbour should still move"
    );
});

test("step() refreshes the canvas-space cache but does not draw", () => {
    const graph = new Graph();
    const a = new Tag({ x: 100, y: 100 }, "a");
    graph.addNode(a);

    const fdg = new ForceDirectedGraph(graph);
    const before = { x: a.translatedPosition.x, y: a.translatedPosition.y };

    fdg.step(CANVAS_W, CANVAS_H);

    assert.notDeepEqual(
        { x: a.translatedPosition.x, y: a.translatedPosition.y },
        before,
        "translatedPosition should be recomputed by step()"
    );
});

// KNOWN DIVERGENCE - see PHYSICS_ALIGNMENT_PLAN.md section 3.2 item 1.
// The current update is `x += F_net`: there is no velocity, no damping and no
// time step, so the system oscillates instead of relaxing. Phase 1 replaces
// this test with a convergence assertion; until then it records the baseline
// so the harness itself is proven to work.
test("KNOWN: the current integrator does not converge", () => {
    const graph = newGraph(10, 2);
    const fdg = new ForceDirectedGraph(graph);

    const travel = maxTravelPerStep(fdg, graph, 500);
    const late = mean(travel.slice(400));

    assert.ok(late > 10, `expected divergence, but mean late travel was ${late}`);
});
