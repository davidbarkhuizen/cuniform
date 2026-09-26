import test from "node:test";
import assert from "node:assert/strict";

import { K } from "../src/K";
import { assertClose } from "./support/assert";
import { pairAt } from "./support/physics";

test("repulsion follows k*q^2 / r^1.9 and pushes away from the other node", () => {
    const k = K.physics.scalarForceConstant;
    const q = K.physics.nodeCharge;
    const exponent = K.physics.repulsionExponent;

    assert.equal(exponent, 1.9, "the reference exponent is 1.9, not 2");

    for (const r of [10, 50, 100, 300]) {
        const { a, fdg } = pairAt(r);
        const f = fdg.netElectrostaticForceAtNode(a);

        const expected = (k * q * q) / Math.pow(r, exponent);
        assertClose(
            Math.abs(f.x),
            expected,
            1e-9,
            `r=${r}: |F| was ${Math.abs(f.x)}, expected ${expected}`
        );
        assert.ok(f.x < 0, `r=${r}: a sits at the origin so it must be pushed toward -x`);
        assertClose(f.y, 0, 1e-12, `r=${r}: force should be purely radial`);
    }
});

test("repulsion is exactly 10000 / r^1.9 for the reference constants", () => {
    for (const r of [30, 65.46, 200]) {
        const { a, fdg } = pairAt(r);
        const f = fdg.netElectrostaticForceAtNode(a);
        assertClose(Math.abs(f.x), 10000 / Math.pow(r, 1.9), 1e-9, `r=${r}: got ${Math.abs(f.x)}`);
    }
});

test("a stretched spring pulls the node toward its neighbour", () => {
    const k = K.physics.springConstant;
    const l = K.physics.equilibriumDisplacement;

    const { a, fdg } = pairAt(l + 15);
    const f = fdg.netSpringForceAtNode(a);

    assert.ok(f.x > 0, "r > l must pull toward the neighbour at +x");
    assertClose(f.x, k * 15, 1e-9, `expected ${k * 15}, got ${f.x}`);
});

test("a compressed spring pushes the node away from its neighbour", () => {
    const k = K.physics.springConstant;
    const l = K.physics.equilibriumDisplacement;

    const { a, fdg } = pairAt(l - 20);
    const f = fdg.netSpringForceAtNode(a);

    assert.ok(f.x < 0, "r < l must push away from the neighbour at +x");
    assertClose(f.x, k * (l - 20 - l), 1e-9, `expected ${k * -20}, got ${f.x}`);
});

test("a spring at its rest length exerts no force", () => {
    const { a, fdg } = pairAt(K.physics.equilibriumDisplacement);
    const f = fdg.netSpringForceAtNode(a);

    assertClose(f.x, 0, 1e-12);
    assertClose(f.y, 0, 1e-12);
});

test("net force is the sum of the two cached contributions", () => {
    const { a, fdg } = pairAt(100);
    a.netElectrostaticForce = { x: 3, y: 4 };
    a.netSpringForce = { x: 1, y: -2 };

    assert.deepEqual(fdg.netForceAtNode(a), { x: 4, y: 2 });
});
