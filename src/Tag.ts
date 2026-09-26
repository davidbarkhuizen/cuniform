import { point, Point2D } from "./Point2D";
import { point3, Point3D, zero3 } from "./Point3D";

export class Tag {

    label: string;
    position : Point3D;
    translatedPosition : Point2D;
    /**
     * View depth from the last projection, for painter ordering and hit-test
     * tie-breaks. Smaller is nearer the camera. Defaults to 0, which is culled
     * until the first step() writes a real depth.
     */
    depth: number = 0;
    /**
     * Retained: velocity carries across steps and is pinned to zero on drag.
     * The net forces are deliberately *not* cached here - they are recomputed
     * from the frozen positions each step, so a force read can never observe a
     * half-written tick or silently return zero.
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
     * This step's displacement. In the reference model the displacement is
     * always the damped velocity - TIME_STEP is already folded into it by
     * velocityAtTag() - so it is exposed as a read-only alias instead of a
     * second field that can drift out of sync.
     */
    get displacement(): Point3D {
        return this.velocity;
    }
};
