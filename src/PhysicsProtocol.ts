import { ForceDirectedGraph } from "./ForceDirectedGraph";
import { Graph } from "./Graph";
import { buildMirrorGraph, packMirror, readPositions } from "./MirrorGraph";
import { Tag } from "./Tag";

/**
 * The message protocol between PhysicsRunner (main thread) and the physics
 * worker, plus the worker-side engine that applies it.
 *
 * This module is pure: it names no browser global, so it can be driven by the
 * worker entry, by the main thread, and by an in-memory fake in tests. The
 * worker entry itself (`simulation.worker.ts`) is the only piece that touches
 * `self`/`postMessage`.
 *
 * Position and edge data cross the boundary as typed arrays, and a positions
 * response is posted with a transfer list, so the cost is a pointer move rather
 * than a copy. Transferables, not SharedArrayBuffer: shared memory needs
 * COOP/COEP headers the static demo does not set.
 */

export interface InitRequest {
    type: "init";
    generation: number;
    /** Node positions as `[x0, y0, z0, x1, ...]`, length 3N. */
    positions: Float64Array;
    /** Undirected edge endpoints as node-index pairs, length 2E. */
    edges: Int32Array;
}

export interface StepRequest {
    type: "step";
    generation: number;
    /** Index of the pinned node, or -1 when nothing is pinned. */
    pinned: number;
    x: number;
    y: number;
    z: number;
}

export type WorkerRequest = InitRequest | StepRequest;

export interface PositionsResponse {
    type: "positions";
    generation: number;
    /** Node positions as `[x0, y0, z0, x1, ...]`, length 3N. Post with transfer. */
    positions: Float64Array;
    /** The largest node travel this step, for the main thread's settle detector. */
    maxDisplacement: number;
}

/** The `init` message for `graph`, with node insertion order as the index space. */
export function initRequest(graph: Graph, generation: number): InitRequest {

    const wire = packMirror(graph);

    return { type: "init", generation, positions: wire.positions, edges: wire.edges };
}

/** The tag at `index`, or null when the index pins nothing. `-1` is the wire's
 * "no pin" sentinel, and an out-of-range index is treated the same way. */
export function pinnedTagOf(graph: Graph, index: number): Tag | null {
    if (index < 0 || index >= graph.vertices.length)
        return null;

    return graph.vertices[index];
}

/**
 * Write the pin's pointer position onto its tag, then advance the solver one
 * step with that tag pinned. An index that pins nothing steps every node.
 *
 * The single home for the pin rule, so the main thread's in-process backend and
 * the worker engine cannot apply a pin differently; that sameness is what makes
 * the two backends deterministic under one seed.
 */
export function stepWithPin(
    solver: ForceDirectedGraph,
    graph: Graph,
    pinnedIndex: number,
    x: number,
    y: number,
    z: number
): void {

    const pinned = pinnedTagOf(graph, pinnedIndex);

    if (pinned !== null) {
        pinned.position.x = x;
        pinned.position.y = y;
        pinned.position.z = z;
    }

    solver.stepPhysics(tag => tag === pinned);
}

/**
 * The worker-side physics. It rebuilds the same `Tag` graph locally so it runs
 * the exact same `stepPhysics()` the main thread would, which is what makes the
 * two backends deterministic under the same seed.
 */
export class PhysicsWorkerEngine {

    graph: Graph | null = null;
    solver: ForceDirectedGraph | null = null;

    /** Apply one request; returns the response to post, or null when none is due. */
    handle(request: WorkerRequest): PositionsResponse | null {

        if (request.type === "init") {
            this.build(request);
            return null;
        }

        if (this.graph === null || this.solver === null)
            return null;

        // The main thread writes the pin's pointer position before asking for a
        // step; here it arrives in the message. Both realms apply it through the
        // same helper, so the pin rule cannot drift between them.
        stepWithPin(this.solver, this.graph, request.pinned, request.x, request.y, request.z);

        return {
            type: "positions",
            generation: request.generation,
            positions: this.positions(),
            maxDisplacement: this.solver.lastMaxDisplacement,
        };
    }

    private build(request: InitRequest): void {

        // The shared mirror builder, so the physics and render mirrors cannot
        // drift. Physics never reads a label, so the builder's own `n<i>` default
        // is left to supply them rather than building a list here.
        const graph = buildMirrorGraph([], request.edges, request.positions);

        this.graph = graph;
        this.solver = new ForceDirectedGraph(graph);
    }

    /** A fresh flat copy of the positions, safe to transfer to the main thread. */
    private positions(): Float64Array {

        const graph = this.graph;
        const out = new Float64Array((graph?.vertices.length ?? 0) * 3);

        if (graph !== null)
            readPositions(graph, out);

        return out;
    }
}
