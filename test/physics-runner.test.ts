import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { K } from "../src/K";
import { PhysicsRunner, PhysicsWorkerPort } from "../src/PhysicsRunner";
import { PhysicsWorkerEngine, PositionsResponse, WorkerRequest } from "../src/PhysicsProtocol";
import { Projector } from "../src/Projector";
import { openingAngleFor } from "../src/Quality";
import { sparseGraph } from "./support/physics";
import { withUIController } from "./support/dom";

/**
 * An in-memory stand-in for the physics worker: it runs the real worker engine
 * synchronously, so both backends can be compared without a worker host. It can
 * be told to hold responses or to fail, which is how the stale-generation and
 * fallback paths are exercised.
 */
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

    /** Stop answering, so a response can be delivered by hand. */
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

test("the worker and in-process backends produce identical physics", () => {
    const order = 40;
    const inProcessGraph = sparseGraph(order, 4242);
    const workerGraph = sparseGraph(order, 4242);

    const inProcess = new PhysicsRunner(new ForceDirectedGraph(inProcessGraph), () => null);

    const fake = new FakePhysicsWorker();
    const worker = new PhysicsRunner(new ForceDirectedGraph(workerGraph), () => fake);

    assert.equal(inProcess.usesWorker, false);
    assert.equal(worker.usesWorker, true);

    for (let step = 0; step < 25; step++) {
        inProcess.step(-1, 0, 0, 0);
        worker.step(-1, 0, 0, 0);
    }

    worker.sync(workerGraph);

    const engineGraph = fake.engine.graph;

    assert.ok(engineGraph, "the fake worker must have built its own graph");

    for (let i = 0; i < order; i++) {
        assert.equal(workerGraph.vertices[i].position.x, inProcessGraph.vertices[i].position.x, `node ${i} x`);
        assert.equal(workerGraph.vertices[i].position.y, inProcessGraph.vertices[i].position.y, `node ${i} y`);
        assert.equal(workerGraph.vertices[i].position.z, inProcessGraph.vertices[i].position.z, `node ${i} z`);

        // Velocity only exists inside the worker; compare it through the engine.
        assert.equal(engineGraph!.vertices[i].velocity.x, inProcessGraph.vertices[i].velocity.x, `node ${i} vx`);
        assert.equal(engineGraph!.vertices[i].velocity.y, inProcessGraph.vertices[i].velocity.y, `node ${i} vy`);
        assert.equal(engineGraph!.vertices[i].velocity.z, inProcessGraph.vertices[i].velocity.z, `node ${i} vz`);
    }
});

test("the backends stay identical above the fast threshold, where auto picks the fast angle", () => {
    // Same harness, at the size where the size default moves the forces: both
    // realms must read the same compile-time K and stay bit-identical.
    const order = K.physics.barnesHutFastMinNodes;
    const inProcessGraph = sparseGraph(order, 909);
    const workerGraph = sparseGraph(order, 909);

    assert.equal(
        openingAngleFor(order, K.physics.quality),
        K.physics.barnesHutFastTheta,
        "this fixture must actually exercise the fast angle"
    );

    const inProcess = new PhysicsRunner(new ForceDirectedGraph(inProcessGraph), () => null);

    const fake = new FakePhysicsWorker();
    const worker = new PhysicsRunner(new ForceDirectedGraph(workerGraph), () => fake);

    for (let step = 0; step < 2; step++) {
        inProcess.step(-1, 0, 0, 0);
        worker.step(-1, 0, 0, 0);
    }

    worker.sync(workerGraph);

    const engineGraph = fake.engine.graph;

    assert.ok(engineGraph, "the fake worker must have built its own graph");

    for (let i = 0; i < order; i++) {
        assert.equal(workerGraph.vertices[i].position.x, inProcessGraph.vertices[i].position.x, `node ${i} x`);
        assert.equal(workerGraph.vertices[i].position.y, inProcessGraph.vertices[i].position.y, `node ${i} y`);
        assert.equal(workerGraph.vertices[i].position.z, inProcessGraph.vertices[i].position.z, `node ${i} z`);

        assert.equal(engineGraph!.vertices[i].velocity.x, inProcessGraph.vertices[i].velocity.x, `node ${i} vx`);
        assert.equal(engineGraph!.vertices[i].velocity.y, inProcessGraph.vertices[i].velocity.y, `node ${i} vy`);
        assert.equal(engineGraph!.vertices[i].velocity.z, inProcessGraph.vertices[i].velocity.z, `node ${i} vz`);
    }
});

test("a pinned node behaves identically through both backends", () => {
    const order = 30;
    const inProcessGraph = sparseGraph(order, 77);
    const workerGraph = sparseGraph(order, 77);

    const inProcess = new PhysicsRunner(new ForceDirectedGraph(inProcessGraph), () => null);

    const fake = new FakePhysicsWorker();
    const worker = new PhysicsRunner(new ForceDirectedGraph(workerGraph), () => fake);

    const pinned = 7;
    const x = 120;
    const y = -45;
    const z = 15;

    for (let step = 0; step < 8; step++) {
        inProcess.step(pinned, x, y, z);
        worker.step(pinned, x, y, z);
    }

    worker.sync(workerGraph);

    assert.deepEqual(
        { x: inProcessGraph.vertices[pinned].position.x, y: inProcessGraph.vertices[pinned].position.y, z: inProcessGraph.vertices[pinned].position.z },
        { x, y, z },
        "the pinned node must hold the pointer position"
    );

    const engineGraph = fake.engine.graph;

    assert.ok(engineGraph);

    assert.deepEqual(
        {
            x: engineGraph!.vertices[pinned].velocity.x,
            y: engineGraph!.vertices[pinned].velocity.y,
            z: engineGraph!.vertices[pinned].velocity.z,
        },
        { x: 0, y: 0, z: 0 },
        "the pinned node's velocity must be bled off"
    );

    for (let i = 0; i < order; i++) {
        assert.equal(workerGraph.vertices[i].position.x, inProcessGraph.vertices[i].position.x, `node ${i} x`);
        assert.equal(workerGraph.vertices[i].position.y, inProcessGraph.vertices[i].position.y, `node ${i} y`);
        assert.equal(workerGraph.vertices[i].position.z, inProcessGraph.vertices[i].position.z, `node ${i} z`);
    }
});

test("a response from a superseded generation is dropped", () => {
    const solver = new ForceDirectedGraph(sparseGraph(12, 99));
    const fake = new FakePhysicsWorker();
    const runner = new PhysicsRunner(solver, () => fake);

    fake.hold();

    // A step whose answer never arrives, so the runner is waiting on it.
    runner.step(-1, 0, 0, 0);

    // Swap the graph: the generation advances and the pending step is abandoned.
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
