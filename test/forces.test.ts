import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { Tag } from "../src/Tag";
import { assertClose } from "./support/assert";
import {
    ANALYTIC_EQUILIBRIUM,
    CANVAS_H,
    CANVAS_W,
    REPULSION_CONSTANT,
    newGraph,
    pairAt,
} from "./support/physics";

test("repulsion follows k*q^2 / r^1.9 and pushes away from the other node", () => {
    const k = K.physics.scalarForceConstant;
    const q = K.physics.nodeCharge;
    const exponent = K.physics.repulsionExponent;

    assert.equal(exponent, 1.9, "the reference exponent is 1.9, not 2");

    for (const r of [10, 50, 100, 300]) {
        const { a, fdg } = pairAt(r);
        const f = fdg.netElectrostaticForceAtNode(a);

        const expected = (k * q * q) / Math.pow(r, exponent);
        assertClose(
            Math.abs(f.x),
            expected,
            1e-9,
            `r=${r}: |F| was ${Math.abs(f.x)}, expected ${expected}`
        );
        assert.ok(f.x < 0, `r=${r}: a sits at the origin so it must be pushed toward -x`);
        assertClose(f.y, 0, 1e-12, `r=${r}: force should be purely radial`);
        assertClose(f.z, 0, 1e-12, `r=${r}: an in-plane pair must exert no z force`);
    }
});

test("repulsion follows the reference k*q^2 / r^1.9 law", () => {
    for (const r of [30, ANALYTIC_EQUILIBRIUM, 200]) {
        const { a, fdg } = pairAt(r);
        const f = fdg.netElectrostaticForceAtNode(a);
        assertClose(Math.abs(f.x), REPULSION_CONSTANT / Math.pow(r, 1.9), 1e-9, `r=${r}: got ${Math.abs(f.x)}`);
    }
});

test("a stretched spring pulls the node toward its neighbour", () => {
    const k = K.physics.springConstant;
    const l = K.physics.equilibriumDisplacement;

    const { a, fdg } = pairAt(l + 15);
    const f = fdg.netSpringForceAtNode(a);

    assert.ok(f.x > 0, "r > l must pull toward the neighbour at +x");
    assertClose(f.x, k * 15, 1e-9, `expected ${k * 15}, got ${f.x}`);
});

test("a compressed spring pushes the node away from its neighbour", () => {
    const k = K.physics.springConstant;
    const l = K.physics.equilibriumDisplacement;

    const { a, fdg } = pairAt(l - 20);
    const f = fdg.netSpringForceAtNode(a);

    assert.ok(f.x < 0, "r < l must push away from the neighbour at +x");
    assertClose(f.x, k * (l - 20 - l), 1e-9, `expected ${k * -20}, got ${f.x}`);
});

test("a spring at its rest length exerts no force", () => {
    const { a, fdg } = pairAt(K.physics.equilibriumDisplacement);
    const f = fdg.netSpringForceAtNode(a);

    assertClose(f.x, 0, 1e-12);
    assertClose(f.y, 0, 1e-12);
});

test("net force is the sum of the two force kernels", () => {
    const { a, fdg } = pairAt(100);

    const e = fdg.netElectrostaticForceAtNode(a);
    const s = fdg.netSpringForceAtNode(a);

    assert.deepEqual(fdg.netForceAtNode(a), { x: e.x + s.x, y: e.y + s.y, z: e.z + s.z });
});

test("netForceAtNode is meaningful before the first step()", () => {
    // Pre-step calls used to read step()-only caches and return {0, 0}, making
    // convergence.test.ts's balance assertion vacuous.
    const { a, fdg } = pairAt(100);

    const e = fdg.netElectrostaticForceAtNode(a);
    const s = fdg.netSpringForceAtNode(a);
    const net = fdg.netForceAtNode(a);

    assert.notEqual(net.x, 0, "a pair at r=100 is not in equilibrium");
    assert.equal(net.x, e.x + s.x, "net force must be the kernel sum before any step");
    assert.equal(net.y, e.y + s.y);
});

test("step() writes no force data onto a Tag", () => {
    // Force is step-local, so a Tag never holds a half-written tick.
    const { graph, fdg } = pairAt(100);

    fdg.step(CANVAS_W, CANVAS_H);

    for (const tag of graph.vertices) {
        assert.ok(!('netElectrostaticForce' in tag), `${tag.label} must not cache a repulsion force`);
        assert.ok(!('netSpringForce' in tag), `${tag.label} must not cache a spring force`);
    }
});

test("coincident pairs separate deterministically, and the other edges still add up", () => {
    const graph = new Graph();
    const a = new Tag({ x: 5, y: 5, z: 0 }, "a");
    const b = new Tag({ x: 5, y: 5, z: 0 }, "b");
    const c = new Tag({ x: 15, y: 5, z: 0 }, "c");
    [a, b, c].forEach(t => graph.addNode(t));
    graph.addEdge(a, b);
    graph.addEdge(a, b);
    graph.addEdge(a, a);
    graph.addEdge(a, c);

    const fdg = new ForceDirectedGraph(graph);

    const clamped = REPULSION_CONSTANT / Math.pow(K.physics.minimumInteractionRadius, K.physics.repulsionExponent);
    const repel = fdg.netElectrostaticForceAtNode(a);
    assertClose(repel.x, -clamped - REPULSION_CONSTANT / Math.pow(10, 1.9), 1e-9, `repulsion was ${repel.x}`);
    assertClose(repel.y, 0, 1e-12, "repulsion must stay radial");

    // Duplicate zero-length edges and the self-loop are skipped by addRadial's
    // r === 0 guard.
    const spring = fdg.netSpringForceAtNode(a);
    assertClose(
        spring.x,
        K.physics.springConstant * (10 - K.physics.equilibriumDisplacement),
        1e-12,
        `spring was ${spring.x}`
    );
    assertClose(spring.y, 0, 1e-12, "the spring must stay radial");

    assert.ok(
        [repel.x, repel.y, spring.x, spring.y].every(Number.isFinite),
        `non-finite force from a coincident pair: ${repel.x},${repel.y},${spring.x},${spring.y}`
    );

    const repelB = fdg.netElectrostaticForceAtNode(b);
    assertClose(repelB.x, clamped - REPULSION_CONSTANT / Math.pow(10, 1.9), 1e-9, `b repulsion was ${repelB.x}`);
});

test("exactly coincident unconnected nodes separate instead of staying a fixed point", () => {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 0, y: 0, z: 0 }, "b");
    graph.addNode(a);
    graph.addNode(b);

    const fdg = new ForceDirectedGraph(graph);
    fdg.step(CANVAS_W, CANVAS_H);

    const separation = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);

    assert.ok(separation > 0, "a coincident pair must not remain coincident");
    assert.ok(Number.isFinite(separation), "the separation must stay finite");

    assert.ok(
        a.position.x < 0 && b.position.x > 0,
        `expected a < 0 < b, got ${a.position.x} and ${b.position.x}`
    );
    assertClose(a.position.x, -b.position.x, 1e-12, "the pair must separate symmetrically");
    assertClose(a.position.y, 0, 1e-12, "the tie-break direction must be radial");
    assertClose(b.position.y, 0, 1e-12, "the tie-break direction must be radial");
    assertClose(a.position.z, 0, 1e-12, "the tie-break direction must stay on the x axis");
    assertClose(b.position.z, 0, 1e-12, "the tie-break direction must stay on the x axis");
});

test("paired repulsion equals the per-node reference exactly", () => {
    // The paired accumulation order is bitwise-identical to the per-node
    // reference, so the difference must be exactly 0, not within a tolerance.
    const fixtures: Graph[] = [newGraph(8, 3)];

    const coincident = new Graph();
    const a = new Tag({ x: 5, y: 5, z: 0 }, "a");
    const b = new Tag({ x: 5, y: 5, z: 0 }, "b");
    const c = new Tag({ x: 15, y: 5, z: 0 }, "c");
    [a, b, c].forEach(t => coincident.addNode(t));
    coincident.addEdge(a, b);
    coincident.addEdge(a, b);
    coincident.addEdge(a, a);
    coincident.addEdge(a, c);
    fixtures.push(coincident);

    const lone = new Graph();
    lone.addNode(new Tag({ x: 1, y: 2, z: 3 }, "lone"));
    fixtures.push(lone);

    for (const graph of fixtures) {
        const fdg = new ForceDirectedGraph(graph);
        const paired = graph.vertices.map(() => ({ x: 0, y: 0, z: 0 }));

        fdg.accumulateRepulsion(paired);

        graph.vertices.forEach((tag, i) => {
            const reference = fdg.netElectrostaticForceAtNode(tag);

            // eps = 0 takes assertClose's absolute branch: exactly 0, but -0 vs 0 still tolerated.
            assertClose(paired[i].x, reference.x, 0, `${tag.label} x`);
            assertClose(paired[i].y, reference.y, 0, `${tag.label} y`);
        });
    }
});

test("one step evaluates repulsion once per unordered pair", () => {
    const graph = new Graph();
    for (let i = 0; i < 5; i++)
        graph.addNode(new Tag({ x: i * 10, y: 0, z: 0 }, `n${i}`));

    const fdg = new ForceDirectedGraph(graph);

    const realHypot = Math.hypot;
    let calls = 0;

    Math.hypot = (...args: number[]) => {
        calls++;
        return realHypot(...args);
    };

    try {
        fdg.step(CANVAS_W, CANVAS_H);
    } finally {
        Math.hypot = realHypot;
    }

    // No springs here, so every hypot call is repulsion: C(5,2) = 10, where the
    // old per-node scan made 20.
    assert.equal(calls, 10, `expected one evaluation per unordered pair, got ${calls}`);
});

test("an off-plane pair obeys the same radial repulsion law in z", () => {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 0, y: 0, z: 40 }, "b");
    graph.addNode(a);
    graph.addNode(b);

    const fdg = new ForceDirectedGraph(graph);
    const f = fdg.netElectrostaticForceAtNode(a);

    const expected = REPULSION_CONSTANT / Math.pow(40, K.physics.repulsionExponent);

    assertClose(Math.abs(f.z), expected, 1e-9, `z force was ${f.z}, expected ${expected}`);
    assert.ok(f.z < 0, "a at z=0 is pushed toward -z by b at z=40");
    assertClose(f.x, 0, 1e-12, "an on-axis pair must have no lateral force");
    assertClose(f.y, 0, 1e-12, "an on-axis pair must have no lateral force");
});

test("a z-separated spring feels the unmodified radial law", () => {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 0, y: 0, z: K.physics.equilibriumDisplacement + 15 }, "b");
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(a, b);

    const fdg = new ForceDirectedGraph(graph);
    const f = fdg.netSpringForceAtNode(a);

    assertClose(f.z, K.physics.springConstant * 15, 1e-9, `z spring was ${f.z}`);
    assertClose(f.x, 0, 1e-12);
    assertClose(f.y, 0, 1e-12);
});

test("a pair coincident in (x, y) but separated in z is an ordinary radial case", () => {
    // Only an all-zero delta takes the (-1, 0, 0) tie-break; a z-only separation must not.
    const graph = new Graph();
    const a = new Tag({ x: 5, y: 5, z: 0 }, "a");
    const b = new Tag({ x: 5, y: 5, z: 7 }, "b");
    graph.addNode(a);
    graph.addNode(b);

    const fdg = new ForceDirectedGraph(graph);
    const f = fdg.netElectrostaticForceAtNode(a);

    assertClose(f.x, 0, 1e-12, "the z-only case must stay on the z axis");
    assertClose(f.y, 0, 1e-12, "the z-only case must stay on the z axis");
    assert.ok(f.z < 0, "a is pushed toward -z");
});

test("z integrates exactly like x and y", () => {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    graph.addNode(a);

    const fdg = new ForceDirectedGraph(graph);

    const v = fdg.velocityAtTag(a, { x: 3, y: -4, z: 12 });
    assertClose(v.x, 3 * K.physics.timeStep, 1e-12, `vx was ${v.x}`);
    assertClose(v.y, -4 * K.physics.timeStep, 1e-12, `vy was ${v.y}`);
    assertClose(v.z, 12 * K.physics.timeStep, 1e-12, `vz was ${v.z}`);

    a.velocity = v;
    fdg.step(CANVAS_W, CANVAS_H);

    assertClose(a.position.z, 12 * K.physics.timeStep * K.physics.friction, 1e-12, `z was ${a.position.z}`);
});
