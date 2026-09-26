import test from "node:test";
import assert from "node:assert/strict";

import { DragController } from "../src/DragController";
import { FakeElement } from "./support/dom";

function mouse(screenX: number, screenY: number): MouseEvent {
    return { screenX, screenY } as unknown as MouseEvent;
}

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

    controller.onDragStart(mouse(1000, 500));
    // The panel starts at (left 100, top 70) within its parent; add the
    // +40 screen x, +30 screen y drag delta.
    controller.onDrag(mouse(1040, 530));
    controller.onDragEnd();

    assert.equal(panel.style.top, '100px');
    assert.equal(panel.style.left, '140px');

    // Regression: the old code produced "$(this.dragY + this.startTop)".
    for (const value of [panel.style.top, panel.style.left]) {
        assert.ok(!value.includes('$('), `still interpolating: ${value}`);
        assert.ok(/^\d+px$/.test(value), `not a px length: ${value}`);
    }
});

test("drag deltas are measured from the drag start, across several moves", () => {
    const { panel, controller } = panelInParent();

    controller.onDragStart(mouse(200, 200));
    controller.onDrag(mouse(220, 210));
    controller.onDrag(mouse(300, 260));
    controller.onDragEnd();

    assert.equal(panel.style.left, '200px');
    assert.equal(panel.style.top, '130px');
});

test("deltas reset after a drag ends, so the next drag is not cumulative", () => {
    const { panel, controller } = panelInParent();

    controller.onDragStart(mouse(200, 200));
    controller.onDrag(mouse(260, 240));
    controller.onDragEnd();

    assert.equal(controller.dragX, 0);
    assert.equal(controller.dragY, 0);

    // A second drag with no movement must leave the panel where it started,
    // not offset by the first drag's delta.
    controller.onDragStart(mouse(200, 200));
    controller.onDragEnd();

    assert.equal(panel.style.left, '100px');
    assert.equal(panel.style.top, '70px');
});

test("a move reported outside the screen is ignored", () => {
    const { panel, controller } = panelInParent();

    controller.onDragStart(mouse(200, 200));
    controller.onDrag(mouse(-5, 0));
    controller.onDragEnd();

    assert.equal(panel.style.left, '100px');
    assert.equal(panel.style.top, '70px');
});

test("a parentless panel still produces a px position instead of throwing", () => {
    const panel = new FakeElement('DIV');
    panel.rect = { top: 100, left: 150, right: 450, bottom: 500, width: 300, height: 400, x: 150, y: 100 };

    const controller = new DragController(panel as unknown as HTMLElement);
    controller.onDragStart(mouse(200, 200));
    controller.onDrag(mouse(230, 220));
    controller.onDragEnd();

    assert.equal(panel.style.left, '30px');
    assert.equal(panel.style.top, '20px');
});

test("the panel is made draggable and listens for the three drag events", () => {
    const { panel } = panelInParent();

    assert.equal(panel.draggable, true);
    assert.equal(panel.listenerCount('dragstart'), 1);
    assert.equal(panel.listenerCount('drag'), 1);
    assert.equal(panel.listenerCount('dragend'), 1);
});
