import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/Graph";
import { GraphFactory } from "../src/GraphFactory";
import { K } from "../src/K";
import { Tag } from "../src/Tag";

function generated(order: number, branching: number) {
    return new GraphFactory().generateGraph(order, branching);
}

test("generateGraph creates exactly `order` vertices", () => {
    for (const order of [1, 2, 10, 50]) {
        assert.equal(generated(order, 2).vertices.length, order);
    }
});

test("generated graphs are sparse, not complete", () => {
    const order = 10;
    const branching = 2;

    for (let trial = 0; trial < 50; trial++) {
        const graph = generated(order, branching);
        const complete = (order * (order - 1)) / 2;

        assert.ok(
            graph.edges.length <= order * branching,
            `trial ${trial}: ${graph.edges.length} edges exceeds order*branching`
        );
        assert.ok(
            graph.edges.length < complete,
            `trial ${trial}: ${graph.edges.length} edges looks complete (${complete})`
        );
    }
});

test("generated graphs have no self-loops and no duplicate edges", () => {
    for (let trial = 0; trial < 50; trial++) {
        const graph = generated(15, 3);

        for (const e of graph.edges) {
            assert.notEqual(e.v1, e.v2, `trial ${trial}: self-loop`);
        }

        for (let i = 0; i < graph.edges.length; i++) {
            for (let j = i + 1; j < graph.edges.length; j++) {
                const a = graph.edges[i];
                const b = graph.edges[j];
                const duplicate =
                    (a.v1 === b.v1 && a.v2 === b.v2) ||
                    (a.v1 === b.v2 && a.v2 === b.v1);
                assert.ok(!duplicate, `trial ${trial}: duplicate edge ${i}/${j}`);
            }
        }
    }
});

test("every vertex is joined to at least one other", () => {
    for (let trial = 0; trial < 20; trial++) {
        const graph = generated(10, 2);
        for (const v of graph.vertices) {
            assert.ok(
                graph.neighbours(v).length >= 1,
                `trial ${trial}: ${v.label} is isolated`
            );
        }
    }
});

test("hasEdge is undirected", () => {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0 }, "a");
    const b = new Tag({ x: 10, y: 0 }, "b");
    const c = new Tag({ x: 20, y: 0 }, "c");
    graph.addNode(a);
    graph.addNode(b);
    graph.addNode(c);
    graph.addEdge(a, b);

    assert.ok(graph.hasEdge(a, b));
    assert.ok(graph.hasEdge(b, a));
    assert.ok(!graph.hasEdge(a, c));
    assert.ok(!graph.hasEdge(a, a));
});

test("initial positions are unique", () => {
    const graph = generated(200, 2);
    const keys = new Set(graph.vertices.map(v => `${v.position.x},${v.position.y}`));
    assert.equal(keys.size, 200);
});

test("the shipped initial conditions match the reference demo", () => {
    assert.equal(K.initialConditions.order, 11);
    assert.equal(K.initialConditions.branching, 2);
});
