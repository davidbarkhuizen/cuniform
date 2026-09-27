import { ForceDirectedGraph } from "./ForceDirectedGraph";
import { Graph } from "./Graph";
import { point3 } from "./Point3D";
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

    const vertices = graph.vertices;
    const positions = new Float64Array(vertices.length * 3);

    for (let i = 0; i < vertices.length; i++) {
        positions[3 * i] = vertices[i].position.x;
        positions[3 * i + 1] = vertices[i].position.y;
        positions[3 * i + 2] = vertices[i].position.z;
    }

    const edges = new Int32Array(graph.edges.length * 2);
    const index = new Map<Tag, number>();

    for (let i = 0; i < vertices.length; i++)
        index.set(vertices[i], i);

    for (let e = 0; e < graph.edges.length; e++) {
        edges[2 * e] = index.get(graph.edges[e].v1) ?? -1;
        edges[2 * e + 1] = index.get(graph.edges[e].v2) ?? -1;
    }

    return { type: "init", generation, positions, edges };
}

/**
 * The worker-side physics. It rebuilds the same `Tag` graph locally so it runs
 * the exact same `stepPhysics()` the main thread would, which is what makes the
 * two backends deterministic under the same seed.
 */
export class PhysicsWorkerEngine {

    graph: Graph | null = null;
    solver: ForceDirectedGraph | null = null;

    private pinned: Tag | null = null;

    /** Apply one request; returns the response to post, or null when none is due. */
    handle(request: WorkerRequest): PositionsResponse | null {

        if (request.type === "init") {
            this.build(request);
            return null;
        }

        if (this.graph === null || this.solver === null)
            return null;

        this.pinned = request.pinned >= 0 ? this.graph.vertices[request.pinned] ?? null : null;

        // The main thread writes the pin's pointer position before asking for a
        // step; here it arrives in the message and is applied the same way.
        if (this.pinned !== null) {
            this.pinned.position.x = request.x;
            this.pinned.position.y = request.y;
            this.pinned.position.z = request.z;
        }

        const pinned = this.pinned;

        this.solver.stepPhysics(tag => tag === pinned);

        return {
            type: "positions",
            generation: request.generation,
            positions: this.positions(),
            maxDisplacement: this.solver.lastMaxDisplacement,
        };
    }

    private build(request: InitRequest): void {

        const graph = new Graph();
        const count = Math.floor(request.positions.length / 3);

        for (let i = 0; i < count; i++) {
            graph.addNode(new Tag(
                point3(
                    request.positions[3 * i],
                    request.positions[3 * i + 1],
                    request.positions[3 * i + 2]
                ),
                `n${i}`
            ));
        }

        for (let e = 0; e + 1 < request.edges.length; e += 2) {
            const a = request.edges[e];
            const b = request.edges[e + 1];

            if (a >= 0 && b >= 0)
                graph.addEdge(graph.vertices[a], graph.vertices[b]);
        }

        this.graph = graph;
        this.solver = new ForceDirectedGraph(graph);
        this.pinned = null;
    }

    /** A fresh flat copy of the positions, safe to transfer to the main thread. */
    private positions(): Float64Array {

        const vertices = this.graph?.vertices ?? [];
        const out = new Float64Array(vertices.length * 3);

        for (let i = 0; i < vertices.length; i++) {
            out[3 * i] = vertices[i].position.x;
            out[3 * i + 1] = vertices[i].position.y;
            out[3 * i + 2] = vertices[i].position.z;
        }

        return out;
    }
}
