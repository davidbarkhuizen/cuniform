import test, { mock } from "node:test";
import assert from "node:assert/strict";

import { Camera } from "../src/view/Camera";
import { Graph } from "../src/graph/Graph";
import { K } from "../src/core/K";
import { Tag } from "../src/graph/Tag";
import { mouseEvent, touchEvent, UIControllerFixture, withUIController } from "./support/dom";

// Two nodes far apart, so the canvas has both a node to press and empty space to press.
function twoNodes(): { graph: Graph; a: Tag; b: Tag } {
    const graph = new Graph();
    const a = new Tag({ x: -100, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 100, y: 0, z: 0 }, "b");

    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(a, b);

    return { graph, a, b };
}

function canvasPos(ui: UIControllerFixture, tag: Tag): { x: number; y: number } {
    return ui.controller.projector().toCanvas(tag.position);
}

function withTouch<T>(fn: (ui: UIControllerFixture, nodes: { a: Tag; b: Tag }) => T): T {
    const { graph, a, b } = twoNodes();

    return withUIController(ui => {
        try {
            return fn(ui, { a, b });
        } finally {
            ui.controller.terminate();
        }
    }, { graph });
}

const down = (ui: UIControllerFixture, id: number, x: number, y: number) => ui.canvas.dispatch("pointerdown", touchEvent(id, x, y));
const move = (ui: UIControllerFixture, id: number, x: number, y: number) => ui.canvas.dispatch("pointermove", touchEvent(id, x, y));
const up = (ui: UIControllerFixture, id: number, x: number, y: number) => ui.canvas.dispatch("pointerup", touchEvent(id, x, y));

// An empty point well away from both nodes.
const EMPTY = { x: 400, y: 80 };

test("the canvas opts out of browser touch gestures", () => {
    withTouch(ui => {
        assert.equal(ui.canvas.style.touchAction, "none");
    });
});

test("one finger on a node selects it and drags it", () => {
    withTouch((ui, { a }) => {
        const at = canvasPos(ui, a);

        down(ui, 1, at.x, at.y);

        assert.equal(a.isSelected, true);
        assert.equal(ui.controller.state.b0Down, true, "the node is pinned while held");

        move(ui, 1, at.x + 40, at.y + 30);

        const now = canvasPos(ui, a);
        assert.ok(Math.abs(now.x - (at.x + 40)) < 1e-6 && Math.abs(now.y - (at.y + 30)) < 1e-6, "the node follows the finger");

        up(ui, 1, at.x + 40, at.y + 30);

        assert.equal(ui.controller.state.b0Down, false);
        assert.equal(a.isSelected, true, "lifting keeps the selection");
    });
});

test("a tap on empty canvas clears the selection", () => {
    withTouch((ui, { a }) => {
        const at = canvasPos(ui, a);

        down(ui, 1, at.x, at.y);
        up(ui, 1, at.x, at.y);
        assert.equal(a.isSelected, true);

        down(ui, 1, EMPTY.x, EMPTY.y);
        up(ui, 1, EMPTY.x + 3, EMPTY.y);

        assert.equal(a.isSelected, false);
    });
});

test("one finger dragged on empty canvas orbits and keeps the selection", () => {
    withTouch((ui, { a }) => {
        const at = canvasPos(ui, a);
        down(ui, 1, at.x, at.y);
        up(ui, 1, at.x, at.y);

        const before = [...ui.controller.state.camera.orientation];

        down(ui, 1, EMPTY.x, EMPTY.y);
        move(ui, 1, EMPTY.x + 60, EMPTY.y + 20);
        up(ui, 1, EMPTY.x + 60, EMPTY.y + 20);

        assert.notDeepEqual([...ui.controller.state.camera.orientation], before, "the camera orbited");
        assert.equal(a.isSelected, true, "an orbit is not a tap, so the selection stays");
    });
});

test("a pinch apart dollies in, together dollies out, within the clamp", () => {
    withTouch(ui => {
        const camera = ui.controller.state.camera;
        const start = camera.distance;

        down(ui, 1, 300, 300);
        down(ui, 2, 400, 300);
        move(ui, 2, 500, 300);

        assert.ok(Math.abs(camera.distance - start / 2) < 1e-9, "doubling the spread halves the distance");

        move(ui, 2, 350, 300);
        assert.ok(camera.distance > start, "pinching together moves away");

        move(ui, 2, 300.01, 300);
        assert.equal(camera.distance, K.camera.maxDistance, "the dolly clamp holds");
    });
});

test("a two-finger drag pans the camera target", () => {
    withTouch(ui => {
        const target = ui.controller.state.camera.target;
        const before = { ...target };

        down(ui, 1, 300, 300);
        down(ui, 2, 400, 300);
        move(ui, 1, 350, 360);
        move(ui, 2, 450, 360);

        assert.notDeepEqual({ ...target }, before, "the target moved with the fingers' centroid");
    });
});

test("a second finger cancels a node drag, and a pinch never decays into an orbit", () => {
    withTouch((ui, { a }) => {
        const at = canvasPos(ui, a);

        down(ui, 1, at.x, at.y);
        down(ui, 2, at.x + 100, at.y);

        assert.equal(ui.controller.state.b0Down, false, "the pin is released");
        assert.equal(ui.controller.state.touchMode, "pinch");

        up(ui, 2, at.x + 100, at.y);

        const before = [...ui.controller.state.camera.orientation];
        move(ui, 1, at.x + 80, at.y + 80);

        assert.deepEqual([...ui.controller.state.camera.orientation], before, "the remaining finger does nothing");
        assert.equal(ui.controller.state.touchMode, "none");
    });
});

test("a still long press opens the actions menu; moving first does not", () => {
    mock.timers.enable({ apis: ["setTimeout"] });

    try {
        withTouch(ui => {
            down(ui, 1, EMPTY.x, EMPTY.y);
            mock.timers.tick(K.ui.longPressMS - 1);
            assert.equal(ui.controller.contextMenu!.isOpen, false);

            mock.timers.tick(1);
            assert.equal(ui.controller.contextMenu!.isOpen, true);

            up(ui, 1, EMPTY.x, EMPTY.y);
            ui.controller.hideContextMenu();

            down(ui, 1, EMPTY.x, EMPTY.y);
            move(ui, 1, EMPTY.x + K.ui.touchSlopPx, EMPTY.y);
            mock.timers.tick(K.ui.longPressMS);

            assert.equal(ui.controller.contextMenu!.isOpen, false, "a moved finger is an orbit, not a long press");
        });
    } finally {
        mock.timers.reset();
    }
});

test("terminate cancels a pending long press", () => {
    mock.timers.enable({ apis: ["setTimeout"] });

    try {
        const { graph } = twoNodes();

        withUIController(ui => {
            down(ui, 1, EMPTY.x, EMPTY.y);
            const menu = ui.controller.contextMenu!;

            ui.controller.terminate();
            mock.timers.tick(K.ui.longPressMS * 2);

            assert.equal(menu.isOpen, false);
        }, { graph });
    } finally {
        mock.timers.reset();
    }
});

test("a lifted finger's pointerout does not reset the gesture, a mouse leaving does", () => {
    withTouch((ui, { a }) => {
        const at = canvasPos(ui, a);

        down(ui, 1, at.x, at.y);
        ui.canvas.dispatch("pointerout", touchEvent(1, at.x, at.y));
        assert.equal(ui.controller.state.b0Down, true);
        up(ui, 1, at.x, at.y);

        ui.canvas.dispatch("pointerdown", mouseEvent({ button: 0, clientX: at.x, clientY: at.y }));
        assert.equal(ui.controller.state.b0Down, true, "a mouse press takes the mouse path");

        ui.canvas.dispatch("pointerout", mouseEvent({ clientX: at.x, clientY: at.y }));
        assert.equal(ui.controller.state.b0Down, false);
    });
});

test("state.reset() forgets every touch", () => {
    withTouch(ui => {
        down(ui, 1, 300, 300);
        down(ui, 2, 400, 300);

        ui.controller.state.reset();

        assert.equal(ui.controller.state.touches.size, 0);
        assert.equal(ui.controller.state.touchMode, "none");
    });
});

test("dollyBy shares the wheel's clamp, and dolly(n) is dollyBy(step^n)", () => {
    const wheel = new Camera();
    const pinch = new Camera();

    wheel.dolly(3);
    pinch.dollyBy(Math.pow(K.camera.dollyPerWheelNotch, 3));
    assert.equal(pinch.distance, wheel.distance);

    const before = pinch.distance;
    pinch.dollyBy(0);
    pinch.dollyBy(-2);
    pinch.dollyBy(NaN);
    assert.equal(pinch.distance, before, "a degenerate factor changes nothing");

    pinch.dollyBy(1e-9);
    assert.equal(pinch.distance, K.camera.minDistance);
});
