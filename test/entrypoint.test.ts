import test from "node:test";
import assert from "node:assert/strict";

import { entrypoint, SELECTION_INFO_PANEL_ID, CANVAS_ID, EXPORT_ELEMENT_ID, RESET_ELEMENT_ID } from "../src/app/entrypoint";
import { defaultGraphSpec } from "../src/graph/GraphSpec";
import { FakeCanvas, demoElements, newUIController, withFakeDom } from "./support/dom";

const IDS: [string, string, string, string] = [
    SELECTION_INFO_PANEL_ID,
    CANVAS_ID,
    EXPORT_ELEMENT_ID,
    RESET_ELEMENT_ID,
];

/** Run `fn` with console.error muted, restoring it afterwards. */
function quietly<T>(fn: () => T): T {
    const realError = console.error;
    console.error = () => {};
    try {
        return fn();
    } finally {
        console.error = realError;
    }
}

test("entrypoint initializes when window.Worker is undefined", () => {
    withFakeDom(demoElements(), dom => {
        // No worker is ever constructed, so its absence must not block startup.
        assert.equal(dom.window.Worker, undefined);

        const result = quietly(() => entrypoint(...IDS));

        assert.ok(result, "entrypoint should hand back the controller");
        assert.equal(result.running, true, "the simulation loop should be running");
        assert.ok(result.solver.graph.vertices.length > 0, "the controller should own a live graph");
        assert.equal(dom.animationFrames.length, 1, "the simulation timer should be running");
        // The fake body is 800x600, and the canvas fills it (dpr 1).
        assert.equal((dom.elements.canvas as FakeCanvas).width, 800);
        assert.equal((dom.elements.canvas as FakeCanvas).height, 600);
    });
});

test("entrypoint starts on a random graph without opening the chooser", () => {
    withFakeDom(demoElements(), dom => {
        const result = quietly(() => entrypoint(...IDS));

        assert.ok(result, "entrypoint should hand back the controller");
        assert.ok(result.wizard === null, "startup must not trigger the reset wizard");
        assert.deepEqual(result.spec, defaultGraphSpec(), "startup seeds the shipped random default");
        assert.ok(result.solver.graph.vertices.length > 0, "a random graph is generated and simulated");
        assert.equal(dom.animationFrames.length, 1, "the simulation timer should be running");
    });
});

test("initialize() itself never opens the chooser", () => {
    const elements = demoElements();

    withFakeDom(elements, dom => {
        const controller = newUIController(elements);

        controller.initialize();

        assert.ok(controller.wizard === null, "the chooser is opened by reset, never by initialize");
        assert.equal(controller.running, true);
        assert.equal(dom.animationFrames.length, 1);
    });
});

test("entrypoint reports failure when the canvas element is missing", () => {
    withFakeDom(demoElements(['canvas']), dom => {
        const result = quietly(() => entrypoint(...IDS));

        assert.equal(result, null);
        assert.equal(dom.animationFrames.length, 0, "nothing should be scheduled on failure");
    });
});

test("entrypoint reports failure when getContext('2d') returns null", () => {
    const elements = demoElements();
    const canvas = elements.canvas as FakeCanvas;
    canvas.getContext = () => null;

    withFakeDom(elements, dom => {
        const result = quietly(() => entrypoint(...IDS));

        assert.equal(result, null);
        assert.equal(dom.animationFrames.length, 0, "nothing should be scheduled on failure");
    });
});

test("entrypoint still initializes when the optional drag panel is missing", () => {
    withFakeDom(demoElements(['selectionInfoPanel']), dom => {
        const result = quietly(() => entrypoint(...IDS));

        assert.ok(result);
        assert.equal(dom.animationFrames.length, 1);
    });
});

test("entrypoint scopes the touch drag to the panel's grip", () => {
    withFakeDom(demoElements(), dom => {
        quietly(() => entrypoint(...IDS));

        assert.equal(dom.elements.panelDragHandle.style.touchAction, 'none', "the grip owns the touch drag");
        assert.notEqual(
            dom.elements.selectionInfoPanel.style.touchAction,
            'none',
            "the panel body must stay touch-scrollable"
        );
    });
});

test("entrypoint falls back to the whole panel when the grip is missing", () => {
    withFakeDom(demoElements(['panelDragHandle']), dom => {
        const result = quietly(() => entrypoint(...IDS));

        assert.ok(result);
        assert.equal(
            dom.elements.selectionInfoPanel.style.touchAction,
            'none',
            "without a grip the panel itself is the touch surface"
        );
    });
});

test("entrypoint reports failure when any required element is missing", () => {
    for (const missing of ['body', 'export_canvas_link', 'reset_link', 'selectedNodeInfoLabel', 'selectedNodeInfoList', 'currentGraphLabel', 'cameraConsole', 'emphasisConsole']) {
        withFakeDom(demoElements([missing]), dom => {
            const result = quietly(() => entrypoint(...IDS));

            assert.equal(result, null, `missing ${missing} should fail startup`);
            assert.equal(dom.animationFrames.length, 0, "nothing should be scheduled on failure");
        });
    }
});
