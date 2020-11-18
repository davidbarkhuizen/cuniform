import { Graph } from "./Graph";
import { Point2D } from "./Point2D";
import { Tag } from "./Tag";
export declare class ForceDirectedGraph {
    graph: Graph;
    constructor(graph: Graph);
    translate(xy: Point2D, w0: number, h0: number, w1: number, h1: number): {
        x: number;
        y: number;
    };
    reverse(xy: Point2D, w0: number, h0: number, w1: number, h1: number): {
        x: number;
        y: number;
    };
    wrapReverse(xy: Point2D, canvasWidth: number, canvasHeight: number): {
        x: number;
        y: number;
    };
    drawToContext(context: CanvasRenderingContext2D, node_label_vert_spacing?: number): void;
    netElectrostaticForceAtNode(tagA: Tag): {
        x: number;
        y: number;
    };
    netSpringForceAtNode(tag: Tag): {
        x: number;
        y: number;
    };
    netForceAtNode(tag: Tag): {
        x: number;
        y: number;
    };
    displacementAtNode(tag: Tag): {
        x: number;
        y: number;
    };
    iterate(context: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): void;
    enforcePositionLimits(rightMargin: number, minorMargin: number): void;
    handleNodeSelectionAttempt(canvasPos: Point2D, canvasWidth: number, canvasHeight: number): boolean;
}
