import { Graph } from "./Graph";
import { K } from "./K";
import { readPositions } from "./MirrorGraph";
import { projectGraph } from "./Projection";
import { CameraView, Projector } from "./Projector";
import { render } from "./Renderer";
import {
    CAMERA_VALUES,
    encodeCameraInto,
    FrameRequest,
    initRequest,
    RenderRequest,
    RenderResponse,
} from "./RenderProtocol";
import { RenderSurface, resizeBackingStore } from "./RenderSurface";
import { Tag } from "./Tag";

/**
 * The main-thread owner of the drawing, mirroring `PhysicsRunner`: the canvas's
 * own 2D context, or a dedicated worker that owns an `OffscreenCanvas` handed
 * over with `transferControlToOffscreen()`.
 *
 * `UIController` draws through this, so it names no canvas type, owns no context
 * and has one place to keep the "is the frame on screen?" rule.
 */

/** How drawing is routed. `main` forces the in-process backend: the A/B control. */
export type RenderMode = "worker" | "main";

/**
 * The slice of `Worker` the runner uses. A fake can stand in for tests, and the
 * real Worker is adapted at the factory without the runner depending on it.
 */
export interface RenderWorkerPort {
    postMessage(message: RenderRequest, transfer: Transferable[]): void;
    terminate(): void;
    onmessage: ((event: { data: RenderResponse }) => void) | null;
    /** Fired when the worker script itself fails to load or throws. */
    onerror: ((event: unknown) => void) | null;
}

export type RenderWorkerFactory = (canvas: HTMLCanvasElement) => RenderWorkerPort | null;

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
    /** Point the backend at a new graph, dropping anything computed for the old one. */
    setGraph(graph: Graph): void;
    /** The current frame as a PNG. */
    exportPng(): Promise<Blob>;
    terminate(): void;
}

export interface RenderRunnerOptions {
    /** Force a mode; the default is `worker` unless the URL says `?render=main`. */
    mode?: RenderMode;
    /** The graph a worker mirror is initialised with; absent, the first draw does it. */
    graph?: Graph;
    /** The worker factory; a fake stands in for tests. */
    workerFactory?: RenderWorkerFactory;
    /** Milliseconds to wait for the worker's `ready` before falling back. */
    readyTimeoutMS?: number;
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

function canUseWorker(canvas: HTMLCanvasElement): boolean {
    return typeof Worker !== "undefined"
        && typeof canvas.transferControlToOffscreen === "function";
}

/** The feature-detectable form of "which realm draws". */
function renderModeFromLocation(): RenderMode {

    if (typeof window === "undefined" || !window.location)
        return "worker";

    return new URLSearchParams(window.location.search).get("render") === "main"
        ? "main"
        : "worker";
}

/** The default: the bundled worker when the browser can transfer a canvas, else null. */
function defaultWorkerFactory(canvas: HTMLCanvasElement): RenderWorkerPort | null {

    if (!canUseWorker(canvas))
        return null;

    try {
        // The demo serves web/index.html beside dist/main.js, so the worker
        // bundle emitted by webpack's render.worker entry resolves from there.
        return new Worker("../dist/render.worker.js") as unknown as RenderWorkerPort;
    } catch {
        return null;
    }
}

/** The canvas's own 2D context, or null when it has none (or has been transferred). */
function inProcessBackend(canvas: HTMLCanvasElement): RenderBackend | null {

    const context = canvas.getContext('2d');

    return context === null ? null : new InProcessBackend(canvas, context);
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

        // The same helper the worker engine uses, so both realms size the
        // backing store and set the transform identically.
        resizeBackingStore(this.canvas, this.surface, width, height, dpr);
    }

    setGraph(_graph: Graph): void {
        // Stateless per draw: the graph arrives with every frame.
    }

    async exportPng(): Promise<Blob> {
        return pngBlob(this.canvas);
    }

    terminate(): void {}
}

/**
 * The worker backend: an `OffscreenCanvas` handed to `dist/render.worker.js`
 * once the worker has proved it answers, one frame in flight with latest-state
 * coalescing, and a pool of position buffers whose ownership returns with the
 * `drawn` ack.
 *
 * The probe comes first because the transfer is one-way: if the worker script
 * 404s, the canvas must still be usable in process.
 */
class WorkerBackend implements RenderBackend {

    onReady: (() => void) | null = null;

    private generation = 0;
    private probePassed = false;
    private initialised = false;
    private canvasSent = false;
    private inFlight = false;
    private disposed = false;
    private offscreen: Transferable | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;

    private graph: Graph | null;
    private width = 0;
    private height = 0;
    private dpr = 1;

    private pendingCamera: CameraView | null = null;
    private pendingSelected: Tag | null = null;
    private pendingSelectedIndex = -1;
    private pendingIndexGraph: Graph | null = null;

    /** One being filled, one in flight, one coming back in the ack. */
    private free: Float64Array[] = [];

    // Reused, and posted by structured clone rather than transfer, so a frame
    // allocates no typed array on this thread.
    private readonly scratchCamera = new Float64Array(CAMERA_VALUES);

    private frameId = 0;
    private exportId = 0;
    private readonly exports = new Map<number, { resolve: (blob: Blob) => void; reject: (error: Error) => void }>();

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly worker: RenderWorkerPort,
        graph: Graph | null,
        timeoutMS: number,
        private readonly onFallback: () => void
    ) {
        this.graph = graph;

        worker.onmessage = event => this.receive(event.data);

        // A worker script that fails to load never answers, so the runner must
        // hand back to the in-process backend rather than freeze.
        worker.onerror = () => this.fail();

        this.timer = setTimeout(() => this.fail(), timeoutMS);
    }

    get usesWorker(): boolean {
        return !this.disposed;
    }

    get ready(): boolean {
        return this.probePassed;
    }

    draw(graph: Graph, camera: CameraView, selected: Tag | null, width: number, height: number): boolean {

        if (this.disposed)
            return false;

        this.width = width;
        this.height = height;

        if (graph !== this.graph)
            this.setGraph(graph);

        // Resolving the selection index is O(N), so it is cached and only
        // recomputed when the selection or the graph changes.
        if (selected !== this.pendingSelected || graph !== this.pendingIndexGraph) {
            this.pendingSelected = selected;
            this.pendingIndexGraph = graph;
            this.pendingSelectedIndex = selected === null ? -1 : graph.vertices.indexOf(selected);
        }

        this.pendingCamera = camera;

        if (!this.probePassed)
            return false;

        this.pump();
        return true;
    }

    resize(width: number, height: number, dpr: number): void {
        // The worker owns the backing store; the size rides the next frame.
        this.width = width;
        this.height = height;
        this.dpr = dpr;
    }

    setGraph(graph: Graph): void {

        if (graph === this.graph)
            return;

        this.graph = graph;

        // A response computed for the replaced graph must not be applied to the
        // new one, and the frame in flight is abandoned.
        this.generation++;
        this.initialised = false;
        this.inFlight = false;
        this.free = [];
        this.pendingIndexGraph = null;

        if (this.probePassed)
            this.pump();
    }

    exportPng(): Promise<Blob> {

        if (this.disposed)
            return Promise.reject(new Error("the render worker is terminated"));

        if (!this.probePassed)
            return Promise.reject(new Error("the render worker is not ready"));

        const requestId = ++this.exportId;

        return new Promise<Blob>((resolve, reject) => {
            this.exports.set(requestId, { resolve, reject });
            this.worker.postMessage({ type: "export", requestId }, []);
        });
    }

    terminate(): void {
        this.dispose("the render worker is terminated");
    }

    /**
     * The teardown both `terminate()` and the failed-start path need: stop the
     * clock, kill the worker, and settle every pending export with `reason`.
     *
     * One sequence, so a step added here cannot be applied on one path and
     * missed on the other - which would leave an export promise unsettled
     * forever.
     */
    private dispose(reason: string): void {

        this.disposed = true;
        this.clearTimer();
        this.worker.terminate();

        for (const pending of this.exports.values())
            pending.reject(new Error(reason));

        this.exports.clear();
    }

    /** Post the initial mirror and the next frame, if either is due. */
    private pump(): void {

        if (this.disposed || !this.probePassed || this.inFlight)
            return;

        if (this.graph === null || this.offscreen === null)
            return;

        if (!this.initialised)
            this.sendInit();

        if (this.pendingCamera !== null)
            this.sendFrame();
    }

    private sendInit(): void {

        const graph = this.graph;
        const offscreen = this.offscreen;

        if (graph === null || offscreen === null)
            return;

        const length = graph.vertices.length * 3;

        this.free = [new Float64Array(length), new Float64Array(length), new Float64Array(length)];

        const init = initRequest(graph, this.generation);
        const transfer: Transferable[] = [init.positions.buffer as Transferable];

        // Control of the canvas is transferred once, and only once.
        if (!this.canvasSent) {
            (init as { canvas?: Transferable }).canvas = offscreen;
            transfer.push(offscreen);
            this.canvasSent = true;
        }

        this.worker.postMessage(init, transfer);
        this.initialised = true;
    }

    private sendFrame(): void {

        const graph = this.graph;
        const camera = this.pendingCamera;

        if (graph === null || camera === null || this.inFlight)
            return;

        const positions = this.free.pop();

        // Pooled buffers are sized to this graph; a mismatch means a re-init is due.
        if (positions === undefined || positions.length !== graph.vertices.length * 3)
            return;

        readPositions(graph, positions);
        encodeCameraInto(camera, this.scratchCamera);

        const frame: FrameRequest = {
            type: "frame",
            generation: this.generation,
            frameId: ++this.frameId,
            camera: this.scratchCamera,
            positions,
            selected: this.pendingSelectedIndex,
            width: this.width,
            height: this.height,
            dpr: this.dpr,
        };

        this.inFlight = true;

        // Consumed: the next post waits for another draw or for the ack's pump,
        // which is what keeps one frame in flight.
        this.pendingCamera = null;

        this.worker.postMessage(frame, [positions.buffer as Transferable]);
    }

    private receive(message: RenderResponse): void {

        if (this.disposed)
            return;

        if (message.type === "ready") {
            this.becomeReady();
            return;
        }

        if (message.type === "png") {

            const pending = this.exports.get(message.requestId);

            if (pending) {
                this.exports.delete(message.requestId);
                pending.resolve(message.blob);
            }

            return;
        }

        // A stale ack must not release the frame in flight, which by now belongs
        // to a different generation, nor touch the new graph's tags.
        if (message.generation !== this.generation)
            return;

        this.inFlight = false;
        this.free.push(message.positions);

        // The depth write-back: the drawer's depths become the main thread's, so
        // the drag's unproject and the cull tie-break read the frame that was drawn.
        const graph = this.graph;

        if (graph !== null && message.depths.length === graph.vertices.length) {
            for (let i = 0; i < graph.vertices.length; i++)
                graph.vertices[i].depth = message.depths[i];
        }

        this.pump();
    }

    private becomeReady(): void {

        if (this.disposed || this.probePassed)
            return;

        this.clearTimer();

        let offscreen: Transferable;

        try {
            // Only now, because the probe proved the worker answers and because
            // the transfer cannot be undone.
            offscreen = this.canvas.transferControlToOffscreen() as unknown as Transferable;
        } catch {
            // The canvas was transferred already (a second initialize over a live
            // page). It cannot be transferred twice, and it has no context, so
            // there is nothing left to draw on: hand back and let the frame stay
            // pending rather than crash.
            this.fail();
            return;
        }

        this.offscreen = offscreen;
        this.probePassed = true;

        if (this.onReady)
            this.onReady();

        // A graph supplied up front initialises the mirror before the first frame.
        this.pump();
    }

    private fail(): void {

        // A failure after the transfer is a crash, not a load failure: the
        // documented hardening for it is out of scope.
        if (this.disposed || this.probePassed)
            return;

        this.dispose("the render worker failed to start");

        this.onFallback();
    }

    private clearTimer(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}

export class RenderRunner {

    private backend: RenderBackend;

    private constructor(backend: RenderBackend, private readonly onReady: () => void) {
        this.backend = backend;
        backend.onReady = onReady;
    }

    /**
     * True when the page can draw at all: a transferable canvas with a `Worker`,
     * or a 2D context. A context is only requested when the worker path is
     * unavailable, because creating one makes the transfer throw.
     */
    static supported(canvas: HTMLCanvasElement): boolean {

        if (renderModeFromLocation() !== "main" && canUseWorker(canvas))
            return true;

        return canvas.getContext('2d') !== null;
    }

    /**
     * The runner over `canvas`. `onReady` is forwarded to the backend, so a
     * backend that becomes usable later can ask the controller for a redraw.
     * Null when neither path can draw.
     */
    static create(
        canvas: HTMLCanvasElement,
        onReady: () => void,
        options: RenderRunnerOptions = {}
    ): RenderRunner | null {

        const mode = options.mode ?? renderModeFromLocation();

        // An injected factory is the test seam, so it bypasses the feature check.
        if (mode === "worker" && (options.workerFactory !== undefined || canUseWorker(canvas))) {

            const factory = options.workerFactory ?? defaultWorkerFactory;

            let worker: RenderWorkerPort | null = null;

            // A worker that cannot even be constructed is not an error: the
            // in-process backend is the documented fallback.
            try {
                worker = factory(canvas);
            } catch {
                worker = null;
            }

            if (worker !== null) {

                let runner: RenderRunner | null = null;

                const backend = new WorkerBackend(
                    canvas,
                    worker,
                    options.graph ?? null,
                    options.readyTimeoutMS ?? K.renderer.workerReadyTimeoutMS,
                    () => {
                        // The probe failed before any transfer, so the canvas is
                        // still usable on this thread.
                        const replacement = inProcessBackend(canvas);

                        if (replacement !== null && runner !== null)
                            runner.replaceBackend(replacement);
                    }
                );

                runner = new RenderRunner(backend, onReady);

                return runner;
            }
        }

        const backend = inProcessBackend(canvas);

        return backend === null ? null : new RenderRunner(backend, onReady);
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

    setGraph(graph: Graph): void {
        this.backend.setGraph(graph);
    }

    exportPng(): Promise<Blob> {
        return this.backend.exportPng();
    }

    terminate(): void {
        this.backend.terminate();
    }

    /** Hand over to a backend that can draw, disposing the one that failed. */
    private replaceBackend(backend: RenderBackend): void {

        const previous = this.backend;

        this.backend = backend;
        backend.onReady = this.onReady;

        if (previous !== backend)
            previous.terminate();
    }
}
