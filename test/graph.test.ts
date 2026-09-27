import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/graph/Graph";
import { Tag } from "../src/graph/Tag";
import { tag } from "./support/physics";

test("addNode rejects a vertex that is already in the graph", () => {
    const graph = new Graph();
    const a = tag("a");
    graph.addNode(a);

    assert.throws(
        () => graph.addNode(a),
        (error: unknown) => {
            assert.ok(error instanceof Error, `threw a ${typeof error}, not an Error`);
            assert.equal(error.message, "Graph.addNode: vertex is already in the graph");
            return true;
        }
    );

    assert.deepEqual(graph.vertices, [a], "the rejected add must not duplicate the vertex");
});

test("addEdge rejects foreign vertices with a complete Error, not a bare string", () => {
    const graph = new Graph();
    const a = tag("a");
    graph.addNode(a);

    assert.throws(
        () => graph.addEdge(a, tag("foreign")),
        (error: unknown) => {
            assert.ok(error instanceof Error, `threw a ${typeof error}, not an Error`);
            assert.equal(error.message, "Graph.addEdge: both vertices must already be in the graph");
            return true;
        }
    );
});

test("neighbours lists a duplicated neighbour only once", () => {
    const graph = new Graph();
    const a = tag("a");
    const b = tag("b");
    const c = tag("c");
    [a, b, c].forEach(t => graph.addNode(t));

    // The model allows duplicate edges (nothing dedupes addEdge).
    graph.addEdge(a, b);
    graph.addEdge(a, b);
    graph.addEdge(b, a);
    graph.addEdge(a, c);

    assert.deepEqual(graph.neighbours(a), [b, c]);
    assert.deepEqual(graph.neighbours(b), [a]);
});

test("neighbours ignores self-loops", () => {
    const graph = new Graph();
    const a = tag("a");
    const b = tag("b");
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(a, a);
    graph.addEdge(a, b);

    assert.deepEqual(graph.neighbours(a), [b]);
});

test("neighbours is empty for an isolated or foreign vertex", () => {
    const graph = new Graph();
    const a = tag("a");
    graph.addNode(a);

    assert.deepEqual(graph.neighbours(a), []);
    assert.deepEqual(graph.neighbours(tag("foreign")), []);
});

test("hasEdge ignores edge direction", () => {
    const graph = new Graph();
    const a = tag("a");
    const b = tag("b");
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(b, a);

    assert.ok(graph.hasEdge(a, b));
    assert.ok(graph.hasEdge(b, a));
});

test("a tag owns its own points rather than aliasing the caller's", () => {
    const origin = { x: 3, y: 4, z: 5 };
    const a = new Tag(origin, "a");
    const b = new Tag(origin, "b");

    a.position.x = 99;
    a.velocity.x = 1;

    assert.deepEqual(origin, { x: 3, y: 4, z: 5 }, "the constructor must not alias the caller's point");
    assert.deepEqual({ ...a.translatedPosition }, { x: 3, y: 4 }, "position and translatedPosition must not alias");
    assert.deepEqual({ ...b.velocity }, { x: 0, y: 0, z: 0 }, "one tag's velocity must not move another's");
    assert.notStrictEqual(a.velocity, b.velocity);
});
