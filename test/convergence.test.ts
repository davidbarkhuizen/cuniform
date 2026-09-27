import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/physics/ForceDirectedGraph";
import { assertClose } from "./support/assert";
import {
    ANALYTIC_EQUILIBRIUM,
    edgeBetween,
    maxTravelPerStep,
    mean,
    newGraph,
} from "./support/physics";

test("a single edge settles at the analytic equilibrium distance", () => {
    const { graph, a, b, fdg } = edgeBetween({ x: -200, y: 0, z: 0 }, { x: 200, y: 0, z: 0 });

    maxTravelPerStep(fdg, graph, 4000);

    const r = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y, b.position.z - a.position.z);

    assertClose(r, ANALYTIC_EQUILIBRIUM, 1.0, `settled at r=${r}, expected ~${ANALYTIC_EQUILIBRIUM}`);
});

test("at equilibrium the spring and repulsion forces balance", () => {
    const { a, fdg } = edgeBetween({ x: 0, y: 0, z: 0 }, { x: ANALYTIC_EQUILIBRIUM, y: 0, z: 0 });

    const repel = fdg.netElectrostaticForceAtNode(a);
    const spring = fdg.netSpringForceAtNode(a);
    const net = fdg.netForceAtNode(a);

    // Guards against a vacuous pass if netForceAtNode reads zeroed Tag caches.
    assert.ok(Math.abs(repel.x) > 1, "the individual forces must be non-trivial");
    assert.ok(Math.abs(spring.x) > 1, "the individual forces must be non-trivial");

    assertClose(net.x, 0, 0.02, `net radial force at r* was ${net.x}`);
    assert.ok(repel.x * spring.x < 0, "the two forces must oppose each other");
});

test("a 10-node graph converges instead of oscillating", () => {
    const graph = newGraph(10, 2);

    assert.ok(
        graph.vertices.some(v => v.position.z !== 0),
        "the generated graph must have depth"
    );

    const fdg = new ForceDirectedGraph(graph);

    const travel = maxTravelPerStep(fdg, graph, 2000);
    const late = mean(travel.slice(1900));

    assert.ok(late < 1.0, `mean max per-step travel over the final 100 ticks was ${late}`);
    assert.ok(
        graph.vertices.every(v =>
            Number.isFinite(v.position.x) &&
            Number.isFinite(v.position.y) &&
            Number.isFinite(v.position.z)
        ),
        "positions must stay finite"
    );
});

test("a single edge separated only along z settles at the analytic equilibrium", () => {
    const { graph, a, b, fdg } = edgeBetween({ x: 0, y: 0, z: -200 }, { x: 0, y: 0, z: 200 });

    maxTravelPerStep(fdg, graph, 4000);

    const r = Math.hypot(
        b.position.x - a.position.x,
        b.position.y - a.position.y,
        b.position.z - a.position.z
    );

    assertClose(r, ANALYTIC_EQUILIBRIUM, 1.0, `settled at r=${r}, expected ~${ANALYTIC_EQUILIBRIUM}`);
});
