import { K } from "./K";
import { axisAngle, Mat3, multiply, rotX, rotY, rotZ } from "./Mat3";
import { point3, Point3D } from "./Point3D";
import { CameraView, defaultCameraView } from "./Projector";

/** The camera axis a console button rotates about. */
export type CameraAxis = 'x' | 'y' | 'z';

/**
 * The world-space unit direction the camera looks along, read from a
 * world->camera rotation. Camera space looks along +z, so its world direction
 * is the third row of the matrix.
 */
export function viewDirection(orientation: Mat3): Point3D {
    return point3(orientation[6], orientation[7], orientation[8]);
}

/**
 * How far the look direction is above the world XY plane, radians in
 * [-pi/2, pi/2]. This is the angle the turntable guard bounds; it is not one of
 * the matrix entries, and collapsing to it is what makes the guard a property
 * of the view rather than of a parameterisation.
 */
export function elevationOf(orientation: Mat3): number {
    return Math.asin(Math.min(Math.max(orientation[7], -1), 1));
}

/**
 * A horizontal world axis perpendicular to the view direction - the axis a
 * pitch tilt turns about.
 *
 * Exact cancellation cannot happen while the guard holds, because that keeps
 * the view off the poles. A view driven to a pole by the free console rotation
 * can still land there, and at a pole every horizontal axis is perpendicular to
 * the view, so world x is a valid choice rather than a division by ~zero.
 */
function pitchAxis(orientation: Mat3): Point3D {
    const x = -orientation[8];
    const z = orientation[6];
    const length = Math.hypot(x, z);

    if (length < 1e-9)
        return point3(1, 0, 0);

    return point3(x / length, 0, z / length);
}

/**
 * The live camera: the mutable value the controller orbits, pans, dollies and
 * rotates from the console.
 *
 * The orientation is a **world -> camera rotation matrix**, not a yaw/pitch
 * pair. A camera-frame rotation is a left-multiplication of that matrix, which
 * a pair of Euler angles is not closed under: with `R = Rx(pitch) . Ry(yaw)`
 * there is no third axis to rotate about, and incrementing either angle is only
 * a rotation about the camera's own axis in special cases. The matrix is what
 * makes all three console buttons rotate about the axis they name, and it
 * supplies the roll the old camera was missing.
 *
 * It implements CameraView, so a Projector can be composed around it directly.
 * It lives in State beside the button flags, which is what makes reset()
 * rebuild the graph without losing the user's viewing angle.
 */
export class Camera implements CameraView {

    // Assigned by applyPose(), which the constructor calls and reset() reuses.
    // The definite assignment assertions are what let that be their only home.
    /** World -> camera rotation. The identity is the default 1:1 view. */
    orientation!: Mat3;

    target!: Point3D;
    distance!: number;

    /** Constant by design: the wheel dollies `distance`, never this. */
    readonly focalLength: number;
    readonly nearPlane: number;

    constructor() {
        const defaults = defaultCameraView();

        // The focal length and near plane are fixed for the camera's life; the
        // pose is restorable, so it comes from the same home as reset().
        this.focalLength = defaults.focalLength;
        this.nearPlane = defaults.nearPlane;

        this.applyPose(defaults);
    }

    /** The look direction's elevation, the angle the turntable guard bounds. */
    get elevation(): number {
        return elevationOf(this.orientation);
    }

    /**
     * Orbit by a pointer delta in CSS pixels. Horizontal turns about world Y,
     * which leaves the elevation alone; vertical tilts about the camera's
     * current horizontal axis.
     *
     * The tilt is clamped to +/- K.camera.maxPitch so the view never reaches a
     * pole, where the turntable has no defined upward direction. Clamping the
     * **applied delta** rather than the resulting angle is what stops a single
     * large drag from tumbling through a pole and coming out the far side.
     */
    orbit(dxPixels: number, dyPixels: number): void {

        this.orientation = multiply(
            this.orientation,
            rotY(dxPixels * K.camera.orbitRadiansPerPixel)
        );

        // A purely horizontal drag is a pure yaw, and must not be an excuse to
        // re-clamp an elevation the console has pushed past the guard.
        if (dyPixels === 0)
            return;

        const elevation = this.elevation;
        const requested = elevation + dyPixels * K.camera.orbitRadiansPerPixel;
        const delta = Math.min(Math.max(requested, -K.camera.maxPitch), K.camera.maxPitch) - elevation;

        if (delta === 0)
            return;

        const axis = pitchAxis(this.orientation);

        // Turn the camera about that axis; the view direction then turns by
        // +delta about it, so the elevation changes by exactly delta.
        this.orientation = multiply(
            this.orientation,
            axisAngle(axis.x, axis.y, axis.z, -delta)
        );
    }

    /**
     * Rotate the camera about one of its own axes, right-hand positive.
     *
     * Free 3-DOF: there is no clamp, so a press can carry the view through a
     * pole. The guard exists to keep the *middle-drag* turntable well defined,
     * and an explicit axis rotation needs no up reference.
     */
    rotateLocal(axis: CameraAxis, radians: number): void {

        const step = axis === 'x' ? rotX(radians) : axis === 'y' ? rotY(radians) : rotZ(radians);

        this.orientation = multiply(step, this.orientation);
    }

    /**
     * Dolly by whole wheel notches; positive zooms out. The distance is clamped
     * above the near plane so the target plane itself is never culled.
     */
    dolly(notches: number): void {
        this.distance = Math.max(
            this.distance * Math.pow(K.camera.dollyPerWheelNotch, notches),
            K.camera.minDistance
        );
    }

    /**
     * Move the point the camera looks at. Node positions are never touched, so
     * a pan cannot perturb the simulation.
     */
    panBy(delta: Point3D): void {
        this.target.x += delta.x;
        this.target.y += delta.y;
        this.target.z += delta.z;
    }

    /** Back to the default orientation and framing. */
    reset(): void {
        this.applyPose(defaultCameraView());
    }

    /**
     * Write the mutable pose - orientation, target and distance - from one
     * camera view. The constructor and reset() share it, so "the default
     * camera" has exactly one definition (`defaultCameraView()`).
     */
    private applyPose(view: CameraView): void {
        this.orientation = view.orientation;
        this.target = point3(view.target.x, view.target.y, view.target.z);
        this.distance = view.distance;
    }
}
