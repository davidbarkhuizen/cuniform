import test from "node:test";
import assert from "node:assert/strict";

import { DragController } from "../src/ui/DragController";
import { FakeElement, FakeRect, pointerEvent } from "./support/dom";

// The demo panel's geometry: a 300x400 panel at (150, 100) inside a 1000x800
// parent at (50, 30). The drag reads both rects.
const PARENT_RECT: FakeRect = { top: 30, left: 50, right: 1050, bottom: 830, width: 1000, height: 800, x: 50, y: 30 };

/** The shared parent/panel pair, before any controller is built over it. */
function panelIn(parentRect: FakeRect) {
    const parent = new FakeElement('DIV');
    parent.rect = parentRect;

    const panel = new FakeElement('DIV');
    panel.parentElement = parent;
    panel.rect = { top: 100, left: 150, right: 450, bottom: 500, width: 300, height: 400, x: 150, y: 100 };

    return { parent, panel };
}

/** Panel at (150, 100) inside a parent at (50, 30). */
function panelInParent() {
    const { parent, panel } = panelIn(PARENT_RECT);

    const controller = new DragController(panel as unknown as HTMLElement);

    return { parent, panel, controller };
}

test("a panel drag writes a valid px offset, not the literal interpolation text", () => {
    const { panel, controller } = panelInParent();

    controller.onPointerDown(pointerEvent({ clientX: 1000, clientY: 500 }));
    // Panel starts at (left 100, top 70) within its parent, plus a +40 x, +30 y drag delta.
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

    assert.equal(panel.style.left, '160px');
    assert.equal(panel.style.top, '110px');

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

    // The second drag moves by its own delta only; the first +60/+40 must not carry over.
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

// ------------------------------------------------------- controls in the panel

/** A control of `tagName` nested in the panel, as the real menu is. */
function controlIn(panel: FakeElement, tagName: string): FakeElement {
    const group = new FakeElement('DIV');
    group.parentElement = panel;

    const control = new FakeElement(tagName);
    control.parentElement = group;

    return control;
}

test("a press on a link inside the panel does not start a drag", () => {
    // Regression: capturing the pointer retargets the click to the panel, so the reset/export links silently do nothing.
    const { panel, controller } = panelInParent();
    const link = controlIn(panel, 'A');

    panel.dispatch('pointerdown', pointerEvent({ target: link, pointerId: 9, clientX: 200, clientY: 200 }));
    panel.dispatch('pointermove', pointerEvent({ target: link, pointerId: 9, clientX: 260, clientY: 240 }));

    assert.equal(panel.hasPointerCapture(9), false, "the link's pointer must not be captured");
    assert.equal(panel.style.left, undefined, "the panel must not move");
    assert.equal(controller.dragX, 0);
});

test("a press on a button inside the panel does not start a drag", () => {
    // The camera console's buttons own their press the same way.
    const { panel, controller } = panelInParent();
    const button = controlIn(panel, 'BUTTON');

    panel.dispatch('pointerdown', pointerEvent({ target: button, pointerId: 4, clientX: 200, clientY: 200 }));
    panel.dispatch('pointermove', pointerEvent({ target: button, pointerId: 4, clientX: 300, clientY: 300 }));

    assert.equal(panel.hasPointerCapture(4), false);
    assert.equal(controller.dragX, 0);
});

test("a press deep inside a control still counts as the control's", () => {
    const { panel } = panelInParent();
    const link = controlIn(panel, 'A');

    const caption = new FakeElement('SPAN');
    caption.parentElement = link;

    panel.dispatch('pointerdown', pointerEvent({ target: caption, pointerId: 11, clientX: 200, clientY: 200 }));

    assert.equal(panel.hasPointerCapture(11), false, "the ancestor chain must be walked");
});

test("a press on a non-interactive part of the panel still drags", () => {
    const { panel } = panelInParent();
    const caption = controlIn(panel, 'SPAN');

    panel.dispatch('pointerdown', pointerEvent({ target: caption, pointerId: 12, clientX: 200, clientY: 200 }));
    panel.dispatch('pointermove', pointerEvent({ target: caption, pointerId: 12, clientX: 260, clientY: 240 }));

    assert.equal(panel.hasPointerCapture(12), true);
    assert.equal(panel.style.left, '160px');
    assert.equal(panel.style.top, '110px');
});

test("a press on the panel itself still drags", () => {
    const { panel } = panelInParent();

    panel.dispatch('pointerdown', pointerEvent({ target: panel, pointerId: 13, clientX: 200, clientY: 200 }));

    assert.equal(panel.hasPointerCapture(13), true);
});

// ------------------------------------------------------------- touch handle

/** The panel plus a grip at its top, built as the demo entrypoint builds it. */
function panelWithHandle() {
    const { panel } = panelIn(PARENT_RECT);

    const handle = new FakeElement('DIV');
    handle.parentElement = panel;

    const controller = new DragController(
        panel as unknown as HTMLElement,
        handle as unknown as HTMLElement
    );

    return { panel, handle, controller };
}

test("a handle scopes touch-action to the grip, leaving the panel scrollable", () => {
    const { panel, handle } = panelWithHandle();

    assert.equal(handle.style.touchAction, 'none', "the grip owns the touch drag");
    assert.notEqual(panel.style.touchAction, 'none', "the panel body must stay touch-scrollable");
    assert.equal(panel.style.userSelect, 'none');
});

test("a touch on the grip drags the panel", () => {
    const { panel, handle } = panelWithHandle();

    panel.dispatch('pointerdown', pointerEvent({ target: handle, pointerType: 'touch', pointerId: 21, clientX: 200, clientY: 200 }));
    panel.dispatch('pointermove', pointerEvent({ target: handle, pointerType: 'touch', pointerId: 21, clientX: 260, clientY: 240 }));

    assert.equal(panel.hasPointerCapture(21), true);
    assert.equal(panel.style.left, '160px');
    assert.equal(panel.style.top, '110px');
});

test("a touch on the panel body scrolls instead of dragging", () => {
    const { panel } = panelWithHandle();
    const body = controlIn(panel, 'SPAN');

    panel.dispatch('pointerdown', pointerEvent({ target: body, pointerType: 'touch', pointerId: 22, clientX: 200, clientY: 200 }));
    panel.dispatch('pointermove', pointerEvent({ target: body, pointerType: 'touch', pointerId: 22, clientX: 260, clientY: 240 }));

    assert.equal(panel.hasPointerCapture(22), false, "the body touch must not be captured");
    assert.equal(panel.style.left, undefined, "the panel must not move");
});

test("a mouse press still drags from the panel body when a handle exists", () => {
    const { panel } = panelWithHandle();
    const body = controlIn(panel, 'SPAN');

    panel.dispatch('pointerdown', pointerEvent({ target: body, pointerType: 'mouse', pointerId: 23, clientX: 200, clientY: 200 }));
    panel.dispatch('pointermove', pointerEvent({ target: body, pointerType: 'mouse', pointerId: 23, clientX: 230, clientY: 220 }));

    assert.equal(panel.style.left, '130px');
});
