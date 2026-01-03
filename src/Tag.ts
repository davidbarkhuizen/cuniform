import { Point2D } from "./Point2D";

var lastUsedTagIndex = 0;
function popUnusedTagIdx(): number {
	var idx = lastUsedTagIndex;
	lastUsedTagIndex += 1;
	return idx;
};

export class Tag {

    xy: Point2D;
    idx: number;
    label: string;
    position : Point2D;
    translatedPosition : Point2D;
    netElectrostaticForce : Point2D;
    netSpringForce : Point2D;
    displacement : Point2D;
    isSelected: boolean = false;

    constructor(xy: Point2D, label: string) {
        this.xy = xy;
        this.idx = popUnusedTagIdx();
        this.label = label;

        this.position = {
            x : xy.x,
            y : xy.y
        };
        
        this.translatedPosition = {
            x : xy.x,
            y : xy.y
        };
        
        this.netElectrostaticForce = {
            x : 0,
            y : 0
        };
        
        this.netSpringForce = {
            x : 0,
            y : 0
        };
        
        this.displacement = {
            x : 0,
            y : 0
        };
    }
	
	toString() {
		return "Tag" + this.idx.toString();

		/*
		 s = ('%i = %s' % (this.idx, this.label)) + '\n'
		 s = s + ('(x,y) = (%f,%f)' % (this.position.x, this.position.y)) + '\n'

		 (Fx, Fy) = this.netElectrostaticForce
		 s = s + ('electro-static Fx, Fy = %f, %f' % (Fx, Fy)) + '\n'

		 (Fx, Fy) = this.netSpringForce
		 s = s + ('spring Fx, Fy = %f, %f' % (Fx, Fy)) + '\n'

		 (dx, dy) = this.displacement
		 s = s + ('displacement dx, dy = %f, %f' % (dx, dy)) + '\n'

		 return s
		 */
	};
};