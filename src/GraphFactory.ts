import { Graph } from "./Graph";
import { K } from "./K";
import { point } from "./Point2D";
import { Tag } from "./Tag";

export class GraphFactory {

	constructXYFactory() {

		// Generated coordinates, keyed by value so uniqueness is an O(1) Set
		// lookup rather than a rescan of every prior point.
		const used = new Set<string>();

		const genXY = () => {
			// Coordinates are continuous and uniform, so an exact duplicate is
			// effectively impossible; the attempt cap only guarantees that this
			// loop terminates rather than spinning forever.
			for (let attempt = 0; attempt < 1000; attempt++) {
				const x = (-K.space.W_0 / 2.0) + (Math.random() * K.space.W_0);
				const y = (-K.space.H_0 / 2.0) + (Math.random() * K.space.H_0);

				// Compare by value: indexOf on a fresh object literal never matches.
				const key = `${x},${y}`;
				if (used.has(key))
					continue;

				used.add(key);
				return point(x, y);
			}

			throw new Error("constructXYFactory: could not generate a unique position");
		}
		return genXY;
	};

	/**
	 * Generate a sparse semi-random graph of `order` vertices.
	 *
	 * Each vertex is randomly joined to between 1 and `maxEdgesPerVertex`
	 * other vertices, with no duplicate edges and no self-loops - the
	 * reference app's generation strategy (graph_manipulator.generate_graph).
	 * Previously this joined every new vertex to every existing one, producing
	 * a complete graph K_n and ignoring the argument entirely.
	 */
	generateGraph(order: number, maxEdgesPerVertex: number) {

		var graph = new Graph();
		var funcGenXY = this.constructXYFactory();

		for(let i = 0; i < order; i++) {
			var pos = funcGenXY();

			// The label is the position in this graph, so names restart at
			// "Node 0" for every graph instead of growing across resets.
			var tag = new Tag(pos, 'Node ' + i.toString());

            graph.addNode(tag);
		}

		for(const tag of graph.vertices) {

			// randint(1, maxEdgesPerVertex) inclusive
			var edgesToAdd = 1 + Math.floor(Math.random() * maxEdgesPerVertex);

			for(let j = 0; j < edgesToAdd; j++) {

				var candidates = graph.vertices.filter(
					v => (v !== tag) && !graph.hasEdge(tag, v)
				);

				if (candidates.length == 0)
					break;

				graph.addEdge(tag, candidates[Math.floor(Math.random() * candidates.length)]);
			}
		}

		return graph;
	};
};