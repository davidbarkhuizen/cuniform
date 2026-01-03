export declare class DragController {
    startDragScreenX: number;
    startDragScreenY: number;
    dragX: number;
    dragY: number;
    startTop: number;
    startLeft: number;
    element: HTMLElement;
    constructor(element: HTMLElement);
    onDragStart: (event: MouseEvent) => void;
    onDrag: (event: MouseEvent) => void;
    onDragEnd: (event: MouseEvent) => void;
}
