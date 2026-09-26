import { Edge } from "./Edge";
import { Tag } from "./Tag";

export class Graph {

	vertices: Array<Tag> = [];
	edges: Array<Edge> = [];

	/**
	 * Incident edges per vertex, kept in sync with `edges`. The spring pass
	 * walks a node's incident edges instead of rescanning every edge for every
	 * node, which turns the per-step cost from O(V*E) into O(V + E).
	 */
	adjacency: Map<Tag, Array<Edge>> = new Map();

	addNode(tag: Tag) {
		this.vertices.push(tag);

		if (!this.adjacency.has(tag))
			this.adjacency.set(tag, []);
	};

	removeNode(tag: Tag) {

		// splice(-1, 1) removes the last vertex, so a tag that is not in the
		// graph must be rejected before the list is touched.
		var vIdx = this.vertices.indexOf(tag);

		if (vIdx === -1)
			return;

		this.vertices.splice(vIdx, 1);
		this.edges = this.edges.filter(edge => (edge.v1 !== tag) && (edge.v2 !== tag));

		// Removals are rare and touch an arbitrary set of neighbours, so
		// rebuilding is simpler than unpicking every adjacency list and is
		// still O(V + E).
		this.rebuildAdjacency();
	};

	addEdge(v1: Tag, v2: Tag) {
		if((this.vertices.indexOf(v1) === -1) || (this.vertices.indexOf(v2) === -1))
			throw new Error("Graph.addEdge: both vertices must already be in the graph");

		var edge = { v1, v2 };

		this.edges.push(edge);
		this.indexEdge(v1, edge);

		// A self-loop is incident to its vertex once, not twice.
		if (v2 !== v1)
			this.indexEdge(v2, edge);
	};

	/** The edges incident to `v`, in insertion order. Empty for an unknown tag. */
	incidentEdges(v: Tag): Array<Edge> {
		return this.adjacency.get(v) ?? [];
	};

	/** True when an undirected edge already joins v1 and v2. */
	hasEdge(v1: Tag, v2: Tag) {
		for (let i = 0; i < this.edges.length; i++) {
			var e = this.edges[i];
			if ((e.v1 === v1 && e.v2 === v2) || (e.v1 === v2 && e.v2 === v1))
				return true;
		}
		return false;
	};

	/**
	 * The distinct neighbours of `v`, one entry per adjacent vertex. Duplicate
	 * edges and self-loops never produce a repeated entry.
	 */
	neighbours(v: Tag) {
		var out: Array<Tag> = [];

		for (let i = 0; i < this.edges.length; i++) {

			var edge = this.edges[i];
			var other = edge.v1 === v ? edge.v2 : (edge.v2 === v ? edge.v1 : null);

			if (other === null || other === v)
				continue;

			if (out.indexOf(other) === -1)
				out.push(other);
		}

		return out;
	};

	private indexEdge(tag: Tag, edge: Edge) {
		const list = this.adjacency.get(tag);

		if (list)
			list.push(edge);
		else
			this.adjacency.set(tag, [edge]);
	};

	private rebuildAdjacency() {
		this.adjacency = new Map();

		for (const vertex of this.vertices)
			this.adjacency.set(vertex, []);

		for (const edge of this.edges) {
			this.indexEdge(edge.v1, edge);

			if (edge.v2 !== edge.v1)
				this.indexEdge(edge.v2, edge);
		}
	};

};
