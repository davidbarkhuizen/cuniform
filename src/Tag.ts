import { point, Point2D, zero } from "./Point2D";

export class Tag {

    label: string;
    position : Point2D;
    translatedPosition : Point2D;
    /**
     * Retained: velocity carries across steps and is pinned to zero on drag.
     * The net forces are deliberately *not* cached here - they are recomputed
     * from the frozen positions each step, so a force read can never observe a
     * half-written tick or silently return zero.
     */
    velocity : Point2D;
    isSelected: boolean = false;

    constructor(xy: Point2D, label: string) {
        this.label = label;

        // Copies, not aliases: the tag owns its own points from here on.
        this.position = point(xy.x, xy.y);
        this.translatedPosition = point(xy.x, xy.y);
        this.velocity = zero();
    }

    /**
     * This step's displacement. In the reference model the displacement is
     * always the damped velocity - TIME_STEP is already folded into it by
     * velocityAtTag() - so it is exposed as a read-only alias instead of a
     * second field that can drift out of sync.
     */
    get displacement(): Point2D {
        return this.velocity;
    }
};
