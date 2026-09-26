import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { Tag } from "../src/Tag";
import { UIController } from "../src/UIController";
import {
    FakeCanvas,
    FakeDom,
    demoElements,
    mouseEvent,
    newUIController,
    withFakeDom,
} from "./support/dom";

interface PanFixture {
    dom: FakeDom;
    canvas: FakeCanvas;
    controller: UIController;
    graph: Graph;
    fdg: ForceDirectedGraph;
    a: Tag;
    b: Tag;
}

/**
 * Two nodes in a 600x600 model mapped onto a 600x600 canvas, so one canvas
 * unit is one model unit.
 */
function withFixture<T>(fn: (ui: PanFixture) => T): T {
    const elements = demoElements();
    const canvas = elements.canvas as FakeCanvas;
    canvas.width = 600;
    canvas.height = 600;

    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0 }, "a");
    const b = new Tag({ x: 100, y: 100 }, "b");
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(a, b);

    return withFakeDom(elements, dom => {
        // The logical size initialize() would have computed; mapping uses it.
        const controller = newUIController(elements, { width: 600, height: 600, graph });

        return fn({ dom, canvas, controller, graph, fdg: controller.solver, a, b });
    });
}

test("middle-drag translates every node by the cursor delta", () => {
    withFixture(({ controller, a, b }) => {
        // Panning is selection-independent: b is selected and still moves.
        b.isSelected = true;

        controller.onMouseDown(mouseEvent({ button: 1, clientX: 100, clientY: 100 }));
        controller.onMouseMove(mouseEvent({ button: 1, clientX: 150, clientY: 120 }));

        // Canvas +x is model +x; canvas +y is model -y (the y axis is flipped).
        assert.equal(a.position.x, 50);
        assert.equal(a.position.y, -20);
        assert.equal(b.position.x, 150);
        assert.equal(b.position.y, 80);
    });
});

test("successive middle moves accumulate the pan", () => {
    withFixture(({ controller, a }) => {
        controller.onMouseDown(mouseEvent({ button: 1, clientX: 100, clientY: 100 }));
        controller.onMouseMove(mouseEvent({ button: 1, clientX: 150, clientY: 120 }));
        controller.onMouseMove(mouseEvent({ button: 1, clientX: 200, clientY: 120 }));

        assert.equal(a.position.x, 100);
        assert.equal(a.position.y, -20);
    });
});

test("the first middle move only anchors the pan and moves nothing", () => {
    withFixture(({ controller, a, b }) => {
        // Simulate a pan already marked down without an anchor.
        controller.state.b1Down = true;

        controller.onMouseMove(mouseEvent({ button: 1, clientX: 400, clientY: 300 }));

        assert.deepEqual({ ...a.position }, { x: 0, y: 0 });
        assert.deepEqual({ ...b.position }, { x: 100, y: 100 });
        assert.deepEqual({ ...controller.state.lastMiddleDragPos }, { x: 400, y: 300 });
    });
});

test("releasing the middle button clears the pan anchor and stops panning", () => {
    withFixture(({ controller, a }) => {
        controller.onMouseDown(mouseEvent({ button: 1, clientX: 100, clientY: 100 }));
        controller.onMouseMove(mouseEvent({ button: 1, clientX: 150, clientY: 120 }));

        const paused = { x: a.position.x, y: a.position.y };

        controller.onMouseUp(mouseEvent({ button: 1, clientX: 150, clientY: 120 }));

        assert.equal(controller.state.b1Down, false);
        assert.equal(controller.state.lastMiddleDragPos, null);

        controller.onMouseMove(mouseEvent({ button: 1, clientX: 300, clientY: 300 }));

        assert.deepEqual({ ...a.position }, paused);
    });
});

test("middle mousedown records the anchor and prevents autoscroll", () => {
    withFixture(({ controller }) => {
        const event = mouseEvent({ button: 1, clientX: 100, clientY: 100 });

        controller.onMouseDown(event);

        assert.equal(controller.state.b1Down, true);
        assert.deepEqual({ ...controller.state.lastMiddleDragPos }, { x: 100, y: 100 });
        assert.equal(event.defaultPrevented, true);
    });
});

test("left-drag still moves only the selected node to the cursor", () => {
    withFixture(({ controller, a, b }) => {
        a.isSelected = true;
        controller.state.b0Down = true;

        controller.onMouseMove(mouseEvent({ button: 0, clientX: 400, clientY: 300 }));

        assert.deepEqual({ ...a.position }, { x: 100, y: 0 });
        assert.deepEqual({ ...b.position }, { x: 100, y: 100 });
    });
});

test("pointer mapping uses the canvas rect, so an offset canvas stays accurate", () => {
    withFixture(({ dom, canvas, controller, a }) => {
        // The canvas sits at (50, 30) in the viewport, and the page reports a
        // scroll offset that the old offsetParent walk added on top.
        canvas.rect = {
            top: 30, left: 50, right: 650, bottom: 630,
            width: 600, height: 600, x: 50, y: 30,
        };
        dom.window.pageXOffset = 999;
        dom.window.pageYOffset = 999;

        a.isSelected = true;
        controller.state.b0Down = true;

        // Client (250, 150) is canvas-local (200, 120), so model (-100, 180)
        // on the 600x600 fixture. The scroll offsets must not be added.
        controller.onMouseMove(mouseEvent({ clientX: 250, clientY: 150 }));

        assert.deepEqual({ ...a.position }, { x: -100, y: 180 });
    });
});

test("a middle move while the left button is up does not follow the node-drag path", () => {
    withFixture(({ controller, a }) => {
        a.isSelected = true;
        controller.state.b0Down = false;
        controller.state.b1Down = true;

        controller.onMouseMove(mouseEvent({ button: 0, clientX: 400, clientY: 300 }));

        // b1Down pans from the anchor; the selected node is not teleported.
        assert.deepEqual({ ...a.position }, { x: 0, y: 0 });
        assert.deepEqual({ ...controller.state.lastMiddleDragPos }, { x: 400, y: 300 });
    });
});

test("mouseout releases every button and the pan anchor", () => {
    withFixture(({ controller }) => {
        controller.state.b0Down = true;
        controller.state.b1Down = true;
        controller.state.b2Down = true;
        controller.state.lastMiddleDragPos = { x: 1, y: 2 };

        controller.onMouseOut();

        assert.equal(controller.state.b0Down, false);
        assert.equal(controller.state.b1Down, false);
        assert.equal(controller.state.b2Down, false);
        assert.equal(controller.state.lastMiddleDragPos, null);
    });
});

test("handlers run on a controller that was never initialized", () => {
    const elements = demoElements();

    withFakeDom(elements, dom => {
        const graph = new Graph();
        graph.addNode(new Tag({ x: 0, y: 0 }, "a"));

        const controller = newUIController(elements, { width: 600, height: 600, graph });

        // initialize() used to install these globals; no handler may still need
        // them, and none may throw on a controller that was never initialized.
        delete dom.window.state;
        delete dom.window.fdg;

        assert.doesNotThrow(() => controller.onMouseOut());
        assert.doesNotThrow(() => controller.panTo({ x: 10, y: 10 }));
        assert.doesNotThrow(() => controller.panTo({ x: 20, y: 20 }));
        assert.doesNotThrow(() => controller.onTimerTick());
    });
});
