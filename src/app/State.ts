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

    /** Active touch points by pointer id, in canvas coordinates. */
    public readonly touches: Map<number, Point2D> = new Map();

    /** What the current touch gesture does; `none` until every finger lifts after a pinch. */
    public touchMode!: 'none' | 'drag' | 'orbit' | 'pinch';

    /** Where a one-finger gesture started, and whether it has left the slop circle since. */
    public touchStart!: Point2D | null;
    public touchMoved!: boolean;

    /** The previous finger spread of a pinch, in canvas pixels. */
    public pinchSpread!: number;

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

        this.touches.clear();
        this.touchMode = 'none';
        this.touchStart = null;
        this.touchMoved = false;
        this.pinchSpread = 0;
    }
}
