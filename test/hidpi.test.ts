import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { defaultCameraView } from "../src/Projector";
import { render } from "../src/Renderer";
import { Tag } from "../src/Tag";
import {
    FakeContext2D,
    UIControllerFixture,
    mouseEvent,
    withUIController,
} from "./support/dom";

// body 750x750 => a 750x750 full-screen logical canvas.
function withController<T>(dpr: number | undefined, fn: (ui: UIControllerFixture) => T): T {
    return withUIController(fn, {
        devicePixelRatio: dpr,
        bodyWidth: 750,
        bodyHeight: 750,
    });
}

test("the backing store is scaled by devicePixelRatio while the CSS size stays logical", () => {
    withController(2, ({ canvas, controller }) => {
        assert.equal(controller.width, 750);
        assert.equal(controller.height, 750);

        assert.equal(canvas.width, 1500);
        assert.equal(canvas.height, 1500);

        assert.equal(canvas.style.width, '750px');
        assert.equal(canvas.style.height, '750px');

        assert.deepEqual(canvas.context.transforms[0], [2, 0, 0, 2, 0, 0]);
    });
});

test("a devicePixelRatio of 1 leaves the backing store unscaled", () => {
    withController(1, ({ canvas, controller }) => {
        assert.equal(canvas.width, 750);
        assert.equal(canvas.height, 750);
        assert.equal(canvas.style.width, '750px');
        assert.deepEqual(canvas.context.transforms[0], [1, 0, 0, 1, 0, 0]);
        assert.equal(controller.width, 750);
    });
});

test("a missing devicePixelRatio falls back to 1", () => {
    withController(undefined, ({ canvas }) => {
        assert.equal(canvas.width, 750);
        assert.deepEqual(canvas.context.transforms[0], [1, 0, 0, 1, 0, 0]);
    });
});

test("the canvas fills the viewport rather than a fraction of it", () => {
    withController(1, ({ canvas, controller }) => {
        assert.equal(controller.width, 750);
        assert.equal(controller.height, 750);
        assert.equal(canvas.style.width, '750px');
    });
});

test("a window resize re-sizes the backing store to the new viewport", () => {
    withController(2, ({ dom, elements, canvas, controller }) => {
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
    });
});

test("terminate removes the resize listener", () => {
    withController(1, ({ dom, controller }) => {
        controller.terminate();
        assert.equal((dom.windowListeners.get('resize') ?? []).length, 0);
    });
});

test("physics is stepped with the logical size, not the scaled backing store", () => {
    withController(2, ({ controller }) => {
        const viewports: number[][] = [];
        const fdg = controller.solver;

        // Physics no longer takes a canvas size; the logical size reaches the
        // frame through the projector, which is what caches the view.
        const realProject = fdg.project.bind(fdg);
        fdg.project = (projector: any) => {
            viewports.push([projector.viewport.w1, projector.viewport.h1]);
            return realProject(projector);
        };

        controller.onTimerTick();

        assert.deepEqual(viewports, [[750, 750]]);
    });
});

test("pointer mapping is unaffected by devicePixelRatio", () => {
    withController(2, ({ controller }) => {
        const graph = controller.solver.graph;
        graph.vertices.forEach((v: Tag) => { v.isSelected = false; });

        const node: Tag = graph.vertices[0];
        node.isSelected = true;
        // A visible node, as step() would have cached, so the drag slides on its z = 0 plane.
        node.depth = K.camera.distance;
        controller.state.b0Down = true;

        // 750x750 canvas over the 600x600 model scales by 1.25: (450, 300) -> (60, 60).
        controller.onMouseMove(mouseEvent({ clientX: 450, clientY: 300 }));

        assert.deepEqual({ ...node.position }, { x: 60, y: 60, z: 0 });
    });
});

test("render clears the whole backing store in device space", () => {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    graph.addNode(a);

    const context = new FakeContext2D();
    context.canvas = { width: 1200, height: 900 };

    render(context, graph, defaultCameraView(), graph.selectedVertex());

    assert.deepEqual(context.transforms[0], [1, 0, 0, 1, 0, 0]);
    assert.deepEqual(context.clears[0], [0, 0, 1200, 900]);
});
