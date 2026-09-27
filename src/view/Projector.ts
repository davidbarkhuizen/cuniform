import { K } from "../core/K";
import { apply, applyTranspose, identity, Mat3 } from "./Mat3";
import { point, Point2D } from "../core/Point2D";
import { point3, Point3D } from "../core/Point3D";
import { Viewport } from "./Viewport";

/**
 * Camera orientation and framing: a plain value object, so the projector stays
 * pure math and owns no live state.
 */
export interface CameraView {
    /**
     * World -> camera rotation; the camera's own axes are the matrix's rows,
     * which is what the console's per-axis buttons rotate about. The identity
     * reduces to the 2D mapping.
     */
    orientation: Mat3;
    /** The point the camera looks at; pan moves this. */
    target: Point3D;
    /** Camera -> target along the view axis; the wheel dollies this. */
    distance: number;
    /** Projection focal length in model units; never changed. */
    focalLength: number;
    /** Depth at or below which a node is culled. */
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
 * A reusable projection destination: the allocation-free form of `Projection`.
 * One per solver, never shared, so `projectInto()` can fill it every node.
 */
export interface ProjectionScratch {
    screenX: number;
    screenY: number;
    depth: number;
}

/**
 * True when a view depth is at or inside the near plane. One home for the cull
 * rule, so projection, drawing and hit-testing cannot disagree at the boundary.
 */
export function isDepthCulled(depth: number, nearPlane: number): boolean {
    return depth <= nearPlane;
}

/**
 * The perspective camera and projection: model -> projected plane (model units)
 * -> canvas. Pure math, so step() can compose one without a canvas type.
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
     * Rotate `p - target` into camera space: x/y across the view plane, z along
     * the view axis. Public so the rigid rotation can be asserted directly.
     */
    toCameraSpace(p: Point3D): Point3D {
        const { orientation, target } = this.camera;

        return apply(orientation, point3(p.x - target.x, p.y - target.y, p.z - target.z));
    }

    /**
     * Model point -> projected plane (model units) plus view depth. `depth` is
     * reported unclamped, so culling and ordering see the true value; only the
     * divide is taken at max(depth, nearPlane), bounding the singularity.
     */
    project(p: Point3D): Projection {
        const projected = this.projectInto(p, { screenX: 0, screenY: 0, depth: 0 });

        return {
            screen: point(projected.screenX, projected.screenY),
            depth: projected.depth,
        };
    }

    /**
     * `project()`, but written into caller-owned scratch so a per-node projection
     * pass allocates nothing. The arithmetic is inlined from `toCameraSpace()` +
     * `project()`, so the two forms agree bit-for-bit.
     */
    projectInto(p: Point3D, out: ProjectionScratch): ProjectionScratch {
        const { orientation, target, distance, focalLength, nearPlane } = this.camera;
        const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = orientation;

        const dx = p.x - target.x;
        const dy = p.y - target.y;
        const dz = p.z - target.z;

        // apply(orientation, p - target), with the temporary object removed.
        const viewX = m0 * dx + m1 * dy + m2 * dz;
        const viewY = m3 * dx + m4 * dy + m5 * dz;
        const viewZ = m6 * dx + m7 * dy + m8 * dz;

        const depth = viewZ + distance;
        const dEff = Math.max(depth, nearPlane);

        out.screenX = (focalLength * viewX) / dEff;
        out.screenY = (focalLength * viewY) / dEff;
        out.depth = depth;

        return out;
    }

    toCanvas(p: Point3D): Point2D {
        return this.viewport.toCanvas(this.project(p).screen);
    }

    isCulled(depth: number): boolean {
        return isDepthCulled(depth, this.camera.nearPlane);
    }

    /**
     * Inverse at a chosen depth: the model point whose projection there lands on
     * `canvasPos`. Keeping the node's current depth makes the inverse exactly
     * match the pointed pixel, and never teleports the node in depth.
     */
    unproject(canvasPos: Point2D, depth: number): Point3D {
        return this.unprojectScreen(this.viewport.toModel(canvasPos), depth);
    }

    /** Inverse from projected-plane model units at a chosen depth. */
    unprojectScreen(screen: Point2D, depth: number): Point3D {
        const { orientation, target, distance, focalLength } = this.camera;

        const vx = (screen.x * depth) / focalLength;
        const vy = (screen.y * depth) / focalLength;
        const vz = depth - distance;

        // For a rotation the transpose is the inverse.
        const view = applyTranspose(orientation, point3(vx, vy, vz));

        return point3(target.x + view.x, target.y + view.y, target.z + view.z);
    }
}
