import test from "node:test";
import assert from "node:assert/strict";

import { entrypoint } from "../src/entrypoint";
import { FakeCanvas, demoElements, withFakeDom } from "./support/dom";
import { readSource } from "./support/files";

const IDS: [string, string, string, string] = [
    'selectionInfoPanel',
    'canvas',
    'export_canvas_link',
    'reset_link',
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

        let result: boolean | undefined;
        quietly(() => {
            result = entrypoint(...IDS);
        });

        assert.equal(result, true);
        assert.ok(dom.window.state, "state should be installed on window");
        assert.ok(dom.window.fdg, "the graph should be installed on window");
        assert.equal(dom.intervals.length, 1, "the simulation timer should be running");
        // The fake body is 800x600, and the canvas fills it (dpr 1).
        assert.equal((dom.elements.canvas as FakeCanvas).width, 800);
        assert.equal((dom.elements.canvas as FakeCanvas).height, 600);
    });
});

test("entrypoint reports failure when the canvas element is missing", () => {
    withFakeDom(demoElements(['canvas']), dom => {
        let result: boolean | undefined;
        quietly(() => {
            result = entrypoint(...IDS);
        });

        assert.equal(result, false);
        assert.equal(dom.intervals.length, 0, "nothing should be scheduled on failure");
    });
});

test("entrypoint reports failure when getContext('2d') returns null", () => {
    const elements = demoElements();
    const canvas = elements.canvas as FakeCanvas;
    canvas.getContext = () => null;

    withFakeDom(elements, dom => {
        let result: boolean | undefined;
        quietly(() => {
            result = entrypoint(...IDS);
        });

        assert.equal(result, false);
        assert.equal(dom.intervals.length, 0, "nothing should be scheduled on failure");
    });
});

test("entrypoint still initializes when the optional drag panel is missing", () => {
    withFakeDom(demoElements(['selectionInfoPanel']), dom => {
        let result: boolean | undefined;
        quietly(() => {
            result = entrypoint(...IDS);
        });

        assert.equal(result, true);
        assert.equal(dom.intervals.length, 1);
    });
});

test("entrypoint reports failure when any required element is missing", () => {
    for (const missing of ['body', 'export_canvas_link', 'reset_link', 'selectedNodeInfoLabel', 'selectedNodeInfoList']) {
        withFakeDom(demoElements([missing]), dom => {
            let result: boolean | undefined;
            quietly(() => {
                result = entrypoint(...IDS);
            });

            assert.equal(result, false, `missing ${missing} should fail startup`);
            assert.equal(dom.intervals.length, 0, "nothing should be scheduled on failure");
        });
    }
});

test("UIController no longer looks up the selection info elements by hardcoded ID", () => {
    const source = readSource("UIController.ts");

    assert.ok(!/getElementById/.test(source), "selection-info lookup moved to the entrypoint");
});

test("entrypoint no longer requires the unused Worker feature", () => {
    const source = readSource("entrypoint.ts");

    assert.ok(!/\.Worker\b/.test(source), "entrypoint must not require window.Worker");
    assert.ok(!/unsupportedRequirements/.test(source), "the dead requirement list should be gone");
});
