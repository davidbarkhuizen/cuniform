import test from "node:test";
import assert from "node:assert/strict";

import { K } from "../src/K";
import { fromYawPitch, identity, multiply, rotZ } from "../src/Mat3";
import { point3, Point3D } from "../src/Point3D";
import { CameraView, defaultCameraView, Projector } from "../src/Projector";
import { Viewport } from "../src/Viewport";
import { assertClose } from "./support/assert";
import { readSource } from "./support/files";

function camera(overrides: Partial<CameraView> = {}): CameraView {
    return { ...defaultCameraView(), ...overrides };
}

function distance3(a: Point3D, b: Point3D): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// Deterministic xorshift32 in [-1, 1), so a failing random fixture is reproducible.
function makeRandom(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state ^= state << 13; state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5; state >>>= 0;
        return (state / 0xffffffff) * 2 - 1;
    };
}

// ------------------------------------------------------- the regression anchor

test("forCanvas defaults to the identity camera that reduces to the 2D view", () => {
    const projector = Projector.forCanvas(800, 600);

    assert.deepEqual(projector.camera.orientation, identity());
    assert.deepEqual(projector.camera.target, { x: 0, y: 0, z: 0 });

    // The 1:1 anchor needs focalLength === distance; drift breaks the equality below.
    assert.equal(projector.camera.focalLength, projector.camera.distance);
});

test("the identity camera with z = 0 equals Viewport.toCanvas exactly", () => {
    const points: Array<[number, number]> = [
        [0, 0], [-250, 120], [180, -200], [123.4, -56.7], [-299, 299], [1e-9, -1e-9],
    ];

    for (const [w, h] of [[800, 600], [600, 800], [1200, 600], [1024, 768]] as Array<[number, number]>) {
        const projector = Projector.forCanvas(w, h);
        const viewport = Viewport.forCanvas(w, h);

        for (const [x, y] of points) {
            const p = point3(x, y, 0);

            // Exact deepEqual: focalLength is a power of two, so the identity is bit-exact.
            assert.deepEqual(
                projector.toCanvas(p),
                viewport.toCanvas({ x, y }),
                `${w}x${h} point ${x},${y}`
            );
            assert.equal(projector.project(p).depth, K.camera.distance, `${w}x${h} depth`);
        }
    }
});

// -------------------------------------------------------------------- rotation

test("the camera rotation is rigid: pairwise model distances are preserved", () => {
    const rnd = makeRandom(12345);

    const projector = new Projector(
        camera({
            orientation: multiply(rotZ(0.35), fromYawPitch(0.7, -0.4)),
            target: point3(10, -20, 30),
        }),
        Viewport.forCanvas(800, 600)
    );

    const points: Point3D[] = [];
    for (let i = 0; i < 20; i++)
        points.push(point3(rnd() * 300, rnd() * 300, rnd() * 300));

    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const world = distance3(points[i], points[j]);
            const view = distance3(
                projector.toCameraSpace(points[i]),
                projector.toCameraSpace(points[j])
            );

            assertClose(view, world, 1e-9, `pair ${i},${j} stretched`);
        }
    }
});

test("a camera at the elevation guard keeps the basis rigid and invertible (no pole flip)", () => {
    assert.ok(K.camera.maxPitch < Math.PI / 2, "the guard must be strictly inside the pole");
    assert.ok(K.camera.maxPitch > Math.PI / 2 - 0.1, "the guard should not give up much pitch");

    const projector = new Projector(
        camera({ orientation: fromYawPitch(1.1, K.camera.maxPitch) }),
        Viewport.forCanvas(800, 600)
    );

    const a = point3(30, -80, 120);
    const b = point3(-140, 60, -20);

    assertClose(
        distance3(projector.toCameraSpace(a), projector.toCameraSpace(b)),
        distance3(a, b),
        1e-9,
        "the clamped basis must stay rigid"
    );

    const { screen, depth } = projector.project(a);
    const back = projector.unprojectScreen(screen, depth);

    assertClose(back.x, a.x, 1e-9);
    assertClose(back.y, a.y, 1e-9);
    assertClose(back.z, a.z, 1e-9);
});

// -------------------------------------------------------------------- inverse

test("unproject at a point's depth is the exact inverse of project", () => {
    const rnd = makeRandom(9876);

    const cameras = [
        camera(),
        camera({ orientation: fromYawPitch(0.6, 0.3) }),
        camera({ orientation: fromYawPitch(-1.2, -0.9), target: point3(-50, 20, 80), distance: 900 }),
        camera({ orientation: fromYawPitch(2.4, K.camera.maxPitch), target: point3(120, -160, 150), distance: 1400 }),
        // Rolled: the round trip must not depend on there being only two Euler angles.
        camera({ orientation: multiply(rotZ(0.5), fromYawPitch(0.6, 0.3)), target: point3(10, -20, 30) }),
    ];

    let tested = 0;

    for (const cam of cameras) {
        const projector = new Projector(cam, Viewport.forCanvas(1024, 768));

        for (let i = 0; i < 30; i++) {
            const p = point3(rnd() * 300, rnd() * 300, rnd() * 300);
            const { screen, depth } = projector.project(p);

            // The guard makes projection non-invertible inside the near plane; those points are culled.
            if (projector.isCulled(depth))
                continue;

            const back = projector.unprojectScreen(screen, depth);

            assertClose(back.x, p.x, 1e-9, `x back from ${p.x}`);
            assertClose(back.y, p.y, 1e-9, `y back from ${p.y}`);
            assertClose(back.z, p.z, 1e-9, `z back from ${p.z}`);
            tested++;
        }
    }

    assert.ok(tested >= 100, `the round trip must actually run; only ${tested} points were in front`);
});

test("unproject from a canvas point matches the projected-plane inverse", () => {
    const projector = new Projector(
        camera({ orientation: fromYawPitch(0.4, -0.2), target: point3(20, 30, -40), distance: 800 }),
        Viewport.forCanvas(1024, 768)
    );

    const p = point3(50, -70, 90);
    const { screen, depth } = projector.project(p);

    const back = projector.unproject(projector.viewport.toCanvas(screen), depth);

    assertClose(back.x, p.x, 1e-9);
    assertClose(back.y, p.y, 1e-9);
    assertClose(back.z, p.z, 1e-9);
});

// ---------------------------------------------------------------- perspective

test("a nearer point projects farther from the centre than a farther one", () => {
    const projector = Projector.forCanvas(600, 600);

    // The camera sits at z = -distance looking toward +z, so smaller z is nearer.
    const near = projector.project(point3(100, 0, -100));
    const far = projector.project(point3(100, 0, 100));

    assert.ok(near.depth < far.depth, "the point at -z is the nearer one");
    assert.ok(Math.abs(near.screen.x) > 100, `near screen x was ${near.screen.x}, expected > 100`);
    assert.ok(Math.abs(far.screen.x) < 100, `far screen x was ${far.screen.x}, expected < 100`);
});

test("the near plane culls and bounds the perspective divide", () => {
    const projector = Projector.forCanvas(600, 600);
    const nearPlane = K.camera.nearPlane;

    assert.equal(projector.isCulled(nearPlane), true, "exactly at the guard is culled");
    assert.equal(projector.isCulled(nearPlane - 1), true);
    assert.equal(projector.isCulled(nearPlane + 1e-9), false, "just inside is not culled");

    // Behind the near plane the divide is evaluated at the guard, so it stays finite.
    const behind = projector.project(point3(100, 0, -K.camera.distance - 100));

    assert.ok(behind.depth < nearPlane, `depth was ${behind.depth}`);
    assert.equal(projector.isCulled(behind.depth), true);
    assert.ok(Number.isFinite(behind.screen.x) && Number.isFinite(behind.screen.y), "must stay finite");

    // Even at exactly zero depth the guard bounds the divide.
    const atZero = projector.project(point3(100, 0, -K.camera.distance));

    assert.equal(atZero.depth, 0);
    assert.ok(Number.isFinite(atZero.screen.x), "zero depth must not produce a non-finite coordinate");
    assert.ok(Math.abs(atZero.screen.x) > 0);
});

// ------------------------------------------------------------ architecture

test("the projector is pure math with no browser coupling", () => {
    const projector = readSource("Projector.ts");

    assert.ok(!/\bwindow\b/.test(projector), "the projector must not reference window");
    assert.ok(!/\bdocument\b/.test(projector), "the projector must not reference document");
    assert.equal(
        projector.split("CanvasRenderingContext2D").length - 1,
        0,
        "the projector must not name a canvas type"
    );
});
