import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { Tag } from "../src/Tag";
import {
    FakeRenderBackend,
    UIControllerFixture,
    withUIController,
    withUIControllerAsync,
} from "./support/dom";

/**
 * The controller draws through one render backend. These drive the seam with a
 * recording fake, so the draw path is observable without a real canvas, and
 * check that the default runner still draws in-process on the canvas context.
 */

const PERIOD = K.physics.timerTickPeriodMS;

// One node at the origin feels no force, so the settle detector arms
// deterministically and the idle-frame skip is reachable.
function settledGraph(): Graph {
    const graph = new Graph();
    graph.addNode(new Tag({ x: 0, y: 0, z: 0 }, "solo"));
    return graph;
}

/** Drive the first frame plus `settleFrames` stepping frames; return the last timestamp. */
function settle(ui: UIControllerFixture): number {
    ui.dom.runAnimationFrames(0);

    let timestamp = 0;

    for (let frame = 1; frame <= K.physics.settleFrames; frame++) {
        timestamp = PERIOD * frame;
        ui.dom.runAnimationFrames(timestamp);
    }

    return timestamp;
}

test("the controller draws once per drawn frame and not at all when settled", () => {
    const backend = new FakeRenderBackend();

    withUIController(ui => {
        ui.dom.runAnimationFrames(0);
        assert.equal(backend.draws.length, 1, "the first frame draws once");

        const timestamp = settle(ui);

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
        const timestamp = settle(ui);
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
