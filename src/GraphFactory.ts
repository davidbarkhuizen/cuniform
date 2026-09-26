import { Graph } from "./Graph";
import { K } from "./K";
import { point3 } from "./Point3D";
import { Tag } from "./Tag";

export class GraphFactory {

	constructXYZFactory() {

		// Generated coordinates, keyed by value so uniqueness is an O(1) Set
		// lookup rather than a rescan of every prior point.
		const used = new Set<string>();

		const genXYZ = () => {
			// Coordinates are continuous and uniform, so an exact duplicate is
			// effectively impossible; the attempt cap only guarantees that this
			// loop terminates rather than spinning forever.
			for (let attempt = 0; attempt < 1000; attempt++) {
				const x = (-K.space.W_0 / 2.0) + (Math.random() * K.space.W_0);
				const y = (-K.space.H_0 / 2.0) + (Math.random() * K.space.H_0);
				const z = (-K.space.D_0 / 2.0) + (Math.random() * K.space.D_0);

				// Compare all three components by value: indexOf on a fresh
				// object literal never matches, and a pair agreeing in (x, y)
				// but differing in z is a distinct position.
				const key = `${x},${y},${z}`;
				if (used.has(key))
					continue;

				used.add(key);
				return point3(x, y, z);
			}

			throw new Error("constructXYZFactory: could not generate a unique position");
		}
		return genXYZ;
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
		var funcGenXYZ = this.constructXYZFactory();

		for(let i = 0; i < order; i++) {
			var pos = funcGenXYZ();

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
