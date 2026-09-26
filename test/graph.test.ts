import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/Graph";
import { Tag } from "../src/Tag";
import { tag } from "./support/physics";

test("removing a tag that is not in the graph leaves the vertices untouched", () => {
    const graph = new Graph();
    const a = tag("a");
    const b = tag("b");
    const c = tag("c");
    graph.addNode(a);
    graph.addNode(b);
    graph.addNode(c);

    // Previously splice(-1, 1) deleted the last vertex.
    graph.removeNode(tag("foreign"));

    assert.deepEqual(graph.vertices, [a, b, c]);
});

test("removing a real node removes it and its incident edges", () => {
    const graph = new Graph();
    const a = tag("a");
    const b = tag("b");
    const c = tag("c");
    [a, b, c].forEach(t => graph.addNode(t));
    graph.addEdge(a, b);
    graph.addEdge(b, c);
    graph.addEdge(a, c);

    graph.removeNode(b);

    assert.deepEqual(graph.vertices, [a, c]);
    assert.deepEqual(graph.edges, [{ v1: a, v2: c }]);
});

test("removing a node keeps edges it was not part of", () => {
    const graph = new Graph();
    const a = tag("a");
    const b = tag("b");
    const c = tag("c");
    const d = tag("d");
    [a, b, c, d].forEach(t => graph.addNode(t));
    graph.addEdge(a, b);
    graph.addEdge(c, d);

    graph.removeNode(b);

    assert.deepEqual(graph.edges, [{ v1: c, v2: d }]);
});

test("removing the same node twice is a no-op the second time", () => {
    const graph = new Graph();
    const a = tag("a");
    const b = tag("b");
    graph.addNode(a);
    graph.addNode(b);

    graph.removeNode(a);
    graph.removeNode(a);

    assert.deepEqual(graph.vertices, [b]);
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

test("hasEdge and removeNode ignore edge direction", () => {
    const graph = new Graph();
    const a = tag("a");
    const b = tag("b");
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(b, a);

    assert.ok(graph.hasEdge(a, b));
    assert.ok(graph.hasEdge(b, a));

    graph.removeNode(a);
    assert.deepEqual(graph.edges, []);
});

test("a tag owns its own points rather than sharing point()/zero() results", () => {
    // point() and zero() are factories exactly so that this holds: a shared
    // ZERO constant would alias every tag's velocity and force accumulators.
    const origin = { x: 3, y: 4 };
    const a = new Tag(origin, "a");
    const b = new Tag(origin, "b");

    a.position.x = 99;
    a.velocity.x = 1;

    assert.deepEqual(origin, { x: 3, y: 4 }, "the constructor must not alias the caller's point");
    assert.deepEqual({ ...a.translatedPosition }, { x: 3, y: 4 }, "position and translatedPosition must not alias");
    assert.deepEqual({ ...b.velocity }, { x: 0, y: 0 }, "one tag's velocity must not move another's");
    assert.notStrictEqual(a.velocity, b.velocity);
    assert.notStrictEqual(a.netElectrostaticForce, a.netSpringForce);
});
