import { ForceDirectedGraph } from "./ForceDirectedGraph";
import { Graph, GraphShape, graphShape, sameShape } from "../graph/Graph";
import { readPositions, writePositions } from "../graph/MirrorGraph";
import { initRequest, PositionsResponse, stepWithPin, StepRequest, WorkerRequest } from "./PhysicsProtocol";
import { WorkerPort } from "../core/WorkerChannel";
import { K } from "../core/K";

/**
 * The main-thread owner of the physics; only force integration leaves this thread. See docs/physics.md
 * ("Cadence").
 */
export type PhysicsWorkerPort = WorkerPort<WorkerRequest, PositionsResponse>;

export type WorkerFactory = () => PhysicsWorkerPort | null;

export interface PhysicsBackend {
    readonly usesWorker: boolean;
    /** Largest node travel in the most recent step, read by the settle detector. */
    readonly maxDisplacement: number;
    step(pinnedIndex: number, x: number, y: number, z: number): void;
    /** The latest flat positions, length 3N. */
    positions(): Float64Array;
    /** Copy the latest positions onto `graph`'s tags before projecting. */
    sync(graph: Graph): void;
    terminate(): void;
}

function defaultWorkerFactory(): PhysicsWorkerPort | null {
    if (typeof Worker === "undefined")
        return null;

    try {
        // Resolves because web/index.html is served beside dist/main.js, where webpack's second entry emits
        // it.
        return new Worker("../dist/simulation.worker.js") as unknown as PhysicsWorkerPort;
    } catch {
        return null;
    }
}

/** Main-thread solver: it owns the Tags, so `sync()` is a no-op. */
class InProcessBackend implements PhysicsBackend {

    readonly usesWorker = false;

    constructor(private readonly solver: ForceDirectedGraph) {}

    get maxDisplacement(): number {
        return this.solver.lastMaxDisplacement;
    }

    step(pinnedIndex: number, x: number, y: number, z: number): void {

        // The same helper the worker engine uses, so a pin means the same thing on both backends.
        stepWithPin(this.solver, this.solver.graph, pinnedIndex, x, y, z);
    }

    positions(): Float64Array {

        const out = new Float64Array(this.solver.graph.vertices.length * 3);

        readPositions(this.solver.graph, out);

        return out;
    }

    sync(_graph: Graph): void {
    }

    terminate(): void {}
}

class WorkerBackend implements PhysicsBackend {

    readonly usesWorker = true;

    private generation = 0;
    private latest: Float64Array;
    private latestMaxDisplacement = 0;
    private inFlight = false;
    private disposed = false;

    // Armed while a step is in flight: a reply that never comes is a hung worker.
    private stepTimer: ReturnType<typeof setTimeout> | null = null;

    // The latest pin, overlaid on every reply: a reply was computed with an older pin,
    // so without the overlay sync() would drag the pinned node back a round trip.
    private pinIndex = -1;
    private pinX = 0;
    private pinY = 0;
    private pinZ = 0;

    // The graph the worker mirrors, and its shape at the last init: a graph grown in
    // place must be re-sent, or sync() writes an old-sized buffer and new tags go NaN.
    private graph: Graph;
    private shape: GraphShape;

    constructor(
        private readonly worker: PhysicsWorkerPort,
        graph: Graph,
        private readonly onFailure: (positions: Float64Array) => void,
        private readonly stepTimeoutMS: number = K.physics.workerStepTimeoutMS
    ) {

        this.graph = graph;
        this.shape = graphShape(graph);
        this.latest = new Float64Array(graph.vertices.length * 3);

        // Mirror now: the first frame may be drawn before the worker answers.
        readPositions(graph, this.latest);

        worker.onmessage = event => this.receive(event.data);

        // A worker script that fails to load never answers: hand back rather than freeze.
        worker.onerror = () => this.fail();

        worker.postMessage(initRequest(graph, this.generation));
    }

    get maxDisplacement(): number {
        return this.latestMaxDisplacement;
    }

    step(pinnedIndex: number, x: number, y: number, z: number): void {

        this.ensureShape();

        // Recorded even when no step is posted, so a pin moved while a step is in flight is not lost.
        this.recordPin(pinnedIndex, x, y, z);

        // One step in flight at a time: a slow worker must not queue a backlog.
        if (this.inFlight || this.disposed)
            return;

        this.inFlight = true;

        const message: StepRequest = {
            type: "step",
            generation: this.generation,
            pinned: pinnedIndex,
            x,
            y,
            z,
        };

        this.stepTimer = setTimeout(() => this.fail(), this.stepTimeoutMS);

        this.worker.postMessage(message);
    }

    positions(): Float64Array {
        return this.latest;
    }

    sync(graph: Graph): void {
        this.ensureShape();
        writePositions(graph, this.latest);
    }

    reinit(graph: Graph): void {

        this.graph = graph;
        this.shape = graphShape(graph);
        this.generation++;
        this.inFlight = false;
        this.clearStepTimer();
        this.latest = new Float64Array(graph.vertices.length * 3);
        this.latestMaxDisplacement = 0;
        this.pinIndex = -1;

        readPositions(graph, this.latest);
        this.worker.postMessage(initRequest(graph, this.generation));
    }

    terminate(): void {
        this.disposed = true;
        this.clearStepTimer();
        this.worker.terminate();
    }

    // Lossless: the main thread owns the Tags, so the runner resumes in process from the last reply.
    private fail(): void {

        if (this.disposed)
            return;

        this.disposed = true;
        this.clearStepTimer();
        this.onFailure(this.latest);
    }

    private clearStepTimer(): void {
        if (this.stepTimer !== null) {
            clearTimeout(this.stepTimer);
            this.stepTimer = null;
        }
    }

    private receive(message: PositionsResponse): void {

        // A graph swap bumps the generation, so a response from before it is stale.
        if (this.disposed || message.generation !== this.generation)
            return;

        this.latest = message.positions;
        this.applyPin(this.latest);
        this.latestMaxDisplacement = message.maxDisplacement;
        this.inFlight = false;
        this.clearStepTimer();
    }

    // Re-sent from the live tags, so the worker resumes from the current layout.
    private ensureShape(): void {
        if (!this.disposed && !sameShape(this.graph, this.shape))
            this.reinit(this.graph);
    }

    private recordPin(index: number, x: number, y: number, z: number): void {
        this.pinIndex = index;
        this.pinX = x;
        this.pinY = y;
        this.pinZ = z;

        this.applyPin(this.latest);
    }

    // The same range rule as pinnedTagOf(): -1 or out of range pins nothing.
    private applyPin(buffer: Float64Array): void {
        const i = this.pinIndex;

        if (i < 0 || 3 * i + 2 >= buffer.length)
            return;

        buffer[3 * i] = this.pinX;
        buffer[3 * i + 1] = this.pinY;
        buffer[3 * i + 2] = this.pinZ;
    }
}

export class PhysicsRunner {

    private solver: ForceDirectedGraph;
    private backend: PhysicsBackend;
    private readonly workerFactory: WorkerFactory;

    constructor(solver: ForceDirectedGraph, workerFactory: WorkerFactory = defaultWorkerFactory) {
        this.solver = solver;
        this.workerFactory = workerFactory;
        this.backend = this.createBackend(solver.graph);
    }

    get usesWorker(): boolean {
        return this.backend.usesWorker;
    }

    get maxDisplacement(): number {
        return this.backend.maxDisplacement;
    }

    step(pinnedIndex: number, x: number, y: number, z: number): void {
        this.backend.step(pinnedIndex, x, y, z);
    }

    positions(): Float64Array {
        return this.backend.positions();
    }

    sync(graph: Graph): void {
        this.backend.sync(graph);
    }

    setGraph(solver: ForceDirectedGraph): void {
        this.solver = solver;

        if (this.backend.usesWorker && this.backend instanceof WorkerBackend) {
            // Reuse the worker, bumping the generation so a response for the replaced graph is dropped.
            this.backend.reinit(solver.graph);
            return;
        }

        this.backend = new InProcessBackend(this.solver);
    }

    terminate(): void {
        this.backend.terminate();
    }

    private createBackend(graph: Graph): PhysicsBackend {

        let worker: PhysicsWorkerPort | null = null;

        // A worker that cannot be constructed is not an error: in-process is the documented fallback.
        try {
            worker = this.workerFactory();
        } catch {
            worker = null;
        }

        if (worker !== null) {
            const failed = worker;
            return new WorkerBackend(worker, graph, positions => this.fallBack(failed, positions));
        }

        return new InProcessBackend(this.solver);
    }

    private fallBack(failed: PhysicsWorkerPort, positions: Float64Array): void {

        // Ignore an error from a worker the runner has already replaced.
        if (!this.backend.usesWorker)
            return;

        failed.terminate();

        // Seed the in-process solver's tags from the last positions the worker reported.
        writePositions(this.solver.graph, positions);
        this.backend = new InProcessBackend(this.solver);
    }
}
