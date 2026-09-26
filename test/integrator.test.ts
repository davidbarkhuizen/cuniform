import test from "node:test";
import assert from "node:assert/strict";

import { K } from "../src/K";
import { assertClose } from "./support/assert";
import { CANVAS_H, CANVAS_W, singleNode } from "./support/physics";

test("the integrator keeps timeStep/(1-friction) at the reference value of 1", () => {
    const gain = K.physics.timeStep / (1 - K.physics.friction);
    assertClose(gain, 1, 1e-9, `force gain was ${gain}`);
});

test("a constant force drives velocity to a terminal displacement of exactly F", () => {
    const { a, fdg } = singleNode();

    const F = 7;

    for (let i = 0; i < 300; i++) {
        a.velocity = fdg.velocityAtTag(a, { x: F, y: 0, z: 0 });
    }

    const expected = (F * K.physics.timeStep) / (1 - K.physics.friction);
    assertClose(a.velocity.x, expected, 1e-6, `terminal displacement was ${a.velocity.x}, expected ${expected}`);
    assertClose(expected, F, 1e-9, "terminal displacement should equal F");
});

test("with no net force, velocity decays by exactly FRICTION each step", () => {
    const { a, fdg } = singleNode();
    a.velocity = { x: 10, y: 0, z: 0 };

    a.velocity = fdg.velocityAtTag(a, { x: 0, y: 0, z: 0 });

    assertClose(a.velocity.x, 10 * K.physics.friction, 1e-9, `velocity was ${a.velocity.x}`);
});

test("displacement is the damped velocity, not the raw net force", () => {
    const { a, fdg } = singleNode();

    assert.deepEqual(a.displacement, { x: 0, y: 0, z: 0 }, "velocity starts at zero");

    a.velocity = fdg.velocityAtTag(a, { x: 7, y: 0, z: 0 });

    assertClose(
        a.displacement.x,
        7 * K.physics.timeStep,
        1e-12,
        "one step of F must advance only F*timeStep"
    );
    assert.deepEqual(a.displacement, a.velocity);
});

test("position advances by the velocity on each unpinned step", () => {
    const { a, fdg } = singleNode();

    a.velocity = { x: 3, y: -4, z: 0 };
    fdg.step(CANVAS_W, CANVAS_H);

    // Velocity is overwritten first (0.9 * v for a lone node), then position advances by it.
    assertClose(a.position.x, 3 * K.physics.friction, 1e-9);
    assertClose(a.position.y, -4 * K.physics.friction, 1e-9);
});
