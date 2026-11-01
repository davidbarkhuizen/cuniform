import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/graph/Graph";
import { GraphFactory } from "./support/GraphFactory";
import { K } from "../src/core/K";
import { Tag } from "../src/graph/Tag";
import { newGraph } from "./support/physics";

function assertNoSelfLoopsOrDuplicates(graph: Graph, context: string): void {
    const pairs = new Set<string>();

    for (const edge of graph.edges) {
        assert.notEqual(edge.v1, edge.v2, `${context}self-loop`);

        const i = graph.vertices.indexOf(edge.v1);
        const j = graph.vertices.indexOf(edge.v2);
        const key = i < j ? `${i}:${j}` : `${j}:${i}`;

        assert.ok(!pairs.has(key), `${context}duplicate edge ${key}`);
        pairs.add(key);
    }
}

test("generateGraph creates exactly `order` vertices", () => {
    for (const order of [1, 2, 10, 50]) {
        assert.equal(newGraph(order, 2).vertices.length, order);
    }
});

test("generated graphs are sparse, not complete", () => {
    const order = 10;
    const branching = 2;

    for (let trial = 0; trial < 50; trial++) {
        const graph = newGraph(order, branching);
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

test("each node starts at most `branching` new edges, whatever the order", () => {
    for (const [order, branching] of [[3, 1], [5, 2], [11, 2], [20, 4]]) {
        for (let trial = 0; trial < 25; trial++) {
            const graph = newGraph(order, branching);

            assert.ok(
                graph.edges.length <= order * branching,
                `${order}/${branching} trial ${trial}: ${graph.edges.length} edges exceeds ${order * branching}`
            );
        }
    }
});

test("branching bounds a node's new edges, not its final degree", () => {
    // The graph is undirected, so a node also collects the edges its neighbours start: branching bounds new
    // edges, not degree.
    let sawDegreeAboveBranching = false;

    for (let seed = 1; seed <= 20 && !sawDegreeAboveBranching; seed++) {
        const graph = withSeededRandom(() => newGraph(3, 1), seed);

        assert.ok(
            graph.edges.length <= 3 * 1,
            `seed ${seed}: a node may still start at most one new edge`
        );

        sawDegreeAboveBranching = graph.vertices.some(
            vertex => graph.neighbours(vertex).length > 1
        );
    }

    assert.ok(sawDegreeAboveBranching, "a node's degree can exceed `branching`");
});

test("generated graphs have no self-loops and no duplicate edges", () => {
    for (let trial = 0; trial < 50; trial++) {
        const graph = newGraph(15, 3);

        for (const e of graph.edges) {
            assert.notEqual(e.v1, e.v2, `trial ${trial}: self-loop`);
        }

        // An independent check by tag identity: a duplicate the index-key scan misses still fails here.
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
        const graph = newGraph(10, 2);
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
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 10, y: 0, z: 0 }, "b");
    const c = new Tag({ x: 20, y: 0, z: 0 }, "c");
    graph.addNode(a);
    graph.addNode(b);
    graph.addNode(c);
    graph.addEdge(a, b);

    assert.ok(graph.hasEdge(a, b));
    assert.ok(graph.hasEdge(b, a));
    assert.ok(!graph.hasEdge(a, c));
    assert.ok(!graph.hasEdge(a, a));
});

test("initial positions are unique in all three dimensions", () => {
    const graph = newGraph(200, 2);

    // The factory's uniqueness key is the 3-tuple: nodes may share (x, y) and differ in z.
    const keys = new Set(graph.vertices.map(v => `${v.position.x},${v.position.y},${v.position.z}`));
    assert.equal(keys.size, 200);
});

test("generated positions fill the 600^3 model cube", () => {
    const graph = newGraph(200, 2);
    const halfX = K.space.W_0 / 2;
    const halfY = K.space.H_0 / 2;
    const halfZ = K.space.D_0 / 2;

    for (const v of graph.vertices) {
        assert.ok(v.position.x >= -halfX && v.position.x <= halfX, `x out of range: ${v.position.x}`);
        assert.ok(v.position.y >= -halfY && v.position.y <= halfY, `y out of range: ${v.position.y}`);
        assert.ok(v.position.z >= -halfZ && v.position.z <= halfZ, `z out of range: ${v.position.z}`);
    }

    // Generation must actually use the depth axis, not sit on the z = 0 plane.
    const zs = graph.vertices.map(v => v.position.z);
    assert.ok(Math.min(...zs) < 0, "the generated z must reach the near half of the cube");
    assert.ok(Math.max(...zs) > 0, "the generated z must reach the far half of the cube");
});

test("labels restart for each graph instead of growing across graphs", () => {
    const first = newGraph(3, 1);
    const second = newGraph(3, 1);

    assert.deepEqual(first.vertices.map(v => v.label), ["Node 0", "Node 1", "Node 2"]);
    assert.deepEqual(second.vertices.map(v => v.label), ["Node 0", "Node 1", "Node 2"]);
});

test("hasEdge is an O(1) membership test with the same rules", () => {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 10, y: 0, z: 0 }, "b");
    const foreign = new Tag({ x: 20, y: 0, z: 0 }, "foreign");

    graph.addNode(a);
    graph.addNode(b);

    assert.ok(!graph.hasEdge(a, b), "no edge yet");
    assert.ok(!graph.hasEdge(a, foreign), "an unknown tag is never a neighbour");
    assert.ok(!graph.hasEdge(foreign, a), "an unknown tag is never a neighbour");

    graph.addEdge(a, b);
    graph.addEdge(a, b); // addEdge permits duplicate edges; membership stays idempotent
    graph.addEdge(a, a); // a self-loop is indexed, but it is not a neighbour relation

    assert.ok(graph.hasEdge(a, b));
    assert.ok(graph.hasEdge(b, a));
    assert.ok(!graph.hasEdge(a, a), "a vertex is not its own neighbour");
});

test("a nearly complete graph terminates and keeps every invariant", () => {
    // branching = order - 1 drives the rejection sampler into its linear fallback.
    for (const order of [2, 3, 4, 5]) {
        for (let trial = 0; trial < 20; trial++) {
            const graph = newGraph(order, order - 1);

            assert.ok(
                graph.edges.length <= order * (order - 1),
                `order ${order} trial ${trial}: too many edges`
            );

            assertNoSelfLoopsOrDuplicates(graph, `order ${order} trial ${trial}: `);
        }
    }
});

test("generation is deterministic for a fixed random stream", () => {
    const first = withSeededRandom(() => newGraph(30, 3));
    const second = withSeededRandom(() => newGraph(30, 3));

    const shape = (graph: Graph) => ({
        labels: graph.vertices.map(vertex => vertex.label),
        edges: graph.edges.map(edge => [graph.vertices.indexOf(edge.v1), graph.vertices.indexOf(edge.v2)]),
    });

    assert.deepEqual(shape(first), shape(second));
});

test("a larger graph still respects the edge bound and has no duplicates", () => {
    const order = 500;
    const branching = 3;
    const graph = newGraph(order, branching);

    assert.equal(graph.vertices.length, order);
    assert.ok(
        graph.edges.length <= order * branching,
        `${graph.edges.length} edges exceeds ${order * branching}`
    );

    assertNoSelfLoopsOrDuplicates(graph, "");
});

/** Run `fn` with a deterministic Math.random, restoring the real one after. */
function withSeededRandom<T>(fn: () => T, seed: number = 42): T {
    const original = Math.random;
    let state = seed;

    Math.random = () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };

    try {
        return fn();
    } finally {
        Math.random = original;
    }
}

// F12: generation used Math.random() with no seed, so a bad random layout could not be rebuilt.
test("one seed rebuilds the same random graph, positions and edges", () => {
    const shape = (graph: Graph) => ({
        positions: graph.vertices.map(v => ({ ...v.position })),
        edges: graph.edges.map(e => [graph.vertices.indexOf(e.v1), graph.vertices.indexOf(e.v2)]),
    });

    const a = new GraphFactory().generateGraph(64, 3, 12345);
    const b = new GraphFactory().generateGraph(64, 3, 12345);
    const c = new GraphFactory().generateGraph(64, 3, 12346);

    assert.deepEqual(shape(a), shape(b));
    assert.notDeepEqual(shape(c), shape(a), "a different seed gives a different graph");
});

