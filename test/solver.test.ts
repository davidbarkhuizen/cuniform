import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { Tag } from "../src/Tag";
import { CANVAS_H, CANVAS_W, edgeBetween, newGraph, singleNode } from "./support/physics";

// A small, deterministic graph: positions and edges are explicit, so two builds
// are identical without depending on the RNG.
function reproducibleGraph(): Graph {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 40, y: 10, z: -5 }, "b");
    const c = new Tag({ x: -25, y: 30, z: 12 }, "c");
    const d = new Tag({ x: 12, y: -44, z: 6 }, "d");

    [a, b, c, d].forEach(t => graph.addNode(t));
    graph.addEdge(a, b);
    graph.addEdge(b, c);
    graph.addEdge(c, d);
    graph.addEdge(d, a);

    return graph;
}

function snapshot(graph: Graph): Array<{ x: number; y: number; z: number; vx: number; vy: number; vz: number }> {
    return graph.vertices.map(t => ({
        x: t.position.x, y: t.position.y, z: t.position.z,
        vx: t.velocity.x, vy: t.velocity.y, vz: t.velocity.z,
    }));
}

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

test("two identical graphs stepped identically agree exactly", () => {
    const first = reproducibleGraph();
    const second = reproducibleGraph();

    const firstSolver = new ForceDirectedGraph(first);
    const secondSolver = new ForceDirectedGraph(second);

    for (let tick = 0; tick < 5; tick++) {
        firstSolver.step(CANVAS_W, CANVAS_H);
        secondSolver.step(CANVAS_W, CANVAS_H);
    }

    assert.deepEqual(snapshot(first), snapshot(second), "the step must be reproducible");
});

test("step() does not carry force-buffer residue from accumulateRepulsion()", () => {
    // accumulateRepulsion() writes the solver's repulsion buffers; step() shares
    // them, so it must clear them before accumulating or the first step would
    // double-count the pair forces computed here.
    const polluted = reproducibleGraph();
    const clean = reproducibleGraph();

    const pollutedSolver = new ForceDirectedGraph(polluted);
    const cleanSolver = new ForceDirectedGraph(clean);

    pollutedSolver.accumulateRepulsion(polluted.vertices.map(() => ({ x: 0, y: 0, z: 0 })));

    pollutedSolver.step(CANVAS_W, CANVAS_H);
    pollutedSolver.step(CANVAS_W, CANVAS_H);

    cleanSolver.step(CANVAS_W, CANVAS_H);
    cleanSolver.step(CANVAS_W, CANVAS_H);

    assert.deepEqual(snapshot(polluted), snapshot(clean), "step() must start from zeroed buffers");
});

test("the solver grows its buffers when the graph gains vertices in place", () => {
    const graph = new Graph();
    graph.addNode(new Tag({ x: 0, y: 0, z: 0 }, "a"));
    graph.addNode(new Tag({ x: 30, y: 0, z: 0 }, "b"));
    graph.addEdge(graph.vertices[0], graph.vertices[1]);

    const solver = new ForceDirectedGraph(graph);

    // Size the buffers for two vertices...
    solver.step(CANVAS_W, CANVAS_H);

    // ...then exceed them through the same solver instance, which is the
    // defensive growth path loadGraph() would otherwise hide.
    for (let i = 2; i < 9; i++)
        graph.addNode(new Tag({ x: (i % 2 === 0 ? 1 : -1) * i * 20, y: i * 7, z: 3 }, `n${i}`));

    solver.step(CANVAS_W, CANVAS_H);

    for (const tag of graph.vertices) {
        assert.ok(
            Number.isFinite(tag.position.x) && Number.isFinite(tag.position.y) && Number.isFinite(tag.position.z),
            `${tag.label} must integrate after the buffers grow, got ${tag.position.x},${tag.position.y},${tag.position.z}`
        );
        assert.ok(Number.isFinite(tag.depth), `${tag.label} must be projected`);
        assert.ok(Number.isFinite(tag.translatedPosition.x), `${tag.label} must map to the canvas`);
    }
});

test("the object-form accumulateRepulsion() still accumulates onto its input", () => {
    // One pair keeps the arithmetic exact: the flat path must add the pair force
    // to the caller's seed, matching the old "accumulate onto out" contract.
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 50, y: 0, z: 0 }, "b");
    graph.addNode(a);
    graph.addNode(b);

    const solver = new ForceDirectedGraph(graph);
    const out = [{ x: 1000, y: -7, z: 3 }, { x: 0, y: 0, z: 0 }];

    solver.accumulateRepulsion(out);

    const reference = solver.netElectrostaticForceAtNode(a);

    assert.equal(out[0].x, 1000 + reference.x, "the seed must be added to, not overwritten");
    assert.equal(out[0].y, -7 + reference.y);
    assert.equal(out[0].z, 3 + reference.z);
});
