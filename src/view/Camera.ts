import { K } from "../core/K";
import { axisAngle, Mat3, multiply, rotX, rotY, rotZ } from "./Mat3";
import { clamp } from "../core/Numeric";
import { point3, Point3D } from "../core/Point3D";
import { CameraView, defaultCameraView } from "./Projector";

/** Each vocabulary is a runtime tuple with its type derived from it, so the guards cannot drift. */
export const CAMERA_AXES = ['x', 'y', 'z'] as const;
export type CameraAxis = typeof CAMERA_AXES[number];

export const CAMERA_DIRECTIONS = ['cw', 'acw'] as const;
export type CameraDirection = typeof CAMERA_DIRECTIONS[number];

export const CAMERA_ZOOMS = ['in', 'out'] as const;
export type CameraZoom = typeof CAMERA_ZOOMS[number];

export function isCameraAxis(value: string | null): value is CameraAxis {
    return value !== null && (CAMERA_AXES as readonly string[]).includes(value);
}

export function isCameraDirection(value: string | null): value is CameraDirection {
    return value !== null && (CAMERA_DIRECTIONS as readonly string[]).includes(value);
}

export function isCameraZoom(value: string | null): value is CameraZoom {
    return value !== null && (CAMERA_ZOOMS as readonly string[]).includes(value);
}

/**
 * Everything `sameCameraView` compares; `orientation` is a plain array so a caller can overwrite one scratch
 * in place.
 */
export interface CameraViewState {
    readonly orientation: readonly number[];
    readonly target: { readonly x: number; readonly y: number; readonly z: number };
    readonly distance: number;
    readonly focalLength: number;
    readonly nearPlane: number;
}

/** Writable twin of `CameraViewState`, overwritten in place so recording a frame allocates nothing. */
export interface MutableCameraView {
    orientation: number[];
    target: Point3D;
    distance: number;
    focalLength: number;
    nearPlane: number;
}

/** A fresh writable camera view seeded from `view` (default `defaultCameraView()`). */
export function cameraScratch(view: CameraView = defaultCameraView()): MutableCameraView {
    return {
        orientation: [...view.orientation],
        target: point3(view.target.x, view.target.y, view.target.z),
        distance: view.distance,
        focalLength: view.focalLength,
        nearPlane: view.nearPlane,
    };
}

export function copyCameraView(view: CameraViewState, out: MutableCameraView): void {

    for (let i = 0; i < 9; i++)
        out.orientation[i] = view.orientation[i];

    out.target.x = view.target.x;
    out.target.y = view.target.y;
    out.target.z = view.target.z;
    out.distance = view.distance;
    out.focalLength = view.focalLength;
    out.nearPlane = view.nearPlane;
}

/** Compares the 9 orientation entries, target and distance; deliberately not a revision counter. */
export function sameCameraView(a: CameraViewState, b: CameraViewState): boolean {

    if (a.distance !== b.distance)
        return false;

    if (a.target.x !== b.target.x || a.target.y !== b.target.y || a.target.z !== b.target.z)
        return false;

    for (let i = 0; i < 9; i++) {
        if (a.orientation[i] !== b.orientation[i])
            return false;
    }

    return true;
}

/** Look direction's elevation above the world XY plane, radians in [-pi/2, pi/2]. */
export function elevationOf(orientation: Mat3): number {
    return Math.asin(clamp(orientation[7], -1, 1));
}

// Axis a pitch tilt turns about; at a pole every horizontal axis qualifies, so world x is returned.
function pitchAxis(orientation: Mat3): Point3D {
    const x = -orientation[8];
    const z = orientation[6];
    const length = Math.hypot(x, z);

    if (length < 1e-9)
        return point3(1, 0, 0);

    return point3(x / length, 0, z / length);
}

/**
 * The live camera; `orientation` is a world -> camera matrix, not a yaw/pitch pair, so each console button
 * can rotate about its named axis.
 */
export class Camera implements CameraView {

    // Assigned only by applyPose(); the definite assignment assertions rely on that.
    orientation!: Mat3;

    target!: Point3D;
    distance!: number;

    /** Fixed; the wheel dollies `distance`, never these. */
    readonly focalLength: number;
    readonly nearPlane: number;

    constructor() {
        const defaults = defaultCameraView();

        this.focalLength = defaults.focalLength;
        this.nearPlane = defaults.nearPlane;

        this.applyPose(defaults);
    }

    get elevation(): number {
        return elevationOf(this.orientation);
    }

    /**
     * Orbit by a CSS-pixel delta: horizontal about world Y, vertical about the current
     * horizontal axis. The applied delta is clamped, so a drag cannot tumble through a pole.
     */
    orbit(dxPixels: number, dyPixels: number): void {

        this.orientation = multiply(
            this.orientation,
            rotY(dxPixels * K.camera.orbitRadiansPerPixel)
        );

        // A pure yaw must not re-clamp an elevation the console pushed past the guard.
        if (dyPixels === 0)
            return;

        const elevation = this.elevation;
        const requested = elevation + dyPixels * K.camera.orbitRadiansPerPixel;
        const delta = clamp(requested, -K.camera.maxPitch, K.camera.maxPitch) - elevation;

        if (delta === 0)
            return;

        const axis = pitchAxis(this.orientation);

        // The view direction turns by +delta about this axis, hence the negated angle.
        this.orientation = multiply(
            this.orientation,
            axisAngle(axis.x, axis.y, axis.z, -delta)
        );
    }

    /** Rotate about one of the camera's own axes, right-hand positive; no clamp, so it is free 3-DOF. */
    rotateLocal(axis: CameraAxis, radians: number): void {

        const step = axis === 'x' ? rotX(radians) : axis === 'y' ? rotY(radians) : rotZ(radians);

        this.orientation = multiply(step, this.orientation);
    }

    /**
     * Dolly by wheel notches; positive zooms out. Clamped above the near plane so
     * the target plane is never culled, and at `maxDistance` so a far zoom cannot shrink every node away.
     */
    dolly(notches: number): void {
        this.distance = clamp(
            this.distance * Math.pow(K.camera.dollyPerWheelNotch, notches),
            K.camera.minDistance,
            K.camera.maxDistance
        );
    }

    /** Dolly one step; zooming in moves toward the target, i.e. a negative dolly. */
    zoom(direction: CameraZoom): void {
        this.dolly(direction === 'in' ? -1 : 1);
    }

    /** Moves the look-at point; node positions are untouched. */
    panBy(delta: Point3D): void {
        this.target.x += delta.x;
        this.target.y += delta.y;
        this.target.z += delta.z;
    }

    reset(): void {
        this.applyPose(defaultCameraView());
    }

    // Shared by the constructor and reset(), so `defaultCameraView()` is the one definition.
    private applyPose(view: CameraView): void {
        this.orientation = view.orientation;
        this.target = point3(view.target.x, view.target.y, view.target.z);
        this.distance = view.distance;
    }
}
