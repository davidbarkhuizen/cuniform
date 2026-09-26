import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { Tag } from "../src/Tag";
import { readSource } from "./support/files";
import { newGraph } from "./support/physics";

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

test("generated graphs have no self-loops and no duplicate edges", () => {
    for (let trial = 0; trial < 50; trial++) {
        const graph = newGraph(15, 3);

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

    // The factory's uniqueness key is the 3-tuple, so the test states the same
    // key: two nodes may agree in (x, y) and still be distinct if z differs.
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

test("GraphFactory generates in 3D and names its factory accordingly", () => {
    const source = readSource("GraphFactory.ts");

    assert.ok(!/constructXYFactory/.test(source), "the 2D factory name is retired");
    assert.ok(/constructXYZFactory/.test(source), "the factory generates a 3D position");
    assert.ok(/K\.space\.D_0/.test(source), "the depth axis uses the world's D_0 extent");
});

test("labels restart for each graph instead of growing across graphs", () => {
    const first = newGraph(3, 1);
    const second = newGraph(3, 1);

    assert.deepEqual(first.vertices.map(v => v.label), ["Node 0", "Node 1", "Node 2"]);
    assert.deepEqual(second.vertices.map(v => v.label), ["Node 0", "Node 1", "Node 2"]);
});

test("the shipped initial conditions match the reference demo", () => {
    assert.equal(K.initialConditions.order, 11);
    assert.equal(K.initialConditions.branching, 2);
});
