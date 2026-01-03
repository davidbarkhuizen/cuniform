import { Point2D } from './Point2D'; 

export class State {

    public b0Down: boolean;
    public b1Down: boolean; 
    public b2Down: boolean;
    
    public b0ClickPos: Point2D;
    public lastB0DragPos: Point2D;
    
    public curPos: Point2D;

	constructor(
	) {
		this.b0Down = false;
		this.b1Down = false; 
		this.b2Down = false; 
		
		this.b0ClickPos = new Point2D(0, 0);
		this.lastB0DragPos = new Point2D(0,0)
		
		this.curPos = new Point2D(0, 0);
	}
}