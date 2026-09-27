import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/graph/Graph";
import { buildMirrorGraph, packMirror } from "../src/graph/MirrorGraph";
import { Tag } from "../src/graph/Tag";

/**
 * `packMirror` and `buildMirrorGraph` are the two directions of one wire format,
 * so the index space, the strides and the missing-endpoint sentinel are asserted
 * as a round trip rather than as two independent encodings.
 */

function fixture(): Graph {
    const graph = new Graph();

    const a = new Tag({ x: 1, y: 2, z: 3 }, "a");
    const b = new Tag({ x: -4, y: 5, z: -6 }, "b");
    const c = new Tag({ x: 0, y: 0, z: 0 }, "c");

    [a, b, c].forEach(tag => graph.addNode(tag));

    graph.addEdge(a, b);
    graph.addEdge(a, b);   // a duplicate edge is carried, not collapsed
    graph.addEdge(b, b);   // a self-loop is carried as a repeated index
    graph.addEdge(a, c);

    return graph;
}

test("packMirror lays positions out as 3N and edges as 2E", () => {
    const graph = fixture();
    const wire = packMirror(graph);

    assert.equal(wire.positions.length, graph.vertices.length * 3);
    assert.equal(wire.edges.length, graph.edges.length * 2);

    assert.deepEqual(
        [...wire.positions],
        graph.vertices.flatMap(tag => [tag.position.x, tag.position.y, tag.position.z])
    );

    // Node insertion order is the index space.
    assert.deepEqual([...wire.edges], [0, 1, 0, 1, 1, 1, 0, 2]);
});

test("a graph packMirror round-trips through buildMirrorGraph", () => {
    const graph = fixture();
    const wire = packMirror(graph);

    const mirror = buildMirrorGraph(graph.vertices.map(tag => tag.label), wire.edges, wire.positions);

    assert.equal(mirror.vertices.length, graph.vertices.length);
    assert.equal(mirror.edges.length, graph.edges.length);

    mirror.vertices.forEach((tag, i) => {
        assert.equal(tag.label, graph.vertices[i].label, `label ${i}`);
        assert.deepEqual(
            { x: tag.position.x, y: tag.position.y, z: tag.position.z },
            {
                x: graph.vertices[i].position.x,
                y: graph.vertices[i].position.y,
                z: graph.vertices[i].position.z,
            },
            `position ${i}`
        );
    });

    // Topology, not just counts: every original edge resolves to the same pair.
    const pairs = (g: Graph) =>
        g.edges.map(e => [g.vertices.indexOf(e.v1), g.vertices.indexOf(e.v2)] as const);

    assert.deepEqual(pairs(mirror), pairs(graph));
});

test("a -1 endpoint is dropped on decode", () => {
    // The decoder is total over the wire: a message whose edge names a node that
    // is not in the index space must be skipped rather than index a missing tag.
    // Graph.addEdge() prevents the encoder from producing this, so the wire form
    // is built directly.
    const positions = new Float64Array([0, 0, 0, 10, 0, 0]);
    const edges = new Int32Array([0, 1, 1, -1, -1, 0]);

    const mirror = buildMirrorGraph(["a", "b"], edges, positions);

    assert.equal(mirror.edges.length, 1, "only the fully indexed edge survives");
    assert.equal(mirror.vertices[mirror.vertices.indexOf(mirror.edges[0].v1)].label, "a");
    assert.equal(mirror.vertices[mirror.vertices.indexOf(mirror.edges[0].v2)].label, "b");
});

test("buildMirrorGraph defaults the labels physics never reads", () => {
    const graph = fixture();
    const wire = packMirror(graph);

    const mirror = buildMirrorGraph([], wire.edges, wire.positions);

    assert.deepEqual(mirror.vertices.map(tag => tag.label), ["n0", "n1", "n2"]);
    assert.equal(mirror.edges.length, graph.edges.length);
});
