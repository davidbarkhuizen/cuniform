/**
 * One representation for a 3D point, used for model-space coordinates.
 *
 * This is an interface rather than a class on purpose: the value was already
 * built as an object literal everywhere the physics loop touches it, and the
 * class only compiled because TypeScript is structural. A class would force
 * allocation ceremony into the per-node, per-tick path for no type-safety gain.
 * `point3()` and `zero3()` exist for the construction sites that want a named
 * factory.
 *
 * `Point2D` stays exactly as it was and keeps its meaning: canvas space.
 * Keeping the two types distinct is the enforcement mechanism - a model point
 * can only reach the canvas through the projector.
 */
export interface Point3D {
    x: number;
    y: number;
    z: number;
}

/** A point at (x, y, z). */
export function point3(x: number, y: number, z: number): Point3D {
    return { x, y, z };
}

/**
 * A fresh point at the origin. Deliberately a factory, not a shared constant:
 * callers assign through these objects (`position.x = ...`), so a single shared
 * instance would alias every user together.
 */
export function zero3(): Point3D {
    return { x: 0, y: 0, z: 0 };
}
