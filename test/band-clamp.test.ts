import test from "node:test";
import assert from "node:assert/strict";

import { BAND_HALF, BAND_STRIDE, BAND_Y, BAND_Z_MAX, NO_BAND } from "../src/graph/Attributes";
import { buildGraph } from "../src/network/BuildGraph";
import { ForceDirectedGraph } from "../src/physics/ForceDirectedGraph";
import { Graph } from "../src/graph/Graph";
import { initRequest, PhysicsWorkerEngine, stepWithPin } from "../src/physics/PhysicsProtocol";
import { readFormat2 } from "../src/network/Format2";
import { bandViolations } from "./support/bands";
import { branchedWindow, sequenceModel } from "./support/format2";
import { ModelName, modelJson, skipUnless } from "./support/models";
import { GraphFactory } from "./support/GraphFactory";

const STEPS = 150;

function positions(graph: Graph): number[] {
    return graph.vertices.flatMap(v => [v.position.x, v.position.y, v.position.z]);
}

/** Steps in process and through the worker engine from one build; both must stay banded and agree bit for bit. */
function assertBandedBothPaths(json: unknown, steps: number = STEPS): void {
    const inProcess = buildGraph(readFormat2(json)).graph;
    const solver = new ForceDirectedGraph(inProcess);

    const engine = new PhysicsWorkerEngine();
    engine.handle(initRequest(buildGraph(readFormat2(json)).graph, 0));

    for (let s = 0; s < steps; s++) {
        solver.stepPhysics();
        engine.handle({ type: "step", generation: 0, pinned: -1, x: 0, y: 0, z: 0 });

        if (s % 25 === 0 || s === steps - 1) {
            assert.deepEqual(bandViolations(inProcess), [], `in process, step ${s}`);
            assert.deepEqual(bandViolations(engine.graph!), [], `worker engine, step ${s}`);
        }
    }

    assert.deepEqual(positions(engine.graph!), positions(inProcess), "the two paths are bit-equal");
}

test("every node stays in its band, in process and in the worker engine", () => {
    assertBandedBothPaths(sequenceModel());
    assertBandedBothPaths(branchedWindow(false));
    assertBandedBothPaths(branchedWindow(true));
});

for (const name of ["tinyshakespeare", "divisionProbe", "branches"] as ModelName[]) {
    const json = modelJson(name);

    test(`the ${name} model stays in its bands on both paths`, skipUnless(json), () => {
        assertBandedBothPaths(json);
    });
}

test("a dragged node is clamped to its band, and the clamped axis loses its velocity", () => {
    const graph = buildGraph(readFormat2(sequenceModel())).graph;
    const solver = new ForceDirectedGraph(graph);
    const a = graph.attributes!;
    const o = a.band[3] * BAND_STRIDE;

    // The pointer drags head0 far above its band and far out along z.
    stepWithPin(solver, graph, 3, 0, 10_000, 10_000);

    const head = graph.vertices[3];
    assert.equal(head.position.y, a.bands[o + BAND_Y] + a.bands[o + BAND_HALF], "held at the band's top face");
    assert.equal(head.position.z, a.bands[o + BAND_Z_MAX], "held at the footprint's edge");
    assert.deepEqual(bandViolations(graph), []);

    // A free node pushed against a face stops there with no velocity along that axis.
    const free = graph.vertices[0];
    const f = a.band[0] * BAND_STRIDE;
    free.position.y = a.bands[f + BAND_Y] + 5_000;
    free.velocity.y = 100;

    solver.stepPhysics();

    assert.equal(free.position.y, a.bands[f + BAND_Y] + a.bands[f + BAND_HALF]);
    assert.equal(free.velocity.y, 0);
});

test("a banded layout settles: travel is what a node moved, so a node pressed on a face is still", () => {
    const solver = new ForceDirectedGraph(buildGraph(readFormat2(sequenceModel())).graph);
    let steps = 0;

    while (solver.lastMaxDisplacement >= 0.01 || steps < 2) {
        solver.stepPhysics();
        steps++;
        assert.ok(steps < 5000, `still moving ${solver.lastMaxDisplacement} after ${steps} steps`);
    }
});

test("nodes outside every band, and graphs without attributes, step exactly as before", () => {
    const plain = new GraphFactory().generateGraph(40, 2, 7);
    const unbanded = new GraphFactory().generateGraph(40, 2, 7);
    const built = buildGraph(readFormat2(sequenceModel())).graph.attributes!;

    // Attributes that put no node in a band leave the arithmetic untouched.
    unbanded.attributes = {
        ...built,
        kind: new Uint8Array(40),
        band: new Int32Array(40).fill(NO_BAND),
        group: new Int32Array(40),
        marks: new Uint16Array(40),
        edgeKind: new Uint8Array(unbanded.edges.length),
        weight: new Float32Array(unbanded.edges.length),
    };

    const a = new ForceDirectedGraph(plain);
    const b = new ForceDirectedGraph(unbanded);

    for (let s = 0; s < 50; s++) {
        a.stepPhysics();
        b.stepPhysics();
    }

    assert.deepEqual(positions(unbanded), positions(plain));
    assert.equal(b.lastMaxDisplacement, a.lastMaxDisplacement);
});
