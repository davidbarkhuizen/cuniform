import { Camera } from '../view/Camera';
import { Emphasis } from '../core/Emphasis';
import { Point2D } from '../core/Point2D';

export class State {

    // Assigned only by reset(); the definite assignment assertion depends on that.
    public b0Down!: boolean;
    public b1Down!: boolean; 
    public b2Down!: boolean;

    /** Canvas-space pointer at the previous middle-button move; null when no middle drag is in progress. */
    public lastMiddleDragPos!: Point2D | null;

    /** Owned here so reset() rebuilds the graph without losing the viewing angle. */
    public readonly camera: Camera = new Camera();

    /** Owned here for the same reason as the camera: reset() runs on mouse-out and graph swaps. */
    public emphasis: Emphasis = Emphasis.nodes;

	constructor(
	) {
		this.reset();
	}

	/** The one reset home for mouse-out, a graph swap and initialize. */
	reset(): void {
		this.b0Down = false;
		this.b1Down = false;
		this.b2Down = false;

		this.lastMiddleDragPos = null;
	}
}
