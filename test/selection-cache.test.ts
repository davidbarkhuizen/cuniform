import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { Tag } from "../src/Tag";
import { mouseEvent, poisonSelection, withUIController } from "./support/dom";

const NODE_DEFAULT = K.colours.nodeDefault;
const NODE_SELECTED = K.colours.nodeSelected;

/** This suite's poison message: the scan would be by the controller's frame. */
const NO_RESCAN = "the controller must not rescan for the selection";

/**
 * The controller caches the selection so neither the pin decision nor the frame
 * rescans the graph. These tests prove the cache is what is used: after a real
 * click refreshes it, `graph.selectedVertex()` is replaced with a thrower, so a
 * regression to a per-frame scan fails loudly.
 */

// body 800x600 => an 800x600 logical canvas; the 600 model cube scales 1:1 and
// the model origin lands on canvas (400, 300).
function twoNodes(): { graph: Graph; a: Tag; b: Tag } {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 100, y: 0, z: 0 }, "b");
    graph.addNode(a);
    graph.addNode(b);

    return { graph, a, b };
}

test("the cached selection drives the frame without rescanning the graph", () => {
    const { graph, a } = twoNodes();

    withUIController(ui => {
        // An actual click, at the canvas point the origin projects to.
        ui.controller.onMouseDown(mouseEvent({ button: 0, clientX: 400, clientY: 300 }));
        ui.controller.onMouseUp(mouseEvent({ button: 0 }));

        assert.equal(a.isSelected, true, "the click must select the origin node");

        poisonSelection(graph, NO_RESCAN);

        const before = ui.canvas.context.fills.length;

        assert.doesNotThrow(() => ui.controller.onTimerTick());

        assert.deepEqual(
            ui.canvas.context.fills.slice(before),
            [NODE_SELECTED, NODE_DEFAULT],
            "the selected fill must come from the cache"
        );
    }, { graph });
});

test("clearSelection refreshes the cache to null", () => {
    const { graph, a } = twoNodes();

    withUIController(ui => {
        ui.controller.onMouseDown(mouseEvent({ button: 0, clientX: 400, clientY: 300 }));
        ui.controller.onMouseUp(mouseEvent({ button: 0 }));
        assert.equal(a.isSelected, true);

        ui.controller.clearSelection();
        assert.equal(graph.selectedVertex(), null);

        poisonSelection(graph, NO_RESCAN);

        const before = ui.canvas.context.fills.length;

        assert.doesNotThrow(() => ui.controller.onTimerTick());

        assert.deepEqual(
            ui.canvas.context.fills.slice(before),
            [NODE_DEFAULT, NODE_DEFAULT],
            "a cleared selection must not keep the selected fill"
        );
    }, { graph });
});

test("loadGraph refreshes the cache to null for the new graph", () => {
    const first = twoNodes();

    withUIController(ui => {
        ui.controller.onMouseDown(mouseEvent({ button: 0, clientX: 400, clientY: 300 }));
        ui.controller.onMouseUp(mouseEvent({ button: 0 }));
        assert.equal(first.a.isSelected, true);

        const replacement = twoNodes();
        ui.controller.loadGraph(replacement.graph);

        poisonSelection(replacement.graph, NO_RESCAN);

        const before = ui.canvas.context.fills.length;

        assert.doesNotThrow(() => ui.controller.onTimerTick());

        assert.deepEqual(
            ui.canvas.context.fills.slice(before),
            [NODE_DEFAULT, NODE_DEFAULT],
            "a fresh graph must never inherit the previous selection"
        );
    }, { graph: first.graph });
});

test("dragging pins the cached selection", () => {
    const { graph, b } = twoNodes();

    withUIController(ui => {
        // Select `b` (canvas x = 500).
        ui.controller.onMouseDown(mouseEvent({ button: 0, clientX: 500, clientY: 300 }));
        assert.equal(b.isSelected, true);

        // Left button still down: the next tick must pin the cached node.
        assert.equal(ui.controller.state.b0Down, true);

        const pinnedIndices: number[] = [];
        const runner = ui.controller.runner;
        const realStep = runner.step.bind(runner);

        runner.step = (pinnedIndex: number, x: number, y: number, z: number) => {
            pinnedIndices.push(pinnedIndex);
            realStep(pinnedIndex, x, y, z);
        };

        poisonSelection(graph, NO_RESCAN);

        assert.doesNotThrow(() => ui.controller.onTimerTick());

        assert.deepEqual(pinnedIndices, [graph.vertices.indexOf(b)]);
        assert.ok(pinnedIndices[0] >= 0, "the selected node must be pinned by index");
    }, { graph });
});
