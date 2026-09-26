import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { Tag } from "../src/Tag";
import { UIController } from "../src/UIController";
import { FakeCanvas, FakeContext2D, demoElements, installFakeDom } from "./support/dom";

/** body 750x750 * 0.8 => a 600x600 logical canvas. */
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
        assert.equal(controller.width, 600);
        assert.equal(controller.height, 600);

        assert.equal(canvas.width, 1200);
        assert.equal(canvas.height, 1200);

        assert.equal(canvas.style.width, '600px');
        assert.equal(canvas.style.height, '600px');

        assert.deepEqual(canvas.context.transforms[0], [2, 0, 0, 2, 0, 0]);
    } finally {
        dom.restore();
    }
});

test("a devicePixelRatio of 1 leaves the backing store unscaled", () => {
    const { dom, canvas, controller } = setup(1);
    try {
        assert.equal(canvas.width, 600);
        assert.equal(canvas.height, 600);
        assert.equal(canvas.style.width, '600px');
        assert.deepEqual(canvas.context.transforms[0], [1, 0, 0, 1, 0, 0]);
        assert.equal(controller.width, 600);
    } finally {
        dom.restore();
    }
});

test("a missing devicePixelRatio falls back to 1", () => {
    const { dom, canvas } = setup(undefined);
    try {
        assert.equal(canvas.width, 600);
        assert.deepEqual(canvas.context.transforms[0], [1, 0, 0, 1, 0, 0]);
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

        assert.deepEqual(calls, [[600, 600]]);
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

        // Canvas CSS point (450, 300) maps to model (150, 0) in a 600x600 world.
        controller.onMouseMove({
            button: 0,
            clientX: 450,
            clientY: 300,
            preventDefault: () => {},
        } as unknown as MouseEvent);

        assert.deepEqual({ ...node.position }, { x: 150, y: 0 });
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
