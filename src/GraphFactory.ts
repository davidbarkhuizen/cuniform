import { Graph } from "./Graph";
import { GraphSpec } from "./GraphSpec";
import { K } from "./K";
import { moleculeById } from "./Molecules";
import { point3, Point3D } from "./Point3D";
import { parseSmiles } from "./Smiles";
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

export class GraphFactory {

	build(spec: GraphSpec): Graph {
		return spec.kind === "random"
			? this.generateGraph(spec.order, spec.branching)
			: this.generateMolecule(spec.id);
	}

	// Heavy atoms are vertices, bonds are edges. Labels are element symbols, not
	// indices: a label at every node would turn a 27-atom molecule into a wall of text.
	generateMolecule(id: string): Graph {

		const molecule = moleculeById(id);
		const topology = parseSmiles(molecule.smiles);

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
	// each vertex joins between 1 and `maxEdgesPerVertex` others, with no duplicates or self-loops.
	generateGraph(order: number, maxEdgesPerVertex: number) {

		var graph = new Graph();
		var funcGenXYZ = this.constructXYZFactory();

		for(let i = 0; i < order; i++) {
			var pos = funcGenXYZ();

			// Label by position in this graph, so names restart at "Node 0" for every graph.
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
