import test from "node:test";
import assert from "node:assert/strict";

import { K } from "../src/K";
import {
    FakeRenderWorker,
    countSteps,
    mouseEvent,
    settleFrames,
    settledGraph,
    wheelEvent,
    withUIController,
} from "./support/dom";

const PERIOD = K.physics.timerTickPeriodMS;

test("the animation loop runs one fixed step per elapsed tick and draws once per frame", () => {
    withUIController(ui => {
        const steps = countSteps(ui.controller);
        const clears = () => ui.canvas.context.clears.length;

        assert.equal(steps(), 0, "initialize must not step on its own");

        // The first frame only establishes the clock.
        ui.dom.runAnimationFrames(0);
        assert.equal(steps(), 0, "the first frame has no elapsed time");

        const clearsAfterFirst = clears();

        ui.dom.runAnimationFrames(PERIOD);
        assert.equal(steps(), 1, "one period of elapsed time is one step");

        ui.dom.runAnimationFrames(PERIOD * 2);
        assert.equal(steps(), 2, "each elapsed period is one more step");

        // Two more frames, two more clears: drawing happens once per frame.
        assert.equal(clears() - clearsAfterFirst, 2);
    }, { graph: settledGraph() });
});

test("a time jump runs at most maxStepsPerFrame steps and drops the backlog", () => {
    withUIController(ui => {
        const steps = countSteps(ui.controller);

        ui.dom.runAnimationFrames(0);

        // Ten periods of elapsed time arrive in a single frame.
        ui.dom.runAnimationFrames(PERIOD * 10);

        assert.equal(steps(), K.physics.maxStepsPerFrame, "the cap must bound one frame");

        // The remainder was discarded, so the next frame runs only its own time.
        ui.dom.runAnimationFrames(PERIOD * 11);

        assert.equal(
            steps(),
            K.physics.maxStepsPerFrame + 1,
            "the backlog must not carry into the next frame"
        );
    }, { graph: settledGraph() });
});

test("stepping stops after settleFrames quiet steps and any interaction resumes it", () => {
    withUIController(ui => {
        const steps = countSteps(ui.controller);

        ui.dom.runAnimationFrames(0);

        for (let frame = 1; frame <= K.physics.settleFrames; frame++)
            ui.dom.runAnimationFrames(PERIOD * frame);

        assert.equal(steps(), K.physics.settleFrames, "the quiet run must step normally");

        // Settled: further frames advance nothing.
        ui.dom.runAnimationFrames(PERIOD * (K.physics.settleFrames + 1));
        ui.dom.runAnimationFrames(PERIOD * (K.physics.settleFrames + 2));

        assert.equal(steps(), K.physics.settleFrames, "a settled layout must stop stepping");

        // A dolly is interaction, so the layout starts moving again.
        ui.elements.canvas.dispatch("wheel", wheelEvent({ deltaY: 1 }));

        ui.dom.runAnimationFrames(PERIOD * (K.physics.settleFrames + 3));

        assert.equal(steps(), K.physics.settleFrames + 1, "interaction must resume stepping");
    }, { graph: settledGraph() });
});

test("a graph swap resumes a settled layout", () => {
    withUIController(ui => {
        const steps = countSteps(ui.controller);

        ui.dom.runAnimationFrames(0);

        for (let frame = 1; frame <= K.physics.settleFrames; frame++)
            ui.dom.runAnimationFrames(PERIOD * frame);

        assert.equal(steps(), K.physics.settleFrames);

        // A fresh graph must never inherit the previous layout's settled state.
        // loadGraph builds a new solver, so the counter is re-installed on it.
        ui.controller.loadGraph(settledGraph());
        const stepsAfterSwap = countSteps(ui.controller);

        ui.dom.runAnimationFrames(PERIOD * (K.physics.settleFrames + 1));

        assert.equal(stepsAfterSwap(), 1, "a swap must resume stepping");
    }, { graph: settledGraph() });
});

test("the setInterval fallback still ticks when rAF is unavailable", () => {
    withUIController(ui => {
        assert.equal(ui.dom.intervals.length, 1, "the fallback interval must be scheduled");
        assert.equal(ui.dom.animationFrames.length, 0, "no frame may be pending");
        assert.equal(ui.controller.running, true);

        const steps = countSteps(ui.controller);
        const clears = ui.canvas.context.clears.length;

        ui.dom.intervals[0].fn();

        assert.equal(steps(), 1, "one interval callback is one fixed tick");

        // The legacy path deliberately bypasses the idle-frame skip: it steps on
        // every callback, so it must draw on every callback too.
        assert.equal(ui.canvas.context.clears.length, clears + 1, "the legacy tick draws every callback");
    }, { graph: settledGraph(), animationFrame: false });
});

// ------------------------------------------------------- idle-frame skipping

test("a settled, untouched scene issues no further clears", () => {
    withUIController(ui => {
        const timestamp = settleFrames(ui);
        const clears = ui.canvas.context.clears.length;

        // Two more frames with no step due, no camera change and no interaction.
        ui.dom.runAnimationFrames(timestamp + PERIOD);
        ui.dom.runAnimationFrames(timestamp + PERIOD * 2);

        assert.equal(
            ui.canvas.context.clears.length,
            clears,
            "an idle scene must leave the previous frame on the canvas"
        );
    }, { graph: settledGraph() });
});

test("a camera dolly redraws even when no step is due", () => {
    withUIController(ui => {
        const timestamp = settleFrames(ui);
        const clears = ui.canvas.context.clears.length;

        ui.elements.canvas.dispatch("wheel", wheelEvent({ deltaY: 1 }));

        // The same timestamp means no elapsed time, so no step can run.
        ui.dom.runAnimationFrames(timestamp);

        assert.equal(ui.canvas.context.clears.length, clears + 1, "a dolly must force a redraw");
    }, { graph: settledGraph() });
});

test("a selection click redraws even when no step is due", () => {
    withUIController(ui => {
        const timestamp = settleFrames(ui);
        const clears = ui.canvas.context.clears.length;

        // The solo node sits at the model origin: canvas (400, 300) on 800x600.
        ui.controller.onMouseDown(mouseEvent({ button: 0, clientX: 400, clientY: 300 }));

        ui.dom.runAnimationFrames(timestamp);

        assert.equal(ui.canvas.context.clears.length, clears + 1, "a selection must force a redraw");
    }, { graph: settledGraph() });
});

test("a position-writing drag redraws even when no step is due", () => {
    withUIController(ui => {
        const timestamp = settleFrames(ui);

        // Select the node; onMouseDown leaves the left button held.
        ui.controller.onMouseDown(mouseEvent({ button: 0, clientX: 400, clientY: 300 }));
        ui.dom.runAnimationFrames(timestamp);

        const clears = ui.canvas.context.clears.length;

        ui.controller.onMouseMove(mouseEvent({ clientX: 430, clientY: 300 }));
        ui.dom.runAnimationFrames(timestamp);

        assert.equal(ui.canvas.context.clears.length, clears + 1, "a drag must force a redraw");
    }, { graph: settledGraph() });
});

test("a resize redraws even when no step is due", () => {
    withUIController(ui => {
        const timestamp = settleFrames(ui);
        const clears = ui.canvas.context.clears.length;

        const listeners = ui.dom.windowListeners.get("resize") ?? [];

        assert.equal(listeners.length, 1, "initialize registers one resize listener");
        listeners[0]({});

        ui.dom.runAnimationFrames(timestamp);

        assert.equal(ui.canvas.context.clears.length, clears + 1, "a resize must force a redraw");
    }, { graph: settledGraph() });
});

test("terminate() stops the loop on either scheduler", () => {
    withUIController(ui => {
        assert.equal(ui.dom.animationFrames.length, 1, "initialize schedules one frame");

        ui.controller.terminate();

        assert.equal(ui.controller.running, false);
        assert.equal(ui.dom.animationFrames.length, 0, "the pending frame must be cancelled");
    }, { graph: settledGraph() });
});

// ------------------------------------------------------- the render worker path

test("the worker path posts one frame per drawn frame and none while settled", () => {
    const fake = new FakeRenderWorker();

    withUIController(ui => {
        // The controller's runner probes this worker; the handshake is what
        // makes the canvas transferable and the backend ready.
        fake.becomeReady();

        const posts = () => fake.posts.filter(post => post.message.type === "frame").length;

        // initialize() set needsRedraw, so the first frame draws and posts once.
        ui.dom.runAnimationFrames(0);
        assert.equal(posts(), 1, "the first frame posts once");

        const timestamp = settleFrames(ui);

        assert.equal(posts(), 1 + K.physics.settleFrames, "one post per drawn frame");

        // Settled, the frame is skipped and nothing more crosses.
        ui.dom.runAnimationFrames(timestamp + PERIOD);
        assert.equal(posts(), 1 + K.physics.settleFrames, "a settled scene must not post");
    }, { graph: settledGraph(), workerFactory: () => fake });
});
