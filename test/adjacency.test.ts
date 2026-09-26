import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { Tag } from "../src/Tag";
import { CANVAS_H, CANVAS_W, newGraph } from "./support/physics";

function tag(label: string, x = 0, y = 0): Tag {
    return new Tag({ x, y }, label);
}

/**
 * The pre-adjacency reference: scan every edge and skip those not incident to
 * the target. Used to prove the adjacency pass computes exactly the same force.
 */
function bruteForceSpring(graph: Graph, target: Tag) {
    let Fx = 0;
    let Fy = 0;

    const x_tag = target.position.x;
    const y_tag = target.position.y;

    for (const edge of graph.edges) {
        const other = edge.v1 === target ? edge.v2 : (edge.v2 === target ? edge.v1 : null);
        if (other === null)
            continue;

        const x_other = other.position.x;
        const y_other = other.position.y;

        const r = Math.hypot(x_other - x_tag, y_other - y_tag);
        if (r === 0)
            continue;

        const scalar = K.physics.springConstant * (r - K.physics.equilibriumDisplacement);

        Fx += scalar * (x_other - x_tag) / r;
        Fy += scalar * (y_other - y_tag) / r;
    }

    return { x: Fx, y: Fy };
}

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

test("removeNode clears the removed vertex from every adjacency list", () => {
    const graph = new Graph();
    const a = tag("a", 0, 0);
    const b = tag("b", 10, 0);
    const c = tag("c", 0, 10);
    [a, b, c].forEach(t => graph.addNode(t));
    graph.addEdge(a, b);
    graph.addEdge(b, c);

    graph.removeNode(b);

    assert.deepEqual(graph.incidentEdges(a), []);
    assert.deepEqual(graph.incidentEdges(c), []);
    assert.deepEqual(graph.incidentEdges(b), []);
});

test("the adjacency spring force equals a brute-force edge scan", () => {
    const graph = new Graph();
    const a = tag("a", 0, 0);
    const b = tag("b", 40, 0);
    const c = tag("c", 0, 40);
    [a, b, c].forEach(t => graph.addNode(t));
    graph.addEdge(a, b);
    graph.addEdge(a, b);   // duplicate edge
    graph.addEdge(a, a);   // self-loop
    graph.addEdge(b, c);   // stretched
    graph.addEdge(a, c);   // compressed relative to the rest length

    const fdg = new ForceDirectedGraph(graph);

    for (const target of [a, b, c]) {
        const actual = fdg.netSpringForceAtNode(target);
        const expected = bruteForceSpring(graph, target);

        assert.ok(
            Math.abs(actual.x - expected.x) < 1e-12 &&
            Math.abs(actual.y - expected.y) < 1e-12,
            `${target.label}: got (${actual.x}, ${actual.y}) expected (${expected.x}, ${expected.y})`
        );
    }
});

test("one step visits each edge once per endpoint, not once per node", () => {
    const graph = newGraph(50, 3);
    const fdg = new ForceDirectedGraph(graph);

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
