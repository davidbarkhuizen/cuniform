import { Point2D } from './Point2D'; 

export class State {

    public b0Down: boolean;
    public b1Down: boolean; 
    public b2Down: boolean;
    
    public b0ClickPos: Point2D;

    /**
     * Canvas-space pointer position at the previous middle-button move, used to
     * translate the graph by the cursor delta while panning. Null when no pan
     * is in progress.
     */
    public lastMiddleDragPos: Point2D | null;
    
    public curPos: Point2D;

	constructor(
	) {
		this.b0Down = false;
		this.b1Down = false; 
		this.b2Down = false; 
		
		this.b0ClickPos = new Point2D(0, 0);
		this.lastMiddleDragPos = null;
		
		this.curPos = new Point2D(0, 0);
	}
}
