import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { Tag } from "../src/Tag";
import { assertClose } from "./support/assert";
import { readSource } from "./support/files";
import { CANVAS_H, CANVAS_W } from "./support/physics";

// Deterministic, well-separated positions inside the 600x600 model square.
const POSITIONS = [
    { x: -250, y: 120 }, { x: 180, y: -200 }, { x: 40, y: 260 },
    { x: -60, y: -40 }, { x: 280, y: 60 }, { x: -180, y: -220 },
    { x: 120, y: 180 }, { x: -280, y: 20 }, { x: 220, y: -120 },
    { x: 0, y: 0 },
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

/** Positions keyed by label, so results can be compared across orderings. */
function snapshot(graph: Graph): Record<string, { x: number; y: number }> {
    const out: Record<string, { x: number; y: number }> = {};
    for (const v of graph.vertices) {
        out[v.label] = { x: v.position.x, y: v.position.y };
    }
    return out;
}

function assertSamePositions(
    actual: Record<string, { x: number; y: number }>,
    expected: Record<string, { x: number; y: number }>,
    message: string
) {
    for (const label of Object.keys(expected)) {
        assert.ok(actual[label], `${message}: missing ${label}`);
        assertClose(actual[label].x, expected[label].x, 1e-9, `${message}: ${label} x`);
        assertClose(actual[label].y, expected[label].y, 1e-9, `${message}: ${label} y`);
    }
}

test("one step is independent of vertex iteration order (Jacobi update)", () => {
    const base = build();
    base.fdg.step(CANVAS_W, CANVAS_H);
    const expected = snapshot(base.graph);

    // Reverse the vertex array: every force must still be computed from the
    // same frozen snapshot of positions.
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

    const before = tags.map(t => ({ x: t.position.x, y: t.position.y }));

    // Forces computed now are pure functions of the pre-step positions.
    const expected = tags.map((t, i) => {
        const e = fdg.netElectrostaticForceAtNode(t);
        const s = fdg.netSpringForceAtNode(t);
        const dt = K.physics.timeStep;
        return {
            x: before[i].x + (e.x + s.x) * dt,
            y: before[i].y + (e.y + s.y) * dt,
        };
    });

    fdg.step(CANVAS_W, CANVAS_H);

    // A Gauss-Seidel update would let later nodes react to earlier nodes'
    // new positions and would not reproduce this result.
    tags.forEach((t, i) => {
        assertClose(t.position.x, expected[i].x, 1e-12, `${t.label} x at ${t.position.x}`);
        assertClose(t.position.y, expected[i].y, 1e-12, `${t.label} y at ${t.position.y}`);
    });
});

test("the solver source has no browser coupling", () => {
    const solver = readSource("ForceDirectedGraph.ts");

    assert.ok(!/\bwindow\b/.test(solver), "solver must not reference window");
    assert.ok(!/\bdocument\b/.test(solver), "solver must not reference document");

    // Drawing lives in its own module now, so the solver's DOM-freedom is
    // structural rather than a convention: there is no canvas type left in the
    // file to reference.
    const canvasTypeUses = solver.split("CanvasRenderingContext2D").length - 1;
    assert.equal(canvasTypeUses, 0, "the solver must not name a canvas type");

    const renderer = readSource("Renderer.ts");
    assert.equal(
        renderer.split("CanvasRenderingContext2D").length - 1,
        1,
        "Renderer is where render()'s canvas parameter lives"
    );
});
