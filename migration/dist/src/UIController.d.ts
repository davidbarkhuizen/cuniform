/// <reference types="node" />
import { ForceDirectedGraph } from "./ForceDirectedGraph";
import { Point2D } from "./Point2D";
import { State } from "./State";
declare global {
    interface Window {
        state: State;
        fdg: ForceDirectedGraph;
    }
}
export declare class UIController {
    timer: NodeJS.Timeout;
    body: HTMLElement;
    canvas: HTMLCanvasElement;
    context2D: CanvasRenderingContext2D;
    exportElement: HTMLElement;
    resetElement: HTMLElement;
    constructor(body: HTMLElement, canvas: HTMLCanvasElement, context2D: CanvasRenderingContext2D, exportElement: HTMLElement, resetElement: HTMLElement);
    onMouseOut: (event: MouseEvent) => void;
    onMouseMove: (event: MouseEvent) => void;
    onMouseDown: (event: MouseEvent) => void;
    getMousePos: (cnvs: HTMLCanvasElement, evt: MouseEvent) => Point2D;
    onMouseUp: (event: MouseEvent) => void;
    onExport: () => void;
    onReset: (event: MouseEvent) => boolean;
    onTimerTick: (event: any) => void;
    deregisterEventListeners: (canvas: HTMLCanvasElement, exportElement: HTMLElement, resetElement: HTMLElement) => void;
    registerEventListeners: (canvas: HTMLCanvasElement, exportElement: HTMLElement, resetElement: HTMLElement) => void;
    updateSelectionInfo: () => void;
    initialize: () => void;
    terminate: () => void;
}
