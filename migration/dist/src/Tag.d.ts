import { Point2D } from "./Point2D";
export declare class Tag {
    xy: Point2D;
    idx: number;
    label: string;
    position: Point2D;
    translatedPosition: Point2D;
    netElectrostaticForce: Point2D;
    netSpringForce: Point2D;
    displacement: Point2D;
    isSelected: boolean;
    constructor(xy: Point2D, label: string);
    toString(): string;
}
