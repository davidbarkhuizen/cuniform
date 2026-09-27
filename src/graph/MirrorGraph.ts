import { Graph } from "./Graph";
import { point3 } from "../core/Point3D";
import { Tag } from "./Tag";

/**
 * Rebuild the `Tag` graph the main thread is simulating from the flat data a
 * worker receives: labels, undirected edge index pairs and `[x, y, z]`
 * positions.
 *
 * One implementation for both workers, so the physics mirror and the render
 * mirror cannot drift. Node insertion order is the index space both directions
 * agree on; a self-loop or a duplicate edge is accepted exactly as `addEdge`
 * accepts it, which is what keeps the mirror's topology identical.
 */
export function buildMirrorGraph(labels: string[], edges: Int32Array, positions: Float64Array): Graph {

    const graph = new Graph();
    const count = Math.floor(positions.length / 3);

    for (let i = 0; i < count; i++) {
        graph.addNode(new Tag(
            point3(
                positions[3 * i],
                positions[3 * i + 1],
                positions[3 * i + 2]
            ),
            labels[i] ?? `n${i}`
        ));
    }

    for (let e = 0; e + 1 < edges.length; e += 2) {
        const a = edges[e];
        const b = edges[e + 1];

        if (a >= 0 && b >= 0)
            graph.addEdge(graph.vertices[a], graph.vertices[b]);
    }

    return graph;
}

/** Read the graph's tag positions into `out`, length 3N. */
export function readPositions(graph: Graph, out: Float64Array): void {

    const vertices = graph.vertices;

    for (let i = 0; i < vertices.length; i++) {
        out[3 * i] = vertices[i].position.x;
        out[3 * i + 1] = vertices[i].position.y;
        out[3 * i + 2] = vertices[i].position.z;
    }
}

/** Write flat positions onto the graph's tags. */
export function writePositions(graph: Graph, positions: Float64Array): void {

    const vertices = graph.vertices;

    for (let i = 0; i < vertices.length; i++) {
        vertices[i].position.x = positions[3 * i];
        vertices[i].position.y = positions[3 * i + 1];
        vertices[i].position.z = positions[3 * i + 2];
    }
}

/**
 * The flat form of a graph as it crosses to a worker: positions as
 * `[x0, y0, z0, x1, ...]`, length 3N, and undirected edge endpoints as
 * node-index pairs, length 2E.
 *
 * The encoder for the index space `buildMirrorGraph` decodes, kept in the same
 * module so the two directions cannot disagree about the `3 * i` position
 * stride, the `2 * e` edge stride, or the `-1` missing-endpoint sentinel. The
 * sentinel is the decoder's contract for a malformed message; `addEdge()`
 * normally stops the encoder from ever emitting one.
 */
export interface MirrorWire {
    positions: Float64Array;
    edges: Int32Array;
}

/** Encode `graph` for the wire, in `buildMirrorGraph`'s index space. */
export function packMirror(graph: Graph): MirrorWire {

    const vertices = graph.vertices;
    const positions = new Float64Array(vertices.length * 3);

    readPositions(graph, positions);

    const edges = new Int32Array(graph.edges.length * 2);
    const index = new Map<Tag, number>();

    for (let i = 0; i < vertices.length; i++)
        index.set(vertices[i], i);

    for (let e = 0; e < graph.edges.length; e++) {
        edges[2 * e] = index.get(graph.edges[e].v1) ?? -1;
        edges[2 * e + 1] = index.get(graph.edges[e].v2) ?? -1;
    }

    return { positions, edges };
}
