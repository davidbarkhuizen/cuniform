import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { Tag } from "../src/Tag";
import { assertClose } from "./support/assert";
import { CANVAS_H, CANVAS_W, newGraph, pairAt } from "./support/physics";

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
    }
});

test("repulsion is exactly 10000 / r^1.9 for the reference constants", () => {
    for (const r of [30, 65.46, 200]) {
        const { a, fdg } = pairAt(r);
        const f = fdg.netElectrostaticForceAtNode(a);
        assertClose(Math.abs(f.x), 10000 / Math.pow(r, 1.9), 1e-9, `r=${r}: got ${Math.abs(f.x)}`);
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

    assert.deepEqual(fdg.netForceAtNode(a), { x: e.x + s.x, y: e.y + s.y });
});

test("netForceAtNode is meaningful before the first step()", () => {
    // The old implementation read two caches that only step() wrote, so a
    // pre-step call silently returned {0, 0} - which is exactly how
    // convergence.test.ts's balance assertion went vacuous.
    const { a, fdg } = pairAt(100);

    const e = fdg.netElectrostaticForceAtNode(a);
    const s = fdg.netSpringForceAtNode(a);
    const net = fdg.netForceAtNode(a);

    assert.notEqual(net.x, 0, "a pair at r=100 is not in equilibrium");
    assert.equal(net.x, e.x + s.x, "net force must be the kernel sum before any step");
    assert.equal(net.y, e.y + s.y);
});

test("step() writes no force data onto a Tag", () => {
    // Force is now step-local, so a Tag can never hold a half-written tick.
    const { graph, fdg } = pairAt(100);

    fdg.step(CANVAS_W, CANVAS_H);

    for (const tag of graph.vertices) {
        assert.ok(!('netElectrostaticForce' in tag), `${tag.label} must not cache a repulsion force`);
        assert.ok(!('netSpringForce' in tag), `${tag.label} must not cache a spring force`);
    }
});

test("coincident pairs separate deterministically, and the other edges still add up", () => {
    // `a` and `b` sit exactly on top of each other (r === 0), joined by two
    // duplicate edges and a self-loop at `a`; only the a-c edge has length.
    const graph = new Graph();
    const a = new Tag({ x: 5, y: 5 }, "a");
    const b = new Tag({ x: 5, y: 5 }, "b");
    const c = new Tag({ x: 15, y: 5 }, "c");
    [a, b, c].forEach(t => graph.addNode(t));
    graph.addEdge(a, b);
    graph.addEdge(a, b);
    graph.addEdge(a, a);
    graph.addEdge(a, c);

    const fdg = new ForceDirectedGraph(graph);

    // Repulsion: the coincident b is pushed away along the deterministic -x
    // direction at the clamped magnitude, and c pushes a to -x at the exact
    // law. The two contributions simply add.
    const clamped = 10000 / Math.pow(K.physics.minimumInteractionRadius, K.physics.repulsionExponent);
    const repel = fdg.netElectrostaticForceAtNode(a);
    assertClose(repel.x, -clamped - 10000 / Math.pow(10, 1.9), 1e-9, `repulsion was ${repel.x}`);
    assertClose(repel.y, 0, 1e-12, "repulsion must stay radial");

    // Springs: the duplicate zero-length edges and the self-loop are still
    // skipped (addRadial owns the r === 0 radial guard), leaving only the
    // compressed 10-unit a-c spring (k * (10 - l) = -2).
    const spring = fdg.netSpringForceAtNode(a);
    assertClose(
        spring.x,
        K.physics.springConstant * (10 - K.physics.equilibriumDisplacement),
        1e-12,
        `spring was ${spring.x}`
    );
    assertClose(spring.y, 0, 1e-12, "the spring must stay radial");

    // Nothing divided by zero, on either kernel.
    assert.ok(
        [repel.x, repel.y, spring.x, spring.y].every(Number.isFinite),
        `non-finite force from a coincident pair: ${repel.x},${repel.y},${spring.x},${spring.y}`
    );

    // Equal and opposite: b's repulsion from a mirrors a's.
    const repelB = fdg.netElectrostaticForceAtNode(b);
    assertClose(repelB.x, clamped - 10000 / Math.pow(10, 1.9), 1e-9, `b repulsion was ${repelB.x}`);
});

test("exactly coincident unconnected nodes separate instead of staying a fixed point", () => {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0 }, "a");
    const b = new Tag({ x: 0, y: 0 }, "b");
    graph.addNode(a);
    graph.addNode(b);

    const fdg = new ForceDirectedGraph(graph);
    fdg.step(CANVAS_W, CANVAS_H);

    const separation = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);

    assert.ok(separation > 0, "a coincident pair must not remain coincident");
    assert.ok(Number.isFinite(separation), "the separation must stay finite");

    // Newton's third law holds: the earlier node goes -x, the later one +x.
    assert.ok(
        a.position.x < 0 && b.position.x > 0,
        `expected a < 0 < b, got ${a.position.x} and ${b.position.x}`
    );
    assertClose(a.position.x, -b.position.x, 1e-12, "the pair must separate symmetrically");
    assertClose(a.position.y, 0, 1e-12, "the tie-break direction must be radial");
    assertClose(b.position.y, 0, 1e-12, "the tie-break direction must be radial");
});

test("paired repulsion equals the per-node reference exactly", () => {
    // The fixtures most likely to expose a divergence: a random graph, the
    // duplicate-edge / self-loop / coincident fixture, and a lone node. The
    // accumulation order is argued bitwise-identical to netElectrostaticForceAtNode,
    // so a difference of exactly 0 is required, not a tolerance.
    const fixtures: Graph[] = [newGraph(8, 3)];

    const coincident = new Graph();
    const a = new Tag({ x: 5, y: 5 }, "a");
    const b = new Tag({ x: 5, y: 5 }, "b");
    const c = new Tag({ x: 15, y: 5 }, "c");
    [a, b, c].forEach(t => coincident.addNode(t));
    coincident.addEdge(a, b);
    coincident.addEdge(a, b);
    coincident.addEdge(a, a);
    coincident.addEdge(a, c);
    fixtures.push(coincident);

    const lone = new Graph();
    lone.addNode(new Tag({ x: 1, y: 2 }, "lone"));
    fixtures.push(lone);

    for (const graph of fixtures) {
        const fdg = new ForceDirectedGraph(graph);
        const paired = graph.vertices.map(() => ({ x: 0, y: 0 }));

        fdg.accumulateRepulsion(paired);

        graph.vertices.forEach((tag, i) => {
            const reference = fdg.netElectrostaticForceAtNode(tag);

            // eps = 0 takes assertClose's absolute branch, so the difference
            // must be zero while -0 vs 0 is still tolerated.
            assertClose(paired[i].x, reference.x, 0, `${tag.label} x`);
            assertClose(paired[i].y, reference.y, 0, `${tag.label} y`);
        });
    }
});

test("one step evaluates repulsion once per unordered pair", () => {
    const graph = new Graph();
    for (let i = 0; i < 5; i++)
        graph.addNode(new Tag({ x: i * 10, y: 0 }, `n${i}`));

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

    // Five unconnected nodes have no springs, so every hypot call is
    // repulsion: C(5,2) = 10 for the paired pass, where the old per-node scan
    // made 20.
    assert.equal(calls, 10, `expected one evaluation per unordered pair, got ${calls}`);
});
