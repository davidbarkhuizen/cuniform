import { ForceDirectedGraph } from "./ForceDirectedGraph";
import { Graph } from "../graph/Graph";
import { readPositions, writePositions } from "../graph/MirrorGraph";
import { initRequest, PositionsResponse, stepWithPin, StepRequest, WorkerRequest } from "./PhysicsProtocol";
import { WorkerPort } from "../core/WorkerChannel";

/**
 * The main-thread owner of the physics: either an in-process solver or a
 * physics worker, behind one interface so nothing above it knows which.
 *
 * Projection, hit-testing, selection and rendering all stay on the main thread;
 * only the force integration moves. See docs/physics.md ("Cadence").
 */

/** The main-thread view of the physics worker. */
export type PhysicsWorkerPort = WorkerPort<WorkerRequest, PositionsResponse>;

export type WorkerFactory = () => PhysicsWorkerPort | null;

/** What the runner hides: an in-process solver, or a worker round trip. */
export interface PhysicsBackend {
    /** True when physics runs off the main thread. */
    readonly usesWorker: boolean;
    /** Largest node travel from the most recent step, for the settle detector. */
    readonly maxDisplacement: number;
    step(pinnedIndex: number, x: number, y: number, z: number): void;
    /** The latest flat positions, length 3N. */
    positions(): Float64Array;
    /** Copy the latest positions onto `graph`'s tags before projecting. */
    sync(graph: Graph): void;
    terminate(): void;
}

/** The default: a Worker when the browser has one, else null (in-process). */
function defaultWorkerFactory(): PhysicsWorkerPort | null {
    if (typeof Worker === "undefined")
        return null;

    try {
        // The demo serves web/index.html beside dist/main.js, so the worker
        // bundle emitted by webpack's second entry resolves from there.
        return new Worker("../dist/simulation.worker.js") as unknown as PhysicsWorkerPort;
    } catch {
        return null;
    }
}

/**
 * Runs the solver on the main thread. The solver owns the Tags, so `sync()` is
 * a no-op: the positions the renderer reads are already current.
 */
class InProcessBackend implements PhysicsBackend {

    readonly usesWorker = false;

    constructor(private readonly solver: ForceDirectedGraph) {}

    get maxDisplacement(): number {
        return this.solver.lastMaxDisplacement;
    }

    step(pinnedIndex: number, x: number, y: number, z: number): void {

        // The same helper the worker engine uses, so a pin means the same thing
        // on both backends.
        stepWithPin(this.solver, this.solver.graph, pinnedIndex, x, y, z);
    }

    positions(): Float64Array {

        const out = new Float64Array(this.solver.graph.vertices.length * 3);

        readPositions(this.solver.graph, out);

        return out;
    }

    sync(_graph: Graph): void {
        // The in-process solver already wrote the graph's own tags.
    }

    terminate(): void {}
}

/** Runs the solver in a worker and copies the returned positions back. */
class WorkerBackend implements PhysicsBackend {

    readonly usesWorker = true;

    private generation = 0;
    private latest: Float64Array;
    private latestMaxDisplacement = 0;
    private inFlight = false;
    private disposed = false;

    constructor(
        private readonly worker: PhysicsWorkerPort,
        graph: Graph,
        onFailure: (positions: Float64Array) => void
    ) {

        this.latest = new Float64Array(graph.vertices.length * 3);

        // Mirror the graph immediately, so the first frame before the worker
        // answers still draws the right thing.
        readPositions(graph, this.latest);

        worker.onmessage = event => this.receive(event.data);

        // A worker script that fails to load never answers, so the runner must
        // hand back to the in-process solver rather than freeze.
        worker.onerror = () => onFailure(this.latest);

        worker.postMessage(initRequest(graph, this.generation));
    }

    get maxDisplacement(): number {
        return this.latestMaxDisplacement;
    }

    step(pinnedIndex: number, x: number, y: number, z: number): void {

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

        this.worker.postMessage(message);
    }

    positions(): Float64Array {
        return this.latest;
    }

    sync(graph: Graph): void {
        writePositions(graph, this.latest);
    }

    /** Re-point the worker at a new graph, bumping the generation. */
    reinit(graph: Graph): void {

        this.generation++;
        this.inFlight = false;
        this.latest = new Float64Array(graph.vertices.length * 3);
        this.latestMaxDisplacement = 0;

        readPositions(graph, this.latest);
        this.worker.postMessage(initRequest(graph, this.generation));
    }

    terminate(): void {
        this.disposed = true;
        this.worker.terminate();
    }

    private receive(message: PositionsResponse): void {

        // A graph swap bumps the generation, so a response from before it is stale.
        if (this.disposed || message.generation !== this.generation)
            return;

        this.latest = message.positions;
        this.latestMaxDisplacement = message.maxDisplacement;
        this.inFlight = false;
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

    /** True when physics is running in a worker rather than in-process. */
    get usesWorker(): boolean {
        return this.backend.usesWorker;
    }

    /** Largest node travel from the most recent step. */
    get maxDisplacement(): number {
        return this.backend.maxDisplacement;
    }

    /** Advance one fixed step, pinning `pinnedIndex` at the given position. */
    step(pinnedIndex: number, x: number, y: number, z: number): void {
        this.backend.step(pinnedIndex, x, y, z);
    }

    /** The latest flat positions, length 3N. */
    positions(): Float64Array {
        return this.backend.positions();
    }

    /** Copy the latest positions onto `graph`'s tags before projecting. */
    sync(graph: Graph): void {
        this.backend.sync(graph);
    }

    /** Swap the graph, re-initialising the backend and dropping stale messages. */
    setGraph(solver: ForceDirectedGraph): void {
        this.solver = solver;

        if (this.backend.usesWorker && this.backend instanceof WorkerBackend) {
            // Reuse the worker and bump the generation: a response computed for
            // the graph just replaced must not be applied to the new one.
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

        // A worker that cannot even be constructed is not an error: the
        // in-process backend is the documented fallback.
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

    /** Replace a failed worker backend with the in-process solver. */
    private fallBack(failed: PhysicsWorkerPort, positions: Float64Array): void {

        // Ignore an error from a worker the runner has already replaced.
        if (!this.backend.usesWorker)
            return;

        failed.terminate();

        // The tags are the in-process solver's state, so seed them from the last
        // positions the worker reported before handing over.
        writePositions(this.solver.graph, positions);
        this.backend = new InProcessBackend(this.solver);
    }
}
