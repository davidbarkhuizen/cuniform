import { GraphAttributes } from "./Attributes";
import { Edge, otherEndpoint } from "./Edge";
import { Tag } from "./Tag";

export class Graph {

    vertices: Array<Tag> = [];
    edges: Array<Edge> = [];

    /** Incident edges per vertex, kept in sync with `edges`. */
    adjacency: Map<Tag, Array<Edge>> = new Map();

    /**
     * Per-node and per-edge attributes and the band table (workplan D4), set once by the network builder
     * after the last node and edge; null for a plain graph, which steps and draws without bands or kinds.
     */
    attributes: GraphAttributes | null = null;

    /**
     * Per-frame projection caches for a banded graph, written by `projectGraph` and read by the renderer, as
     * `Tag.translatedPosition` is: each band's four projected corners (x, y) and its centre's depth
     * (BAND_SCREEN_STRIDE per band, depth NaN when culled), and each edge's projected curve control point
     * (x, y; NaN for a straight edge). Allocated once per graph size.
     */
    bandScreen: Float64Array | null = null;
    edgeControls: Float64Array | null = null;

    /** Undirected membership index, kept in sync with `edges`. */
    private readonly neighbourSets: Map<Tag, Set<Tag>> = new Map();

    addNode(tag: Tag) {
        // A repeated vertex would double-count in the O(N^2) pass and make every
        // index-based tie-break ambiguous, so it is rejected.
        if (this.adjacency.has(tag))
            throw new Error("Graph.addNode: vertex is already in the graph");

        this.vertices.push(tag);
        this.adjacency.set(tag, []);
        this.neighbourSets.set(tag, new Set());
    };

    addEdge(v1: Tag, v2: Tag) {
        const incidentToV1 = this.adjacency.get(v1);
        const incidentToV2 = this.adjacency.get(v2);
        const neighboursOfV1 = this.neighbourSets.get(v1);
        const neighboursOfV2 = this.neighbourSets.get(v2);

        if (!incidentToV1 || !incidentToV2 || !neighboursOfV1 || !neighboursOfV2)
            throw new Error("Graph.addEdge: both vertices must already be in the graph");

        let edge = { v1, v2 };

        this.edges.push(edge);
        incidentToV1.push(edge);

        // A self-loop is incident to its vertex once, not twice.
        if (v2 !== v1)
            incidentToV2.push(edge);

        // A self-loop still records the pair here; `hasEdge` applies the not-own-neighbour rule on read.
        neighboursOfV1.add(v2);
        neighboursOfV2.add(v1);
    };

    incidentEdges(v: Tag): Array<Edge> {
        return this.adjacency.get(v) ?? [];
    };

    hasEdge(v1: Tag, v2: Tag) {
        // A vertex is not its own neighbour, even though a self-loop is indexed.
        if (v1 === v2)
            return false;

        return this.neighbourSets.get(v1)?.has(v2) ?? false;
    };

    /** The distinct neighbours of `v`, in insertion order. */
    neighbours(v: Tag) {
        let out: Array<Tag> = [];
        let seen = new Set<Tag>();

        for (const edge of this.incidentEdges(v)) {

            let other = otherEndpoint(edge, v);

            if (other === null)
                continue;

            if (seen.has(other))
                continue;

            seen.add(other);
            out.push(other);
        }

        return out;
    };

    selectedVertex(): Tag | null {
        return this.vertices.find(v => v.isSelected) ?? null;
    };

    clearSelection() {
        for (const v of this.vertices)
            v.isSelected = false;
    };

};

/** A graph's size as the worker mirrors see it; `Graph` is append-only, so any change is growth. */
export interface GraphShape {
    vertices: number;
    edges: number;
}

export function graphShape(graph: Graph): GraphShape {
    return { vertices: graph.vertices.length, edges: graph.edges.length };
}

export function sameShape(graph: Graph, shape: GraphShape): boolean {
    return graph.vertices.length === shape.vertices && graph.edges.length === shape.edges;
}
