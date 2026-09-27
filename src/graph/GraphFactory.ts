import { Graph } from "./Graph";
import { GraphSpec } from "./GraphSpec";
import { K } from "../core/K";
import { moleculeById } from "./Molecules";
import { point3, Point3D } from "../core/Point3D";
import { Tag } from "./Tag";

// Phyllotaxis spiral at the spring rest length: `sqrt(i / PI)` gives each atom
// `spacing^2` of area, so the first frame is reproducible.
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

// Bounds rejection sampling on a nearly complete graph before the linear fallback.
const MAX_REJECTION_ATTEMPTS = 32;

export class GraphFactory {

	build(spec: GraphSpec): Graph {
		return spec.kind === "random"
			? this.generateGraph(spec.order, spec.branching)
			: this.generateMolecule(spec.id);
	}

	generateMolecule(id: string): Graph {

		const molecule = moleculeById(id);
		const topology = molecule.topology;

		const graph = new Graph();
		const positions = moleculeSeedPositions(topology.atoms.length);

		const tags = topology.atoms.map((symbol, i) => {
			const tag = new Tag(positions[i], symbol);
			graph.addNode(tag);
			return tag;
		});

		// The parser rejects duplicate bonds and the catalog has no disconnected entries.
		for (const bond of topology.bonds)
			graph.addEdge(tags[bond.a], tags[bond.b]);

		return graph;
	}

	constructXYZFactory() {

		const used = new Set<string>();

		const genXYZ = () => {
			for (let attempt = 0; attempt < 1000; attempt++) {
				const x = (-K.space.W_0 / 2.0) + (Math.random() * K.space.W_0);
				const y = (-K.space.H_0 / 2.0) + (Math.random() * K.space.H_0);
				const z = (-K.space.D_0 / 2.0) + (Math.random() * K.space.D_0);

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

	// As in the reference app's graph_manipulator.generate_graph; see docs/graphs.md.
	generateGraph(order: number, maxNewEdgesPerVertex: number) {

		var graph = new Graph();
		var funcGenXYZ = this.constructXYZFactory();

		for(let i = 0; i < order; i++) {
			var pos = funcGenXYZ();

			var tag = new Tag(pos, 'Node ' + i.toString());

            graph.addNode(tag);
		}

		const vertices = graph.vertices;

		for(let i = 0; i < vertices.length; i++) {

			const tag = vertices[i];

			// randint(1, maxNewEdgesPerVertex) inclusive
			var edgesToAdd = 1 + Math.floor(Math.random() * maxNewEdgesPerVertex);

			for(let j = 0; j < edgesToAdd; j++) {

				const partner = this.pickNewNeighbour(graph, vertices, i);

				if (partner === null)
					break;

				graph.addEdge(tag, partner);
			}
		}

		return graph;
	};

	/** A random vertex not already joined to `vertices[self]`, or null when none remains. */
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
