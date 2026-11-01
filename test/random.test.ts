import test from "node:test";
import assert from "node:assert/strict";

import { mulberry32, randomSeed, SEED_LIMIT } from "../src/core/Random";

// Known answers from the canonical mulberry32, computed independently: a refactor that
// changed one would silently change every seeded layout a user may have noted down.
const KNOWN: Array<[number, number[]]> = [
    [1, [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741]],
    [42, [0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693]],
    [SEED_LIMIT - 1, [0.8964226141106337, 0.189478256739676, 0.7156526781618595, 0.9440599093213677]],
];

test("mulberry32 reproduces the canonical sequence for fixed seeds", () => {
    for (const [seed, expected] of KNOWN) {
        const random = mulberry32(seed);
        assert.deepEqual(expected.map(() => random()), expected, `seed ${seed}`);
    }
});

test("mulberry32 draws stay in [0, 1)", () => {
    const random = mulberry32(7);

    for (let i = 0; i < 10000; i++) {
        const value = random();
        assert.ok(value >= 0 && value < 1);
    }
});

test("randomSeed is an unsigned 32-bit integer", () => {
    for (let i = 0; i < 100; i++) {
        const seed = randomSeed();
        assert.ok(Number.isInteger(seed) && seed >= 0 && seed < SEED_LIMIT);
    }
});
