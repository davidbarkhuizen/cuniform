import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/graph/Graph";
import { labelComponents } from "../src/graph/Components";
import { buildMirrorGraph, packMirror } from "../src/graph/MirrorGraph";
import { ForceDirectedGraph } from "../src/physics/ForceDirectedGraph";
import { Tag } from "../src/graph/Tag";
import { CANVAS_H, CANVAS_W, newGraph, sparseGraph } from "./support/physics";

/**
 * labelComponents is pure topology; these pin the partition, numbering and its agreement with the worker
 * mirror.
 */

function labelsOf(graph: Graph): number[] {
    return [...labelComponents(graph)];
}

function build(vertexCount: number, edges: Array<[number, number]>, selfLoops: number[] = []): Graph {
    const graph = new Graph();

    for (let i = 0; i < vertexCount; i++)
        graph.addNode(new Tag({ x: i, y: 0, z: 0 }, `n${i}`));

    for (const [a, b] of edges)
        graph.addEdge(graph.vertices[a], graph.vertices[b]);

    for (const a of selfLoops)
        graph.addEdge(graph.vertices[a], graph.vertices[a]);

    return graph;
}

test("an empty graph labels to an empty array", () => {
    assert.deepEqual([...labelComponents(new Graph())], []);
});

test("a single vertex is its own component", () => {
    assert.deepEqual(labelsOf(build(1, [])), [0]);
});

test("edgeless vertices are one component each, numbered in vertex order", () => {
    assert.deepEqual(labelsOf(build(3, [])), [0, 1, 2]);
});

test("one edge makes one component of its two endpoints", () => {
    assert.deepEqual(labelsOf(build(3, [[0, 1]])), [0, 0, 1]);
});

test("a chain is one component however it is connected", () => {
    assert.deepEqual(labelsOf(build(4, [[0, 1], [1, 2], [2, 3]])), [0, 0, 0, 0]);

    // Same partition, edges named the other way round: undirected.
    assert.deepEqual(labelsOf(build(4, [[1, 0], [2, 1], [3, 2]])), [0, 0, 0, 0]);
});

test("a cycle is one component", () => {
    assert.deepEqual(labelsOf(build(4, [[0, 1], [1, 2], [2, 3], [3, 0]])), [0, 0, 0, 0]);
});

test("self-loops and duplicate edges change nothing", () => {
    assert.deepEqual(
        labelsOf(build(3, [[0, 1], [0, 1]], [0])),
        [0, 0, 1]
    );
});

test("components are numbered in first-vertex order, not by size", () => {
    assert.deepEqual(
        labelsOf(build(6, [[3, 4], [4, 5], [0, 1]])),
        [0, 0, 1, 2, 2, 2]
    );
});

test("the labelling is a function of insertion order alone", () => {
    const edges: Array<[number, number]> = [[0, 1], [3, 4], [4, 5]];

    assert.deepEqual(labelsOf(build(6, edges)), labelsOf(build(6, edges)));
});

test("a graph and its worker mirror label identically", () => {
    // packMirror/buildMirrorGraph preserve insertion order, so both realms label identically (see
    // physics-runner.test.ts).
    const graph = build(7, [[0, 1], [1, 2], [4, 5]]);
    const wire = packMirror(graph);

    const mirror = buildMirrorGraph(graph.vertices.map(tag => tag.label), wire.edges, wire.positions);

    assert.deepEqual([...labelComponents(mirror)], labelsOf(graph));
});

test("a seeded sparse graph labels completely, with no -1 left behind", () => {
    const graph = sparseGraph(60, 31337, 2);
    const labels = labelComponents(graph);

    assert.equal(labels.length, graph.vertices.length);

    for (let i = 0; i < labels.length; i++)
        assert.ok(labels[i] >= 0, `vertex ${i} is unlabelled`);

    for (const edge of graph.edges) {
        const a = graph.vertices.indexOf(edge.v1);
        const b = graph.vertices.indexOf(edge.v2);

        assert.equal(labels[a], labels[b], `edge ${a}-${b} crosses components`);
    }

    const distinct = [...new Set(labels)].sort((a, b) => a - b);

    assert.deepEqual(distinct, distinct.map((_, i) => i), `component numbers were ${distinct}`);
});

test("a long path labels without recursing", () => {
    // A recursive BFS would overflow the stack on a 4096-node path.
    const graph = build(4096, Array.from({ length: 4095 }, (_, i) => [i, i + 1] as [number, number]));

    const labels = labelComponents(graph);

    assert.ok(labels.every(label => label === 0), "a path is one component");
});

test("the solver relabels when the graph gains vertices in place", () => {
    const graph = new Graph();
    graph.addNode(new Tag({ x: 0, y: 0, z: 0 }, "a"));
    graph.addNode(new Tag({ x: 30, y: 0, z: 0 }, "b"));
    graph.addEdge(graph.vertices[0], graph.vertices[1]);

    const solver = new ForceDirectedGraph(graph);

    assert.deepEqual(labelsOf(graph), [0, 0], "the initial pair is one component");

    graph.addNode(new Tag({ x: 100, y: 100, z: 0 }, "c"));

    const labels = labelsOf(graph);

    assert.equal(labels.length, 3, "the new vertex must be labelled");
    assert.equal(labels[2], 1, "the new vertex is its own component");

    // A stale label array would be read out of range on the next step and turn forces into NaN.
    solver.step(CANVAS_W, CANVAS_H);

    for (const tag of graph.vertices) {
        assert.ok(
            Number.isFinite(tag.position.x) && Number.isFinite(tag.position.y) && Number.isFinite(tag.position.z),
            `${tag.label} must integrate after the relabel`
        );
    }
});

test("the solver relabels when an edge merges two components in place", () => {
    const graph = new Graph();
    graph.addNode(new Tag({ x: 0, y: 0, z: 0 }, "a"));
    graph.addNode(new Tag({ x: 40, y: 0, z: 0 }, "b"));

    const solver = new ForceDirectedGraph(graph);

    assert.deepEqual(labelsOf(graph), [0, 1]);

    solver.step(CANVAS_W, CANVAS_H);

    // An edge at constant N merges them, so the vertex-count guard alone would miss it.
    graph.addEdge(graph.vertices[0], graph.vertices[1]);

    assert.deepEqual(labelsOf(graph), [0, 0], "the new edge merges the two components");

    // A fresh solver over a copy of the current state is the reference for a correct merge.
    const positions = graph.vertices.map(tag => ({ ...tag.position }));

    const fresh = new Graph();
    positions.forEach((position, i) => fresh.addNode(new Tag(position, `f${i}`)));
    fresh.addEdge(fresh.vertices[0], fresh.vertices[1]);

    graph.vertices.forEach((tag, i) => {
        tag.velocity.x = 0;
        tag.velocity.y = 0;
        tag.velocity.z = 0;
        void i;
    });

    solver.step(CANVAS_W, CANVAS_H);
    new ForceDirectedGraph(fresh).step(CANVAS_W, CANVAS_H);

    graph.vertices.forEach((tag, i) => {
        assert.equal(tag.position.x, fresh.vertices[i].position.x, `${tag.label} x`);
        assert.equal(tag.position.y, fresh.vertices[i].position.y, `${tag.label} y`);
        assert.equal(tag.position.z, fresh.vertices[i].position.z, `${tag.label} z`);
    });
});

test("the solver's relabelled components are the ones a fresh solver sees", () => {
    // A merge at constant N must leave the grown solver with the labelling a fresh solver computes, not
    // merely a valid one.
    const grown = new Graph();
    grown.addNode(new Tag({ x: -20, y: 0, z: 0 }, "a"));
    grown.addNode(new Tag({ x: 20, y: 0, z: 0 }, "b"));
    grown.addNode(new Tag({ x: 0, y: 90, z: 0 }, "c"));

    const grownSolver = new ForceDirectedGraph(grown);
    grownSolver.step(CANVAS_W, CANVAS_H);
    grown.addEdge(grown.vertices[0], grown.vertices[2]);
    grownSolver.step(CANVAS_W, CANVAS_H);

    const fresh = new Graph();
    fresh.addNode(new Tag({ x: -20, y: 0, z: 0 }, "a"));
    fresh.addNode(new Tag({ x: 20, y: 0, z: 0 }, "b"));
    fresh.addNode(new Tag({ x: 0, y: 90, z: 0 }, "c"));
    fresh.addEdge(fresh.vertices[0], fresh.vertices[2]);

    assert.deepEqual(labelsOf(grown), labelsOf(fresh));
});

test("a generated graph labels as one component or a handful, never unlabelled", () => {
    const graph = newGraph(40, 1);
    const labels = labelComponents(graph);

    assert.equal(labels.length, graph.vertices.length);

    for (let i = 0; i < labels.length; i++)
        assert.ok(labels[i] >= 0, `vertex ${i} is unlabelled`);

    for (const edge of graph.edges)
        assert.equal(
            labels[graph.vertices.indexOf(edge.v1)],
            labels[graph.vertices.indexOf(edge.v2)],
            "an edge must not cross components"
        );
});
