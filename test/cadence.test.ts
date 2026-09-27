import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { Tag } from "../src/Tag";
import { UIController } from "../src/UIController";
import { wheelEvent, withUIController } from "./support/dom";

const PERIOD = K.physics.timerTickPeriodMS;

// One node at the origin feels no force, so its travel is exactly zero and the
// settle detector arms deterministically.
function settledGraph(): Graph {
    const graph = new Graph();
    graph.addNode(new Tag({ x: 0, y: 0, z: 0 }, "solo"));
    return graph;
}

/** Count physics steps by wrapping the controller's solver. */
function countSteps(controller: UIController): () => number {
    const solver = controller.solver;
    const realStep = solver.step.bind(solver);

    let steps = 0;

    solver.step = (width, height, isPinned, projector) => {
        steps++;
        realStep(width, height, isPinned, projector);
    };

    return () => steps;
}

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

        ui.dom.intervals[0].fn();

        assert.equal(steps(), 1, "one interval callback is one fixed tick");
    }, { graph: settledGraph(), animationFrame: false });
});

test("terminate() stops the loop on either scheduler", () => {
    withUIController(ui => {
        assert.equal(ui.dom.animationFrames.length, 1, "initialize schedules one frame");

        ui.controller.terminate();

        assert.equal(ui.controller.running, false);
        assert.equal(ui.dom.animationFrames.length, 0, "the pending frame must be cancelled");
    }, { graph: settledGraph() });
});
