import test from "node:test";
import assert from "node:assert/strict";

import { ContextMenu } from "../src/ContextMenu";
import { UIController } from "../src/UIController";
import { FakeCanvas, FakeElement, demoElements, installFakeDom } from "./support/dom";

function mouseEvent(props: Record<string, any> = {}): any {
    return {
        defaultPrevented: false,
        preventDefault(this: any) {
            this.defaultPrevented = true;
        },
        ...props,
    };
}

function setup() {
    const elements = demoElements();
    const dom = installFakeDom(elements);
    const canvas = elements.canvas as FakeCanvas;

    const controller = new UIController(
        elements.body as unknown as HTMLElement,
        canvas as unknown as HTMLCanvasElement,
        canvas.context as unknown as CanvasRenderingContext2D,
        elements.export_canvas_link as unknown as HTMLElement,
        elements.reset_link as unknown as HTMLElement
    );

    controller.initialize();

    return { dom, elements, canvas, controller };
}

function rightClick(canvas: FakeCanvas, x = 250, y = 150) {
    canvas.dispatch('mousedown', mouseEvent({ button: 2, clientX: x, clientY: y }));
    const contextEvent = mouseEvent({ clientX: x, clientY: y });
    canvas.dispatch('contextmenu', contextEvent);
    return contextEvent;
}

function entry(controller: UIController, label: string): FakeElement {
    const found = controller.contextMenu!.entries.find(e => e.label === label);
    assert.ok(found, `no context-menu entry labelled "${label}"`);
    return found!.element as unknown as FakeElement;
}

// ---------------------------------------------------------------- ContextMenu

test("a context menu starts hidden and keeps its entries in order", () => {
    const dom = installFakeDom({});
    try {
        const menu = new ContextMenu([
            { label: 'one', onSelect: () => {} },
            { label: 'two', onSelect: () => {} },
        ]);

        assert.equal(menu.isOpen, false);
        assert.deepEqual(menu.entries.map(e => e.label), ['one', 'two']);
    } finally {
        dom.restore();
    }
});

test("open anchors the menu at the cursor and hide closes it", () => {
    const dom = installFakeDom({});
    try {
        const menu = new ContextMenu([{ label: 'one', onSelect: () => {} }]);

        menu.open(12, 34);
        assert.equal(menu.isOpen, true);
        assert.equal(menu.element.style.left, '12px');
        assert.equal(menu.element.style.top, '34px');

        menu.hide();
        assert.equal(menu.isOpen, false);
    } finally {
        dom.restore();
    }
});

test("selecting an entry hides the menu and runs its callback once", () => {
    const dom = installFakeDom({});
    try {
        let calls = 0;
        const menu = new ContextMenu([{ label: 'clear selection', onSelect: () => calls++ }]);

        menu.open(1, 2);
        (menu.entries[0].element as unknown as FakeElement).dispatch('click');

        assert.equal(calls, 1);
        assert.equal(menu.isOpen, false);
    } finally {
        dom.restore();
    }
});

// ----------------------------------------------------------- UIController UI

test("right-click opens the context menu at the cursor and suppresses the browser menu", () => {
    const { dom, canvas, controller } = setup();
    try {
        const contextEvent = rightClick(canvas, 250, 150);

        assert.ok(controller.contextMenu, "initialize should build the menu");
        assert.equal(controller.contextMenu!.isOpen, true);
        assert.equal(controller.contextMenu!.element.style.left, '250px');
        assert.equal(controller.contextMenu!.element.style.top, '150px');
        assert.equal(contextEvent.defaultPrevented, true);
    } finally {
        dom.restore();
    }
});

test("the menu offers export, reset and clear selection", () => {
    const { dom, controller } = setup();
    try {
        assert.deepEqual(
            controller.contextMenu!.entries.map(e => e.label),
            ['export', 'reset', 'clear selection']
        );
    } finally {
        dom.restore();
    }
});

test("a contextmenu event without a right-button press stays closed but is still suppressed", () => {
    const { dom, canvas, controller } = setup();
    try {
        const contextEvent = mouseEvent({ clientX: 10, clientY: 10 });
        canvas.dispatch('contextmenu', contextEvent);

        assert.equal(controller.contextMenu!.isOpen, false);
        assert.equal(contextEvent.defaultPrevented, true);
    } finally {
        dom.restore();
    }
});

test("the contextmenu listener is registered exactly once", () => {
    const { dom, canvas } = setup();
    try {
        assert.equal(canvas.listenerCount('contextmenu'), 1);
    } finally {
        dom.restore();
    }
});

test("clear selection deselects every node and resets the info panel", () => {
    const { dom, controller, elements } = setup();
    try {
        const vertices = dom.window.fdg.graph.vertices;
        vertices[0].isSelected = true;
        vertices[1].isSelected = true;

        entry(controller, 'clear selection').dispatch('click');

        assert.ok(vertices.every((v: any) => v.isSelected === false));
        assert.equal(controller.contextMenu!.isOpen, false);
        assert.equal(elements.selectedNodeInfoLabel.innerHTML, 'Click on a node to select...');
    } finally {
        dom.restore();
    }
});

test("export opens the canvas PNG data URL", () => {
    const { dom, controller } = setup();
    try {
        const opened: string[] = [];
        dom.window.open = (url: string): null => {
            opened.push(url);
            return null;
        };

        entry(controller, 'export').dispatch('click');

        assert.deepEqual(opened, ['data:image/png;base64,FAKE']);
    } finally {
        dom.restore();
    }
});

test("reset asks for confirmation before rebuilding", () => {
    const { dom, controller } = setup();
    try {
        let asked = 0;
        (globalThis as any).confirm = () => {
            asked++;
            return false;
        };

        entry(controller, 'reset').dispatch('click');

        assert.equal(asked, 1);
    } finally {
        dom.restore();
    }
});

test("a confirmed reset rebuilds the menu exactly once and does not double-register", () => {
    const { dom, elements, canvas, controller } = setup();
    try {
        (globalThis as any).confirm = () => true;

        assert.equal(elements.body.children.length, 1, "one menu element after initialize");

        controller.onReset();

        assert.equal(elements.body.children.length, 1, "reset must not leak a second menu");
        assert.ok(controller.contextMenu);
        assert.equal(canvas.listenerCount('contextmenu'), 1);
        assert.equal(canvas.listenerCount('mousedown'), 1);
    } finally {
        dom.restore();
    }
});

test("a left mousedown closes an open context menu", () => {
    const { dom, canvas, controller } = setup();
    try {
        rightClick(canvas);
        assert.equal(controller.contextMenu!.isOpen, true);

        canvas.dispatch('mousedown', mouseEvent({ button: 0, clientX: 10, clientY: 10 }));

        assert.equal(controller.contextMenu!.isOpen, false);
    } finally {
        dom.restore();
    }
});
