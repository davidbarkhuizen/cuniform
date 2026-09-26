import { point, Point2D, zero } from "./Point2D";

var lastUsedTagIndex = 0;
function popUnusedTagIdx(): number {
	var idx = lastUsedTagIndex;
	lastUsedTagIndex += 1;
	return idx;
};

export class Tag {

    idx: number;
    label: string;
    position : Point2D;
    translatedPosition : Point2D;
    netElectrostaticForce : Point2D;
    netSpringForce : Point2D;
    velocity : Point2D;
    isSelected: boolean = false;

    constructor(xy: Point2D, label: string) {
        this.idx = popUnusedTagIdx();
        this.label = label;

        // Copies, not aliases: the tag owns its own points from here on.
        this.position = point(xy.x, xy.y);
        this.translatedPosition = point(xy.x, xy.y);
        this.netElectrostaticForce = zero();
        this.netSpringForce = zero();
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
