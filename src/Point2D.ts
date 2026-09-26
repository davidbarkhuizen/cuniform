/**
 * One representation for a 2D point, used for both model-space and
 * canvas-space coordinates.
 *
 * This is an interface rather than a class on purpose: the value was already
 * built as an object literal everywhere the physics loop touches it, and the
 * class only compiled because TypeScript is structural. A class would force
 * allocation ceremony into the per-node, per-tick path for no type-safety gain.
 * `point()` and `zero()` exist for the construction sites that want a named
 * factory.
 */
export interface Point2D {
    x: number;
    y: number;
}

/** A point at (x, y). */
export function point(x: number, y: number): Point2D {
    return { x, y };
}

/**
 * A fresh point at the origin. Deliberately a factory, not a shared constant:
 * callers assign through these objects (`position.x = ...`), so a single shared
 * instance would alias every user together.
 */
export function zero(): Point2D {
    return { x: 0, y: 0 };
}
