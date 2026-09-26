/**
 * One representation for a 2D point: canvas space, and the projected plane the
 * projector produces on the way there. Model space is `Point3D`.
 *
 * This is an interface rather than a class on purpose: the value is built as an
 * object literal everywhere it is used, and the class form only compiled because
 * TypeScript is structural. A class would force allocation ceremony into the
 * per-node path for no type-safety gain. `point()` and `zero()` exist for the
 * construction sites that want a named factory.
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
