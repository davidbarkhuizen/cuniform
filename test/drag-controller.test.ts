import test from "node:test";
import assert from "node:assert/strict";

import { DragController } from "../src/DragController";
import { FakeElement, pointerEvent } from "./support/dom";

/** Panel at (150, 100) inside a parent at (50, 30). */
function panelInParent() {
    const parent = new FakeElement('DIV');
    parent.rect = { top: 30, left: 50, right: 1050, bottom: 830, width: 1000, height: 800, x: 50, y: 30 };

    const panel = new FakeElement('DIV');
    panel.parentElement = parent;
    panel.rect = { top: 100, left: 150, right: 450, bottom: 500, width: 300, height: 400, x: 150, y: 100 };

    const controller = new DragController(panel as unknown as HTMLElement);

    return { parent, panel, controller };
}

test("a panel drag writes a valid px offset, not the literal interpolation text", () => {
    const { panel, controller } = panelInParent();

    controller.onPointerDown(pointerEvent({ clientX: 1000, clientY: 500 }));
    // The panel starts at (left 100, top 70) within its parent; add the
    // +40 x, +30 y drag delta.
    controller.onPointerMove(pointerEvent({ clientX: 1040, clientY: 530 }));
    controller.onPointerUp(pointerEvent({}));

    assert.equal(panel.style.top, '100px');
    assert.equal(panel.style.left, '140px');

    // Regression: the old code produced "$(this.dragY + this.startTop)".
    for (const value of [panel.style.top, panel.style.left]) {
        assert.ok(!value.includes('$('), `still interpolating: ${value}`);
        assert.ok(/^\d+px$/.test(value), `not a px length: ${value}`);
    }
});

test("the panel follows the pointer during the drag, not only on release", () => {
    const { panel, controller } = panelInParent();

    controller.onPointerDown(pointerEvent({ clientX: 200, clientY: 200 }));
    controller.onPointerMove(pointerEvent({ clientX: 260, clientY: 240 }));

    // Still mid-drag: the panel must already be at the new position.
    assert.equal(panel.style.left, '160px');
    assert.equal(panel.style.top, '110px');

    // Releasing keeps the position the pointer wrote.
    controller.onPointerUp(pointerEvent({}));
    assert.equal(panel.style.left, '160px');
    assert.equal(panel.style.top, '110px');
});

test("drag deltas are measured from the drag start, across several moves", () => {
    const { panel, controller } = panelInParent();

    controller.onPointerDown(pointerEvent({ clientX: 200, clientY: 200 }));
    controller.onPointerMove(pointerEvent({ clientX: 220, clientY: 210 }));
    controller.onPointerMove(pointerEvent({ clientX: 300, clientY: 260 }));
    controller.onPointerUp(pointerEvent({}));

    assert.equal(panel.style.left, '200px');
    assert.equal(panel.style.top, '130px');
});

test("deltas reset after a drag ends, so the next drag is not cumulative", () => {
    const { panel, controller } = panelInParent();

    controller.onPointerDown(pointerEvent({ clientX: 200, clientY: 200 }));
    controller.onPointerMove(pointerEvent({ clientX: 260, clientY: 240 }));
    controller.onPointerUp(pointerEvent({}));

    assert.equal(controller.dragX, 0);
    assert.equal(controller.dragY, 0);

    // A second drag moves by its own delta only; the first drag's +60/+40
    // must not carry over.
    controller.onPointerDown(pointerEvent({ clientX: 200, clientY: 200 }));
    controller.onPointerMove(pointerEvent({ clientX: 210, clientY: 205 }));
    controller.onPointerUp(pointerEvent({}));

    assert.equal(panel.style.left, '110px');
    assert.equal(panel.style.top, '75px');
});

test("a pointer move without a pointerdown is ignored", () => {
    const { panel, controller } = panelInParent();

    controller.onPointerMove(pointerEvent({ clientX: 500, clientY: 500 }));

    assert.equal(panel.style.left, undefined);
    assert.equal(controller.dragX, 0);
});

test("a second pointer cannot hijack an in-progress drag", () => {
    const { panel, controller } = panelInParent();

    controller.onPointerDown(pointerEvent({ pointerId: 1, clientX: 200, clientY: 200 }));
    controller.onPointerMove(pointerEvent({ pointerId: 2, clientX: 500, clientY: 500 }));

    assert.equal(panel.style.left, undefined, "the second finger must not move the panel");

    controller.onPointerMove(pointerEvent({ pointerId: 1, clientX: 220, clientY: 210 }));
    assert.equal(panel.style.left, '120px');
    assert.equal(panel.style.top, '80px');
});

test("only the primary button starts a drag", () => {
    const { panel, controller } = panelInParent();

    controller.onPointerDown(pointerEvent({ button: 2, clientX: 200, clientY: 200 }));
    controller.onPointerMove(pointerEvent({ clientX: 260, clientY: 240 }));

    assert.equal(panel.style.left, undefined);
});

test("a parentless panel still produces a px position instead of throwing", () => {
    const panel = new FakeElement('DIV');
    panel.rect = { top: 100, left: 150, right: 450, bottom: 500, width: 300, height: 400, x: 150, y: 100 };

    const controller = new DragController(panel as unknown as HTMLElement);
    controller.onPointerDown(pointerEvent({ clientX: 200, clientY: 200 }));
    controller.onPointerMove(pointerEvent({ clientX: 230, clientY: 220 }));
    controller.onPointerUp(pointerEvent({}));

    assert.equal(panel.style.left, '30px');
    assert.equal(panel.style.top, '20px');
});

test("the panel listens for pointer events and disables touch panning", () => {
    const { panel } = panelInParent();

    assert.equal(panel.style.touchAction, 'none');
    assert.equal(panel.style.userSelect, 'none');
    assert.equal(panel.draggable, false);

    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
        assert.equal(panel.listenerCount(type), 1, `panel should listen for ${type} once`);
});

test("the pointer is captured on pointerdown and released on pointerup", () => {
    const { panel, controller } = panelInParent();

    controller.onPointerDown(pointerEvent({ pointerId: 7, clientX: 200, clientY: 200 }));
    assert.equal(panel.hasPointerCapture(7), true, "the drag should capture its pointer");

    controller.onPointerUp(pointerEvent({ pointerId: 7 }));
    assert.equal(panel.hasPointerCapture(7), false, "the capture should be released");
});
