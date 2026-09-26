import { Camera } from './Camera';
import { Point2D } from './Point2D';

export class State {

    // Assigned only by reset(); the definite assignment assertion depends on that.
    public b0Down!: boolean;
    public b1Down!: boolean; 
    public b2Down!: boolean;

    /**
     * Canvas-space pointer position at the previous middle-button move; anchor for the
     * current orbit or pan drag. Null when no middle drag is in progress.
     */
    public lastMiddleDragPos!: Point2D | null;

    /**
     * The live view camera, owned here so a reset() rebuilds the graph without
     * losing the viewing angle.
     */
    public readonly camera: Camera = new Camera();

	constructor(
	) {
		this.reset();
	}

	/**
	 * Clear every button flag and the gesture anchor; the one reset home for mouse-out,
	 * a graph swap and initialize, so a new flag cannot be missed.
	 */
	reset(): void {
		this.b0Down = false;
		this.b1Down = false;
		this.b2Down = false;

		this.lastMiddleDragPos = null;
	}
}
