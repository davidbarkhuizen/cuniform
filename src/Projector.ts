import { K } from "./K";
import { apply, applyTranspose, identity, Mat3 } from "./Mat3";
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
    /**
     * World -> camera rotation. The identity reduces to the 2D mapping; the
     * camera's own axes are the matrix's rows, which is what the console's
     * per-axis buttons rotate about.
     */
    orientation: Mat3;
    /** The point the camera looks at; pan moves this. */
    target: Point3D;
    /** Camera -> target along the view axis; the wheel dollies this. */
    distance: number;
    /** Projection focal length in model units; constant. */
    focalLength: number;
    /** Depth below which a node is culled. */
    nearPlane: number;
}

/** The default camera: the identity rotation that reduces to the 2D view. */
export function defaultCameraView(): CameraView {
    return {
        orientation: identity(),
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
 * True when a view depth is at or inside the near plane.
 *
 * One home for the cull rule, so the projection's own clamp, the renderer's
 * draw filter and hit-testing cannot disagree about the boundary. `Projector`
 * supplies its camera's near plane; a caller with only a depth (the renderer,
 * which is handed the camera's value) supplies it directly.
 */
export function isDepthCulled(depth: number, nearPlane: number): boolean {
    return depth <= nearPlane;
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
     * Rotate `p - target` into camera space: x/y across the view plane and z
     * along the view axis. Public because it is the rigid rotation the
     * projection is built on, and the one thing worth asserting directly.
     */
    toCameraSpace(p: Point3D): Point3D {
        const { orientation, target } = this.camera;

        return apply(orientation, point3(p.x - target.x, p.y - target.y, p.z - target.z));
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
        return isDepthCulled(depth, this.camera.nearPlane);
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
        const { orientation, target, distance, focalLength } = this.camera;

        // Undo the projection at the chosen depth.
        const vx = (screen.x * depth) / focalLength;
        const vy = (screen.y * depth) / focalLength;
        const vz = depth - distance;

        // Then undo the rotation. For a rotation the transpose is the inverse.
        const view = applyTranspose(orientation, point3(vx, vy, vz));

        return point3(target.x + view.x, target.y + view.y, target.z + view.z);
    }
}
