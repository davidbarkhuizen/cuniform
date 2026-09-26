import { Point3D } from "./Point3D";

/**
 * A 3x3 rotation as a row-major 9-tuple: `m[row * 3 + column]`. A value, not a
 * class, so it compares structurally under `deepEqual`.
 */
export type Mat3 = readonly [
    number, number, number,
    number, number, number,
    number, number, number,
];

export function identity(): Mat3 {
    return [
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
    ];
}

/** The matrix product `a . b`, so `apply(multiply(a, b), p) == apply(a, apply(b, p))`. */
export function multiply(a: Mat3, b: Mat3): Mat3 {
    const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = a;
    const [b0, b1, b2, b3, b4, b5, b6, b7, b8] = b;

    return [
        a0 * b0 + a1 * b3 + a2 * b6, a0 * b1 + a1 * b4 + a2 * b7, a0 * b2 + a1 * b5 + a2 * b8,
        a3 * b0 + a4 * b3 + a5 * b6, a3 * b1 + a4 * b4 + a5 * b7, a3 * b2 + a4 * b5 + a5 * b8,
        a6 * b0 + a7 * b3 + a8 * b6, a6 * b1 + a7 * b4 + a8 * b7, a6 * b2 + a7 * b5 + a8 * b8,
    ];
}

/**
 * Apply `m` to `p`: the rotation of a column vector. Three sums of three
 * products, so the identity reproduces `p` bit-for-bit.
 */
export function apply(m: Mat3, p: Point3D): Point3D {
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = m;

    return {
        x: m0 * p.x + m1 * p.y + m2 * p.z,
        y: m3 * p.x + m4 * p.y + m5 * p.z,
        z: m6 * p.x + m7 * p.y + m8 * p.z,
    };
}

/** Apply the transpose, `m^T p` - the inverse of `apply` for a rotation. */
export function applyTranspose(m: Mat3, p: Point3D): Point3D {
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = m;

    return {
        x: m0 * p.x + m3 * p.y + m6 * p.z,
        y: m1 * p.x + m4 * p.y + m7 * p.z,
        z: m2 * p.x + m5 * p.y + m8 * p.z,
    };
}

/** Rotation about x by `angle` radians, right-hand positive. */
export function rotX(angle: number): Mat3 {
    const c = Math.cos(angle), s = Math.sin(angle);

    return [
        1, 0, 0,
        0, c, -s,
        0, s, c,
    ];
}

/** Rotation about y by `angle` radians, right-hand positive. */
export function rotY(angle: number): Mat3 {
    const c = Math.cos(angle), s = Math.sin(angle);

    return [
        c, 0, s,
        0, 1, 0,
        -s, 0, c,
    ];
}

/** Rotation about z by `angle` radians, right-hand positive. */
export function rotZ(angle: number): Mat3 {
    const c = Math.cos(angle), s = Math.sin(angle);

    return [
        c, -s, 0,
        s, c, 0,
        0, 0, 1,
    ];
}

/** Rotation by `angle` about the unit axis `(x, y, z)` - Rodrigues' formula. */
export function axisAngle(x: number, y: number, z: number, angle: number): Mat3 {
    const c = Math.cos(angle), s = Math.sin(angle), k = 1 - c;

    return [
        c + x * x * k, x * y * k - z * s, x * z * k + y * s,
        y * x * k + z * s, c + y * y * k, y * z * k - x * s,
        z * x * k - y * s, z * y * k + x * s, c + z * z * k,
    ];
}

/** The `Rx(pitch) . Ry(yaw)` orientation. The projector tests describe cameras in angles. */
export function fromYawPitch(yaw: number, pitch: number): Mat3 {
    return multiply(rotX(pitch), rotY(yaw));
}
