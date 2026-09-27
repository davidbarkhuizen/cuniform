// Force laws shared by the exact solver, its reference, and the Barnes-Hut octree.

import { K } from "../core/K";

const CHARGE_PRODUCT =
    K.physics.scalarForceConstant * K.physics.nodeCharge * K.physics.nodeCharge;

/** Euclidean length: `Math.sqrt`, not `Math.hypot` — hypot's overflow/underflow
 * rescaling is unnecessary for these bounded inputs and costs ~2.2x in the
 * repulsion pass (docs/performance.md). */
export function radius(dx: number, dy: number, dz: number): number {
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** The repulsion law and its r -> 0 clamp; the single home for all three passes. */
export function repulsionMagnitude(r: number): number {
    var r_law = Math.max(r, K.physics.minimumInteractionRadius);

    return CHARGE_PRODUCT / Math.pow(r_law, K.physics.repulsionExponent);
}

/** Hooke magnitude k*(r - l), positive when stretched; the single home for the step and reference paths. */
export function springMagnitude(r: number): number {
    return K.physics.springConstant * (r - K.physics.equilibriumDisplacement);
}

/** Non-reference anchor pull, zero inside the dead zone. Proportional, not constant:
 * a constant pull has no root at the origin and limit-cycles a lone node. */
export function componentAnchorMagnitude(r: number): number {
    return K.physics.componentAnchorStrength * Math.max(0, r - K.physics.componentAnchorRadius);
}

/** Shared damped-Euler update; see the stability note in docs/constants.md. */
export function integrateVelocity(v: number, force: number): number {
    return (v * K.physics.friction) + force * K.physics.timeStep;
}

/** Scaled radial components into caller-owned scratch `out`; `earlier` breaks the
 * `r === 0` tie by pushing the earlier index along -x, so a coincident pair cannot
 * sit in a fixed point. The Barnes-Hut aggregate inlines this for speed
 * (docs/performance.md); every other pass must call it. */
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
