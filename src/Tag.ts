import { point, Point2D } from "./Point2D";
import { point3, Point3D, zero3 } from "./Point3D";

export class Tag {

    label: string;
    position : Point3D;
    translatedPosition : Point2D;
    /**
     * View depth from the last projection, for painter ordering and hit-test tie-breaks:
     * smaller is nearer. Defaults to 0, which is culled until the first step().
     */
    depth: number = 0;
    /**
     * Velocity, carried across steps and pinned to zero on drag. Forces are deliberately
     * not cached here, so a read never observes a half-written tick.
     */
    velocity : Point3D;
    isSelected: boolean = false;

    constructor(xyz: Point3D, label: string) {
        this.label = label;

        // Copies, not aliases: the tag owns its own points from here on.
        this.position = point3(xyz.x, xyz.y, xyz.z);
        this.translatedPosition = point(xyz.x, xyz.y);
        this.velocity = zero3();
    }

    /**
     * This step's displacement: a read-only alias of the damped velocity, which already
     * folds in TIME_STEP, so the two cannot drift out of sync.
     */
    get displacement(): Point3D {
        return this.velocity;
    }
};
