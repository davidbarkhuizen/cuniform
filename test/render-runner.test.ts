import test from "node:test";
import assert from "node:assert/strict";

import { Emphasis } from "../src/core/Emphasis";
import { Graph } from "../src/graph/Graph";
import { K } from "../src/core/K";
import { defaultCameraView } from "../src/view/Projector";
import { FrameRequest } from "../src/render/RenderProtocol";
import { RenderRunner, RenderRunnerOptions } from "../src/render/RenderRunner";
import {
    FakeCanvas,
    FakeRenderBackend,
    FakeRenderWorker,
    settleFrames,
    settledGraph,
    withUIController,
    withUIControllerAsync,
} from "./support/dom";
import { sparseGraph } from "./support/physics";

/**
 * The controller draws through one render backend. These drive the seam with a
 * recording fake, so the draw path is observable without a real canvas, and
 * check that the default runner still draws in-process on the canvas context.
 */

const PERIOD = K.physics.timerTickPeriodMS;

test("the controller draws once per drawn frame and not at all when settled", () => {
    const backend = new FakeRenderBackend();

    withUIController(ui => {
        ui.dom.runAnimationFrames(0);
        assert.equal(backend.draws.length, 1, "the first frame draws once");

        const timestamp = settleFrames(ui);

        assert.equal(
            backend.draws.length,
            1 + K.physics.settleFrames,
            "every stepping frame draws once"
        );

        ui.dom.runAnimationFrames(timestamp + PERIOD);

        assert.equal(
            backend.draws.length,
            1 + K.physics.settleFrames,
            "a settled, untouched scene must not draw"
        );
    }, { backend, graph: settledGraph() });
});

test("draw() receives the solver's graph, the live camera, the selection and the logical size", () => {
    const backend = new FakeRenderBackend();

    withUIController(ui => {
        ui.dom.runAnimationFrames(0);

        const first = backend.draws[0];

        assert.equal(first.graph, ui.controller.solver.graph, "the frame draws the solver's graph");
        assert.equal(first.camera, ui.controller.state.camera, "the frame draws the live camera");
        assert.equal(first.selected, null, "nothing is selected");
        assert.deepEqual([first.width, first.height], [800, 600], "the logical canvas size");
        assert.equal(first.emphasis, Emphasis.nodes, "the frame's display emphasis");

        // A selection reaches the backend without the renderer scanning for it.
        const node = ui.controller.solver.graph.vertices[0];
        node.isSelected = true;
        ui.controller.updateSelectionInfo();

        ui.dom.runAnimationFrames(0);

        assert.equal(backend.draws[backend.draws.length - 1].selected, node);
    }, { backend, graph: settledGraph() });
});

test("resizeCanvas hands the backend the logical size and devicePixelRatio", () => {
    const backend = new FakeRenderBackend();

    withUIController(ui => {
        assert.deepEqual(backend.resizes[0], [800, 600, 1], "initialize sizes the backing store");

        ui.elements.body.clientWidth = 1000;
        ui.elements.body.clientHeight = 400;

        const listeners = ui.dom.windowListeners.get('resize') ?? [];
        assert.equal(listeners.length, 1);
        listeners[0]({});

        assert.deepEqual(backend.resizes[1], [1000, 400, 1]);

        // The element still carries the logical CSS size on the main thread.
        assert.equal(ui.canvas.style.width, '1000px');
        assert.equal(ui.canvas.style.height, '400px');
    }, { backend });
});

test("a not-ready backend leaves the redraw pending so the next frame retries", () => {
    const backend = new FakeRenderBackend();

    withUIController(ui => {
        backend.drawable = false;

        // initialize() set needsRedraw, so the first frame draws and fails.
        ui.dom.runAnimationFrames(0);
        assert.equal(backend.draws.length, 1);

        // Still pending: the next frame must draw again even though nothing moved.
        ui.dom.runAnimationFrames(0);
        assert.equal(backend.draws.length, 2, "a false draw must keep the frame pending");

        backend.drawable = true;
        ui.dom.runAnimationFrames(0);
        assert.equal(backend.draws.length, 3);

        // Consumed and recorded: an idle frame now draws nothing.
        ui.dom.runAnimationFrames(0);
        assert.equal(backend.draws.length, 3, "a completed frame clears the pending redraw");
    }, { backend, graph: settledGraph() });
});

test("a backend that becomes ready later asks for a redraw", () => {
    const backend = new FakeRenderBackend();

    withUIController(ui => {
        const timestamp = settleFrames(ui);
        const before = backend.draws.length;

        // The runner forwards onReady to the controller's requestRedraw().
        backend.ready = false;
        backend.becomeReady();

        ui.dom.runAnimationFrames(timestamp);

        assert.equal(backend.draws.length, before + 1, "onReady must force a frame");
    }, { backend, graph: settledGraph() });
});

test("terminate disposes the render backend", () => {
    const backend = new FakeRenderBackend();

    withUIController(ui => {
        assert.equal(backend.terminated, false);

        ui.controller.terminate();

        assert.equal(backend.terminated, true, "a render backend must not outlive the controller");
    }, { backend });
});

test("a second initialize builds a fresh runner over the same backend", () => {
    const backend = new FakeRenderBackend();

    withUIController(ui => {
        const first = ui.controller.renderRunner;

        ui.controller.initialize();

        assert.notEqual(ui.controller.renderRunner, first, "a run owns its own runner");
        assert.equal(ui.dom.animationFrames.length, 1, "a second run must not double the frame");
        assert.equal(ui.controller.renderRunner.usesWorker, backend.usesWorker);
    }, { backend });
});

test("without an injected backend the runner draws in-process on the canvas context", () => {
    withUIController(ui => {
        assert.equal(ui.controller.renderRunner.usesWorker, false, "no Worker in the test host");
        assert.equal(ui.controller.renderRunner.ready, true, "the in-process backend is ready at once");

        ui.dom.runAnimationFrames(0);

        assert.ok(ui.canvas.context.clears.length > 0, "the in-process backend must clear the canvas");
        assert.ok(ui.canvas.context.fills.length > 0, "the in-process backend must draw the nodes");
    }, { graph: settledGraph() });
});

test("the in-process backend exports the canvas as a PNG blob", async () => {
    await withUIControllerAsync(async ({ controller }) => {
        const blob = await controller.renderRunner.exportPng();

        assert.ok(blob instanceof Blob, "export must resolve a Blob");
        assert.equal(blob.type, 'image/png');
    }, { graph: settledGraph() });
});

// ------------------------------------------------------- the render worker path

/** A runner over a FakeCanvas, wired to a fake worker, with its ready calls recorded. */
function workerFixture(
    graph: Graph | null,
    options: Partial<RenderRunnerOptions> = {}
): { canvas: FakeCanvas; fake: FakeRenderWorker; runner: RenderRunner; ready: number[] } {

    const canvas = new FakeCanvas();
    const fake = new FakeRenderWorker();
    const ready: number[] = [];

    const runner = RenderRunner.create(
        canvas as unknown as HTMLCanvasElement,
        () => ready.push(ready.length + 1),
        {
            graph: graph ?? undefined,
            workerFactory: () => fake,
            readyTimeoutMS: 20,
            ...options,
        }
    );

    assert.ok(runner, "the injected worker must produce a runner");

    return { canvas, fake, runner, ready };
}

/** Every frame message the worker has received, in order. */
function frames(fake: FakeRenderWorker): FrameRequest[] {
    return fake.posts
        .filter(post => post.message.type === "frame")
        .map(post => post.message as FrameRequest);
}

/** Deliver the ack `frame` earns, as the real engine would. */
function ack(fake: FakeRenderWorker, frame: FrameRequest, nodes: number): void {
    fake.deliver({
        type: "drawn",
        generation: frame.generation,
        frameId: frame.frameId,
        positions: frame.positions,
        depths: new Float64Array(nodes),
    });
}

test("the probe transfers nothing until the worker answers ready", () => {
    const graph = sparseGraph(8, 1);
    const { canvas, fake, runner } = workerFixture(graph);

    assert.equal(runner.usesWorker, true, "the runner is a worker backend from the start");
    assert.equal(runner.ready, false, "but it is not ready until the probe answers");
    assert.equal(canvas.transferred, false, "nothing may be transferred before ready");
    assert.equal(fake.posts.length, 0, "and nothing may be posted");

    fake.becomeReady();

    assert.equal(canvas.transferred, true, "ready is what transfers control");
    assert.equal(canvas.transferCount, 1, "control is transferred exactly once");
    assert.equal(runner.ready, true);
    assert.equal(fake.posts[0].message.type, "init", "the mirror crosses first");
    assert.equal(
        fake.posts[0].transfer.length,
        2,
        "the init carries the transferred canvas and its position buffer"
    );

    runner.terminate();
});

test("the worker's onReady asks the caller for a redraw", () => {
    const { fake, runner, ready } = workerFixture(sparseGraph(4, 1));

    assert.equal(ready.length, 0);

    fake.becomeReady();

    assert.equal(ready.length, 1, "a backend that becomes ready must request a frame");

    runner.terminate();
});

test("a worker that fails to load leaves the canvas untransferred and falls back in process", () => {
    const graph = sparseGraph(8, 1);
    const { canvas, fake, runner } = workerFixture(graph);

    fake.fail();

    assert.equal(canvas.transferred, false, "a failed probe must never have transferred");
    assert.equal(fake.terminated, true, "the failed worker must be terminated");
    assert.equal(runner.usesWorker, false, "the runner must fall back to the canvas context");
    assert.equal(runner.ready, true, "the in-process backend is ready at once");

    runner.draw(graph, defaultCameraView(), null, 800, 600, Emphasis.nodes);

    assert.ok(canvas.context.clears.length > 0, "the fallback must draw on the canvas context");
});

test("a ready that never arrives times out to the in-process backend", async () => {
    const graph = sparseGraph(8, 1);
    const { canvas, fake, runner } = workerFixture(graph, { readyTimeoutMS: 5 });

    await new Promise(resolve => setTimeout(resolve, 25));

    assert.equal(canvas.transferred, false, "a timed-out probe must never have transferred");
    assert.equal(fake.terminated, true);
    assert.equal(runner.usesWorker, false, "the timeout falls back in process");
});

test("without a Worker global the default factory chooses the in-process backend", () => {
    const canvas = new FakeCanvas();

    const runner = RenderRunner.create(canvas as unknown as HTMLCanvasElement, () => {});

    assert.ok(runner);
    assert.equal(runner.usesWorker, false, "a file:// style host has no Worker");
    assert.equal(runner.ready, true);
    assert.equal(canvas.transferred, false);
});

test("supported() is false when there is no worker and no 2d context", () => {
    const canvas = new FakeCanvas();

    assert.equal(RenderRunner.supported(canvas as unknown as HTMLCanvasElement), true);

    canvas.getContext = () => null;

    assert.equal(
        RenderRunner.supported(canvas as unknown as HTMLCanvasElement),
        false,
        "neither path can draw"
    );
});

test("draw coalesces to one frame in flight and carries the newest state", () => {
    const graph = sparseGraph(12, 7);
    const { fake, runner } = workerFixture(graph);

    fake.becomeReady();
    fake.hold();

    const cameraA = { ...defaultCameraView(), distance: 500 };
    const cameraB = { ...defaultCameraView(), distance: 600 };
    const cameraC = { ...defaultCameraView(), distance: 700 };

    runner.draw(graph, cameraA, null, 800, 600, Emphasis.nodes);
    assert.equal(frames(fake).length, 1);

    // Two more draws while one frame is in flight: neither may post.
    runner.draw(graph, cameraB, null, 800, 600, Emphasis.nodes);
    runner.draw(graph, cameraC, graph.vertices[3], 800, 600, Emphasis.edges);
    assert.equal(frames(fake).length, 1, "one frame in flight");

    // The ack posts the coalesced frame, carrying the newest camera and selection.
    ack(fake, frames(fake)[0], graph.vertices.length);

    assert.equal(frames(fake).length, 2, "exactly one more frame");
    assert.equal(frames(fake)[1].camera[12], 700, "the newest camera");
    assert.equal(frames(fake)[1].selected, 3, "the newest selection");
    assert.equal(frames(fake)[1].emphasis, Emphasis.edges, "the newest emphasis");

    runner.terminate();
});

test("a steady-state frame reuses the pooled position buffers", () => {
    const graph = sparseGraph(12, 7);
    const { fake, runner } = workerFixture(graph);

    fake.becomeReady();

    const seen = new Set<Float64Array>();

    for (let frame = 0; frame < 12; frame++) {
        runner.draw(graph, defaultCameraView(), null, 800, 600, Emphasis.nodes);

        const posts = frames(fake);
        seen.add(posts[posts.length - 1].positions);
    }

    assert.ok(seen.size <= 3, `expected at most three pooled buffers, saw ${seen.size}`);

    runner.terminate();
});

test("an ack from a replaced generation is ignored", () => {
    const first = sparseGraph(12, 7);
    const second = sparseGraph(12, 99);
    const { fake, runner } = workerFixture(first);

    fake.becomeReady();
    fake.hold();

    runner.draw(first, defaultCameraView(), null, 800, 600, Emphasis.nodes);
    const stale = frames(fake)[0];

    runner.setGraph(second);

    fake.deliver({
        type: "drawn",
        generation: stale.generation,
        frameId: stale.frameId,
        positions: stale.positions,
        depths: new Float64Array(first.vertices.length).fill(123),
    });

    assert.ok(
        first.vertices.every(tag => tag.depth !== 123),
        "a stale ack must not write depths onto the replaced graph"
    );

    runner.terminate();
});

test("the drawn ack writes this frame's depths back onto the tags", () => {
    const graph = sparseGraph(16, 21);
    const { fake, runner } = workerFixture(graph);

    fake.becomeReady();
    runner.draw(graph, defaultCameraView(), null, 800, 600, Emphasis.nodes);

    const mirror = fake.engine.graph;

    assert.ok(mirror, "the worker must have built its mirror");

    for (let i = 0; i < graph.vertices.length; i++)
        assert.equal(graph.vertices[i].depth, mirror.vertices[i].depth, `node ${i} depth`);

    runner.terminate();
});

test("the worker backend resolves export through the png response", async () => {
    const { fake, runner } = workerFixture(sparseGraph(4, 1));

    fake.becomeReady();

    const blob = await runner.exportPng();

    assert.ok(blob instanceof Blob, "export must resolve a Blob");
    assert.equal(fake.posts.some(post => post.message.type === "export"), true);

    runner.terminate();
});

test("terminate disposes the worker", () => {
    const { fake, runner } = workerFixture(sparseGraph(4, 1));

    fake.becomeReady();
    runner.terminate();

    assert.equal(fake.terminated, true, "a render worker must not outlive the runner");
});

test("a second initialize disposes the previous worker rather than leaking it", () => {
    const workers: FakeRenderWorker[] = [];

    const factory = () => {
        const worker = new FakeRenderWorker();
        workers.push(worker);
        return worker;
    };

    withUIController(ui => {
        workers[0].becomeReady();

        assert.equal(workers.length, 1);

        ui.controller.initialize();

        assert.equal(workers.length, 2, "a fresh run asks for a fresh worker");
        assert.equal(workers[0].terminated, true, "the previous worker must not leak");

        ui.controller.terminate();
    }, { graph: settledGraph(), workerFactory: factory });
});
