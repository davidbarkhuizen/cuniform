// A test and benchmark fixture only (workplan D1): seeded random graphs give the physics tests and the
// 4096-node benchmark a scalable, reproducible input that no real model reproduces on demand.
import { Graph } from "../../src/graph/Graph";
import { K } from "../../src/core/K";
import { point3 } from "../../src/core/Point3D";
import { mulberry32, Random, randomSeed } from "../../src/core/Random";
import { Tag } from "../../src/graph/Tag";

// Bounds rejection sampling on a nearly complete graph before the linear fallback.
const MAX_REJECTION_ATTEMPTS = 32;

export class GraphFactory {

    constructXYZFactory(random: Random = Math.random) {

        const used = new Set<string>();

        const genXYZ = () => {
            for (let attempt = 0; attempt < 1000; attempt++) {
                const x = (-K.space.W_0 / 2.0) + (random() * K.space.W_0);
                const y = (-K.space.H_0 / 2.0) + (random() * K.space.H_0);
                const z = (-K.space.D_0 / 2.0) + (random() * K.space.D_0);

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

    // As in the reference app's graph_manipulator.generate_graph; see docs/networks.md.
    // Every draw goes through the seeded generator, so one seed rebuilds the same graph.
    generateGraph(order: number, maxNewEdgesPerVertex: number, seed: number = randomSeed()) {

        const random = mulberry32(seed);

        let graph = new Graph();
        let funcGenXYZ = this.constructXYZFactory(random);

        for(let i = 0; i < order; i++) {
            let pos = funcGenXYZ();

            let tag = new Tag(pos, 'Node ' + i.toString());

            graph.addNode(tag);
        }

        const vertices = graph.vertices;

        for(let i = 0; i < vertices.length; i++) {

            const tag = vertices[i];

            // randint(1, maxNewEdgesPerVertex) inclusive
            let edgesToAdd = 1 + Math.floor(random() * maxNewEdgesPerVertex);

            for(let j = 0; j < edgesToAdd; j++) {

                const partner = this.pickNewNeighbour(graph, vertices, i, random);

                if (partner === null)
                    break;

                graph.addEdge(tag, partner);
            }
        }

        return graph;
    };

    /** A random vertex not already joined to `vertices[self]`, or null when none remains. */
    private pickNewNeighbour(graph: Graph, vertices: Array<Tag>, self: number, random: Random): Tag | null {

        const selfTag = vertices[self];

        for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {

            const candidate = Math.floor(random() * vertices.length);

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
