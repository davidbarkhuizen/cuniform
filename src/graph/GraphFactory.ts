import { Graph } from "./Graph";
import { GraphSpec } from "./GraphSpec";
import { K } from "../core/K";
import { moleculeById } from "./Molecules";
import { point3, Point3D } from "../core/Point3D";
import { Tag } from "./Tag";

// Phyllotaxis spiral aimed at the spring rest length: `sqrt(i / PI)` gives each atom
// `spacing^2` of area, so neighbours start a rest length apart and the first frame is reproducible.
function moleculeSeedPositions(n: number): Point3D[] {

    const spacing = K.molecule.seedSpacing;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const jitter = K.molecule.seedDepthJitter;

    return Array.from({ length: n }, (_, i) => {
        const r = spacing * Math.sqrt(i / Math.PI);
        const theta = i * golden;
        return point3(r * Math.cos(theta), r * Math.sin(theta), jitter * Math.sin(theta));
    });
}

// Rejection sampling is O(1) expected on the sparse graphs the chooser builds;
// this cap bounds the work on a nearly complete graph before the linear
// fallback runs.
const MAX_REJECTION_ATTEMPTS = 32;

export class GraphFactory {

	build(spec: GraphSpec): Graph {
		return spec.kind === "random"
			? this.generateGraph(spec.order, spec.branching)
			: this.generateMolecule(spec.id);
	}

	// Heavy atoms are vertices, bonds are edges. Labels are element symbols, not
	// indices: a label at every node would turn a 27-atom molecule into a wall of text.
	generateMolecule(id: string): Graph {

		// The catalog parsed every SMILES at load, so the topology is reused
		// rather than re-parsed here.
		const molecule = moleculeById(id);
		const topology = molecule.topology;

		const graph = new Graph();
		const positions = moleculeSeedPositions(topology.atoms.length);

		const tags = topology.atoms.map((symbol, i) => {
			const tag = new Tag(positions[i], symbol);
			graph.addNode(tag);
			return tag;
		});

		// The parser rejects duplicate bonds and the catalog has no disconnected
		// entries, so addEdge() here cannot create a duplicate or a self-loop.
		for (const bond of topology.bonds)
			graph.addEdge(tags[bond.a], tags[bond.b]);

		return graph;
	}

	constructXYZFactory() {

		// Keyed by value: uniqueness is an O(1) Set lookup, not a rescan of prior points.
		const used = new Set<string>();

		const genXYZ = () => {
			// Duplicates are effectively impossible; the cap only guarantees termination.
			for (let attempt = 0; attempt < 1000; attempt++) {
				const x = (-K.space.W_0 / 2.0) + (Math.random() * K.space.W_0);
				const y = (-K.space.H_0 / 2.0) + (Math.random() * K.space.H_0);
				const z = (-K.space.D_0 / 2.0) + (Math.random() * K.space.D_0);

				// Compare all three components by value: indexOf on a fresh
				// object literal never matches, and points differing only in z differ.
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

	// Sparse semi-random graph, as in the reference app's graph_manipulator.generate_graph:
	// each vertex starts between 1 and `maxNewEdgesPerVertex` edges, with no duplicates or
	// self-loops. That bounds the edges a vertex *initiates*, not its final degree: the graph
	// is undirected, so a vertex also collects the edges its neighbours start.
	generateGraph(order: number, maxNewEdgesPerVertex: number) {

		var graph = new Graph();
		var funcGenXYZ = this.constructXYZFactory();

		for(let i = 0; i < order; i++) {
			var pos = funcGenXYZ();

			// Label by position in this graph, so names restart at "Node 0" for every graph.
			var tag = new Tag(pos, 'Node ' + i.toString());

            graph.addNode(tag);
		}

		// Partners are drawn by rejection over vertex indices rather than by filtering
		// a candidate list: on the sparse graphs the chooser builds, a random draw is
		// almost always a valid partner, so each edge costs O(1) expected and the pass
		// is O(V + E) instead of O(V^2 * E).
		const vertices = graph.vertices;

		for(let i = 0; i < vertices.length; i++) {

			const tag = vertices[i];

			// randint(1, maxNewEdgesPerVertex) inclusive
			var edgesToAdd = 1 + Math.floor(Math.random() * maxNewEdgesPerVertex);

			for(let j = 0; j < edgesToAdd; j++) {

				const partner = this.pickNewNeighbour(graph, vertices, i);

				// Every other vertex is already a neighbour: this vertex has started
				// all the new edges it can, so it stops.
				if (partner === null)
					break;

				graph.addEdge(tag, partner);
			}
		}

		return graph;
	};

	/**
	 * A random vertex not already joined to `vertices[self]`, or null when every
	 * other vertex is a neighbour. Rejection sampling is the fast path; the capped
	 * attempts plus an insertion-order scan keep a nearly complete graph terminating.
	 */
	private pickNewNeighbour(graph: Graph, vertices: Array<Tag>, self: number): Tag | null {

		const selfTag = vertices[self];

		for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {

			const candidate = Math.floor(Math.random() * vertices.length);

			if (candidate === self)
				continue;

			const tag = vertices[candidate];

			if (!graph.hasEdge(selfTag, tag))
				return tag;
		}

		// Dense fallback: insertion order, so a near-complete graph stays deterministic.
		for (let candidate = 0; candidate < vertices.length; candidate++) {

			if (candidate === self)
				continue;

			const tag = vertices[candidate];

			if (!graph.hasEdge(selfTag, tag))
				return tag;
		}

		return null;
	};
};
