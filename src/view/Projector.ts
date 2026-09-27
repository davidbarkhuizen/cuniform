import { K } from "../core/K";
import { apply, applyTranspose, identity, Mat3 } from "./Mat3";
import { point, Point2D } from "../core/Point2D";
import { point3, Point3D } from "../core/Point3D";
import { Viewport } from "./Viewport";

export interface CameraView {
    /** World -> camera rotation; its rows are the camera's axes. */
    orientation: Mat3;
    target: Point3D;
    /** Camera -> target along the view axis; the wheel dollies it. */
    distance: number;
    /** Focal length in model units; never changed. */
    focalLength: number;
    nearPlane: number;
}

/** The default camera: identity rotation, which reduces to the 2D view. */
export function defaultCameraView(): CameraView {
    return {
        orientation: identity(),
        target: point3(0, 0, 0),
        distance: K.camera.distance,
        focalLength: K.camera.focalLength,
        nearPlane: K.camera.nearPlane,
    };
}

/** Plane coordinates in model units plus view depth. */
export interface Projection {
    screen: Point2D;
    depth: number;
}

/** Allocation-free form of `Projection`; one per solver, never shared. */
export interface ProjectionScratch {
    screenX: number;
    screenY: number;
    depth: number;
}

/** One home for the cull rule, so projection, drawing and hit-testing agree at the boundary. */
export function isDepthCulled(depth: number, nearPlane: number): boolean {
    return depth <= nearPlane;
}

export class Projector {

    constructor(
        readonly camera: CameraView,
        readonly viewport: Viewport
    ) {}

    static forCanvas(
        w1: number,
        h1: number,
        camera: CameraView = defaultCameraView()
    ): Projector {
        return new Projector(camera, Viewport.forCanvas(w1, h1));
    }

    /** Rotate `p - target` into camera space: x/y across the view plane, z along the view axis. */
    toCameraSpace(p: Point3D): Point3D {
        const { orientation, target } = this.camera;

        return apply(orientation, point3(p.x - target.x, p.y - target.y, p.z - target.z));
    }

    /**
     * Projected plane (model units) plus view depth. `depth` is unclamped so
     * culling and ordering see the true value; only the divide is clamped.
     */
    project(p: Point3D): Projection {
        const projected = this.projectInto(p, { screenX: 0, screenY: 0, depth: 0 });

        return {
            screen: point(projected.screenX, projected.screenY),
            depth: projected.depth,
        };
    }

    /** `project()` into caller-owned scratch; inlined so the two forms agree bit-for-bit. */
    projectInto(p: Point3D, out: ProjectionScratch): ProjectionScratch {
        const { orientation, target, distance, focalLength, nearPlane } = this.camera;
        const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = orientation;

        const dx = p.x - target.x;
        const dy = p.y - target.y;
        const dz = p.z - target.z;

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
     * Inverse at a chosen depth; keeping the node's depth makes the inverse match the pointed pixel exactly.
     */
    unproject(canvasPos: Point2D, depth: number): Point3D {
        return this.unprojectScreen(this.viewport.toModel(canvasPos), depth);
    }

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
