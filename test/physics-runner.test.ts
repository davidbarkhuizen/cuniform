import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/physics/ForceDirectedGraph";
import { Graph } from "../src/graph/Graph";
import { K } from "../src/core/K";
import { PhysicsRunner, PhysicsWorkerPort } from "../src/physics/PhysicsRunner";
import { PhysicsWorkerEngine, PositionsResponse, WorkerRequest } from "../src/physics/PhysicsProtocol";
import { Projector } from "../src/view/Projector";
import { openingAngleFor } from "../src/physics/Quality";
import { CANVAS_H, CANVAS_W, disconnectedPaths, sparseGraph } from "./support/physics";
import { withUIController } from "./support/dom";

/** In-memory worker running the real engine synchronously; can hold or fail responses. */
class FakePhysicsWorker implements PhysicsWorkerPort {

    onmessage: ((event: { data: PositionsResponse }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;

    readonly engine = new PhysicsWorkerEngine();
    terminated = false;

    private answering = true;

    postMessage(message: WorkerRequest): void {

        if (this.terminated)
            return;

        const response = this.engine.handle(message);

        if (response !== null && this.answering)
            this.onmessage?.({ data: response });
    }

    terminate(): void {
        this.terminated = true;
    }

    hold(): void {
        this.answering = false;
    }

    deliver(response: PositionsResponse): void {
        this.onmessage?.({ data: response });
    }

    fail(): void {
        this.onerror?.(new Error("the worker script failed to load"));
    }
}

interface BackendPair {
    inProcess: PhysicsRunner;
    worker: PhysicsRunner;
    inProcessGraph: Graph;
    workerGraph: Graph;
    engineGraph: Graph;
}

/** Runs both backends on one seeded fixture; shared seed and step rule must keep them bit-identical. */
function runBackends(
    order: number,
    seed: number,
    steps: number,
    pinnedIndex: number,
    x = 0,
    y = 0,
    z = 0,
    build: (order: number, seed: number) => Graph = sparseGraph
): BackendPair {
    const inProcessGraph = build(order, seed);
    const workerGraph = build(order, seed);

    const inProcess = new PhysicsRunner(new ForceDirectedGraph(inProcessGraph), () => null);

    const fake = new FakePhysicsWorker();
    const worker = new PhysicsRunner(new ForceDirectedGraph(workerGraph), () => fake);

    for (let step = 0; step < steps; step++) {
        inProcess.step(pinnedIndex, x, y, z);
        worker.step(pinnedIndex, x, y, z);
    }

    worker.sync(workerGraph);

    const engineGraph = fake.engine.graph;

    assert.ok(engineGraph, "the fake worker must have built its own graph");

    return { inProcess, worker, inProcessGraph, workerGraph, engineGraph: engineGraph! };
}

function assertSamePositions(order: number, pair: BackendPair): void {
    for (let i = 0; i < order; i++) {
        assert.equal(pair.workerGraph.vertices[i].position.x, pair.inProcessGraph.vertices[i].position.x, `node ${i} x`);
        assert.equal(pair.workerGraph.vertices[i].position.y, pair.inProcessGraph.vertices[i].position.y, `node ${i} y`);
        assert.equal(pair.workerGraph.vertices[i].position.z, pair.inProcessGraph.vertices[i].position.z, `node ${i} z`);
    }
}

/** Velocity exists only inside the worker, so it is compared through the engine's graph. */
function assertBackendsAgree(
    order: number,
    seed: number,
    steps: number,
    build: (order: number, seed: number) => Graph = sparseGraph
): BackendPair {
    const pair = runBackends(order, seed, steps, -1, 0, 0, 0, build);

    assertSamePositions(order, pair);

    for (let i = 0; i < order; i++) {
        assert.equal(pair.engineGraph.vertices[i].velocity.x, pair.inProcessGraph.vertices[i].velocity.x, `node ${i} vx`);
        assert.equal(pair.engineGraph.vertices[i].velocity.y, pair.inProcessGraph.vertices[i].velocity.y, `node ${i} vy`);
        assert.equal(pair.engineGraph.vertices[i].velocity.z, pair.inProcessGraph.vertices[i].velocity.z, `node ${i} vz`);
    }

    return pair;
}

test("the worker and in-process backends produce identical physics", () => {
    const pair = assertBackendsAgree(40, 4242, 25);

    assert.equal(pair.inProcess.usesWorker, false);
    assert.equal(pair.worker.usesWorker, true);
});

test("the backends stay identical above the fast threshold, where auto picks the fast angle", () => {
    // At this size the fast angle is selected: both realms must read the same compile-time K.
    const order = K.physics.barnesHutFastMinNodes;

    assert.equal(
        openingAngleFor(order, K.physics.quality),
        K.physics.barnesHutFastTheta,
        "this fixture must actually exercise the fast angle"
    );

    assertBackendsAgree(order, 909, 2);
});

test("the worker and in-process backends are identical on a disconnected graph", () => {
    // Both realms must label components, accumulate centroids in vertices order and apply the same anchor;
    // exact equality, no tolerance.
    const build = () => disconnectedPaths(500, 6, 2).graph;

    const pair = assertBackendsAgree(12, 0, 40, build);

    assert.equal(pair.inProcess.usesWorker, false);
    assert.equal(pair.worker.usesWorker, true);

    const engineGraph = pair.engineGraph;

    assert.equal(engineGraph.vertices.length, 12);
    assert.equal(engineGraph.edges.length, 10, "two 6-node paths");
});

test("a pinned node behaves identically through both backends", () => {
    const order = 30;
    const pinned = 7;
    const x = 120;
    const y = -45;
    const z = 15;

    const pair = runBackends(order, 77, 8, pinned, x, y, z);

    assert.deepEqual(
        { x: pair.inProcessGraph.vertices[pinned].position.x, y: pair.inProcessGraph.vertices[pinned].position.y, z: pair.inProcessGraph.vertices[pinned].position.z },
        { x, y, z },
        "the pinned node must hold the pointer position"
    );

    assert.deepEqual(
        {
            x: pair.engineGraph.vertices[pinned].velocity.x,
            y: pair.engineGraph.vertices[pinned].velocity.y,
            z: pair.engineGraph.vertices[pinned].velocity.z,
        },
        { x: 0, y: 0, z: 0 },
        "the pinned node's velocity must be bled off"
    );

    assertSamePositions(order, pair);
});

test("a -1 or out-of-range index steps with nothing pinned", () => {
    const order = 12;

    const reference = sparseGraph(order, 5);
    new ForceDirectedGraph(reference).step(CANVAS_W, CANVAS_H);

    // -1 is the wire's "no pin" sentinel.
    const sentinel = sparseGraph(order, 5);
    new PhysicsRunner(new ForceDirectedGraph(sentinel), () => null).step(-1, 999, 999, 999);

    // An index past the last node must be treated the same, never indexed.
    const outOfRange = sparseGraph(order, 5);
    new PhysicsRunner(new ForceDirectedGraph(outOfRange), () => null).step(order + 5, 999, 999, 999);

    const snapshot = (graph: Graph) =>
        graph.vertices.map(tag => ({ x: tag.position.x, y: tag.position.y, z: tag.position.z }));

    assert.deepEqual(snapshot(sentinel), snapshot(reference), "-1 must pin nothing");
    assert.deepEqual(snapshot(outOfRange), snapshot(reference), "an out-of-range index must pin nothing");
});

test("a response from a superseded generation is dropped", () => {
    const solver = new ForceDirectedGraph(sparseGraph(12, 99));
    const fake = new FakePhysicsWorker();
    const runner = new PhysicsRunner(solver, () => fake);

    fake.hold();

    runner.step(-1, 0, 0, 0);

    runner.setGraph(new ForceDirectedGraph(sparseGraph(12, 1234)));

    const afterSwap = runner.positions().slice();

    fake.deliver({
        type: "positions",
        generation: 0,
        positions: new Float64Array(afterSwap.length).fill(7),
        maxDisplacement: 42,
    });

    assert.deepEqual(runner.positions(), afterSwap, "a stale response must not replace positions");
    assert.equal(runner.maxDisplacement, 0, "a stale response must not report travel");

    fake.deliver({
        type: "positions",
        generation: 1,
        positions: new Float64Array(afterSwap.length).fill(3),
        maxDisplacement: 2,
    });

    assert.equal(runner.positions()[0], 3, "a current response must be applied");
    assert.equal(runner.maxDisplacement, 2);
});

test("the runner falls back in-process when no worker can be constructed", () => {
    const solver = new ForceDirectedGraph(sparseGraph(10, 5));

    const none = new PhysicsRunner(solver, () => null);
    assert.equal(none.usesWorker, false);

    const throwing = new PhysicsRunner(solver, () => { throw new Error("Worker is unavailable"); });
    assert.equal(throwing.usesWorker, false, "a throwing factory must fall back");

    none.step(-1, 0, 0, 0);
    assert.equal(none.positions().length, 30, "the fallback must still report positions");
});

test("a worker that fails to load hands back to the in-process solver", () => {
    const graph = sparseGraph(12, 8);
    const solver = new ForceDirectedGraph(graph);
    const fake = new FakePhysicsWorker();
    const runner = new PhysicsRunner(solver, () => fake);

    assert.equal(runner.usesWorker, true);

    fake.fail();

    assert.equal(runner.usesWorker, false, "the runner must fall back to the solver");
    assert.equal(fake.terminated, true, "the failed worker must be terminated");

    runner.step(-1, 0, 0, 0);

    assert.ok(solver.lastMaxDisplacement > 0, "the fallback must advance the solver's own graph");
});

test("stepPhysics advances without projecting, and project() caches the view", () => {
    const graph = sparseGraph(8, 21);
    const solver = new ForceDirectedGraph(graph);
    const depthsBefore = graph.vertices.map(node => node.depth);

    solver.stepPhysics();

    graph.vertices.forEach((node, i) =>
        assert.equal(node.depth, depthsBefore[i], "stepPhysics must not project")
    );

    solver.project(Projector.forCanvas(800, 600));

    assert.ok(
        graph.vertices.every(node => Number.isFinite(node.depth) && node.depth !== 0),
        "project() must cache a depth on every node"
    );
    assert.ok(
        graph.vertices.every(node => Number.isFinite(node.translatedPosition.x)),
        "project() must cache the canvas position on every node"
    );
});

test("the controller drives physics through the runner, in-process without a Worker", () => {
    withUIController(ui => {
        assert.equal(ui.controller.runner.usesWorker, false, "the test host has no Worker");

        const before = ui.controller.solver.graph.vertices[0].position.x;

        ui.controller.onTimerTick();

        assert.notEqual(
            ui.controller.solver.graph.vertices[0].position.x,
            before,
            "onTimerTick must advance physics through the runner"
        );
    });
});
