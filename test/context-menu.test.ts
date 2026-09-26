import test from "node:test";
import assert from "node:assert/strict";

import { ContextMenu } from "../src/ContextMenu";
import { UIController } from "../src/UIController";
import {
    FakeCanvas,
    FakeDom,
    FakeElement,
    demoElements,
    installFakeDom,
    keyEvent,
    mouseEvent,
    newUIController,
    withFakeDom,
} from "./support/dom";
import { readSource } from "./support/files";

/** Every listener initialize() attaches to the canvas. */
const CANVAS_EVENTS = ['mousemove', 'mousedown', 'mouseup', 'mouseout', 'contextmenu', 'keydown', 'wheel'];

/** The fake element behind an HTMLElement the controller hands back. */
function el(element: HTMLElement): FakeElement {
    return element as unknown as FakeElement;
}

interface Fixture {
    dom: FakeDom;
    elements: Record<string, FakeElement>;
    canvas: FakeCanvas;
    controller: UIController;
}

function withController<T>(fn: (ui: Fixture) => T): T {
    const elements = demoElements();

    return withFakeDom(elements, dom => {
        const canvas = elements.canvas as FakeCanvas;
        const controller = newUIController(elements);

        controller.initialize();

        return fn({ dom, elements, canvas, controller });
    });
}

/**
 * Like withController(), but keeps the fake DOM installed until the callback
 * settles. Export defers its object-URL revocation to a timer, so a caller that
 * awaits it must not have had the fake URL namespace restored underneath it.
 */
async function withControllerAsync<T>(fn: (ui: Fixture) => Promise<T> | T): Promise<T> {
    const elements = demoElements();
    const dom = installFakeDom(elements);

    try {
        const canvas = elements.canvas as FakeCanvas;
        const controller = newUIController(elements);
        controller.initialize();

        return await fn({ dom, elements, canvas, controller });
    } finally {
        dom.restore();
    }
}

/** Let every pending setTimeout(..., 0) callback run. */
function flushDeferred() {
    return new Promise(resolve => setTimeout(resolve, 0));
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
    withFakeDom({}, () => {
        const menu = new ContextMenu([
            { label: 'one', onSelect: () => {} },
            { label: 'two', onSelect: () => {} },
        ]);

        assert.equal(menu.isOpen, false);
        assert.deepEqual(menu.entries.map(e => e.label), ['one', 'two']);
    });
});

test("the menu and its entries carry their own inline styles", () => {
    withFakeDom({}, () => {
        const menu = new ContextMenu([{ label: 'one', onSelect: () => {} }]);

        // setStyle writes through the real style properties rather than an any.
        assert.equal(menu.element.style.position, 'absolute');
        assert.equal(menu.element.style.display, 'none');
        assert.equal(menu.entries[0].element.style.cursor, 'pointer');
    });
});

test("open anchors the menu at the cursor and hide closes it", () => {
    withFakeDom({}, () => {
        const menu = new ContextMenu([{ label: 'one', onSelect: () => {} }]);

        menu.open(12, 34);
        assert.equal(menu.isOpen, true);
        assert.equal(menu.element.style.left, '12px');
        assert.equal(menu.element.style.top, '34px');

        menu.hide();
        assert.equal(menu.isOpen, false);
    });
});

test("selecting an entry hides the menu and runs its callback once", () => {
    withFakeDom({}, () => {
        let calls = 0;
        const menu = new ContextMenu([{ label: 'clear selection', onSelect: () => calls++ }]);

        menu.open(1, 2);
        (menu.entries[0].element as unknown as FakeElement).dispatch('click');

        assert.equal(calls, 1);
        assert.equal(menu.isOpen, false);
    });
});

// ----------------------------------------------------------- UIController UI

test("right-click opens the context menu at the cursor and suppresses the browser menu", () => {
    withController(({ canvas, controller }) => {
        const contextEvent = rightClick(canvas, 250, 150);

        assert.ok(controller.contextMenu, "initialize should build the menu");
        assert.equal(controller.contextMenu!.isOpen, true);
        assert.equal(controller.contextMenu!.element.style.left, '250px');
        assert.equal(controller.contextMenu!.element.style.top, '150px');
        assert.equal(contextEvent.defaultPrevented, true);
    });
});

test("the menu offers export, reset and clear selection", () => {
    withController(({ controller }) => {
        assert.deepEqual(
            controller.contextMenu!.entries.map(e => e.label),
            ['export', 'reset', 'clear selection']
        );
    });
});

// -------------------------------------------------------- keyboard access

test("menu entries are buttons carrying menu roles", () => {
    withFakeDom({}, () => {
        const menu = new ContextMenu([{ label: 'one', onSelect: () => {} }]);

        assert.equal(menu.element.getAttribute('role'), 'menu');
        assert.equal(el(menu.entries[0].element).tagName, 'BUTTON');
        assert.equal(el(menu.entries[0].element).getAttribute('type'), 'button');
        assert.equal(el(menu.entries[0].element).getAttribute('role'), 'menuitem');
    });
});

test("opening the menu focuses its first entry", () => {
    withFakeDom({}, () => {
        const menu = new ContextMenu([
            { label: 'one', onSelect: () => {} },
            { label: 'two', onSelect: () => {} },
        ]);

        menu.open(1, 2);

        assert.equal(el(menu.entries[0].element).focused, true);
        assert.equal(el(menu.entries[1].element).focused, false);
    });
});

test("the arrow keys move focus between entries and wrap around", () => {
    withFakeDom({}, () => {
        const menu = new ContextMenu([
            { label: 'one', onSelect: () => {} },
            { label: 'two', onSelect: () => {} },
            { label: 'three', onSelect: () => {} },
        ]);
        const entries = menu.entries.map(e => el(e.element));

        menu.open(1, 2);

        el(menu.element).dispatch('keydown', keyEvent({ key: 'ArrowDown' }));
        assert.equal(entries[1].focused, true);

        el(menu.element).dispatch('keydown', keyEvent({ key: 'ArrowUp' }));
        assert.equal(entries[0].focused, true);

        el(menu.element).dispatch('keydown', keyEvent({ key: 'ArrowUp' }));
        assert.equal(entries[2].focused, true, "ArrowUp from the first entry wraps to the last");
    });
});

test("Escape hides the menu and calls the dismiss handler once", () => {
    withFakeDom({}, () => {
        let dismissed = 0;
        const menu = new ContextMenu([{ label: 'one', onSelect: () => {} }], () => dismissed++);

        menu.open(1, 2);
        el(menu.element).dispatch('keydown', keyEvent({ key: 'Escape' }));

        assert.equal(menu.isOpen, false);
        assert.equal(dismissed, 1);
    });
});

test("Shift+F10 opens the actions menu from the keyboard", () => {
    withController(({ canvas, controller }) => {
        const event = keyEvent({ key: 'F10', shiftKey: true });

        canvas.dispatch('keydown', event);

        assert.equal(controller.contextMenu!.isOpen, true);
        assert.equal(event.defaultPrevented, true, "the browser's own menu must be suppressed");
    });
});

test("the dedicated context-menu key opens the actions menu", () => {
    withController(({ canvas, controller }) => {
        canvas.dispatch('keydown', keyEvent({ key: 'ContextMenu' }));

        assert.equal(controller.contextMenu!.isOpen, true);
    });
});

test("Escape closes the menu and returns focus to the canvas", () => {
    withController(({ canvas, controller }) => {
        canvas.dispatch('keydown', keyEvent({ key: 'F10', shiftKey: true }));
        assert.equal(controller.contextMenu!.isOpen, true);

        el(controller.contextMenu!.element).dispatch('keydown', keyEvent({ key: 'Escape' }));

        assert.equal(controller.contextMenu!.isOpen, false);
        assert.equal(canvas.focused, true, "focus should return to the canvas");
    });
});

test("a plain F10 leaves the menu closed", () => {
    withController(({ canvas, controller }) => {
        canvas.dispatch('keydown', keyEvent({ key: 'F10' }));

        assert.equal(controller.contextMenu!.isOpen, false);
    });
});

test("a contextmenu event without a right-button press stays closed but is still suppressed", () => {
    withController(({ canvas, controller }) => {
        const contextEvent = mouseEvent({ clientX: 10, clientY: 10 });
        canvas.dispatch('contextmenu', contextEvent);

        assert.equal(controller.contextMenu!.isOpen, false);
        assert.equal(contextEvent.defaultPrevented, true);
    });
});

test("the contextmenu listener is registered exactly once", () => {
    withController(({ canvas }) => {
        assert.equal(canvas.listenerCount('contextmenu'), 1);
    });
});

test("clear selection deselects every node and resets the info panel", () => {
    withController(({ canvas, controller, elements }) => {
        const vertices = controller.solver.graph.vertices;
        vertices[0].isSelected = true;
        vertices[1].isSelected = true;

        entry(controller, 'clear selection').dispatch('click');

        assert.ok(vertices.every((v: any) => v.isSelected === false));
        assert.equal(controller.contextMenu!.isOpen, false);
        assert.equal(elements.selectedNodeInfoLabel.innerHTML, 'Click on a node to select...');
        assert.equal(canvas.focused, true, "activating an entry should return focus to the canvas");
    });
});

test("export navigates to a blob: URL, not a data: URL", async () => {
    await withControllerAsync(async ({ dom, controller }) => {
        entry(controller, 'export').dispatch('click');

        assert.equal(dom.objectUrls.created.length, 1, "export should mint exactly one object URL");
        assert.ok(
            dom.objectUrls.created[0].startsWith('blob:'),
            `expected a blob: URL, got ${dom.objectUrls.created[0]}`
        );
        assert.ok(
            !dom.objectUrls.created.some(url => url.startsWith('data:')),
            "a data: URL is blocked by browsers and must never be a transport"
        );

        await flushDeferred();
    });
});

test("export triggers a download named cuniform.png", async () => {
    await withControllerAsync(async ({ dom, controller }) => {
        entry(controller, 'export').dispatch('click');

        const anchor = dom.createdElements.filter(e => e.tagName === 'A').pop();

        assert.ok(anchor, "export should create an anchor to carry the download");
        assert.equal(anchor!.download, 'cuniform.png');
        assert.equal(anchor!.href, dom.objectUrls.created[0], "the anchor must point at the object URL");
        assert.equal(anchor!.clickCount, 1, "the anchor must be clicked to start the download");

        await flushDeferred();
    });
});

test("export revokes the object URL it created", async () => {
    await withControllerAsync(async ({ dom, controller }) => {
        entry(controller, 'export').dispatch('click');

        assert.deepEqual(dom.objectUrls.revoked, [], "revocation must be deferred, not synchronous");

        // The revoke runs from setTimeout(..., 0), so let the macrotask run
        // while the fake URL namespace is still installed.
        await flushDeferred();

        assert.deepEqual(dom.objectUrls.revoked, dom.objectUrls.created);
    });
});

test("UIController exports through an object URL, never a data: URL", () => {
    const source = readSource("UIController.ts");

    // The original bug: window.open(canvas.toDataURL(...)) opens a window that
    // no current browser permits to navigate. The scheme is the contract.
    assert.ok(!/\bwindow\.open\b/.test(source), "export must not use window.open");
    assert.ok(/\bURL\.createObjectURL\b/.test(source), "export must build an object URL");
    assert.ok(/\bURL\.revokeObjectURL\b/.test(source), "the object URL must be released");
});

test("reset asks for confirmation before rebuilding", () => {
    withController(({ controller }) => {
        let asked = 0;
        (globalThis as any).confirm = () => {
            asked++;
            return false;
        };

        entry(controller, 'reset').dispatch('click');

        assert.equal(asked, 1);
    });
});

test("a confirmed reset rebuilds the menu exactly once and does not double-register", () => {
    withController(({ elements, canvas, controller }) => {
        (globalThis as any).confirm = () => true;

        assert.equal(elements.body.children.length, 1, "one menu element after initialize");

        controller.onReset();

        assert.equal(elements.body.children.length, 1, "reset must not leak a second menu");
        assert.ok(controller.contextMenu);
        assert.equal(canvas.listenerCount('contextmenu'), 1);
        assert.equal(canvas.listenerCount('mousedown'), 1);
    });
});

test("initialize is idempotent: a second call doubles nothing", () => {
    withController(({ dom, elements, canvas, controller }) => {
        // withController already initialized once; initialize again without
        // terminating, as a careless caller would.
        controller.initialize();

        assert.equal(dom.intervals.length, 1, "one simulation timer after two initializes");
        assert.equal(elements.body.children.length, 1, "one context menu after two initializes");

        for (const type of CANVAS_EVENTS)
            assert.equal(canvas.listenerCount(type), 1, `canvas must listen for ${type} exactly once`);

        assert.equal(elements.cameraConsole.listenerCount('click'), 1, "one console click listener");
        assert.equal(elements.cameraConsole.listenerCount('pointerdown'), 1, "one console press listener");

        for (const type of ['pointerup', 'pointercancel', 'blur'])
            assert.equal((dom.windowListeners.get(type) ?? []).length, 1, `one window ${type} listener`);

        assert.equal((dom.windowListeners.get('resize') ?? []).length, 1, "one resize listener");
    });
});

test("a left mousedown closes an open context menu", () => {
    withController(({ canvas, controller }) => {
        rightClick(canvas);
        assert.equal(controller.contextMenu!.isOpen, true);

        canvas.dispatch('mousedown', mouseEvent({ button: 0, clientX: 10, clientY: 10 }));

        assert.equal(controller.contextMenu!.isOpen, false);
    });
});

test("terminate detaches every listener initialize attached", () => {
    withController(({ dom, elements, canvas, controller }) => {
        controller.terminate();

        for (const type of CANVAS_EVENTS)
            assert.equal(canvas.listenerCount(type), 0, `canvas still listens for ${type}`);

        assert.equal(elements.export_canvas_link.listenerCount('click'), 0, "export still listens");
        assert.equal(elements.reset_link.listenerCount('click'), 0, "reset still listens");
        assert.equal(elements.cameraConsole.listenerCount('click'), 0, "console still listens for click");
        assert.equal(elements.cameraConsole.listenerCount('pointerdown'), 0, "console still listens for pointerdown");

        for (const type of ['pointerup', 'pointercancel', 'blur'])
            assert.equal((dom.windowListeners.get(type) ?? []).length, 0, `window still listens for ${type}`);

        assert.equal((dom.windowListeners.get('resize') ?? []).length, 0, "window still listens for resize");
    });
});
