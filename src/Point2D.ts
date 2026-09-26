/** A point in canvas space and on the projected plane; model space is `Point3D`. */
export interface Point2D {
    x: number;
    y: number;
}

export function point(x: number, y: number): Point2D {
    return { x, y };
}

/** A fresh origin, not a shared constant: callers assign through these objects. */
export function zero(): Point2D {
    return { x: 0, y: 0 };
}
