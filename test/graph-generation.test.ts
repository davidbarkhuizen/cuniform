import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/Graph";
import { GraphFactory } from "../src/GraphFactory";
import { K } from "../src/K";
import { Tag } from "../src/Tag";
import { catalogEntry } from "./support/catalog";
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

// -------------------------------------------------------------- build(spec)

/** Run `fn` with a deterministic Math.random, restoring the real one after. */
function withSeededRandom<T>(fn: () => T): T {
    const original = Math.random;
    let state = 42;

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

/** The structure of a graph, independent of the (random) coordinates. */
function shape(graph: Graph) {
    return {
        labels: graph.vertices.map(vertex => vertex.label),
        edges: graph.edges.map(edge => [
            graph.vertices.indexOf(edge.v1),
            graph.vertices.indexOf(edge.v2),
        ]),
    };
}

test("build of a random spec is exactly generateGraph(order, branching)", () => {
    const viaBuild = withSeededRandom(() => new GraphFactory().build({ kind: "random", order: 8, branching: 3 }));
    const viaGenerate = withSeededRandom(() => new GraphFactory().generateGraph(8, 3));

    assert.deepEqual(shape(viaBuild), shape(viaGenerate));
});

test("build of a molecule spec has one vertex per atom and one edge per bond", () => {
    const entry = catalogEntry("ibogaine");

    const graph = new GraphFactory().build({ kind: "molecule", id: "ibogaine" });

    assert.equal(graph.vertices.length, entry.topology.atoms.length);
    assert.equal(graph.edges.length, entry.topology.bonds.length);
    assert.equal(graph.vertices.length, entry.heavyAtoms);
});

test("molecule vertices are labelled with element symbols, in SMILES order", () => {
    const entry = catalogEntry("strychnine");

    const graph = new GraphFactory().generateMolecule("strychnine");

    assert.deepEqual(graph.vertices.map(vertex => vertex.label), entry.topology.atoms);
    assert.ok(
        graph.vertices.every(vertex => /^[A-Za-z]{1,2}$/.test(vertex.label)),
        "a label must be an element symbol, not an atom index"
    );
    assert.ok(
        !graph.vertices.some(vertex => /^Node /.test(vertex.label)),
        "molecules must not reuse the random graph's Node i labels"
    );
});

test("a molecule graph is connected and has no self-loops", () => {
    const graph = new GraphFactory().generateMolecule("vincristine");

    for (const edge of graph.edges)
        assert.notEqual(edge.v1, edge.v2, "a bond must join two distinct atoms");

    const seen = new Set<Tag>([graph.vertices[0]]);
    const queue = [graph.vertices[0]];

    while (queue.length > 0) {
        const vertex = queue.shift()!;
        for (const neighbour of graph.neighbours(vertex)) {
            if (seen.has(neighbour))
                continue;
            seen.add(neighbour);
            queue.push(neighbour);
        }
    }

    assert.equal(seen.size, graph.vertices.length, "every atom should be reachable");
});

test("molecule seeds are unique, deterministic and bounded by the jitter", () => {
    const factory = new GraphFactory();
    const first = factory.generateMolecule("vincristine");
    const second = factory.generateMolecule("vincristine");

    const positions = first.vertices.map(vertex => vertex.position);
    const keys = new Set(positions.map(position => `${position.x},${position.y},${position.z}`));

    assert.equal(keys.size, positions.length, "no two atoms may share a seed position");
    assert.deepEqual(
        positions,
        second.vertices.map(vertex => vertex.position),
        "the same molecule must seed identically"
    );

    for (const position of positions)
        assert.ok(Math.abs(position.z) <= K.molecule.seedDepthJitter, "z exceeds the jitter");

    // The spiral starts at the origin: the layout is not flung out to a corner.
    assert.equal(positions[0].x, 0);
    assert.equal(positions[0].y, 0);
});

test("an unknown molecule id throws", () => {
    const factory = new GraphFactory();

    assert.throws(() => factory.generateMolecule("unobtainium"), /unknown molecule id/);
    assert.throws(() => factory.build({ kind: "molecule", id: "unobtainium" }), /unknown molecule id/);
});
