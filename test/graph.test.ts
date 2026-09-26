import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/Graph";
import { Tag } from "../src/Tag";
import { readSource } from "./support/files";
import { tag } from "./support/physics";

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

test("Graph carries no removeNode machinery", () => {
    // Nothing in src/ removes a node; both helpers are recoverable from git history if a caller appears.
    const source = readSource("Graph.ts");

    assert.ok(!/removeNode/.test(source), "removeNode had no src/ caller");
    assert.ok(!/rebuildAdjacency/.test(source), "rebuildAdjacency only served removeNode");
});

test("a tag owns its own points rather than aliasing the caller's", () => {
    // The constructor copies through point3()/point() and zero3(), so no two tags share a point object.
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
