import test from "node:test";
import assert from "node:assert/strict";

import { Camera } from "../src/Camera";
import { K } from "../src/K";
import { point3 } from "../src/Point3D";
import { assertClose } from "./support/assert";

test("a fresh camera matches the K defaults", () => {
    const camera = new Camera();

    assert.equal(camera.yaw, K.camera.yaw);
    assert.equal(camera.pitch, K.camera.pitch);
    assert.equal(camera.distance, K.camera.distance);
    assert.equal(camera.focalLength, K.camera.focalLength);
    assert.equal(camera.nearPlane, K.camera.nearPlane);
    assert.deepEqual(camera.target, { x: 0, y: 0, z: 0 });
});

test("orbit scales the pointer delta by the configured rate", () => {
    const camera = new Camera();

    camera.orbit(10, -20);

    assertClose(camera.yaw, 10 * K.camera.orbitRadiansPerPixel, 1e-12, "yaw");
    assertClose(camera.pitch, -20 * K.camera.orbitRadiansPerPixel, 1e-12, "pitch");
});

test("orbit clamps pitch to the gimbal guard", () => {
    const camera = new Camera();

    camera.orbit(0, 1e6);
    assert.equal(camera.pitch, K.camera.maxPitch);

    camera.orbit(0, -1e6);
    assert.equal(camera.pitch, -K.camera.maxPitch);

    assert.ok(Math.abs(camera.pitch) < Math.PI / 2, "the basis must never reach the pole");
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

test("reset restores the default orientation and framing", () => {
    const camera = new Camera();

    camera.orbit(100, 50);
    camera.dolly(3);
    camera.panBy(point3(1, 2, 3));

    camera.reset();

    assert.equal(camera.yaw, K.camera.yaw);
    assert.equal(camera.pitch, K.camera.pitch);
    assert.equal(camera.distance, K.camera.distance);
    assert.deepEqual(camera.target, { x: 0, y: 0, z: 0 });
});
