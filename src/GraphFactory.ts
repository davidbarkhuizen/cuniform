import { Graph } from "./Graph";
import { GraphSpec } from "./GraphSpec";
import { K } from "./K";
import { moleculeById } from "./Molecules";
import { point3, Point3D } from "./Point3D";
import { parseSmiles } from "./Smiles";
import { Tag } from "./Tag";

/**
 * A phyllotaxis (sunflower) spiral for `n` atoms, aimed at the spring rest
 * length, with a small deterministic z offset.
 *
 * `sqrt(i / PI)` gives every atom `spacing^2` of area, so neighbours start
 * about a rest length apart - well outside the repulsion guard and already near
 * the separation the springs want. Dropping a molecule into the random cube
 * instead would start it as a tangle that unfolds into a blob; this starts it
 * near its settled shape, and makes a molecule's first frame reproducible.
 */
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

	/** Build the graph a `GraphSpec` describes. */
	build(spec: GraphSpec): Graph {
		return spec.kind === "random"
			? this.generateGraph(spec.order, spec.branching)
			: this.generateMolecule(spec.id);
	}

	/**
	 * Build the molecular graph of a catalog entry: heavy atoms are vertices,
	 * bonds are edges.
	 *
	 * Vertices are labelled with element symbols, not indices. The canvas draws
	 * a label at every node, so per-atom indices would turn a 27-atom molecule
	 * into a wall of text; the element symbol is the conventional
	 * skeletal-formula reading and keeps the cloud legible.
	 */
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

		// The catalog has no disconnected entries and the parser rejects
		// duplicate bonds, so addEdge() cannot create a duplicate or a self-loop
		// here: every atom is already in the graph and every bond is distinct.
		for (const bond of topology.bonds)
			graph.addEdge(tags[bond.a], tags[bond.b]);

		return graph;
	}

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
