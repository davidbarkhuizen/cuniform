import { K } from "./K";
import { axisAngle, Mat3, multiply, rotX, rotY, rotZ } from "./Mat3";
import { clamp } from "./Numeric";
import { point3, Point3D } from "./Point3D";
import { CameraView, defaultCameraView } from "./Projector";

/**
 * The axes a console button rotates about, and the directions it turns. Each
 * vocabulary is a runtime tuple with its type derived from it, so the type and
 * the guard that validates a `data-axis`/`data-direction` attribute cannot drift
 * apart.
 */
export const CAMERA_AXES = ['x', 'y', 'z'] as const;
export type CameraAxis = typeof CAMERA_AXES[number];

export const CAMERA_DIRECTIONS = ['cw', 'acw'] as const;
export type CameraDirection = typeof CAMERA_DIRECTIONS[number];

/** True when `value` names a camera axis. */
export function isCameraAxis(value: string | null): value is CameraAxis {
    return value !== null && (CAMERA_AXES as readonly string[]).includes(value);
}

/** True when `value` names a rotation direction. */
export function isCameraDirection(value: string | null): value is CameraDirection {
    return value !== null && (CAMERA_DIRECTIONS as readonly string[]).includes(value);
}

/**
 * The mutable part of a camera: everything `sameCameraView` compares. A caller
 * can keep one scratch copy and overwrite it, which is why `orientation` is a
 * plain (read-only to the reader) array rather than the `Mat3` tuple.
 * `focalLength`/`nearPlane` are fixed for a camera's life but are carried so the
 * state is a faithful view.
 */
export interface CameraViewState {
    readonly orientation: readonly number[];
    readonly target: { readonly x: number; readonly y: number; readonly z: number };
    readonly distance: number;
    readonly focalLength: number;
    readonly nearPlane: number;
}

/**
 * The writable twin of a camera view: the scratch a caller keeps and overwrites
 * in place, so recording the frame it drew allocates nothing.
 */
export interface MutableCameraView {
    orientation: number[];
    target: Point3D;
    distance: number;
    focalLength: number;
    nearPlane: number;
}

/**
 * A fresh scratch camera view, seeded from `view` (the default camera by
 * default). The one definition of "the default camera" stays
 * `defaultCameraView()`; this only adds the writable copy around it.
 */
export function cameraScratch(view: CameraView = defaultCameraView()): MutableCameraView {
    return {
        orientation: [...view.orientation],
        target: point3(view.target.x, view.target.y, view.target.z),
        distance: view.distance,
        focalLength: view.focalLength,
        nearPlane: view.nearPlane,
    };
}

/**
 * Overwrite `out` with `view`'s values, in place. Paired with `cameraScratch()`
 * so the fields a camera view carries are listed once rather than in a literal, a
 * copy and a comparison separately.
 */
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

/**
 * True when two camera views frame the same picture: the 9 orientation entries,
 * the target and the distance. This is a fail-safe O(13) comparison rather than
 * a revision counter, so it catches every mutation path (`orbit`, `rotateLocal`,
 * `dolly`, `panBy`, `reset`) without the camera having to remember to bump
 * anything. The renderer's redraw check is its only caller.
 */
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

/**
 * How far the look direction is above the world XY plane, radians in
 * [-pi/2, pi/2] - the quantity the turntable guard bounds.
 */
export function elevationOf(orientation: Mat3): number {
    return Math.asin(clamp(orientation[7], -1, 1));
}

// A horizontal world axis perpendicular to the view direction - the axis a
// pitch tilt turns about. At a pole every horizontal axis qualifies, so world x
// is returned rather than dividing by ~zero.
function pitchAxis(orientation: Mat3): Point3D {
    const x = -orientation[8];
    const z = orientation[6];
    const length = Math.hypot(x, z);

    if (length < 1e-9)
        return point3(1, 0, 0);

    return point3(x / length, 0, z / length);
}

/**
 * The live camera. The orientation is a world -> camera rotation matrix, not a
 * yaw/pitch pair, which is what lets each console button rotate about the axis
 * it names.
 */
export class Camera implements CameraView {

    // Assigned by applyPose(), which the constructor calls and reset() reuses;
    // the definite assignment assertions are what let that be their only home.
    orientation!: Mat3;

    target!: Point3D;
    distance!: number;

    /** Fixed for the camera's life: the wheel dollies `distance`, never this. */
    readonly focalLength: number;
    readonly nearPlane: number;

    constructor() {
        const defaults = defaultCameraView();

        // The pose is restorable, so it comes from the same home as reset().
        this.focalLength = defaults.focalLength;
        this.nearPlane = defaults.nearPlane;

        this.applyPose(defaults);
    }

    get elevation(): number {
        return elevationOf(this.orientation);
    }

    /**
     * Orbit by a CSS-pixel pointer delta: horizontal about world Y (elevation
     * unchanged), vertical about the camera's current horizontal axis. The
     * *applied delta* is clamped, so one drag cannot tumble through a pole.
     */
    orbit(dxPixels: number, dyPixels: number): void {

        this.orientation = multiply(
            this.orientation,
            rotY(dxPixels * K.camera.orbitRadiansPerPixel)
        );

        // A purely horizontal drag is a pure yaw, so it must not re-clamp an
        // elevation the console has pushed past the guard.
        if (dyPixels === 0)
            return;

        const elevation = this.elevation;
        const requested = elevation + dyPixels * K.camera.orbitRadiansPerPixel;
        const delta = clamp(requested, -K.camera.maxPitch, K.camera.maxPitch) - elevation;

        if (delta === 0)
            return;

        const axis = pitchAxis(this.orientation);

        // The view direction turns by +delta about this axis, hence the negated
        // angle.
        this.orientation = multiply(
            this.orientation,
            axisAngle(axis.x, axis.y, axis.z, -delta)
        );
    }

    /**
     * Rotate the camera about one of its own axes, right-hand positive. Free
     * 3-DOF: there is no clamp, because an explicit axis rotation needs no up
     * reference.
     */
    rotateLocal(axis: CameraAxis, radians: number): void {

        const step = axis === 'x' ? rotX(radians) : axis === 'y' ? rotY(radians) : rotZ(radians);

        this.orientation = multiply(step, this.orientation);
    }

    /**
     * Dolly by whole wheel notches; positive zooms out. Clamped between
     * `minDistance` (above the near plane, so the target plane is never culled)
     * and `maxDistance` (so a far zoom cannot shrink every node to the floor).
     */
    dolly(notches: number): void {
        this.distance = clamp(
            this.distance * Math.pow(K.camera.dollyPerWheelNotch, notches),
            K.camera.minDistance,
            K.camera.maxDistance
        );
    }

    /** Move the point the camera looks at; node positions are never touched. */
    panBy(delta: Point3D): void {
        this.target.x += delta.x;
        this.target.y += delta.y;
        this.target.z += delta.z;
    }

    reset(): void {
        this.applyPose(defaultCameraView());
    }

    // Shared by the constructor and reset(), so "the default camera" has one
    // definition (`defaultCameraView()`).
    private applyPose(view: CameraView): void {
        this.orientation = view.orientation;
        this.target = point3(view.target.x, view.target.y, view.target.z);
        this.distance = view.distance;
    }
}
