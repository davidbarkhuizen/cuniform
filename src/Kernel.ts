// The innermost arithmetic shared by every force consumer: the solver's exact
// pairwise pass, the per-node reference, and the Barnes-Hut octree.

import { K } from "./K";

// k*q^2, the numerator of the repulsion law. Hoisted because repulsionMagnitude
// runs at least once per interaction and the factors are constants.
const CHARGE_PRODUCT =
    K.physics.scalarForceConstant * K.physics.nodeCharge * K.physics.nodeCharge;

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
 * rather than a division by zero. See docs/performance.md.
 */
export function radius(dx: number, dy: number, dz: number): number {
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * The repulsion magnitude law, k*q^2 / max(r, minimumInteractionRadius)^1.9.
 *
 * The single home for the law: the exact pairwise kernel, the per-node reference
 * and the Barnes-Hut aggregate all call it, so they cannot drift apart. Only the
 * far-field *evaluation* differs between them. The clamp bounds the r -> 0
 * singularity; callers still use the true radius for direction.
 */
export function repulsionMagnitude(r: number): number {
    var r_law = Math.max(r, K.physics.minimumInteractionRadius);

    return CHARGE_PRODUCT / Math.pow(r_law, K.physics.repulsionExponent);
}

/**
 * The Hooke magnitude for an edge of length `r`, k*(r - l): positive when the
 * edge is stretched, so the pair is pulled together, negative when compressed.
 *
 * The single home for the spring law, alongside `repulsionMagnitude`, so the
 * solver's step path and its object-returning reference cannot drift.
 */
export function springMagnitude(r: number): number {
    return K.physics.springConstant * (r - K.physics.equilibriumDisplacement);
}

/**
 * One damped semi-implicit Euler velocity update, `v' = v*friction + F*timeStep`.
 *
 * `stepPhysics()` and `velocityAtTag()` both call it, so the integration law -
 * the one the `timeStep / (1 - friction) ~= 1` stability note in
 * docs/constants.md is about - has one home.
 */
export function integrateVelocity(v: number, force: number): number {
    return (v * K.physics.friction) + force * K.physics.timeStep;
}

/**
 * The three scaled components of a radial interaction of `magnitude` between two
 * centres offset by `(dx, dy, dz)` at distance `r`, written into `out`.
 *
 * `earlier` breaks the coincident case (`r === 0`), where there is no radial
 * direction and an unconnected pair would sit in a permanent fixed point: the
 * earlier index is pushed along -x and the later along +x. The divisor is 1
 * there, so the push is exactly `-/+ magnitude`.
 *
 * The single home for that rule: the exact paired pass, the per-node reference,
 * the spring pass and the Barnes-Hut leaf all call it, so they cannot disagree
 * about direction at the singular boundary. `out` is caller-owned scratch, which
 * is what keeps the hot passes allocation-free.
 */
export function radialComponentsInto(
    dx: number,
    dy: number,
    dz: number,
    r: number,
    magnitude: number,
    earlier: boolean,
    out: Float64Array
): void {

    if (r === 0) {
        out[0] = earlier ? -magnitude : magnitude;
        out[1] = 0;
        out[2] = 0;
        return;
    }

    out[0] = (magnitude * dx) / r;
    out[1] = (magnitude * dy) / r;
    out[2] = (magnitude * dz) / r;
}
