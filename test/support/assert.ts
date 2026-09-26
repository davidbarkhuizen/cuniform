/**
 * Shared assertion helpers.
 *
 * The physics and mapping tests are full of tolerance checks written inline as
 * `Math.abs(actual - expected) < eps`. Stating the comparison once here removes
 * the repetition without loosening anything: every call site keeps the epsilon
 * its inline check used.
 */

import assert from "node:assert/strict";

/**
 * Assert that `actual` is within `eps` of `expected`.
 *
 * The comparison is relative-or-absolute: the accepted difference is
 * `eps * max(1, |expected|)`. That keeps a tight epsilon tight around zero
 * (where the physics tests live) while letting a loose one (say `1.0` for a
 * settled distance) survive a large magnitude. The existing inline checks
 * ranged over `1e-6 .. 1e-12`, so a single absolute epsilon would have silently
 * weakened the tightest of them.
 */
export function assertClose(
    actual: number,
    expected: number,
    eps: number = 1e-9,
    message?: string
): void {
    const difference = Math.abs(actual - expected);
    const tolerance = eps * Math.max(1, Math.abs(expected));

    assert.ok(
        difference <= tolerance,
        message ?? `expected ${actual} to be within ${eps} of ${expected} (was off by ${difference})`
    );
}

/**
 * Assert that two matrices agree element-wise within `eps`. The camera tests
 * compare whole orientations, and a per-element loop at every call site hid
 * which entry had drifted.
 */
export function assertMatClose(
    actual: readonly number[],
    expected: readonly number[],
    eps: number = 1e-12,
    message: string = "matrix"
): void {
    assert.equal(actual.length, expected.length, `${message}: length`);
    actual.forEach((value, index) =>
        assertClose(value, expected[index], eps, `${message} [${index}]`)
    );
}
