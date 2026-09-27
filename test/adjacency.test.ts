import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/physics/ForceDirectedGraph";
import { Graph } from "../src/graph/Graph";
import { Edge, otherEndpoint } from "../src/graph/Edge";
import { K } from "../src/core/K";
import { Tag } from "../src/graph/Tag";
import { assertClose } from "./support/assert";
import { CANVAS_H, CANVAS_W, newGraph, tag } from "./support/physics";

/** Pre-adjacency reference: scan every edge, skipping those not incident to the target. */
function bruteForceSpring(graph: Graph, target: Tag) {
    let Fx = 0;
    let Fy = 0;
    let Fz = 0;

    const x_tag = target.position.x;
    const y_tag = target.position.y;
    const z_tag = target.position.z;

    for (const edge of graph.edges) {
        const other = otherEndpoint(edge, target);
        if (other === null)
            continue;

        const x_other = other.position.x;
        const y_other = other.position.y;
        const z_other = other.position.z;

        const r = Math.hypot(x_other - x_tag, y_other - y_tag, z_other - z_tag);
        if (r === 0)
            continue;

        const scalar = K.physics.springConstant * (r - K.physics.equilibriumDisplacement);

        Fx += scalar * (x_other - x_tag) / r;
        Fy += scalar * (y_other - y_tag) / r;
        Fz += scalar * (z_other - z_tag) / r;
    }

    return { x: Fx, y: Fy, z: Fz };
}

test("otherEndpoint names the far endpoint, and null for a self-loop or foreign tag", () => {
    const a = tag("a", 0, 0);
    const b = tag("b", 10, 0);
    const edge: Edge = { v1: a, v2: b };

    assert.equal(otherEndpoint(edge, a), b);
    assert.equal(otherEndpoint(edge, b), a);
    assert.equal(otherEndpoint(edge, tag("foreign")), null);
    assert.equal(otherEndpoint({ v1: a, v2: a }, a), null);
});

test("incidentEdges indexes an edge from both endpoints", () => {
    const graph = new Graph();
    const a = tag("a", 0, 0);
    const b = tag("b", 10, 0);
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(a, b);

    assert.equal(graph.incidentEdges(a).length, 1);
    assert.equal(graph.incidentEdges(b).length, 1);
    assert.equal(graph.incidentEdges(a)[0], graph.incidentEdges(b)[0]);
});

test("incidentEdges keeps duplicate edges separately", () => {
    const graph = new Graph();
    const a = tag("a", 0, 0);
    const b = tag("b", 10, 0);
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(a, b);
    graph.addEdge(a, b);

    assert.equal(graph.incidentEdges(a).length, 2);
    assert.equal(graph.incidentEdges(b).length, 2);
});

test("a self-loop is incident to its vertex once", () => {
    const graph = new Graph();
    const a = tag("a", 0, 0);
    graph.addNode(a);
    graph.addEdge(a, a);

    assert.equal(graph.incidentEdges(a).length, 1);
});

test("incidentEdges is empty for an isolated or unknown vertex", () => {
    const graph = new Graph();
    const a = tag("a", 0, 0);
    graph.addNode(a);

    assert.deepEqual(graph.incidentEdges(a), []);
    assert.deepEqual(graph.incidentEdges(tag("foreign")), []);
});

test("the adjacency spring force equals a brute-force edge scan", () => {
    const graph = new Graph();
    const a = tag("a", 0, 0);
    const b = tag("b", 40, 0);
    const c = tag("c", 0, 40);
    // An off-plane node, so the equivalence also covers the z component.
    const d = new Tag({ x: 10, y: 10, z: 35 }, "d");
    [a, b, c, d].forEach(t => graph.addNode(t));
    // Fixture covers duplicate edges, a self-loop, stretched/compressed springs, and out-of-plane pairs.
    graph.addEdge(a, b);
    graph.addEdge(a, b);
    graph.addEdge(a, a);
    graph.addEdge(b, c);
    graph.addEdge(a, c);
    graph.addEdge(b, d);
    graph.addEdge(a, d);

    const fdg = new ForceDirectedGraph(graph);

    for (const target of [a, b, c, d]) {
        const actual = fdg.netSpringForceAtNode(target);
        const expected = bruteForceSpring(graph, target);

        assertClose(actual.x, expected.x, 1e-12, `${target.label}: x force`);
        assertClose(actual.y, expected.y, 1e-12, `${target.label}: y force`);
        assertClose(actual.z, expected.z, 1e-12, `${target.label}: z force`);
    }
});

test("one step visits each edge once per endpoint, not once per node", () => {
    const graph = newGraph(50, 3);
    const fdg = new ForceDirectedGraph(graph);

    // Warm the solver once: the first step labels the connected components, an
    // O(V + E) walk over the same adjacency, and that one-time cost is not what
    // this test measures. The labelling is cached (topology is unchanged), so
    // the instrumented step below runs only the spring pass.
    fdg.step(CANVAS_W, CANVAS_H);

    const realIncidentEdges = graph.incidentEdges.bind(graph);
    let visited = 0;

    graph.incidentEdges = (t: Tag) => {
        const list = realIncidentEdges(t);
        visited += list.length;
        return list;
    };

    fdg.step(CANVAS_W, CANVAS_H);

    // Generated graphs have no self-loops, so the total is exactly 2*E.
    assert.equal(visited, 2 * graph.edges.length);

    // The old pass rescanned all E edges for each of the V nodes.
    assert.ok(
        visited < graph.vertices.length * graph.edges.length,
        "the spring pass must not rescan every edge per node"
    );
});

test("a 200-node graph steps without pathological cost", () => {
    const graph = newGraph(200, 3);
    const fdg = new ForceDirectedGraph(graph);

    const started = Date.now();
    for (let i = 0; i < 25; i++) {
        fdg.step(CANVAS_W, CANVAS_H);
    }
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 5000, `25 steps of a 200-node graph took ${elapsed}ms`);
});
