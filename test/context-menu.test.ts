import test from "node:test";
import assert from "node:assert/strict";

import { ContextMenu } from "../src/ContextMenu";
import { UIController } from "../src/UIController";
import {
    CAMERA_HOLD_RELEASE_EVENTS,
    CANVAS_EVENTS,
    FakeCanvas,
    FakeElement,
    el,
    keyEvent,
    mouseEvent,
    withFakeDom,
    withUIController,
    withUIControllerAsync,
} from "./support/dom";

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

test("open clamps the menu inside the viewport", () => {
    withFakeDom({}, () => {
        const menu = new ContextMenu([{ label: 'one', onSelect: () => {} }]);
        const element = el(menu.element);

        // A right/bottom-edge menu of this size, against the fake 1024x768 viewport.
        element.rect = { ...element.rect, width: 200, height: 100 };

        menu.open(1000, 700);

        assert.equal(element.style.left, '824px', '1024 - 200');
        assert.equal(element.style.top, '668px', '768 - 100');
    });
});

test("open clamps a negative anchor to the viewport origin", () => {
    withFakeDom({}, () => {
        const menu = new ContextMenu([{ label: 'one', onSelect: () => {} }]);

        menu.open(-40, -10);

        assert.equal(menu.element.style.left, '0px');
        assert.equal(menu.element.style.top, '0px');
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
    withUIController(({ canvas, controller }) => {
        const contextEvent = rightClick(canvas, 250, 150);

        assert.ok(controller.contextMenu, "initialize should build the menu");
        assert.equal(controller.contextMenu!.isOpen, true);
        assert.equal(controller.contextMenu!.element.style.left, '250px');
        assert.equal(controller.contextMenu!.element.style.top, '150px');
        assert.equal(contextEvent.defaultPrevented, true);
    });
});

test("macOS Ctrl+click opens the menu without changing the selection", () => {
    withUIController(({ canvas, controller }) => {
        const selected = controller.solver.graph.vertices[0];
        selected.isSelected = true;

        // macOS reports Ctrl+click as a primary press plus a contextmenu event.
        canvas.dispatch('mousedown', mouseEvent({ button: 0, ctrlKey: true, clientX: 250, clientY: 150 }));
        canvas.dispatch('contextmenu', mouseEvent({ ctrlKey: true, clientX: 250, clientY: 150 }));

        assert.equal(controller.contextMenu!.isOpen, true, "the Ctrl+click gesture opens the menu");
        assert.equal(
            controller.solver.graph.selectedVertex(),
            selected,
            "the context-menu gesture must not touch the selection"
        );
    });
});

test("a Ctrl contextmenu with no preceding press still opens", () => {
    withUIController(({ canvas, controller }) => {
        // Safari has not always delivered the primary press before the contextmenu.
        canvas.dispatch('contextmenu', mouseEvent({ ctrlKey: true, clientX: 10, clientY: 10 }));

        assert.equal(controller.contextMenu!.isOpen, true);
    });
});

test("the menu offers export, reset and clear selection", () => {
    withUIController(({ controller }) => {
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

test("focusing an entry directly resyncs the arrow-key roving index", () => {
    withFakeDom({}, () => {
        const menu = new ContextMenu([
            { label: 'one', onSelect: () => {} },
            { label: 'two', onSelect: () => {} },
            { label: 'three', onSelect: () => {} },
        ]);
        const entries = menu.entries.map(e => el(e.element));

        menu.open(1, 2);
        assert.equal(entries[0].focused, true, "open focuses the first entry");

        // A pointer click or Tab moves focus without the arrow-key handler, so the
        // focus event has to move the roving index with it.
        entries[2].focus();

        el(menu.element).dispatch('keydown', keyEvent({ key: 'ArrowDown' }));

        assert.equal(entries[0].focused, true, "ArrowDown from the last entry wraps to the first");
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
    withUIController(({ canvas, controller }) => {
        const event = keyEvent({ key: 'F10', shiftKey: true });

        canvas.dispatch('keydown', event);

        assert.equal(controller.contextMenu!.isOpen, true);
        assert.equal(event.defaultPrevented, true, "the browser's own menu must be suppressed");
    });
});

test("the dedicated context-menu key opens the actions menu", () => {
    withUIController(({ canvas, controller }) => {
        canvas.dispatch('keydown', keyEvent({ key: 'ContextMenu' }));

        assert.equal(controller.contextMenu!.isOpen, true);
    });
});

test("Escape closes the menu and returns focus to the canvas", () => {
    withUIController(({ canvas, controller }) => {
        canvas.dispatch('keydown', keyEvent({ key: 'F10', shiftKey: true }));
        assert.equal(controller.contextMenu!.isOpen, true);

        el(controller.contextMenu!.element).dispatch('keydown', keyEvent({ key: 'Escape' }));

        assert.equal(controller.contextMenu!.isOpen, false);
        assert.equal(canvas.focused, true, "focus should return to the canvas");
    });
});

test("a plain F10 leaves the menu closed", () => {
    withUIController(({ canvas, controller }) => {
        canvas.dispatch('keydown', keyEvent({ key: 'F10' }));

        assert.equal(controller.contextMenu!.isOpen, false);
    });
});

test("a contextmenu event without a right-button press stays closed but is still suppressed", () => {
    withUIController(({ canvas, controller }) => {
        const contextEvent = mouseEvent({ clientX: 10, clientY: 10 });
        canvas.dispatch('contextmenu', contextEvent);

        assert.equal(controller.contextMenu!.isOpen, false);
        assert.equal(contextEvent.defaultPrevented, true);
    });
});

test("the contextmenu listener is registered exactly once", () => {
    withUIController(({ canvas }) => {
        assert.equal(canvas.listenerCount('contextmenu'), 1);
    });
});

test("clear selection deselects every node and resets the info panel", () => {
    withUIController(({ canvas, controller, elements }) => {
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
    await withUIControllerAsync(async ({ dom, controller }) => {
        entry(controller, 'export').dispatch('click');

        // The PNG comes from the backend's promise, so the download is one
        // microtask behind the click.
        await flushDeferred();

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
    await withUIControllerAsync(async ({ dom, controller }) => {
        entry(controller, 'export').dispatch('click');

        await flushDeferred();

        const anchor = dom.createdElements.filter(e => e.tagName === 'A').pop();

        assert.ok(anchor, "export should create an anchor to carry the download");
        assert.equal(anchor!.download, 'cuniform.png');
        assert.equal(anchor!.href, dom.objectUrls.created[0], "the anchor must point at the object URL");
        assert.equal(anchor!.clickCount, 1, "the anchor must be clicked to start the download");

        await flushDeferred();
    });
});

test("export revokes the object URL it created", async () => {
    await withUIControllerAsync(async ({ dom, controller }) => {
        entry(controller, 'export').dispatch('click');

        // Let the backend's promise settle and the download run; the revoke it
        // schedules is one timer behind, so it must not have fired yet.
        await flushDeferred();

        assert.deepEqual(dom.objectUrls.revoked, [], "revocation must be deferred, not synchronous");

        // The revoke runs from setTimeout(..., 0); flush it while the fake URL namespace is installed.
        await flushDeferred();

        assert.deepEqual(dom.objectUrls.revoked, dom.objectUrls.created);
    });
});

test("reset opens the graph chooser and leaves the graph alone until a choice", () => {
    withUIController(({ controller }) => {
        const before = controller.solver.graph;

        entry(controller, 'reset').dispatch('click');

        assert.ok(controller.wizard, "reset opens the chooser");
        assert.equal(controller.wizard!.isOpen, true);
        assert.equal(
            controller.solver.graph,
            before,
            "the running graph must be untouched while the chooser is open"
        );
    });
});

test("the fake DOM blurs the previous element, so a focus steal cannot hide", () => {
    withFakeDom({}, () => {
        const first = new FakeElement('BUTTON');
        const second = new FakeElement('BUTTON');

        first.focus();
        second.focus();

        assert.equal(second.focused, true);
        assert.equal(first.focused, false, "focusing one element must blur the last");
    });
});

test("resetting from the context menu leaves focus inside the chooser", () => {
    withUIController(({ canvas, controller }) => {
        rightClick(canvas);

        entry(controller, 'reset').dispatch('click');

        const wizard = controller.wizard!;
        const firstChoice = el(wizard.choiceButtons[0].element);

        assert.equal(firstChoice.focused, true, "the chooser's first control keeps focus");
        assert.equal(canvas.focused, false, "the menu's dismissal must not steal focus back");
    });
});

test("a completed reset swaps the graph without rebuilding the menu or double-registering", () => {
    withUIController(({ elements, canvas, controller }) => {
        assert.equal(elements.body.children.length, 1, "one menu element after initialize");

        entry(controller, 'reset').dispatch('click');

        const wizard = controller.wizard!;
        wizard.orderInput.value = "5";
        wizard.branchingInput.value = "2";
        (wizard.generateButton as unknown as FakeElement).dispatch('click');

        assert.equal(elements.body.children.length, 1, "reset must not leak a second menu");
        assert.ok(controller.contextMenu);
        assert.equal(canvas.listenerCount('contextmenu'), 1);
        assert.equal(canvas.listenerCount('mousedown'), 1);
        assert.equal(controller.solver.graph.vertices.length, 5, "the chosen graph is now live");
    });
});

test("initialize is idempotent: a second call doubles nothing", () => {
    withUIController(({ dom, elements, canvas, controller }) => {
        // withController already initialized once; initialize again without terminating.
        controller.initialize();

        assert.equal(dom.animationFrames.length, 1, "one animation frame after two initializes");
        assert.equal(elements.body.children.length, 1, "one context menu after two initializes");

        for (const type of CANVAS_EVENTS)
            assert.equal(canvas.listenerCount(type), 1, `canvas must listen for ${type} exactly once`);

        assert.equal(elements.cameraConsole.listenerCount('click'), 1, "one console click listener");
        assert.equal(elements.cameraConsole.listenerCount('pointerdown'), 1, "one console press listener");

        for (const type of CAMERA_HOLD_RELEASE_EVENTS)
            assert.equal((dom.windowListeners.get(type) ?? []).length, 1, `one window ${type} listener`);

        assert.equal((dom.windowListeners.get('resize') ?? []).length, 1, "one resize listener");
    });
});

test("a left mousedown closes an open context menu", () => {
    withUIController(({ canvas, controller }) => {
        rightClick(canvas);
        assert.equal(controller.contextMenu!.isOpen, true);

        canvas.dispatch('mousedown', mouseEvent({ button: 0, clientX: 10, clientY: 10 }));

        assert.equal(controller.contextMenu!.isOpen, false);
    });
});

test("terminate detaches every listener initialize attached", () => {
    withUIController(({ dom, elements, canvas, controller }) => {
        controller.terminate();

        for (const type of CANVAS_EVENTS)
            assert.equal(canvas.listenerCount(type), 0, `canvas still listens for ${type}`);

        assert.equal(elements.export_canvas_link.listenerCount('click'), 0, "export still listens");
        assert.equal(elements.reset_link.listenerCount('click'), 0, "reset still listens");
        assert.equal(elements.cameraConsole.listenerCount('click'), 0, "console still listens for click");
        assert.equal(elements.cameraConsole.listenerCount('pointerdown'), 0, "console still listens for pointerdown");

        for (const type of CAMERA_HOLD_RELEASE_EVENTS)
            assert.equal((dom.windowListeners.get(type) ?? []).length, 0, `window still listens for ${type}`);

        assert.equal((dom.windowListeners.get('resize') ?? []).length, 0, "window still listens for resize");
    });
});
