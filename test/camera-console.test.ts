import test from "node:test";
import assert from "node:assert/strict";

import { entrypoint } from "../src/entrypoint";
import { K } from "../src/K";
import { identity, Mat3, rotX, rotY, rotZ } from "../src/Mat3";
import { point3 } from "../src/Point3D";
import { UIController } from "../src/UIController";
import { assertMatClose } from "./support/assert";
import {
    FakeElement,
    demoElements,
    newUIController,
    pointerEvent,
    withFakeDom,
} from "./support/dom";

/**
 * The camera console section of the floating panel.
 *
 * The buttons are static markup in web/index.html, so these press them the way
 * the browser does: a click that bubbles to the container with the pressed
 * button as the event target. The delegated handler reads the data attributes
 * off that target.
 */

interface ConsoleFixture {
    elements: Record<string, FakeElement>;
    controller: UIController;
    consoleElement: FakeElement;
}

function withFixture<T>(fn: (ui: ConsoleFixture) => T): T {
    const elements = demoElements();

    return withFakeDom(elements, () => {
        // 600x600 so a projector can be asked where a model point lands.
        const controller = newUIController(elements, { width: 600, height: 600 });

        // initialize() is what attaches the console listeners.
        controller.initialize();

        return fn({ elements, controller, consoleElement: elements.cameraConsole });
    });
}

/** A button carrying the markup's data contract. */
function button(axis: string, direction: string): FakeElement {
    const element = new FakeElement('BUTTON');
    element.setAttribute('data-axis', axis);
    element.setAttribute('data-direction', direction);
    return element;
}

/** A click as it arrives from a button, after bubbling to the container. */
function press(consoleElement: FakeElement, target: FakeElement) {
    consoleElement.dispatch('click', { target });
}

const ROTATIONS: Record<string, (angle: number) => Mat3> = { x: rotX, y: rotY, z: rotZ };

test("each console button rotates about its own axis by one configured step", () => {
    withFixture(({ controller, consoleElement }) => {
        for (const axis of ['x', 'y', 'z']) {
            for (const direction of ['cw', 'acw']) {
                const radians = (direction === 'acw' ? 1 : -1) * K.camera.rotateStepRadians;

                // Fresh each case, so one press is measured from the identity
                // and is exactly that axis rotation.
                controller.state.camera.orientation = identity();

                press(consoleElement, button(axis, direction));

                assertMatClose(
                    controller.state.camera.orientation,
                    ROTATIONS[axis](radians),
                    1e-12,
                    `${direction} about ${axis}`
                );
            }
        }
    });
});

test("anticlockwise about z spins the view anticlockwise on screen", () => {
    withFixture(({ controller, consoleElement }) => {
        const before = controller.projector().toCanvas(point3(120, 0, 0));

        press(consoleElement, button('z', 'acw'));

        const after = controller.projector().toCanvas(point3(120, 0, 0));

        // Model +y is up the canvas, so an anticlockwise on-screen spin takes a
        // point on the right towards the top.
        assert.ok(after.y < before.y, `expected the point to move up, got y ${before.y} -> ${after.y}`);
        assert.ok(after.y < 300, "the point should end above the canvas centre");
    });
});

test("a click that is not on a rotate button is a no-op", () => {
    withFixture(({ controller, consoleElement }) => {
        press(consoleElement, consoleElement);

        press(consoleElement, button('w', 'acw'));
        press(consoleElement, button('x', 'sideways'));

        assert.deepEqual(controller.state.camera.orientation, identity());
    });
});

test("pointerdown on the console stops before the panel drag can capture it", () => {
    withFixture(({ consoleElement }) => {
        const event = pointerEvent({ button: 0, clientX: 5, clientY: 5 });

        consoleElement.dispatch('pointerdown', event);

        assert.equal(
            (event as unknown as { propagationStopped: boolean }).propagationStopped,
            true,
            "the press must not reach the panel's DragController"
        );
    });
});

test("terminate detaches the console listeners and initialize restores exactly one each", () => {
    withFixture(({ controller, consoleElement }) => {
        assert.equal(consoleElement.listenerCount('click'), 1, "one delegated click listener");
        assert.equal(consoleElement.listenerCount('pointerdown'), 1, "one drag guard listener");

        controller.terminate();

        assert.equal(consoleElement.listenerCount('click'), 0, "click still listening after terminate");
        assert.equal(consoleElement.listenerCount('pointerdown'), 0, "pointerdown still listening after terminate");

        controller.initialize();

        assert.equal(consoleElement.listenerCount('click'), 1, "a second initialize must not double the listener");
        assert.equal(consoleElement.listenerCount('pointerdown'), 1, "a second initialize must not double the listener");
    });
});

test("the entrypoint wires the console to the live camera", () => {
    const elements = demoElements();

    withFakeDom(elements, () => {
        const controller = entrypoint(
            'selectionInfoPanel',
            'canvas',
            'export_canvas_link',
            'reset_link'
        );

        assert.ok(controller, "the demo elements should start the controller");

        press(elements.cameraConsole, button('x', 'acw'));

        assertMatClose(
            controller!.state.camera.orientation,
            rotX(K.camera.rotateStepRadians),
            1e-12,
            "the entrypoint's console"
        );
    });
});
