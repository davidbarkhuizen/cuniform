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

/**
 * Size a surface's backing store in device pixels and re-apply the transform
 * that keeps drawing in CSS pixels.
 *
 * Assigning `width`/`height` resets the context transform, so the transform must
 * be set afterwards. One home for that ordering rule, so the main thread's
 * in-process backend and the render worker produce identical pixels for the same
 * frame at any device-pixel ratio.
 *
 * `target` is the writable canvas (or `OffscreenCanvas`); `surface` is the
 * context drawn through, whose own `canvas` reference is read-only.
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
