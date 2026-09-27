import { Edge, otherEndpoint } from "./Edge";
import { Tag } from "./Tag";

export class Graph {

	vertices: Array<Tag> = [];
	edges: Array<Edge> = [];

	/**
	 * Incident edges per vertex, kept in sync with `edges`; the spring pass walks these
	 * instead of rescanning every edge, turning O(V*E) per step into O(V + E).
	 */
	adjacency: Map<Tag, Array<Edge>> = new Map();

	/**
	 * Undirected membership index, kept in sync with `edges`; `hasEdge` reads it in
	 * O(1) instead of rescanning every edge. A self-loop indexes its vertex here,
	 * but `hasEdge(v, v)` is still false.
	 */
	private readonly neighbourSets: Map<Tag, Set<Tag>> = new Map();

	addNode(tag: Tag) {
		// A repeated vertex would double-count in the O(N^2) pass and make every
		// index-based tie-break ambiguous, so it is rejected like a foreign edge.
		if (this.adjacency.has(tag))
			throw new Error("Graph.addNode: vertex is already in the graph");

		this.vertices.push(tag);
		this.adjacency.set(tag, []);
		this.neighbourSets.set(tag, new Set());
	};

	addEdge(v1: Tag, v2: Tag) {
		// The adjacency map is the membership index: addNode() is its only writer,
		// so a tag it holds is in `vertices`. An O(1) lookup, not an indexOf scan.
		const incidentToV1 = this.adjacency.get(v1);
		const incidentToV2 = this.adjacency.get(v2);
		const neighboursOfV1 = this.neighbourSets.get(v1);
		const neighboursOfV2 = this.neighbourSets.get(v2);

		if (!incidentToV1 || !incidentToV2 || !neighboursOfV1 || !neighboursOfV2)
			throw new Error("Graph.addEdge: both vertices must already be in the graph");

		var edge = { v1, v2 };

		this.edges.push(edge);
		incidentToV1.push(edge);

		// A self-loop is incident to its vertex once, not twice.
		if (v2 !== v1)
			incidentToV2.push(edge);

		// Membership is undirected and idempotent under the duplicate edges addEdge
		// permits. A self-loop still records the pair; hasEdge applies the
		// "a vertex is not its own neighbour" rule on read.
		neighboursOfV1.add(v2);
		neighboursOfV2.add(v1);
	};

	/** The edges incident to `v`, in insertion order. Empty for an unknown tag. */
	incidentEdges(v: Tag): Array<Edge> {
		return this.adjacency.get(v) ?? [];
	};

	/** True when an undirected edge already joins v1 and v2. O(1). */
	hasEdge(v1: Tag, v2: Tag) {
		// A vertex is not its own neighbour, even though a self-loop is indexed.
		if (v1 === v2)
			return false;

		return this.neighbourSets.get(v1)?.has(v2) ?? false;
	};

	/**
	 * The distinct neighbours of `v`, in insertion order, one entry per adjacent vertex;
	 * duplicate edges and self-loops never produce a repeated entry.
	 */
	neighbours(v: Tag) {
		var out: Array<Tag> = [];
		var seen = new Set<Tag>();

		for (const edge of this.incidentEdges(v)) {

			var other = otherEndpoint(edge, v);

			if (other === null)
				continue;

			if (seen.has(other))
				continue;

			seen.add(other);
			out.push(other);
		}

		return out;
	};

	/** The first selected vertex, or null when nothing is selected. */
	selectedVertex(): Tag | null {
		return this.vertices.find(v => v.isSelected) ?? null;
	};

	clearSelection() {
		for (const v of this.vertices)
			v.isSelected = false;
	};

};
