import { Emphasis } from "../core/Emphasis";
import { Graph, GraphShape, graphShape, sameShape } from "../graph/Graph";
import { K } from "../core/K";
import { readPositions } from "../graph/MirrorGraph";
import { projectGraph } from "../view/Projection";
import { CameraView, Projector } from "../view/Projector";
import { render } from "./Renderer";
import {
    CAMERA_VALUES,
    encodeCameraInto,
    FrameRequest,
    initRequest,
    initTransfer,
    RenderRequest,
    RenderResponse,
} from "./RenderProtocol";
import { RenderSurface, resizeBackingStore } from "./RenderSurface";
import { Tag } from "../graph/Tag";
import { WorkerPort } from "../core/WorkerChannel";

/**
 * The main-thread owner of the drawing, mirroring `PhysicsRunner`; `UIController` draws through this.
 * `main` forces the in-process backend: the A/B control.
 */
export type RenderMode = "worker" | "main";

export type RenderWorkerPort = WorkerPort<RenderRequest, RenderResponse>;

export type RenderWorkerFactory = (canvas: HTMLCanvasElement) => RenderWorkerPort | null;

/**
 * A backend that cannot draw yet reports `ready === false`, and `draw()` then means "keep the redraw
 * pending".
 */
export interface RenderBackend {
    readonly usesWorker: boolean;
    readonly ready: boolean;
    onReady: (() => void) | null;
    /** `width`/`height` are logical CSS pixels; false means "not ready". */
    draw(graph: Graph, camera: CameraView, selected: Tag | null, width: number, height: number, emphasis: Emphasis): boolean;
    resize(width: number, height: number, dpr: number): void;
    setGraph(graph: Graph): void;
    exportPng(): Promise<Blob>;
    terminate(): void;
}

/** The backing-store size a replacement backend must adopt. */
interface SurfaceSize {
    width: number;
    height: number;
    dpr: number;
}

/**
 * Hands back a fresh, untransferred canvas in place of one the worker owned. Supplied by the element's
 * owner (it holds the listeners); without it a dead worker leaves nothing to draw on.
 */
export type CanvasReplacer = () => HTMLCanvasElement | null;

export interface RenderRunnerOptions {
    /** The default is `worker` unless the URL says `?render=main`. */
    mode?: RenderMode;
    graph?: Graph;
    workerFactory?: RenderWorkerFactory;
    readyTimeoutMS?: number;
    frameTimeoutMS?: number;
    replaceCanvas?: CanvasReplacer;
}

// Canvases whose control went to a worker. The transfer is one-way, so such an element can never draw
// again; a new runner over one asks for a replacement first.
const transferredCanvases = new WeakSet<object>();

function canUseWorker(canvas: HTMLCanvasElement): boolean {
    return typeof Worker !== "undefined"
        && typeof canvas.transferControlToOffscreen === "function";
}

export function renderModeFromLocation(): RenderMode {

    if (typeof window === "undefined" || !window.location)
        return "worker";

    return new URLSearchParams(window.location.search).get("render") === "main"
        ? "main"
        : "worker";
}

function defaultWorkerFactory(canvas: HTMLCanvasElement): RenderWorkerPort | null {

    if (!canUseWorker(canvas))
        return null;

    try {
        // Resolves because web/index.html is served beside dist/main.js, where webpack's render.worker entry
        // emits it.
        return new Worker("../dist/render.worker.js") as unknown as RenderWorkerPort;
    } catch {
        return null;
    }
}

function inProcessBackend(canvas: HTMLCanvasElement): RenderBackend | null {

    let context: CanvasRenderingContext2D | null = null;

    // A transferred canvas throws InvalidStateError rather than returning null.
    try {
        context = canvas.getContext('2d');
    } catch {
        context = null;
    }

    return context === null ? null : new InProcessBackend(canvas, context);
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob === null
            ? reject(new Error("the canvas could not be encoded as a PNG"))
            : resolve(blob), 'image/png');
    });
}

class InProcessBackend implements RenderBackend {

    readonly usesWorker = false;
    readonly ready = true;
    onReady: (() => void) | null = null;

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly surface: RenderSurface
    ) {}

    draw(graph: Graph, camera: CameraView, selected: Tag | null, width: number, height: number, emphasis: Emphasis): boolean {

        // Invariant 2: one projector for both the projection pass and the draw.
        const projector = Projector.forCanvas(width, height, camera);

        projectGraph(graph, projector);
        render(this.surface, graph, projector.camera, selected, emphasis);

        return true;
    }

    resize(width: number, height: number, dpr: number): void {

        // The same helper the worker engine uses, so both realms size the backing store identically.
        resizeBackingStore(this.canvas, this.surface, width, height, dpr);
    }

    setGraph(_graph: Graph): void {
        // Stateless per draw: the graph arrives with every frame.
    }

    exportPng(): Promise<Blob> {
        return canvasBlob(this.canvas);
    }

    terminate(): void {}
}

/**
 * An `OffscreenCanvas` handed to `dist/render.worker.js` once the worker proves it answers; one frame in
 * flight.
 * The probe comes first because the transfer is one-way: a 404ing worker must leave the canvas usable here.
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
    // Armed while a frame is in flight: an ack that never comes is a dead worker.
    private frameTimer: ReturnType<typeof setTimeout> | null = null;

    private graph: Graph | null;
    // The graph's shape at the last init; growth in place re-inits the mirror.
    private shape: GraphShape = { vertices: -1, edges: -1 };
    private width = 0;
    private height = 0;
    private dpr = 1;

    private pendingCamera: CameraView | null = null;
    private pendingEmphasis: Emphasis = Emphasis.nodes;
    private pendingSelected: Tag | null = null;
    private pendingSelectedIndex = -1;
    private pendingIndexGraph: Graph | null = null;

    /** One being filled, one in flight, one coming back in the ack. */
    private free: Float64Array[] = [];

    // Posted by structured clone, not transfer, so a frame allocates nothing here.
    private readonly scratchCamera = new Float64Array(CAMERA_VALUES);

    private frameId = 0;
    private exportId = 0;
    private readonly exports = new Map<number, {
        resolve: (blob: Blob) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly worker: RenderWorkerPort,
        graph: Graph | null,
        timeoutMS: number,
        private readonly frameTimeoutMS: number,
        private readonly onFallback: (size: SurfaceSize) => void,
        private readonly onCrash: (reason: string, size: SurfaceSize) => void
    ) {
        this.graph = graph;

        worker.onmessage = event => this.receive(event.data);

        // Before the probe a load failure falls back; after it, any error is a crash.
        worker.onerror = () => this.fail("the render worker raised an error");

        this.timer = setTimeout(() => this.fail("the render worker never answered ready"), timeoutMS);
    }

    get usesWorker(): boolean {
        return !this.disposed;
    }

    get ready(): boolean {
        return this.probePassed;
    }

    draw(graph: Graph, camera: CameraView, selected: Tag | null, width: number, height: number, emphasis: Emphasis): boolean {

        if (this.disposed)
            return false;

        this.width = width;
        this.height = height;

        if (graph !== this.graph)
            this.setGraph(graph);
        else if (this.initialised && !sameShape(graph, this.shape))
            this.restart();

        // The selection index is O(N) to resolve, so it is cached across frames.
        if (selected !== this.pendingSelected || graph !== this.pendingIndexGraph) {
            this.pendingSelected = selected;
            this.pendingIndexGraph = graph;
            this.pendingSelectedIndex = selected === null ? -1 : graph.vertices.indexOf(selected);
        }

        this.pendingCamera = camera;
        this.pendingEmphasis = emphasis;

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
        this.restart();
    }

    private restart(): void {

        // Bump the generation so a response for the replaced graph is dropped; the frame in flight is
        // abandoned.
        this.generation++;
        this.initialised = false;
        this.inFlight = false;
        this.clearFrameTimer();
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

            const timer = setTimeout(() => {
                if (this.exports.delete(requestId))
                    reject(new Error("the render worker did not answer the export"));
            }, this.frameTimeoutMS);

            this.exports.set(requestId, { resolve, reject, timer });
            this.worker.postMessage({ type: "export", requestId }, []);
        });
    }

    terminate(): void {
        this.dispose("the render worker is terminated");
    }

    /** Shared teardown: one sequence, so neither the terminate nor the failed-start path can miss a step. */
    private dispose(reason: string): void {

        this.disposed = true;
        this.clearTimer();
        this.clearFrameTimer();
        this.worker.terminate();

        for (const pending of this.exports.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(reason));
        }

        this.exports.clear();
    }

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

        this.shape = graphShape(graph);
        this.free = [new Float64Array(length), new Float64Array(length), new Float64Array(length)];

        const init = initRequest(graph, this.generation);
        const transfer: Transferable[] = initTransfer(init);

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

        if (positions === undefined)
            return;

        // Pooled buffers are sized to this graph; a mismatch means a re-init is due. The buffer
        // goes back, so the pool cannot drain while the mismatch lasts.
        if (positions.length !== graph.vertices.length * 3) {
            this.free.push(positions);
            return;
        }

        readPositions(graph, positions);
        encodeCameraInto(camera, this.scratchCamera);

        const frame: FrameRequest = {
            type: "frame",
            generation: this.generation,
            frameId: ++this.frameId,
            camera: this.scratchCamera,
            positions,
            selected: this.pendingSelectedIndex,
            emphasis: this.pendingEmphasis,
            width: this.width,
            height: this.height,
            dpr: this.dpr,
        };

        this.inFlight = true;

        // Consumed, so the next post waits for another draw or the ack's pump.
        this.pendingCamera = null;

        this.frameTimer = setTimeout(() => this.fail("the render worker did not answer a frame"), this.frameTimeoutMS);

        this.worker.postMessage(frame, [positions.buffer as Transferable]);
    }

    private receive(message: RenderResponse): void {

        if (this.disposed)
            return;

        if (message.type === "ready") {
            this.becomeReady();
            return;
        }

        if (message.type === "error") {
            this.fail(message.reason);
            return;
        }

        if (message.type === "png") {

            const pending = this.exports.get(message.requestId);

            if (pending) {
                this.exports.delete(message.requestId);
                clearTimeout(pending.timer);

                if (message.blob !== undefined)
                    pending.resolve(message.blob);
                else
                    pending.reject(new Error(message.error ?? "the render worker could not export"));
            }

            return;
        }

        // A stale ack belongs to another generation: it must not release the frame in flight.
        if (message.generation !== this.generation)
            return;

        this.inFlight = false;
        this.clearFrameTimer();
        this.free.push(message.positions);

        // Depth write-back: the drag's unproject and the cull tie-break read the frame actually drawn.
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
            // Only now: the probe proved the worker answers, and the transfer cannot be undone.
            offscreen = this.canvas.transferControlToOffscreen() as unknown as Transferable;
        } catch {
            // Already transferred; RenderRunner.create() swaps such a canvas first, so this is a host that
            // transferred it some other way.
            this.fail("the canvas was already transferred");
            return;
        }

        transferredCanvases.add(this.canvas);
        this.offscreen = offscreen;
        this.probePassed = true;

        if (this.onReady)
            this.onReady();

        this.pump();
    }

    /**
     * Before the probe the canvas is still ours, so a failure falls back on it. After the transfer the canvas is
     * the dead worker's, so the runner must draw on a replacement.
     */
    private fail(reason: string): void {

        if (this.disposed)
            return;

        const size = { width: this.width, height: this.height, dpr: this.dpr };

        if (!this.probePassed) {
            this.dispose("the render worker failed to start");
            this.onFallback(size);
            return;
        }

        this.dispose(reason);
        this.onCrash(reason, size);
    }

    private clearFrameTimer(): void {
        if (this.frameTimer !== null) {
            clearTimeout(this.frameTimer);
            this.frameTimer = null;
        }
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
     * A 2D context is requested only when the worker path is unavailable: creating one makes the transfer
     * throw.
     */
    static supported(canvas: HTMLCanvasElement): boolean {

        if (renderModeFromLocation() !== "main" && canUseWorker(canvas))
            return true;

        return canvas.getContext('2d') !== null;
    }

    static create(
        canvas: HTMLCanvasElement,
        onReady: () => void,
        options: RenderRunnerOptions = {}
    ): RenderRunner | null {

        const mode = options.mode ?? renderModeFromLocation();

        // A canvas a previous runner transferred can neither transfer again nor give a 2d context.
        if (transferredCanvases.has(canvas) && options.replaceCanvas)
            canvas = options.replaceCanvas() ?? canvas;

        // An injected factory is the test seam, so it bypasses the feature check.
        if (mode === "worker" && (options.workerFactory !== undefined || canUseWorker(canvas))) {

            const factory = options.workerFactory ?? defaultWorkerFactory;

            let worker: RenderWorkerPort | null = null;

            // A worker that cannot be constructed is not an error: in-process is the documented fallback.
            try {
                worker = factory(canvas);
            } catch {
                worker = null;
            }

            if (worker !== null) {

                let runner: RenderRunner | null = null;

                const adopt = (target: HTMLCanvasElement | null, size: SurfaceSize): void => {

                    const replacement = target === null ? null : inProcessBackend(target);

                    if (replacement === null || runner === null)
                        return;

                    // The worker held the size; the new backing store must take it, not the element default.
                    if (size.width > 0 && size.height > 0)
                        replacement.resize(size.width, size.height, size.dpr);

                    runner.replaceBackend(replacement);

                    // The worker's last frame died with it, so the new surface needs a draw.
                    onReady();
                };

                const backend = new WorkerBackend(
                    canvas,
                    worker,
                    options.graph ?? null,
                    options.readyTimeoutMS ?? K.renderer.workerReadyTimeoutMS,
                    options.frameTimeoutMS ?? K.renderer.workerFrameTimeoutMS,
                    // The probe failed before any transfer, so the canvas is still usable here.
                    size => adopt(canvas, size),
                    (reason, size) => {
                        console.error(`render worker failed (${reason}); continuing in process`);
                        adopt(options.replaceCanvas ? options.replaceCanvas() : null, size);
                    }
                );

                runner = new RenderRunner(backend, onReady);

                return runner;
            }
        }

        const backend = inProcessBackend(canvas);

        return backend === null ? null : new RenderRunner(backend, onReady);
    }

    static over(backend: RenderBackend, onReady: () => void = () => {}): RenderRunner {
        return new RenderRunner(backend, onReady);
    }

    get usesWorker(): boolean {
        return this.backend.usesWorker;
    }

    get ready(): boolean {
        return this.backend.ready;
    }

    draw(graph: Graph, camera: CameraView, selected: Tag | null, width: number, height: number, emphasis: Emphasis): boolean {
        return this.backend.draw(graph, camera, selected, width, height, emphasis);
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

    private replaceBackend(backend: RenderBackend): void {

        const previous = this.backend;

        this.backend = backend;
        backend.onReady = this.onReady;

        if (previous !== backend)
            previous.terminate();
    }
}
