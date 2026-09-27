import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { Octree } from "../src/Octree";
import { Projector } from "../src/Projector";
import { Tag } from "../src/Tag";
import { assertClose } from "./support/assert";
import { sparseGraph } from "./support/physics";

/**
 * Mean and max |F_approx - F_exact| over every body, normalised by the graph's
 * mean exact force magnitude. The mean force is the scale a body actually
 * feels, so a body sitting near a force balance (exact magnitude ~0) cannot blow
 * a per-node ratio up while its absolute error stays tiny.
 */
function forceErrors(graph: Graph, solver: ForceDirectedGraph): { mean: number; max: number } {
    const out = graph.vertices.map(() => ({ x: 0, y: 0, z: 0 }));

    solver.accumulateRepulsion(out);

    const exact: Array<{ x: number; y: number; z: number }> = [];
    let scale = 0;

    for (const tag of graph.vertices) {
        const reference = solver.netElectrostaticForceAtNode(tag);

        assert.ok(
            Number.isFinite(out[exact.length].x) &&
            Number.isFinite(out[exact.length].y) &&
            Number.isFinite(out[exact.length].z),
            `${tag.label}: the force must stay finite`
        );

        exact.push(reference);
        scale += Math.hypot(reference.x, reference.y, reference.z);
    }

    scale /= graph.vertices.length;

    let total = 0;
    let worst = 0;

    graph.vertices.forEach((tag, i) => {
        const reference = exact[i];
        const difference = Math.hypot(
            out[i].x - reference.x,
            out[i].y - reference.y,
            out[i].z - reference.z
        ) / scale;

        assert.ok(Number.isFinite(difference), `${tag.label}: the error must stay finite`);

        total += difference;
        worst = Math.max(worst, difference);
    });

    return { mean: total / graph.vertices.length, max: worst };
}

test("below the crossover the repulsion pass is the exact pairwise kernel", () => {
    const order = K.physics.barnesHutMinNodes - 1;
    const graph = sparseGraph(order, 4242);
    const solver = new ForceDirectedGraph(graph);
    const out = graph.vertices.map(() => ({ x: 0, y: 0, z: 0 }));

    solver.accumulateRepulsion(out);

    graph.vertices.forEach((tag, i) => {
        const reference = solver.netElectrostaticForceAtNode(tag);

        assert.equal(out[i].x, reference.x, `${tag.label}: the exact path must be bit-identical`);
        assert.equal(out[i].y, reference.y, `${tag.label}: the exact path must be bit-identical`);
        assert.equal(out[i].z, reference.z, `${tag.label}: the exact path must be bit-identical`);
    });
});

test("below the fast threshold auto and accurate step bit-identically", () => {
    // The size default only changes forces at or above barnesHutFastMinNodes;
    // below it "auto" must be exactly the old always-theta-0.5 behaviour.
    const order = K.physics.barnesHutFastMinNodes - 1;
    const autoGraph = sparseGraph(order, 31337);
    const accurateGraph = sparseGraph(order, 31337);

    const auto = new ForceDirectedGraph(autoGraph);
    const accurate = new ForceDirectedGraph(accurateGraph);
    const projector = Projector.forCanvas(800, 600);

    const originalQuality = K.physics.quality;

    try {
        K.physics.quality = "auto";
        for (let step = 0; step < 3; step++)
            auto.step(800, 600, () => false, projector);

        K.physics.quality = "accurate";
        for (let step = 0; step < 3; step++)
            accurate.step(800, 600, () => false, projector);
    } finally {
        K.physics.quality = originalQuality;
    }

    autoGraph.vertices.forEach((tag, i) => {
        assert.equal(tag.position.x, accurateGraph.vertices[i].position.x, `${tag.label}: x`);
        assert.equal(tag.position.y, accurateGraph.vertices[i].position.y, `${tag.label}: y`);
        assert.equal(tag.position.z, accurateGraph.vertices[i].position.z, `${tag.label}: z`);

        assert.equal(tag.velocity.x, accurateGraph.vertices[i].velocity.x, `${tag.label}: vx`);
        assert.equal(tag.velocity.y, accurateGraph.vertices[i].velocity.y, `${tag.label}: vy`);
        assert.equal(tag.velocity.z, accurateGraph.vertices[i].velocity.z, `${tag.label}: vz`);
    });
});

test("at theta = 0.5 the octree stays within the documented force error", () => {
    const cases: Array<[number, number]> = [[128, 1128], [512, 1512], [1024, 2024]];

    for (const [order, seed] of cases) {
        const graph = sparseGraph(order, seed);
        const solver = new ForceDirectedGraph(graph);
        const error = forceErrors(graph, solver);

        assert.ok(error.max > 0, `N=${order}: the octree path must actually approximate`);
        assert.ok(error.mean <= 0.01, `N=${order}: mean force error ${(100 * error.mean).toFixed(2)}% exceeds 1%`);
        assert.ok(error.max <= 0.15, `N=${order}: max force error ${(100 * error.max).toFixed(2)}% exceeds 15%`);
    }
});

test("no body repels itself: a coincident cluster matches the exact reference", () => {
    // Every body sits at one point, so the cell containing a body is the whole
    // cluster. If traversal ever accepted it as an aggregate, each body would
    // receive its own charge and the force would shift by a whole pairwise term.
    const order = 128;
    const graph = new Graph();

    for (let i = 0; i < order; i++)
        graph.addNode(new Tag({ x: 5, y: 5, z: 0 }, `n${i}`));

    const solver = new ForceDirectedGraph(graph);
    const out = graph.vertices.map(() => ({ x: 0, y: 0, z: 0 }));

    solver.accumulateRepulsion(out);

    graph.vertices.forEach((tag, i) => {
        const exact = solver.netElectrostaticForceAtNode(tag);

        // The same multiset of pairwise terms, so this is a rounding tolerance,
        // not an approximation budget.
        assertClose(out[i].x, exact.x, 1e-12, `${tag.label}: x must match`);
        assertClose(out[i].y, exact.y, 1e-12, `${tag.label}: y must match`);
        assertClose(out[i].z, exact.z, 1e-12, `${tag.label}: z must match`);
    });
});

test("a large opening angle still excludes self and stays bounded", () => {
    const order = 512;
    const graph = sparseGraph(order, 6060);

    // 0.9 is the fast opening angle the README's "Performance" section names.
    // Above 1/sqrt(3) a theta-only self-exclusion argument would fail, so this
    // exercises the explicit rule.
    const tree = new Octree();
    tree.build(graph.vertices, 0.9);

    const fx = new Float64Array(order);
    const fy = new Float64Array(order);
    const fz = new Float64Array(order);

    tree.accumulateForce(fx, fy, fz);

    const solver = new ForceDirectedGraph(graph);

    let totalError = 0;
    let totalExact = 0;

    graph.vertices.forEach((tag, i) => {
        assert.ok(
            Number.isFinite(fx[i]) && Number.isFinite(fy[i]) && Number.isFinite(fz[i]),
            `${tag.label}: the force must stay finite`
        );

        const exact = solver.netElectrostaticForceAtNode(tag);

        totalError += Math.hypot(fx[i] - exact.x, fy[i] - exact.y, fz[i] - exact.z);
        totalExact += Math.hypot(exact.x, exact.y, exact.z);
    });

    const relative = totalError / totalExact;

    assert.ok(relative <= 0.05, `theta=0.9 mean error ${(100 * relative).toFixed(2)}% exceeds 5%`);
});
