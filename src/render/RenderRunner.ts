import { Emphasis } from "../core/Emphasis";
import { Graph } from "../graph/Graph";
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

export interface RenderRunnerOptions {
    /** The default is `worker` unless the URL says `?render=main`. */
    mode?: RenderMode;
    graph?: Graph;
    workerFactory?: RenderWorkerFactory;
    readyTimeoutMS?: number;
}

// Browsers refuse top-frame navigation to a `data:` URL, hence the `blob:` object URL.
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

    const context = canvas.getContext('2d');

    return context === null ? null : new InProcessBackend(canvas, context);
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

    async exportPng(): Promise<Blob> {
        return pngBlob(this.canvas);
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

    private graph: Graph | null;
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

        // A worker script that fails to load never answers: hand back rather than freeze.
        worker.onerror = () => this.fail();

        this.timer = setTimeout(() => this.fail(), timeoutMS);
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

        // Bump the generation so a response for the replaced graph is dropped; the frame in flight is
        // abandoned.
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

    /** Shared teardown: one sequence, so neither the terminate nor the failed-start path can miss a step. */
    private dispose(reason: string): void {

        this.disposed = true;
        this.clearTimer();
        this.worker.terminate();

        for (const pending of this.exports.values())
            pending.reject(new Error(reason));

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

        this.free = [new Float64Array(length), new Float64Array(length), new Float64Array(length)];

        const init = initRequest(graph, this.generation);
        const transfer: Transferable[] = [init.positions.buffer as Transferable];

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
            emphasis: this.pendingEmphasis,
            width: this.width,
            height: this.height,
            dpr: this.dpr,
        };

        this.inFlight = true;

        // Consumed, so the next post waits for another draw or the ack's pump.
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

        // A stale ack belongs to another generation: it must not release the frame in flight.
        if (message.generation !== this.generation)
            return;

        this.inFlight = false;
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
            // Already transferred (a second initialize over a live page), so there is nothing left to draw
            // on.
            this.fail();
            return;
        }

        this.offscreen = offscreen;
        this.probePassed = true;

        if (this.onReady)
            this.onReady();

        this.pump();
    }

    private fail(): void {

        // After the transfer a failure is a crash, not a load failure: only pre-probe failures fall back.
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

                const backend = new WorkerBackend(
                    canvas,
                    worker,
                    options.graph ?? null,
                    options.readyTimeoutMS ?? K.renderer.workerReadyTimeoutMS,
                    () => {
                        // The probe failed before any transfer, so the canvas is still usable here.
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
