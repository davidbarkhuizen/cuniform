import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { State } from "../src/State";
import { Tag } from "../src/Tag";
import { UIController } from "../src/UIController";
import { FakeCanvas, demoElements, installFakeDom } from "./support/dom";

function mouseEvent(button: number, clientX: number, clientY: number): MouseEvent {
    return {
        button,
        clientX,
        clientY,
        preventDefault: () => {},
    } as unknown as MouseEvent;
}

/**
 * Two nodes in a 600x600 model mapped onto a 600x600 canvas, so one canvas
 * unit is one model unit.
 */
function setup() {
    const elements = demoElements();
    const dom = installFakeDom(elements);
    const canvas = elements.canvas as FakeCanvas;
    canvas.width = 600;
    canvas.height = 600;

    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0 }, "a");
    const b = new Tag({ x: 100, y: 100 }, "b");
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(a, b);

    const fdg = new ForceDirectedGraph(graph);
    dom.window.state = new State();
    dom.window.fdg = fdg;

    const controller = new UIController(
        elements.body as unknown as HTMLElement,
        canvas as unknown as HTMLCanvasElement,
        canvas.context as unknown as CanvasRenderingContext2D,
        elements.export_canvas_link as unknown as HTMLElement,
        elements.reset_link as unknown as HTMLElement
    );

    // The logical size initialize() would have computed; mapping uses it.
    controller.width = 600;
    controller.height = 600;

    return { dom, canvas, controller, graph, fdg, a, b };
}

test("middle-drag translates every node by the cursor delta", () => {
    const { dom, controller, a, b } = setup();
    try {
        // Panning is selection-independent: b is selected and still moves.
        b.isSelected = true;

        controller.onMouseDown(mouseEvent(1, 100, 100));
        controller.onMouseMove(mouseEvent(1, 150, 120));

        // Canvas +x is model +x; canvas +y is model -y (the y axis is flipped).
        assert.equal(a.position.x, 50);
        assert.equal(a.position.y, -20);
        assert.equal(b.position.x, 150);
        assert.equal(b.position.y, 80);
    } finally {
        dom.restore();
    }
});

test("successive middle moves accumulate the pan", () => {
    const { dom, controller, a } = setup();
    try {
        controller.onMouseDown(mouseEvent(1, 100, 100));
        controller.onMouseMove(mouseEvent(1, 150, 120));
        controller.onMouseMove(mouseEvent(1, 200, 120));

        assert.equal(a.position.x, 100);
        assert.equal(a.position.y, -20);
    } finally {
        dom.restore();
    }
});

test("the first middle move only anchors the pan and moves nothing", () => {
    const { dom, controller, a, b } = setup();
    try {
        // Simulate a pan already marked down without an anchor.
        dom.window.state.b1Down = true;

        controller.onMouseMove(mouseEvent(1, 400, 300));

        assert.deepEqual({ ...a.position }, { x: 0, y: 0 });
        assert.deepEqual({ ...b.position }, { x: 100, y: 100 });
        assert.deepEqual({ ...dom.window.state.lastMiddleDragPos }, { x: 400, y: 300 });
    } finally {
        dom.restore();
    }
});

test("releasing the middle button clears the pan anchor and stops panning", () => {
    const { dom, controller, a } = setup();
    try {
        controller.onMouseDown(mouseEvent(1, 100, 100));
        controller.onMouseMove(mouseEvent(1, 150, 120));

        const paused = { x: a.position.x, y: a.position.y };

        controller.onMouseUp(mouseEvent(1, 150, 120));

        assert.equal(dom.window.state.b1Down, false);
        assert.equal(dom.window.state.lastMiddleDragPos, null);

        controller.onMouseMove(mouseEvent(1, 300, 300));

        assert.deepEqual({ ...a.position }, paused);
    } finally {
        dom.restore();
    }
});

test("middle mousedown records the anchor and prevents autoscroll", () => {
    const { dom, controller } = setup();
    try {
        let prevented = false;
        const event = {
            button: 1,
            clientX: 100,
            clientY: 100,
            preventDefault: () => { prevented = true; },
        } as unknown as MouseEvent;

        controller.onMouseDown(event);

        assert.equal(dom.window.state.b1Down, true);
        assert.deepEqual({ ...dom.window.state.lastMiddleDragPos }, { x: 100, y: 100 });
        assert.equal(prevented, true);
    } finally {
        dom.restore();
    }
});

test("left-drag still moves only the selected node to the cursor", () => {
    const { dom, controller, a, b } = setup();
    try {
        a.isSelected = true;
        dom.window.state.b0Down = true;

        controller.onMouseMove(mouseEvent(0, 400, 300));

        assert.deepEqual({ ...a.position }, { x: 100, y: 0 });
        assert.deepEqual({ ...b.position }, { x: 100, y: 100 });
    } finally {
        dom.restore();
    }
});

test("a middle move while the left button is up does not follow the node-drag path", () => {
    const { dom, controller, a } = setup();
    try {
        a.isSelected = true;
        dom.window.state.b0Down = false;
        dom.window.state.b1Down = true;

        controller.onMouseMove(mouseEvent(0, 400, 300));

        // b1Down pans from the anchor; the selected node is not teleported.
        assert.deepEqual({ ...a.position }, { x: 0, y: 0 });
        assert.deepEqual({ ...dom.window.state.lastMiddleDragPos }, { x: 400, y: 300 });
    } finally {
        dom.restore();
    }
});

test("mouseout releases every button and the pan anchor", () => {
    const { dom, controller } = setup();
    try {
        dom.window.state.b0Down = true;
        dom.window.state.b1Down = true;
        dom.window.state.b2Down = true;
        dom.window.state.lastMiddleDragPos = { x: 1, y: 2 };

        controller.onMouseOut();

        assert.equal(dom.window.state.b0Down, false);
        assert.equal(dom.window.state.b1Down, false);
        assert.equal(dom.window.state.b2Down, false);
        assert.equal(dom.window.state.lastMiddleDragPos, null);
    } finally {
        dom.restore();
    }
});
