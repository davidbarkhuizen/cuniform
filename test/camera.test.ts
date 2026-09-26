import test from "node:test";
import assert from "node:assert/strict";

import { Camera } from "../src/Camera";
import { K } from "../src/K";
import { apply, fromYawPitch, identity, Mat3, multiply, rotX, rotY, rotZ } from "../src/Mat3";
import { point3 } from "../src/Point3D";
import { assertClose, assertMatClose } from "./support/assert";

test("a fresh camera is the identity orientation at the K defaults", () => {
    const camera = new Camera();

    assert.deepEqual(camera.orientation, identity());
    assert.equal(camera.distance, K.camera.distance);
    assert.equal(camera.focalLength, K.camera.focalLength);
    assert.equal(camera.nearPlane, K.camera.nearPlane);
    assert.deepEqual(camera.target, { x: 0, y: 0, z: 0 });
});

test("orbit scales the pointer delta by the configured rate", () => {
    const camera = new Camera();

    camera.orbit(10, -20);

    const rate = K.camera.orbitRadiansPerPixel;
    assertMatClose(camera.orientation, fromYawPitch(10 * rate, -20 * rate), 1e-12, "orbit");
});

test("orbit clamps the elevation to the turntable guard, at both signs", () => {
    const camera = new Camera();

    camera.orbit(0, 1e6);
    assertClose(camera.elevation, K.camera.maxPitch, 1e-12, "elevation");

    // A second huge drag towards the same pole must stay on the guard rather
    // than tumbling through it and coming out the far side.
    camera.orbit(0, 1e6);
    assertClose(camera.elevation, K.camera.maxPitch, 1e-12, "elevation after a second drag");

    camera.orbit(0, -1e6);
    assertClose(camera.elevation, -K.camera.maxPitch, 1e-12, "elevation");

    assert.ok(Math.abs(camera.elevation) < Math.PI / 2, "the view must stay off the pole");
});

test("a horizontal drag is a pure yaw that leaves the elevation alone", () => {
    const camera = new Camera();

    camera.orbit(40, 25);
    const elevation = camera.elevation;

    camera.orbit(50, 0);

    assertClose(camera.elevation, elevation, 1e-12, "a pure yaw must not tilt");
});

test("dolly scales the distance and clamps above the near plane", () => {
    const camera = new Camera();

    camera.dolly(1);
    assertClose(camera.distance, K.camera.distance * K.camera.dollyPerWheelNotch, 1e-9);

    camera.dolly(-1);
    assertClose(camera.distance, K.camera.distance, 1e-9, "the dolly must be reversible");

    for (let i = 0; i < 500; i++)
        camera.dolly(-1);

    assert.equal(camera.distance, K.camera.minDistance);
    assert.ok(camera.distance > camera.nearPlane, "the target plane is never culled");
});

test("panBy moves only the target", () => {
    const camera = new Camera();

    camera.panBy(point3(5, -7, 9));

    assert.deepEqual(camera.target, { x: 5, y: -7, z: 9 });
});

// ---------------------------------------------------------- local rotation

test("rotateLocal is a left multiplication about the named camera axis", () => {
    // A deliberately rolled, yawed, pitched start: the point is that each
    // button composes on the camera's frame, not on the world's.
    const start = multiply(fromYawPitch(0.4, -0.3), rotZ(0.2));

    const cases: Array<{ axis: 'x' | 'y' | 'z'; step: (angle: number) => Mat3 }> = [
        { axis: 'x', step: rotX },
        { axis: 'y', step: rotY },
        { axis: 'z', step: rotZ },
    ];

    for (const { axis, step } of cases) {
        const camera = new Camera();
        camera.orientation = start;
        camera.rotateLocal(axis, 0.25);

        assertMatClose(
            camera.orientation,
            multiply(step(0.25), start),
            1e-12,
            `rotateLocal(${axis})`
        );
    }
});

test("opposite rotateLocal steps cancel", () => {
    const camera = new Camera();
    camera.orbit(30, 20);

    camera.rotateLocal('y', 0.3);
    camera.rotateLocal('y', -0.3);

    assertMatClose(camera.orientation, fromYawPitch(30 * K.camera.orbitRadiansPerPixel,
        20 * K.camera.orbitRadiansPerPixel), 1e-12, "round trip");
});

test("anticlockwise is the right-hand positive sense about each camera axis", () => {
    // The on-screen reading of the console's sign convention, asserted in
    // camera space: +x is right, +y is up and +z is along the view axis.
    const step = K.camera.rotateStepRadians;

    const aboutX = new Camera();
    aboutX.rotateLocal('x', step);
    const afterX = apply(aboutX.orientation, point3(0, 1, 0));
    assert.ok(afterX.z > 0, `about x: up must move towards the view axis, got z=${afterX.z}`);

    const aboutY = new Camera();
    aboutY.rotateLocal('y', step);
    const afterY = apply(aboutY.orientation, point3(0, 0, 1));
    assert.ok(afterY.x > 0, `about y: the view axis must move right, got x=${afterY.x}`);

    const aboutZ = new Camera();
    aboutZ.rotateLocal('z', step);
    const afterZ = apply(aboutZ.orientation, point3(1, 0, 0));
    assert.ok(afterZ.y > 0, `about z: right must move up, got y=${afterZ.y}`);
});

test("rotateLocal is free 3-DOF and does not trap the camera at a pole", () => {
    const camera = new Camera();

    camera.rotateLocal('x', Math.PI / 2);
    assertClose(camera.elevation, Math.PI / 2, 1e-12, "the console may reach the pole");

    // A horizontal drag then yaws, with the pitch axis falling back rather
    // than dividing by ~zero; a vertical drag re-engages the guard.
    camera.orbit(10, 0);
    assert.ok(camera.orientation.every(Number.isFinite), "no NaN at the pole");
    assertClose(camera.elevation, Math.PI / 2, 1e-12, "a pure yaw must not tilt");

    camera.orbit(0, 10);
    assertClose(camera.elevation, K.camera.maxPitch, 1e-12, "the guard re-engages");
});

test("reset restores the identity orientation and framing", () => {
    const camera = new Camera();

    camera.orbit(100, 50);
    camera.rotateLocal('z', 0.7);
    camera.dolly(3);
    camera.panBy(point3(1, 2, 3));

    camera.reset();

    assert.deepEqual(camera.orientation, identity());
    assert.equal(camera.distance, K.camera.distance);
    assert.deepEqual(camera.target, { x: 0, y: 0, z: 0 });
});
