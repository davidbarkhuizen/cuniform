/** A model-space point; distinct from `Point2D` so it reaches the canvas only through the projector. */
export interface Point3D {
    x: number;
    y: number;
    z: number;
}

export function point3(x: number, y: number, z: number): Point3D {
    return { x, y, z };
}

/** A fresh origin each call: callers assign through the returned object. */
export function zero3(): Point3D {
    return { x: 0, y: 0, z: 0 };
}
