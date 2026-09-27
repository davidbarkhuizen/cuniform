// The innermost arithmetic shared by every force consumer: the solver's exact
// pairwise pass, the per-node reference, and (Plan 1) the Barnes-Hut octree.

/**
 * Euclidean length of a delta vector.
 *
 * `Math.sqrt(dx*dx + dy*dy + dz*dz)` rather than `Math.hypot`: hypot is
 * variadic and rescales to survive overflow/underflow, so it cannot compile to
 * a square root plus two multiplies, and it dominates the repulsion pass (the
 * benchmark measures roughly a 2.2x difference at N=1024).
 *
 * The rescaling is unnecessary here because the inputs are bounded model-space
 * doubles: positions start inside the 600-unit cube, drift stays far from the
 * ~1e154 overflow point, and camera-space deltas are bounded by the 8192 camera
 * distance. At the other end, deltas below ~1e-162 square to zero, so `sqrt`
 * returns 0 where `hypot` would return a tiny positive value; every caller has
 * an explicit `r === 0` coincident branch and evaluates the magnitude at
 * `minimumInteractionRadius`, so that lands in a bounded, deterministic case
 * rather than a division by zero. See docs/performance/03-distance-kernel.md.
 */
export function radius(dx: number, dy: number, dz: number): number {
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
