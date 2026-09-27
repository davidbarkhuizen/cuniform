import { ForceDirectedGraph } from "./ForceDirectedGraph";
import { Graph } from "../graph/Graph";
import { buildMirrorGraph, packMirror, readPositions } from "../graph/MirrorGraph";
import { Tag } from "../graph/Tag";

/**
 * Protocol between PhysicsRunner and the physics worker, plus the worker-side engine; pure,
 * so the worker entry, the main thread and tests drive it. Positions transfer, not share.
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

/** Tag at `index`, or null when it pins nothing (`-1` sentinel or out of range). */
export function pinnedTagOf(graph: Graph, index: number): Tag | null {
    if (index < 0 || index >= graph.vertices.length)
        return null;

    return graph.vertices[index];
}

/** Writes the pin position onto its tag, then steps with that tag pinned. Single home for
 * the pin rule, so the main thread and worker engine cannot apply it differently. */
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

/** Worker-side physics; rebuilds the same `Tag` graph so it runs the main thread's `stepPhysics()`. */
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

        stepWithPin(this.solver, this.graph, request.pinned, request.x, request.y, request.z);

        return {
            type: "positions",
            generation: request.generation,
            positions: this.positions(),
            maxDisplacement: this.solver.lastMaxDisplacement,
        };
    }

    private build(request: InitRequest): void {

        // The shared mirror builder, so the physics and render mirrors cannot drift;
        // its `n<i>` default supplies labels that physics never reads.
        const graph = buildMirrorGraph([], request.edges, request.positions);

        this.graph = graph;
        this.solver = new ForceDirectedGraph(graph);
    }

    private positions(): Float64Array {

        const graph = this.graph;
        const out = new Float64Array((graph?.vertices.length ?? 0) * 3);

        if (graph !== null)
            readPositions(graph, out);

        return out;
    }
}
