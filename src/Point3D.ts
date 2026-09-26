/**
 * A point in model space. Kept distinct from `Point2D` so a model point can
 * only reach the canvas through the projector.
 */
export interface Point3D {
    x: number;
    y: number;
    z: number;
}

export function point3(x: number, y: number, z: number): Point3D {
    return { x, y, z };
}

/** A fresh origin, not a shared constant: callers assign through these objects. */
export function zero3(): Point3D {
    return { x: 0, y: 0, z: 0 };
}
