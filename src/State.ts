import { Camera } from './Camera';
import { Point2D } from './Point2D';

export class State {

    public b0Down: boolean;
    public b1Down: boolean; 
    public b2Down: boolean;

    /**
     * Canvas-space pointer position at the previous middle-button move, used as
     * the anchor for the current middle-drag gesture - orbit or pan. Null when
     * no middle drag is in progress.
     */
    public lastMiddleDragPos: Point2D | null;

    /**
     * The live view camera. Owned here beside the button flags so a reset()
     * rebuilds the graph without losing the user's viewing angle.
     */
    public readonly camera: Camera = new Camera();

	constructor(
	) {
		this.b0Down = false;
		this.b1Down = false; 
		this.b2Down = false; 

		this.lastMiddleDragPos = null;
	}
}
