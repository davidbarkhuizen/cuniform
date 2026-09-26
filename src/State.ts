import { Camera } from './Camera';
import { Point2D } from './Point2D';

export class State {

    // Assigned by reset(), which the constructor calls and the controller calls
    // on mouse-out, on a graph swap and on initialize(). The definite
    // assignment assertion is what lets reset() be their only home.
    public b0Down!: boolean;
    public b1Down!: boolean; 
    public b2Down!: boolean;

    /**
     * Canvas-space pointer position at the previous middle-button move, used as
     * the anchor for the current middle-drag gesture - orbit or pan. Null when
     * no middle drag is in progress.
     */
    public lastMiddleDragPos!: Point2D | null;

    /**
     * The live view camera. Owned here beside the button flags so a reset()
     * rebuilds the graph without losing the user's viewing angle.
     */
    public readonly camera: Camera = new Camera();

	constructor(
	) {
		this.reset();
	}

	/**
	 * Clear every button flag and the gesture anchor. One home for the reset
	 * that onMouseOut(), loadGraph() and initialize() all need, so a flag added
	 * later cannot be missed by one of them.
	 */
	reset(): void {
		this.b0Down = false;
		this.b1Down = false;
		this.b2Down = false;

		this.lastMiddleDragPos = null;
	}
}
