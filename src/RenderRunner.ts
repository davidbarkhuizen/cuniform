import { Graph } from "./Graph";
import { projectGraph } from "./Projection";
import { CameraView, Projector } from "./Projector";
import { render } from "./Renderer";
import { RenderSurface } from "./RenderSurface";
import { Tag } from "./Tag";

/**
 * The main-thread owner of the drawing, mirroring `PhysicsRunner`: the canvas's
 * own 2D context today, and (Item 5 of the render-worker workplan) a dedicated
 * worker that owns an `OffscreenCanvas` behind the same interface.
 *
 * `UIController` draws through this, so it names no canvas type, owns no context
 * and has one place to keep the "is the frame on screen?" rule.
 */

/**
 * What the runner hides. A backend that cannot draw yet reports
 * `ready === false`, and `draw()` returning false then means "keep the redraw
 * pending", not "the canvas is up to date".
 */
export interface RenderBackend {
    /** True when drawing runs off the main thread. */
    readonly usesWorker: boolean;
    /** True once the backend can accept frames. */
    readonly ready: boolean;
    /** Called when a backend that was not ready becomes usable. */
    onReady: (() => void) | null;
    /**
     * Project and draw one frame. `width`/`height` are logical CSS pixels; the
     * backend owns the device-pixel backing store. False means "not ready".
     */
    draw(graph: Graph, camera: CameraView, selected: Tag | null, width: number, height: number): boolean;
    resize(width: number, height: number, dpr: number): void;
    /** The current frame as a PNG. */
    exportPng(): Promise<Blob>;
    terminate(): void;
}

// The canvas as a PNG Blob. Browsers refuse top-frame navigation to a `data:`
// URL, so the download must carry the image on a `blob:` object URL instead.
function pngBlob(canvas: HTMLCanvasElement): Blob {
	const [header, base64] = canvas.toDataURL('image/png').split(',');
	const mime = /:(.*?);/.exec(header)?.[1] ?? 'image/png';

	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i++)
		bytes[i] = binary.charCodeAt(i);

	return new Blob([bytes], { type: mime });
}

/**
 * The in-process backend: projection and drawing on the canvas's own 2D
 * context, in the same order a frame always ran. Ready from construction, so it
 * never needs `onReady`.
 */
class InProcessBackend implements RenderBackend {

    readonly usesWorker = false;
    readonly ready = true;
    onReady: (() => void) | null = null;

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly surface: RenderSurface
    ) {}

    draw(graph: Graph, camera: CameraView, selected: Tag | null, width: number, height: number): boolean {

        // One projector for the projection pass and the draw, so the cull
        // boundary sees the depths cached with this camera (invariant 2).
        const projector = Projector.forCanvas(width, height, camera);

        projectGraph(graph, projector);
        render(this.surface, graph, projector.camera, selected);

        return true;
    }

    resize(width: number, height: number, dpr: number): void {

        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;

        // Assigning width/height resets the context transform, so it is set after.
        this.surface.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    async exportPng(): Promise<Blob> {
        return pngBlob(this.canvas);
    }

    terminate(): void {}
}

export class RenderRunner {

    private constructor(
        private readonly backend: RenderBackend,
        onReady: () => void
    ) {
        this.backend.onReady = onReady;
    }

    /**
     * The runner over `canvas`. `onReady` is forwarded to the backend, so a
     * backend that becomes usable later can ask the controller for a redraw.
     */
    static create(canvas: HTMLCanvasElement, onReady: () => void): RenderRunner {

        const context = canvas.getContext('2d');

        // entrypoint() refuses to start when the canvas has no 2D context, so
        // this is the impossible path rather than the fallback.
        if (context === null)
            throw new Error("RenderRunner.create: the canvas has no 2d context");

        return new RenderRunner(new InProcessBackend(canvas, context), onReady);
    }

    /** A runner over an injected backend: the seam the tests drive. */
    static over(backend: RenderBackend, onReady: () => void = () => {}): RenderRunner {
        return new RenderRunner(backend, onReady);
    }

    /** True when drawing runs off the main thread. */
    get usesWorker(): boolean {
        return this.backend.usesWorker;
    }

    /** True once the backend can accept frames. */
    get ready(): boolean {
        return this.backend.ready;
    }

    draw(graph: Graph, camera: CameraView, selected: Tag | null, width: number, height: number): boolean {
        return this.backend.draw(graph, camera, selected, width, height);
    }

    resize(width: number, height: number, dpr: number): void {
        this.backend.resize(width, height, dpr);
    }

    exportPng(): Promise<Blob> {
        return this.backend.exportPng();
    }

    terminate(): void {
        this.backend.terminate();
    }
}
