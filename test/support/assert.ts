// Shared tolerance assertions. Each call site keeps the epsilon its inline
// check used, so none of them is loosened.

import assert from "node:assert/strict";

// Asserts `actual` is within `eps` of `expected`. The tolerance is
// `eps * max(1, |expected|)`: tight near zero, scale-tolerant at magnitude.
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

/** Assert two matrices agree element-wise within `eps`. */
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
