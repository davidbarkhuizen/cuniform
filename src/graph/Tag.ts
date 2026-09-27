import { point, Point2D } from "../core/Point2D";
import { point3, Point3D, zero3 } from "../core/Point3D";

export class Tag {

    label: string;
    position : Point3D;
    /** Canvas position from the last full projection; stale on the main thread on the worker path. */
    translatedPosition : Point2D;
    /** View depth from the last projection; smaller is nearer, and 0 is culled until the first step(). */
    depth: number = 0;
    /** Velocity, carried across steps and pinned to zero on drag; forces are deliberately not cached here. */
    velocity : Point3D;
    isSelected: boolean = false;

    constructor(xyz: Point3D, label: string) {
        this.label = label;

        // Copies, not aliases: the tag owns its own points from here on.
        this.position = point3(xyz.x, xyz.y, xyz.z);
        this.translatedPosition = point(xyz.x, xyz.y);
        this.velocity = zero3();
    }

    /** This step's displacement: an alias of the damped velocity, which already folds in TIME_STEP. */
    get displacement(): Point3D {
        return this.velocity;
    }
};
