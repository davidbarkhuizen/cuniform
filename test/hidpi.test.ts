import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { Tag } from "../src/Tag";
import { UIController } from "../src/UIController";
import { FakeCanvas, FakeContext2D, demoElements, installFakeDom } from "./support/dom";

/** body 750x750 => a 750x750 full-screen logical canvas. */
function setup(dpr: number | undefined) {
    const elements = demoElements();
    const dom = installFakeDom(elements);
    dom.window.devicePixelRatio = dpr;

    const body = elements.body;
    body.clientWidth = 750;
    body.clientHeight = 750;

    const canvas = elements.canvas as FakeCanvas;

    const controller = new UIController(
        body as unknown as HTMLElement,
        canvas as unknown as HTMLCanvasElement,
        canvas.context as unknown as CanvasRenderingContext2D,
        elements.export_canvas_link as unknown as HTMLElement,
        elements.reset_link as unknown as HTMLElement,
        elements.selectedNodeInfoLabel as unknown as HTMLElement,
        elements.selectedNodeInfoList as unknown as HTMLElement
    );

    controller.initialize();

    return { dom, elements, canvas, controller };
}

test("the backing store is scaled by devicePixelRatio while the CSS size stays logical", () => {
    const { dom, canvas, controller } = setup(2);
    try {
        assert.equal(controller.width, 750);
        assert.equal(controller.height, 750);

        assert.equal(canvas.width, 1500);
        assert.equal(canvas.height, 1500);

        assert.equal(canvas.style.width, '750px');
        assert.equal(canvas.style.height, '750px');

        assert.deepEqual(canvas.context.transforms[0], [2, 0, 0, 2, 0, 0]);
    } finally {
        dom.restore();
    }
});

test("a devicePixelRatio of 1 leaves the backing store unscaled", () => {
    const { dom, canvas, controller } = setup(1);
    try {
        assert.equal(canvas.width, 750);
        assert.equal(canvas.height, 750);
        assert.equal(canvas.style.width, '750px');
        assert.deepEqual(canvas.context.transforms[0], [1, 0, 0, 1, 0, 0]);
        assert.equal(controller.width, 750);
    } finally {
        dom.restore();
    }
});

test("a missing devicePixelRatio falls back to 1", () => {
    const { dom, canvas } = setup(undefined);
    try {
        assert.equal(canvas.width, 750);
        assert.deepEqual(canvas.context.transforms[0], [1, 0, 0, 1, 0, 0]);
    } finally {
        dom.restore();
    }
});

test("the canvas fills the viewport rather than a fraction of it", () => {
    const { dom, canvas, controller } = setup(1);

    try {
        // The old layout used body.clientWidth * 0.8 and left 20% of the page
        // for the title and menu rows.
        assert.equal(controller.width, 750);
        assert.equal(controller.height, 750);
        assert.equal(canvas.style.width, '750px');
    } finally {
        dom.restore();
    }
});

test("a window resize re-sizes the backing store to the new viewport", () => {
    const { dom, elements, canvas, controller } = setup(2);

    try {
        elements.body.clientWidth = 1000;
        elements.body.clientHeight = 400;

        const listeners = dom.windowListeners.get('resize') ?? [];
        assert.equal(listeners.length, 1, "initialize should register one resize listener");
        listeners[0]({});

        assert.equal(controller.width, 1000);
        assert.equal(controller.height, 400);

        assert.equal(canvas.width, 2000);
        assert.equal(canvas.height, 800);

        assert.equal(canvas.style.width, '1000px');
        assert.equal(canvas.style.height, '400px');

        const last = canvas.context.transforms[canvas.context.transforms.length - 1];
        assert.deepEqual(last, [2, 0, 0, 2, 0, 0]);
    } finally {
        dom.restore();
    }
});

test("terminate removes the resize listener", () => {
    const { dom, controller } = setup(1);

    try {
        controller.terminate();
        assert.equal((dom.windowListeners.get('resize') ?? []).length, 0);
    } finally {
        dom.restore();
    }
});

test("physics is stepped with the logical size, not the scaled backing store", () => {
    const { dom, controller } = setup(2);
    try {
        const calls: number[][] = [];
        const fdg = dom.window.fdg;

        const realStep = fdg.step.bind(fdg);
        fdg.step = (w: number, h: number, pinned: any) => {
            calls.push([w, h]);
            return realStep(w, h, pinned);
        };

        controller.onTimerTick();

        assert.deepEqual(calls, [[750, 750]]);
    } finally {
        dom.restore();
    }
});

test("pointer mapping is unaffected by devicePixelRatio", () => {
    const { dom, controller } = setup(2);
    try {
        const graph = dom.window.fdg.graph;
        graph.vertices.forEach((v: Tag) => { v.isSelected = false; });

        const node: Tag = graph.vertices[0];
        node.isSelected = true;
        dom.window.state.b0Down = true;

        // A 750x750 canvas over the 600x600 model scales by 1.25, so the canvas
        // CSS point (450, 300) maps to model (60, 60).
        controller.onMouseMove({
            button: 0,
            clientX: 450,
            clientY: 300,
            preventDefault: () => {},
        } as unknown as MouseEvent);

        assert.deepEqual({ ...node.position }, { x: 60, y: 60 });
    } finally {
        dom.restore();
    }
});

test("render clears the whole backing store in device space", () => {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0 }, "a");
    graph.addNode(a);

    const fdg = new ForceDirectedGraph(graph);
    const context = new FakeContext2D();
    context.canvas = { width: 1200, height: 900 };

    fdg.render(context as unknown as CanvasRenderingContext2D);

    assert.deepEqual(context.transforms[0], [1, 0, 0, 1, 0, 0]);
    assert.deepEqual(context.clears[0], [0, 0, 1200, 900]);
});
