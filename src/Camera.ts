import { K } from "./K";
import { axisAngle, Mat3, multiply, rotX, rotY, rotZ } from "./Mat3";
import { point3, Point3D } from "./Point3D";
import { CameraView, defaultCameraView } from "./Projector";

/** The camera axis a console button rotates about. */
export type CameraAxis = 'x' | 'y' | 'z';

/**
 * The world-space unit direction the camera looks along, read from a
 * world->camera rotation. Camera space looks along +z, so it is the third row.
 */
export function viewDirection(orientation: Mat3): Point3D {
    return point3(orientation[6], orientation[7], orientation[8]);
}

/**
 * How far the look direction is above the world XY plane, radians in
 * [-pi/2, pi/2] - the quantity the turntable guard bounds.
 */
export function elevationOf(orientation: Mat3): number {
    return Math.asin(Math.min(Math.max(orientation[7], -1), 1));
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
        const delta = Math.min(Math.max(requested, -K.camera.maxPitch), K.camera.maxPitch) - elevation;

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
     * Dolly by whole wheel notches; positive zooms out. Clamped above the near
     * plane, so the target plane itself is never culled.
     */
    dolly(notches: number): void {
        this.distance = Math.max(
            this.distance * Math.pow(K.camera.dollyPerWheelNotch, notches),
            K.camera.minDistance
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
