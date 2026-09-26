import { Edge, otherEndpoint } from "./Edge";
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
	 *
	 * Walks the maintained adjacency list rather than rescanning every edge, so
	 * the cost is O(deg(v)); a Set makes the dedupe O(1) per edge instead of
	 * the old O(deg) `indexOf` scan, while the insertion order is preserved so
	 * the result order is unchanged.
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

	/** Deselect every vertex. */
	clearSelection() {
		for (const v of this.vertices)
			v.isSelected = false;
	};

	private indexEdge(tag: Tag, edge: Edge) {
		const list = this.adjacency.get(tag);

		if (list)
			list.push(edge);
		else
			this.adjacency.set(tag, [edge]);
	};

};
