/**
 * Seeded randomness for graph generation, so a random layout can be reproduced from its seed.
 * mulberry32: 32-bit state, a few integer operations per draw, ample quality for seeding positions.
 */

export type Random = () => number;

/** The largest seed plus one; seeds are unsigned 32-bit integers. */
export const SEED_LIMIT = 2 ** 32;

/** Uniform draws in [0, 1), fully determined by `seed`. */
export function mulberry32(seed: number): Random {

    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) | 0;

        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / SEED_LIMIT;
    };
}

/** A fresh seed for a spec that names none. */
export function randomSeed(): number {
    return Math.floor(Math.random() * SEED_LIMIT);
}
