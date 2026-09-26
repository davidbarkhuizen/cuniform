import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { Tag } from "../src/Tag";
import { assertClose } from "./support/assert";
import { maxTravelPerStep, mean, newGraph } from "./support/physics";

// Reference doc section 9: for a pair joined by a single edge the repulsion
// 10000/r^1.9 balances the spring 0.1(r-30) at r* ~= 65.46 model units.
const ANALYTIC_EQUILIBRIUM = 65.46;

test("a single edge settles at the analytic equilibrium distance", () => {
    const graph = new Graph();
    const a = new Tag({ x: -200, y: 0 }, "a");
    const b = new Tag({ x: 200, y: 0 }, "b");
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(a, b);

    const fdg = new ForceDirectedGraph(graph);
    maxTravelPerStep(fdg, graph, 4000);

    const r = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);

    assertClose(r, ANALYTIC_EQUILIBRIUM, 1.0, `settled at r=${r}, expected ~${ANALYTIC_EQUILIBRIUM}`);
});

test("at equilibrium the spring and repulsion forces balance", () => {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0 }, "a");
    const b = new Tag({ x: ANALYTIC_EQUILIBRIUM, y: 0 }, "b");
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(a, b);

    const fdg = new ForceDirectedGraph(graph);

    const repel = fdg.netElectrostaticForceAtNode(a);
    const spring = fdg.netSpringForceAtNode(a);
    const net = fdg.netForceAtNode(a);

    assertClose(net.x, 0, 0.02, `net radial force at r* was ${net.x}`);
    assert.ok(repel.x * spring.x < 0, "the two forces must oppose each other");
});

test("a 10-node graph converges instead of oscillating", () => {
    const graph = newGraph(10, 2);
    const fdg = new ForceDirectedGraph(graph);

    const travel = maxTravelPerStep(fdg, graph, 2000);
    const late = mean(travel.slice(1900));

    assert.ok(late < 1.0, `mean max per-step travel over the final 100 ticks was ${late}`);
    assert.ok(
        graph.vertices.every(v => Number.isFinite(v.position.x) && Number.isFinite(v.position.y)),
        "positions must stay finite"
    );
});
