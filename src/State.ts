import { Point2D } from './Point2D';

export class State {

    public b0Down: boolean;
    public b1Down: boolean; 
    public b2Down: boolean;

    /**
     * Canvas-space pointer position at the previous middle-button move, used to
     * translate the graph by the cursor delta while panning. Null when no pan
     * is in progress.
     */
    public lastMiddleDragPos: Point2D | null;

	constructor(
	) {
		this.b0Down = false;
		this.b1Down = false; 
		this.b2Down = false; 

		this.lastMiddleDragPos = null;
	}
}
