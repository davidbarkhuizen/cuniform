import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/physics/ForceDirectedGraph";
import { Graph } from "../src/graph/Graph";
import { K } from "../src/core/K";
import { Tag } from "../src/graph/Tag";
import { assertClose } from "./support/assert";
import { CANVAS_H, CANVAS_W } from "./support/physics";

const POSITIONS = [
    { x: -250, y: 120, z: 0 }, { x: 180, y: -200, z: 0 }, { x: 40, y: 260, z: 0 },
    { x: -60, y: -40, z: 0 }, { x: 280, y: 60, z: 0 }, { x: -180, y: -220, z: 0 },
    { x: 120, y: 180, z: 0 }, { x: -280, y: 20, z: 0 }, { x: 220, y: -120, z: 0 },
    { x: 0, y: 0, z: 0 },
];

const EDGES: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5],
    [5, 6], [6, 7], [7, 8], [8, 9], [9, 0],
    [0, 5], [2, 7],
];

const NATURAL = POSITIONS.map((_, i) => i);
const NATURAL_EDGES = EDGES.map((_, i) => i);

function build(vertexOrder: number[] = NATURAL, edgeOrder: number[] = NATURAL_EDGES) {
    const graph = new Graph();
    const tags = POSITIONS.map((p, i) => new Tag(p, `n${i}`));

    for (const i of vertexOrder) {
        graph.addNode(tags[i]);
    }
    for (const e of edgeOrder) {
        graph.addEdge(tags[EDGES[e][0]], tags[EDGES[e][1]]);
    }

    return { graph, tags, fdg: new ForceDirectedGraph(graph) };
}

function snapshot(graph: Graph): Record<string, { x: number; y: number; z: number }> {
    const out: Record<string, { x: number; y: number; z: number }> = {};
    for (const v of graph.vertices) {
        out[v.label] = { x: v.position.x, y: v.position.y, z: v.position.z };
    }
    return out;
}

function assertSamePositions(
    actual: Record<string, { x: number; y: number; z: number }>,
    expected: Record<string, { x: number; y: number; z: number }>,
    message: string
) {
    for (const label of Object.keys(expected)) {
        assert.ok(actual[label], `${message}: missing ${label}`);
        assertClose(actual[label].x, expected[label].x, 1e-9, `${message}: ${label} x`);
        assertClose(actual[label].y, expected[label].y, 1e-9, `${message}: ${label} y`);
        assertClose(actual[label].z, expected[label].z, 1e-9, `${message}: ${label} z`);
    }
}

test("one step is independent of vertex iteration order (Jacobi update)", () => {
    const base = build();
    base.fdg.step(CANVAS_W, CANVAS_H);
    const expected = snapshot(base.graph);

    // Every force must still come from the same frozen snapshot of positions.
    const shuffled = build([...NATURAL].reverse());
    shuffled.fdg.step(CANVAS_W, CANVAS_H);

    assertSamePositions(snapshot(shuffled.graph), expected, "reversed vertex order");
});

test("one step is independent of edge iteration order", () => {
    const base = build();
    base.fdg.step(CANVAS_W, CANVAS_H);
    const expected = snapshot(base.graph);

    const shuffled = build(NATURAL, [...NATURAL_EDGES].reverse());
    shuffled.fdg.step(CANVAS_W, CANVAS_H);

    assertSamePositions(snapshot(shuffled.graph), expected, "reversed edge order");
});

test("one step is exactly a synchronous update from the pre-step snapshot", () => {
    const { tags, fdg } = build();

    const before = tags.map(t => ({ x: t.position.x, y: t.position.y, z: t.position.z }));

    const expected = tags.map((t, i) => {
        const e = fdg.netElectrostaticForceAtNode(t);
        const s = fdg.netSpringForceAtNode(t);
        const dt = K.physics.timeStep;
        return {
            x: before[i].x + (e.x + s.x) * dt,
            y: before[i].y + (e.y + s.y) * dt,
            z: before[i].z + (e.z + s.z) * dt,
        };
    });

    fdg.step(CANVAS_W, CANVAS_H);

    tags.forEach((t, i) => {
        assertClose(t.position.x, expected[i].x, 1e-12, `${t.label} x at ${t.position.x}`);
        assertClose(t.position.y, expected[i].y, 1e-12, `${t.label} y at ${t.position.y}`);
        assertClose(t.position.z, expected[i].z, 1e-12, `${t.label} z at ${t.position.z}`);
    });
});
