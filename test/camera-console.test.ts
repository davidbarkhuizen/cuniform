import test from "node:test";
import assert from "node:assert/strict";

import { entrypoint } from "../src/app/entrypoint";
import { Graph } from "../src/graph/Graph";
import { K } from "../src/core/K";
import { identity, Mat3, rotX, rotY, rotZ } from "../src/view/Mat3";
import { point3 } from "../src/core/Point3D";
import { assertClose, assertMatClose } from "./support/assert";
import {
    CAMERA_CONSOLE_EVENTS,
    CAMERA_HOLD_RELEASE_EVENTS,
    FakeDom,
    FakeElement,
    UIControllerFixture,
    countSteps,
    demoElements,
    keyEvent,
    mouseEvent,
    pointerEvent,
    settledGraph,
    withFakeDom,
    withUIController,
} from "./support/dom";

// The console buttons are static markup in web/index.html; these drive them as the browser does.

const PER_TICK = K.camera.rotateRadiansPerSecond * K.physics.timerTickPeriodMS / 1000;

const ROTATIONS: Record<string, (angle: number) => Mat3> = { x: rotX, y: rotY, z: rotZ };

function stepFor(axis: string, direction: string, ticks: number): Mat3 {
    return ROTATIONS[axis]((direction === 'acw' ? 1 : -1) * PER_TICK * ticks);
}

interface ConsoleFixture extends UIControllerFixture {
    consoleElement: FakeElement;
}

function withFixture<T>(fn: (ui: ConsoleFixture) => T, graph?: Graph): T {
    return withUIController(
        ui => fn({ ...ui, consoleElement: ui.elements.cameraConsole }),
        // 600x600 so a projector can be asked where a model point lands.
        { width: 600, height: 600, graph }
    );
}

function button(axis: string, direction: string): FakeElement {
    const element = new FakeElement('BUTTON');
    element.setAttribute('data-axis', axis);
    element.setAttribute('data-direction', direction);
    return element;
}

function zoomButton(direction: string): FakeElement {
    const element = new FakeElement('BUTTON');
    element.setAttribute('data-zoom', direction);
    return element;
}

function pressDown(consoleElement: FakeElement, target: FakeElement): void {
    consoleElement.dispatch('pointerdown', pointerEvent({ target }));
}

function release(dom: FakeDom, type: string = 'pointerup'): void {
    for (const fn of dom.windowListeners.get(type) ?? [])
        fn(pointerEvent());
}

test("each console button rotates about its own axis from the first press", () => {
    withFixture(({ controller, consoleElement }) => {
        for (const axis of ['x', 'y', 'z']) {
            for (const direction of ['cw', 'acw']) {
                controller.state.camera.orientation = identity();

                pressDown(consoleElement, button(axis, direction));

                assertMatClose(
                    controller.state.camera.orientation,
                    stepFor(axis, direction, 1),
                    1e-12,
                    `${direction} about ${axis}`
                );

                controller.stopCameraHold();
            }
        }
    });
});

test("a press on a rotate button's SVG icon still reaches its button", () => {
    // A real press can report the SVG child as target, so the handler must walk up to the button.
    withFixture(({ controller, consoleElement }) => {
        const target = button('x', 'acw');
        const icon = new FakeElement('path');
        target.appendChild(icon);

        pressDown(consoleElement, icon);

        assertMatClose(
            controller.state.camera.orientation,
            stepFor('x', 'acw', 1),
            1e-12,
            "a press on the icon must reach its button"
        );
    });
});

test("each zoom button dollies one notch from the first press", () => {
    withFixture(({ controller, consoleElement }) => {
        const start = controller.state.camera.distance;

        pressDown(consoleElement, zoomButton('out'));
        assertClose(
            controller.state.camera.distance,
            start * K.camera.dollyPerWheelNotch,
            1e-9,
            "zoom out"
        );

        controller.stopCameraHold();

        pressDown(consoleElement, zoomButton('in'));
        assertClose(controller.state.camera.distance, start, 1e-9, "zoom in must reverse zoom out");
    });
});

test("a held zoom button zooms one notch per simulation tick", () => {
    withFixture(({ controller, consoleElement }) => {
        const start = controller.state.camera.distance;

        pressDown(consoleElement, zoomButton('out'));
        controller.onTimerTick();
        controller.onTimerTick();

        assertClose(
            controller.state.camera.distance,
            start * Math.pow(K.camera.dollyPerWheelNotch, 3),
            1e-9,
            "one notch on press plus one per tick"
        );
    });
});

test("keyboard: Enter starts a held zoom, keyup ends it", () => {
    withFixture(({ controller, consoleElement }) => {
        const start = controller.state.camera.distance;
        const target = zoomButton('in');

        consoleElement.dispatch('keydown', keyEvent({ key: 'Enter', target }));
        assertClose(
            controller.state.camera.distance,
            start / K.camera.dollyPerWheelNotch,
            1e-9,
            "keydown notch"
        );

        consoleElement.dispatch('keyup', keyEvent({ key: 'Enter', target }));
        controller.onTimerTick();

        assertClose(
            controller.state.camera.distance,
            start / K.camera.dollyPerWheelNotch,
            1e-9,
            "keyup ends the hold"
        );
    });
});

test("an assistive-technology click zooms once; a pointer click is already handled", () => {
    withFixture(({ controller, consoleElement }) => {
        const start = controller.state.camera.distance;
        const target = zoomButton('in');

        consoleElement.dispatch('click', mouseEvent({ detail: 0, target }));
        assertClose(controller.state.camera.distance, start / K.camera.dollyPerWheelNotch, 1e-9, "AT zoom");

        consoleElement.dispatch('click', mouseEvent({ detail: 1, target }));
        assertClose(controller.state.camera.distance, start / K.camera.dollyPerWheelNotch, 1e-9, "pointer click");
    });
});

test("a zoom value that names no direction does nothing", () => {
    withFixture(({ controller, consoleElement }) => {
        const start = controller.state.camera.distance;

        pressDown(consoleElement, zoomButton('sideways'));
        controller.onTimerTick();

        assert.equal(controller.state.camera.distance, start, "an unknown zoom must not move the camera");
    });
});

test("a held button applies one small step per simulation tick", () => {
    assert.ok(PER_TICK < Math.PI / 36, `one step should be small, got ${PER_TICK} rad`);

    withFixture(({ controller, consoleElement }) => {
        pressDown(consoleElement, button('y', 'acw'));

        controller.onTimerTick();
        controller.onTimerTick();

        assertMatClose(
            controller.state.camera.orientation,
            stepFor('y', 'acw', 3),
            1e-12,
            "one step on press plus one per tick"
        );
    });
});

test("a held button keeps rotating after the layout settles", () => {
    // Regression: rotation rode the physics step, so a hold froze once the rAF loop stopped stepping.
    withFixture(({ dom, controller, consoleElement }) => {
        const period = K.physics.timerTickPeriodMS;

        dom.runAnimationFrames(0);

        pressDown(consoleElement, button('y', 'acw'));

        const frames = K.physics.settleFrames + 5;

        for (let frame = 1; frame <= frames; frame++)
            dom.runAnimationFrames(period * frame);

        assertMatClose(
            controller.state.camera.orientation,
            stepFor('y', 'acw', 1 + frames),
            1e-12,
            "a held console button must keep stepping after the layout settles"
        );
    }, settledGraph());
});

test("a settled hold turns the camera without re-stepping the layout", () => {
    // The fix must not undo the settle optimisation: a settled hold turns the camera on the clock alone.
    withFixture(({ dom, controller, consoleElement }) => {
        const steps = countSteps(controller);

        const period = K.physics.timerTickPeriodMS;

        dom.runAnimationFrames(0);
        pressDown(consoleElement, button('y', 'acw'));

        for (let frame = 1; frame <= K.physics.settleFrames; frame++)
            dom.runAnimationFrames(period * frame);

        const stepsAtSettle = steps();
        const turnedAtSettle = controller.state.camera.orientation;

        dom.runAnimationFrames(period * (K.physics.settleFrames + 1));
        dom.runAnimationFrames(period * (K.physics.settleFrames + 2));

        assert.equal(steps(), stepsAtSettle, "a settled layout must not step while a hold turns the camera");
        assert.notDeepEqual(
            controller.state.camera.orientation,
            turnedAtSettle,
            "the camera must keep turning after the layout settles"
        );
    }, settledGraph());
});

test("releasing the pointer stops the rotation", () => {
    withFixture(({ dom, controller, consoleElement }) => {
        pressDown(consoleElement, button('x', 'cw'));
        controller.onTimerTick();

        const held = controller.state.camera.orientation;

        release(dom);

        controller.onTimerTick();

        assert.deepEqual(controller.state.camera.orientation, held, "no ticks after release");
    });
});

test("a lost window stops a held rotation too", () => {
    withFixture(({ dom, controller, consoleElement }) => {
        pressDown(consoleElement, button('x', 'cw'));

        const held = controller.state.camera.orientation;

        release(dom, 'blur');

        controller.onTimerTick();

        assert.deepEqual(controller.state.camera.orientation, held, "a blur must end the hold");
    });
});

test("keyboard: Enter starts a hold, keyup ends it, auto-repeat does not restart it", () => {
    withFixture(({ controller, consoleElement }) => {
        const target = button('z', 'acw');

        consoleElement.dispatch('keydown', keyEvent({ key: 'Enter', target }));

        assertMatClose(controller.state.camera.orientation, stepFor('z', 'acw', 1), 1e-12, "keydown step");

        controller.onTimerTick();
        assertMatClose(controller.state.camera.orientation, stepFor('z', 'acw', 2), 1e-12, "held step");

        // A repeat keydown must not add an immediate step on top of the tick handler.
        consoleElement.dispatch('keydown', keyEvent({ key: 'Enter', target, repeat: true }));
        assertMatClose(controller.state.camera.orientation, stepFor('z', 'acw', 2), 1e-12, "repeat keydown");

        consoleElement.dispatch('keyup', keyEvent({ key: 'Enter', target }));
        controller.onTimerTick();
        assertMatClose(controller.state.camera.orientation, stepFor('z', 'acw', 2), 1e-12, "keyup ends the hold");
    });
});

test("an assistive-technology click rotates once; a pointer click is already handled", () => {
    withFixture(({ controller, consoleElement }) => {
        consoleElement.dispatch('click', mouseEvent({ detail: 0, target: button('x', 'acw') }));

        assertMatClose(controller.state.camera.orientation, stepFor('x', 'acw', 1), 1e-12, "AT click");

        // A pointer press already rotated on pointerdown, so its click must not rotate twice.
        consoleElement.dispatch('click', mouseEvent({ detail: 1, target: button('x', 'acw') }));

        assertMatClose(controller.state.camera.orientation, stepFor('x', 'acw', 1), 1e-12, "pointer click");
    });
});

test("a press that is not on a console button does nothing", () => {
    withFixture(({ controller, consoleElement }) => {
        const start = controller.state.camera.distance;

        pressDown(consoleElement, consoleElement);
        pressDown(consoleElement, button('w', 'acw'));

        controller.onTimerTick();

        assert.deepEqual(controller.state.camera.orientation, identity());
        assert.equal(controller.state.camera.distance, start);
    });
});

test("anticlockwise about z spins the view anticlockwise on screen", () => {
    withFixture(({ controller, consoleElement }) => {
        const before = controller.projector().toCanvas(point3(120, 0, 0));

        pressDown(consoleElement, button('z', 'acw'));

        const after = controller.projector().toCanvas(point3(120, 0, 0));

        // Model +y is up the canvas, so an anticlockwise spin takes a right-side point up.
        assert.ok(after.y < before.y, `expected the point to move up, got y ${before.y} -> ${after.y}`);
        assert.ok(after.y < 300, "the point should end above the canvas centre");
    });
});

test("pointerdown on the console stops before the panel drag can capture it", () => {
    withFixture(({ consoleElement }) => {
        const event = pointerEvent({ button: 0, clientX: 5, clientY: 5, target: button('x', 'acw') });

        consoleElement.dispatch('pointerdown', event);

        assert.equal(
            (event as unknown as { propagationStopped: boolean }).propagationStopped,
            true,
            "the press must not reach the panel's DragController"
        );
    });
});

test("terminate ends a held rotation", () => {
    withFixture(({ controller, consoleElement }) => {
        pressDown(consoleElement, button('x', 'acw'));

        const held = controller.state.camera.orientation;

        controller.terminate();
        controller.onTimerTick();

        assert.deepEqual(controller.state.camera.orientation, held, "a reset must not keep rotating");
    });
});

test("initialize attaches the console listeners once and terminate removes them", () => {
    withFixture(({ dom, controller, consoleElement }) => {
        for (const type of CAMERA_CONSOLE_EVENTS)
            assert.equal(consoleElement.listenerCount(type), 1, `console must listen for ${type} once`);

        for (const type of CAMERA_HOLD_RELEASE_EVENTS)
            assert.equal((dom.windowListeners.get(type) ?? []).length, 1, `window must listen for ${type} once`);

        controller.terminate();

        for (const type of CAMERA_CONSOLE_EVENTS)
            assert.equal(consoleElement.listenerCount(type), 0, `console still listens for ${type}`);

        for (const type of CAMERA_HOLD_RELEASE_EVENTS)
            assert.equal((dom.windowListeners.get(type) ?? []).length, 0, `window still listens for ${type}`);

        controller.initialize();

        for (const type of CAMERA_CONSOLE_EVENTS)
            assert.equal(consoleElement.listenerCount(type), 1, `a second initialize must not double ${type}`);
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

        elements.cameraConsole.dispatch('pointerdown', pointerEvent({ target: button('x', 'acw') }));

        assertMatClose(
            controller!.state.camera.orientation,
            rotX(PER_TICK),
            1e-12,
            "the entrypoint's console"
        );
    });
});
