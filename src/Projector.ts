import { K } from "./K";
import { point, Point2D } from "./Point2D";
import { point3, Point3D } from "./Point3D";
import { Viewport } from "./Viewport";

/**
 * Camera orientation and framing.
 *
 * A plain value object, so the projector stays pure math and owns no live
 * state: the controller holds the mutable camera and hands this in.
 */
export interface CameraView {
    /** Orientation, radians. R = Rx(pitch) . Ry(yaw). */
    yaw: number;
    pitch: number;
    /** The point the camera looks at; pan moves this. */
    target: Point3D;
    /** Camera -> target along the view axis; the wheel dollies this. */
    distance: number;
    /** Projection focal length in model units; constant. */
    focalLength: number;
    /** Depth below which a node is culled. */
    nearPlane: number;
}

/** The default camera: the identity orientation that reduces to the 2D view. */
export function defaultCameraView(): CameraView {
    return {
        yaw: K.camera.yaw,
        pitch: K.camera.pitch,
        target: point3(0, 0, 0),
        distance: K.camera.distance,
        focalLength: K.camera.focalLength,
        nearPlane: K.camera.nearPlane,
    };
}

/** A projected model point: plane coordinates in model units, plus view depth. */
export interface Projection {
    screen: Point2D;
    depth: number;
}

/**
 * The perspective camera and projection.
 *
 *   model (Point3D) --Projector--> projected plane (Point2D + depth) --Viewport--> canvas
 *
 * Pure math and DOM-free, so step() can compose one without importing a canvas
 * type. The projected-plane coordinates are in model units and are handed to
 * the existing Viewport unchanged, which keeps the uniform scale and the y-flip
 * in exactly one place.
 */
export class Projector {

    constructor(
        readonly camera: CameraView,
        readonly viewport: Viewport
    ) {}

    /** A projector for `w1` x `h1` CSS pixels, under `camera`. */
    static forCanvas(
        w1: number,
        h1: number,
        camera: CameraView = defaultCameraView()
    ): Projector {
        return new Projector(camera, Viewport.forCanvas(w1, h1));
    }

    /**
     * Apply R = Rx(pitch) . Ry(yaw) to `p - target`, giving camera space:
     * x/y across the view plane and z along the view axis. Public because it
     * is the rigid rotation the projection is built on, and the one thing
     * worth asserting directly.
     */
    toCameraSpace(p: Point3D): Point3D {
        const { yaw, pitch, target } = this.camera;

        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        const cp = Math.cos(pitch), sp = Math.sin(pitch);

        const dx = p.x - target.x;
        const dy = p.y - target.y;
        const dz = p.z - target.z;

        const vx = dx * cy + dz * sy;
        const z1 = -dx * sy + dz * cy;
        const vy = dy * cp - z1 * sp;
        const z2 = dy * sp + z1 * cp;

        return point3(vx, vy, z2);
    }

    /**
     * Model point -> projected plane (model units) plus view depth.
     *
     * The camera sits at (0, 0, -distance) in view space, so the depth along
     * the view axis is z2 + distance. The divide is evaluated at
     * max(depth, nearPlane) to bound the perspective singularity; `depth` is
     * reported unclamped so culling and depth ordering see the true value.
     */
    project(p: Point3D): Projection {
        const { distance, focalLength, nearPlane } = this.camera;

        const view = this.toCameraSpace(p);

        const depth = view.z + distance;
        const dEff = Math.max(depth, nearPlane);

        return {
            screen: point(
                (focalLength * view.x) / dEff,
                (focalLength * view.y) / dEff
            ),
            depth,
        };
    }

    /** Model point -> canvas point. */
    toCanvas(p: Point3D): Point2D {
        return this.viewport.toCanvas(this.project(p).screen);
    }

    /** True when a view depth is at or inside the near plane. */
    isCulled(depth: number): boolean {
        return depth <= this.camera.nearPlane;
    }

    /**
     * Inverse at a chosen depth: the model point whose projection at `depth`
     * lands on `canvasPos`. Unprojecting onto the plane through a node's
     * current depth is exactly invertible, matches the pixel the user is
     * pointing at, and never teleports the node in depth.
     */
    unproject(canvasPos: Point2D, depth: number): Point3D {
        return this.unprojectScreen(this.viewport.toModel(canvasPos), depth);
    }

    /** Inverse from projected-plane model units at a chosen depth. */
    unprojectScreen(screen: Point2D, depth: number): Point3D {
        const { yaw, pitch, target, distance, focalLength } = this.camera;

        // Undo the projection at the chosen depth.
        const vx = (screen.x * depth) / focalLength;
        const vy = (screen.y * depth) / focalLength;
        const z2 = depth - distance;

        // Then undo the rotation: R^T = Ry(-yaw) . Rx(-pitch), so Rx(-pitch)
        // applies first.
        const cp = Math.cos(pitch), sp = Math.sin(pitch);
        const y1 = vy * cp + z2 * sp;
        const z1 = -vy * sp + z2 * cp;

        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        const x1 = vx * cy - z1 * sy;
        const zz = vx * sy + z1 * cy;

        return point3(target.x + x1, target.y + y1, target.z + zz);
    }
}
