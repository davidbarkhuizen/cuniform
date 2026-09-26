import { K } from "./K";
import { point3, Point3D } from "./Point3D";
import { CameraView } from "./Projector";

/**
 * The live camera: the mutable value the controller orbits, pans and dollies.
 *
 * It implements CameraView, so a Projector can be composed around it directly.
 * It lives in State beside the button flags, which is what makes reset()
 * rebuild the graph without losing the user's viewing angle.
 *
 * A class rather than a bag of fields because it owns two invariants - the
 * pitch clamp and the dolly clamp - and those belong next to the mutation that
 * can break them.
 */
export class Camera implements CameraView {

    yaw: number;
    pitch: number;
    target: Point3D;
    distance: number;

    /** Constant by design: the wheel dollies `distance`, never this. */
    readonly focalLength: number;
    readonly nearPlane: number;

    constructor() {
        this.yaw = K.camera.yaw;
        this.pitch = K.camera.pitch;
        this.target = point3(0, 0, 0);
        this.distance = K.camera.distance;
        this.focalLength = K.camera.focalLength;
        this.nearPlane = K.camera.nearPlane;
    }

    /**
     * Orbit by a pointer delta in CSS pixels. `pitch` is clamped to
     * +/- K.camera.maxPitch so the rotation basis never degenerates at the
     * poles.
     */
    orbit(dxPixels: number, dyPixels: number): void {

        this.yaw += dxPixels * K.camera.orbitRadiansPerPixel;

        const pitch = this.pitch + dyPixels * K.camera.orbitRadiansPerPixel;

        this.pitch = Math.min(Math.max(pitch, -K.camera.maxPitch), K.camera.maxPitch);
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
        this.yaw = K.camera.yaw;
        this.pitch = K.camera.pitch;
        this.target = point3(0, 0, 0);
        this.distance = K.camera.distance;
    }
}
