import { BAND_HALF, BAND_STRIDE, BAND_X_MAX, BAND_X_MIN, BAND_Y, BAND_Z_MAX, BAND_Z_MIN } from "../graph/Attributes";
import { K } from "../core/K";
import { clamp } from "../core/Numeric";
import { fromYawPitch } from "./Mat3";
import { point3 } from "../core/Point3D";
import { CameraView } from "./Projector";

// The initial view (workplan D6): slightly turned and looking slightly down, so bands read as slabs and not
// lines. Set on load only and never re-fitted per frame, which keeps the "no breathing" decision.
export const FIT_YAW = 0.45;
// Negative: Rx(pitch) with pitch < 0 tilts the view to look down onto the bands.
export const FIT_PITCH = -0.35;

// The fraction of the viewport's shorter half the model's bounding sphere may fill.
export const FIT_MARGIN = 0.9;

/**
 * A camera that frames every band: aimed at the bands' bounding-box centre, at the distance where the box's
 * bounding sphere fits the viewport's shorter half (the projected plane spans +-H_0/2 there), clamped to the
 * dolly range. Null for an empty table.
 */
export function fitView(bands: Float64Array): CameraView | null {

    const count = bands.length / BAND_STRIDE;

    if (count === 0)
        return null;

    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;

    for (let b = 0; b < count; b++) {
        const o = b * BAND_STRIDE;

        xMin = Math.min(xMin, bands[o + BAND_X_MIN]);
        xMax = Math.max(xMax, bands[o + BAND_X_MAX]);
        yMin = Math.min(yMin, bands[o + BAND_Y] - bands[o + BAND_HALF]);
        yMax = Math.max(yMax, bands[o + BAND_Y] + bands[o + BAND_HALF]);
        zMin = Math.min(zMin, bands[o + BAND_Z_MIN]);
        zMax = Math.max(zMax, bands[o + BAND_Z_MAX]);
    }

    const radius = Math.hypot(xMax - xMin, yMax - yMin, zMax - zMin) / 2;
    const half = Math.min(K.space.W_0, K.space.H_0) / 2 * FIT_MARGIN;

    // A sphere of `radius` at distance d projects to at most focal * radius / (d - radius).
    const distance = radius + K.camera.focalLength * radius / half;

    return {
        orientation: fromYawPitch(FIT_YAW, FIT_PITCH),
        target: point3((xMin + xMax) / 2, (yMin + yMax) / 2, (zMin + zMax) / 2),
        distance: clamp(distance, K.camera.minDistance, K.camera.maxDistance),
        focalLength: K.camera.focalLength,
        nearPlane: K.camera.nearPlane,
    };
}
