/**
 * The 2D drawing surface the renderer writes. A structural subset of both
 * `CanvasRenderingContext2D` and `OffscreenCanvasRenderingContext2D`, so the same
 * renderer runs on the main thread, in a worker and against the fake context in
 * tests with no cast and no branch.
 *
 * The styles are `string | object` because the renderer only ever writes a
 * colour string, while `object` covers `CanvasGradient`/`CanvasPattern` without
 * naming a canvas type in a DOM-free module. A narrower `string` does not
 * typecheck either way: the real contexts declare the wider union.
 */
export interface RenderSurface {
    readonly canvas: { readonly width: number; readonly height: number };
    font: string;
    globalAlpha: number;
    strokeStyle: string | object;
    fillStyle: string | object;
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
