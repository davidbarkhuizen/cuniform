/**
 * A structural subset of both canvas 2D contexts, so the renderer runs on the
 * main thread, in a worker and against the test fake. Styles are `string |
 * object` because the real contexts declare that wider union.
 */
export interface RenderSurface {
    readonly canvas: { readonly width: number; readonly height: number };
    font: string;
    globalAlpha: number;
    strokeStyle: string | object;
    fillStyle: string | object;
    lineWidth: number;
    save(): void;
    restore(): void;
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    clearRect(x: number, y: number, w: number, h: number): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arc(x: number, y: number, r: number, start: number, end: number, ccw: boolean): void;
    stroke(): void;
    fill(): void;
    fillText(text: string, x: number, y: number): void;
}

/**
 * Assigning `width`/`height` resets the context transform, so it must be set
 * afterwards. One home, so the main thread and the worker agree on the ordering.
 */
export function resizeBackingStore(
    target: { width: number; height: number },
    surface: RenderSurface,
    width: number,
    height: number,
    dpr: number
): void {

    target.width = width * dpr;
    target.height = height * dpr;

    surface.setTransform(dpr, 0, 0, dpr, 0, 0);
}
