import assert from "node:assert/strict";

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
