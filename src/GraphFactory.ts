import { Graph } from "./Graph";
import { K } from "./K";
import { Point2D } from "./Point2D";
import { Tag } from "./Tag";

export class GraphFactory {

	constructXYFactory() {

		var used = Array<Point2D>();
		const genXY = () => {
			// Coordinates are continuous and uniform, so an exact duplicate is
			// effectively impossible; the attempt cap only guarantees that this
			// loop terminates rather than spinning forever.
			for (let attempt = 0; attempt < 1000; attempt++) {
				var x = (-K.space.W_0 / 2.0) + (Math.random() * K.space.W_0);
				var y = (-K.space.H_0 / 2.0) + (Math.random() * K.space.H_0);

				// Compare by value: indexOf on a fresh object literal never matches.
				if (used.some(p => p.x === x && p.y === y))
					continue;

				used.push({ x : x, y : y });
				return { x : x, y : y };
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
			var tag = new Tag(pos, 'no label');
			tag.label = 'Node ' + tag.idx.toString();

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