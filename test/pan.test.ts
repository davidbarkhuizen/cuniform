import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { fromYawPitch, identity } from "../src/Mat3";
import { Tag } from "../src/Tag";
import { UIController } from "../src/UIController";
import { assertClose, assertMatClose } from "./support/assert";
import {
    FakeCanvas,
    FakeDom,
    demoElements,
    mouseEvent,
    newUIController,
    wheelEvent,
    withFakeDom,
} from "./support/dom";

interface PanFixture {
    dom: FakeDom;
    canvas: FakeCanvas;
    controller: UIController;
    graph: Graph;
    fdg: ForceDirectedGraph;
    a: Tag;
    b: Tag;
}

/**
 * Two nodes in a 600x600 model mapped onto a 600x600 canvas, so one canvas
 * unit is one model unit. Depth is set to the camera distance, which is what a
 * step() would have cached for this flat scene, so the nodes are visible and a
 * drag has a real plane to slide on.
 *
 * The behaviour change from the old pan tests: middle-drag no longer
 * translates the nodes. It orbits the camera, and Shift+middle-drag moves the
 * camera target instead (plan D2/D4).
 */
function withFixture<T>(fn: (ui: PanFixture) => T): T {
    const elements = demoElements();
    const canvas = elements.canvas as FakeCanvas;
    canvas.width = 600;
    canvas.height = 600;

    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 100, y: 100, z: 0 }, "b");
    a.depth = K.camera.distance;
    b.depth = K.camera.distance;
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(a, b);

    return withFakeDom(elements, dom => {
        // The logical size initialize() would have computed; mapping uses it.
        const controller = newUIController(elements, { width: 600, height: 600, graph });

        return fn({ dom, canvas, controller, graph, fdg: controller.solver, a, b });
    });
}

// ------------------------------------------------------------------ orbiting

test("middle-drag orbits the camera and leaves node positions untouched", () => {
    withFixture(({ controller, a, b }) => {
        const beforeA = { ...a.position };
        const beforeB = { ...b.position };

        controller.onMouseDown(mouseEvent({ button: 1, clientX: 100, clientY: 100 }));
        controller.onMouseMove(mouseEvent({ button: 1, clientX: 150, clientY: 120 }));

        const rate = K.camera.orbitRadiansPerPixel;
        assertMatClose(
            controller.state.camera.orientation,
            fromYawPitch(50 * rate, 20 * rate),
            1e-12,
            "orbit"
        );

        assert.deepEqual({ ...a.position }, beforeA, "orbit must not touch the physics model");
        assert.deepEqual({ ...b.position }, beforeB, "orbit must not touch the physics model");
    });
});

test("successive middle moves accumulate the orbit", () => {
    withFixture(({ controller }) => {
        controller.onMouseDown(mouseEvent({ button: 1, clientX: 100, clientY: 100 }));
        controller.onMouseMove(mouseEvent({ button: 1, clientX: 150, clientY: 120 }));
        controller.onMouseMove(mouseEvent({ button: 1, clientX: 200, clientY: 120 }));

        const rate = K.camera.orbitRadiansPerPixel;
        assertMatClose(
            controller.state.camera.orientation,
            fromYawPitch(100 * rate, 20 * rate),
            1e-12,
            "orbit"
        );
    });
});

test("the first middle move only anchors the gesture and moves nothing", () => {
    withFixture(({ controller, a, b }) => {
        // Simulate a middle drag already marked down without an anchor.
        controller.state.b1Down = true;

        controller.onMouseMove(mouseEvent({ button: 1, clientX: 400, clientY: 300 }));

        assert.deepEqual({ ...a.position }, { x: 0, y: 0, z: 0 });
        assert.deepEqual({ ...b.position }, { x: 100, y: 100, z: 0 });
        assert.deepEqual(controller.state.camera.orientation, identity());
        assert.deepEqual({ ...controller.state.lastMiddleDragPos }, { x: 400, y: 300 });
    });
});

test("releasing the middle button clears the anchor and stops the gesture", () => {
    withFixture(({ controller }) => {
        controller.onMouseDown(mouseEvent({ button: 1, clientX: 100, clientY: 100 }));
        controller.onMouseMove(mouseEvent({ button: 1, clientX: 150, clientY: 120 }));

        const pausedOrientation = controller.state.camera.orientation;

        controller.onMouseUp(mouseEvent({ button: 1, clientX: 150, clientY: 120 }));

        assert.equal(controller.state.b1Down, false);
        assert.equal(controller.state.lastMiddleDragPos, null);

        controller.onMouseMove(mouseEvent({ button: 1, clientX: 300, clientY: 300 }));

        assert.deepEqual(controller.state.camera.orientation, pausedOrientation);
    });
});

test("middle mousedown records the anchor and prevents autoscroll", () => {
    withFixture(({ controller }) => {
        const event = mouseEvent({ button: 1, clientX: 100, clientY: 100 });

        controller.onMouseDown(event);

        assert.equal(controller.state.b1Down, true);
        assert.deepEqual({ ...controller.state.lastMiddleDragPos }, { x: 100, y: 100 });
        assert.equal(event.defaultPrevented, true);
    });
});

// ---------------------------------------------------------- camera-target pan

test("Shift+middle-drag moves the camera target, not the nodes", () => {
    withFixture(({ controller, a, b }) => {
        const beforeA = { ...a.position };
        const beforeB = { ...b.position };

        controller.onMouseDown(mouseEvent({ button: 1, clientX: 100, clientY: 100 }));
        controller.onMouseMove(mouseEvent({ button: 1, clientX: 150, clientY: 120, shiftKey: true }));

        // One canvas unit is one model unit and the camera is the identity, so
        // the +50/-20 canvas delta is a +50/-20 model target move on the target
        // plane. Node positions are never written.
        assertClose(controller.state.camera.target.x, 50, 1e-9, "target x");
        assertClose(controller.state.camera.target.y, -20, 1e-9, "target y");
        assertClose(controller.state.camera.target.z, 0, 1e-9, "target z");

        assert.deepEqual({ ...a.position }, beforeA, "pan must not touch the physics model");
        assert.deepEqual({ ...b.position }, beforeB, "pan must not touch the physics model");
    });
});

test("successive Shift+middle moves accumulate the camera pan", () => {
    withFixture(({ controller }) => {
        controller.onMouseDown(mouseEvent({ button: 1, clientX: 100, clientY: 100 }));
        controller.onMouseMove(mouseEvent({ button: 1, clientX: 150, clientY: 120, shiftKey: true }));
        controller.onMouseMove(mouseEvent({ button: 1, clientX: 200, clientY: 120, shiftKey: true }));

        assertClose(controller.state.camera.target.x, 100, 1e-9, "target x");
        assertClose(controller.state.camera.target.y, -20, 1e-9, "target y");
    });
});

// ------------------------------------------------------------------- dolly

test("the wheel dollies the camera distance and prevents page scroll", () => {
    withFixture(({ controller }) => {
        const event = wheelEvent({ deltaY: -100 });

        controller.onWheel(event);

        assertClose(
            controller.state.camera.distance,
            K.camera.distance / K.camera.dollyPerWheelNotch,
            1e-9,
            "a notch in should move the camera closer"
        );
        assert.equal(event.defaultPrevented, true, "the wheel must not scroll the page");
    });
});

test("the dolly is clamped above the near plane", () => {
    withFixture(({ controller }) => {
        for (let i = 0; i < 200; i++)
            controller.onWheel(wheelEvent({ deltaY: -100 }));

        assert.equal(controller.state.camera.distance, K.camera.minDistance);
        assert.ok(
            K.camera.minDistance > K.camera.nearPlane,
            "the target plane must never be inside the near plane"
        );
    });
});

test("a wheel event with no delta is a no-op", () => {
    withFixture(({ controller }) => {
        controller.onWheel(wheelEvent({ deltaY: 0 }));

        assert.equal(controller.state.camera.distance, K.camera.distance);
    });
});

// --------------------------------------------------------------- node drag

test("left-drag unprojects the cursor at the node's depth", () => {
    withFixture(({ controller, a, b }) => {
        a.isSelected = true;
        controller.state.b0Down = true;

        controller.onMouseMove(mouseEvent({ button: 0, clientX: 400, clientY: 300 }));

        assert.deepEqual({ ...a.position }, { x: 100, y: 0, z: 0 });
        assert.deepEqual({ ...b.position }, { x: 100, y: 100, z: 0 });
    });
});

test("view-plane drag preserves the node's depth and tracks the cursor", () => {
    withFixture(({ controller, a }) => {
        a.position = { x: 0, y: 0, z: 200 };
        a.depth = K.camera.distance + 200;
        a.isSelected = true;
        controller.state.b0Down = true;

        controller.onMouseMove(mouseEvent({ button: 0, clientX: 400, clientY: 300 }));

        assert.equal(a.position.z, 200, "depth must be preserved through a drag");
        assertClose(
            controller.projector().toCanvas(a.position).x,
            400,
            1e-9,
            "the node must land under the cursor"
        );
        assertClose(
            controller.projector().toCanvas(a.position).y,
            300,
            1e-9,
            "the node must land under the cursor"
        );
    });
});

test("a culled selected node drags on the near plane", () => {
    withFixture(({ controller, a }) => {
        a.depth = 0; // never projected: inside the near plane
        a.isSelected = true;
        controller.state.b0Down = true;

        controller.onMouseMove(mouseEvent({ button: 0, clientX: 400, clientY: 300 }));

        assertClose(
            controller.projector().project(a.position).depth,
            K.camera.nearPlane,
            1e-9,
            "a culled node falls back to the near plane as its drag depth"
        );
        assert.ok(
            Number.isFinite(a.position.x) && Number.isFinite(a.position.y) && Number.isFinite(a.position.z)
        );
    });
});

test("pointer mapping uses the canvas rect, so an offset canvas stays accurate", () => {
    withFixture(({ dom, canvas, controller, a }) => {
        // The canvas sits at (50, 30) in the viewport, and the page reports a
        // scroll offset that the old offsetParent walk added on top.
        canvas.rect = {
            top: 30, left: 50, right: 650, bottom: 630,
            width: 600, height: 600, x: 50, y: 30,
        };
        dom.window.pageXOffset = 999;
        dom.window.pageYOffset = 999;

        a.isSelected = true;
        controller.state.b0Down = true;

        // Client (250, 150) is canvas-local (200, 120), so model (-100, 180)
        // on the 600x600 fixture. The scroll offsets must not be added.
        controller.onMouseMove(mouseEvent({ clientX: 250, clientY: 150 }));

        assert.deepEqual({ ...a.position }, { x: -100, y: 180, z: 0 });
    });
});

test("a middle move while the left button is up does not follow the node-drag path", () => {
    withFixture(({ controller, a }) => {
        a.isSelected = true;
        controller.state.b0Down = false;
        controller.state.b1Down = true;

        controller.onMouseMove(mouseEvent({ button: 0, clientX: 400, clientY: 300 }));

        // b1Down orbits from the anchor; the selected node is not teleported.
        assert.deepEqual({ ...a.position }, { x: 0, y: 0, z: 0 });
        assert.deepEqual({ ...controller.state.lastMiddleDragPos }, { x: 400, y: 300 });
    });
});

// ------------------------------------------------------------- camera lifetime

test("a reset rebuilds the graph without losing the viewing angle", () => {
    withFixture(({ controller }) => {
        controller.state.camera.orbit(40, 15);
        // The console's roll is part of the viewing angle too, so it must
        // survive a reset like the yaw and pitch do.
        controller.state.camera.rotateLocal('z', 0.4);
        controller.state.camera.dolly(2);

        const orientation = controller.state.camera.orientation;
        const distance = controller.state.camera.distance;

        controller.initialize();

        assert.deepEqual(controller.state.camera.orientation, orientation, "orientation must survive a reset");
        assert.equal(controller.state.camera.distance, distance, "zoom must survive a reset");
    });
});

// ------------------------------------------------------------------- teardown

test("mouseout releases every button and the gesture anchor", () => {
    withFixture(({ controller }) => {
        controller.state.b0Down = true;
        controller.state.b1Down = true;
        controller.state.b2Down = true;
        controller.state.lastMiddleDragPos = { x: 1, y: 2 };

        controller.onMouseOut();

        assert.equal(controller.state.b0Down, false);
        assert.equal(controller.state.b1Down, false);
        assert.equal(controller.state.b2Down, false);
        assert.equal(controller.state.lastMiddleDragPos, null);
    });
});

test("handlers run on a controller that was never initialized", () => {
    const elements = demoElements();

    withFakeDom(elements, dom => {
        const graph = new Graph();
        graph.addNode(new Tag({ x: 0, y: 0, z: 0 }, "a"));

        const controller = newUIController(elements, { width: 600, height: 600, graph });

        // initialize() used to install these globals; no handler may still need
        // them, and none may throw on a controller that was never initialized.
        delete dom.window.state;
        delete dom.window.fdg;

        assert.doesNotThrow(() => controller.onMouseOut());
        assert.doesNotThrow(() => controller.orbitTo({ x: 10, y: 10 }));
        assert.doesNotThrow(() => controller.orbitTo({ x: 20, y: 20 }));
        assert.doesNotThrow(() => controller.panCameraTo({ x: 10, y: 10 }));
        assert.doesNotThrow(() => controller.panCameraTo({ x: 20, y: 20 }));
        assert.doesNotThrow(() => controller.onWheel(wheelEvent({ deltaY: 100 })));
        assert.doesNotThrow(() => controller.onTimerTick());
    });
});
