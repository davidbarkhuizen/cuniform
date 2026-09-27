import { ForceDirectedGraph } from "../../src/physics/ForceDirectedGraph";
import { Graph } from "../../src/graph/Graph";
import { GraphFactory } from "../../src/graph/GraphFactory";
import { K } from "../../src/core/K";
import { Point3D } from "../../src/core/Point3D";
import { Tag } from "../../src/graph/Tag";

// Canvas size only affects the model -> canvas translation, never the physics.
export const CANVAS_W = 800;
export const CANVAS_H = 600;

// k*q^2, the numerator of the reference repulsion law k*q^2 / r^1.9; derived
// so a retuned K propagates instead of leaving a stale literal.
export const REPULSION_CONSTANT =
    K.physics.scalarForceConstant * K.physics.nodeCharge * K.physics.nodeCharge;

// Single-edge balance of k*q^2 / r^1.9 against the spring: r* ~= 65.46 for the
// reference constants (reference doc section 9).
export const ANALYTIC_EQUILIBRIUM = 65.46;

export function edgeBetween(aPos: Point3D, bPos: Point3D) {
    const graph = new Graph();
    const a = new Tag(aPos, "a");
    const b = new Tag(bPos, "b");
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(a, b);

    return { graph, a, b, fdg: new ForceDirectedGraph(graph) };
}

/** Two nodes one edge apart on the x axis: a at the origin, b at (+r, 0). */
export function pairAt(r: number) {
    return edgeBetween({ x: 0, y: 0, z: 0 }, { x: r, y: 0, z: 0 });
}

export function singleNode(label = "a") {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, label);
    graph.addNode(a);

    return { graph, a, fdg: new ForceDirectedGraph(graph) };
}

/**
 * `components` disjoint paths of `nodesPerComponent` nodes each, seeded as a
 * symmetric arrangement about each piece's own centroid, with those centroids
 * spread along x at `componentSpacing` intervals. Disconnected by construction,
 * so the component anchor is the only force between the pieces, and both the
 * labelling and the resulting motion are a deterministic function of the
 * arguments.
 *
 * The default - two 6-node components centred at x = -250 and x = +250 - is the
 * workplan's drift fixture: on a graph with no anchor the two pieces separate
 * without bound. `offset` shifts the whole arrangement, which lets a test place
 * a single congruent component at a chosen centroid.
 */
export function disconnectedPaths(
    componentSpacing = 500,
    nodesPerComponent = 6,
    components = 2,
    offset: Point3D = { x: 0, y: 0, z: 0 }
) {
    const graph = new Graph();
    const tags: Tag[] = [];
    const componentOf: number[] = [];

    for (let c = 0; c < components; c++) {

        const centre = (c - (components - 1) / 2) * componentSpacing + offset.x;
        const path: Tag[] = [];

        // A path along y, centred on `centre`, so each component's own centroid
        // is exactly its centre.
        for (let i = 0; i < nodesPerComponent; i++) {
            const tag = new Tag(
                {
                    x: centre,
                    y: (i - (nodesPerComponent - 1) / 2) * K.physics.equilibriumDisplacement + offset.y,
                    z: offset.z,
                },
                `c${c}n${i}`
            );

            graph.addNode(tag);
            tags.push(tag);
            path.push(tag);
            componentOf.push(c);
        }

        for (let i = 1; i < path.length; i++)
            graph.addEdge(path[i - 1], path[i]);
    }

    return { graph, tags, componentOf, fdg: new ForceDirectedGraph(graph) };
}

export function tag(label: string, x = 0, y = 0): Tag {
    return new Tag({ x, y, z: 0 }, label);
}

// Per step, the largest distance any node travelled during that step; a
// relaxing layout settles towards zero, an unstable integrator does not.
export function maxTravelPerStep(
    fdg: ForceDirectedGraph,
    graph: Graph,
    ticks: number,
    isPinned: (tag: Tag) => boolean = () => false
): number[] {
    const out: number[] = [];

    for (let t = 0; t < ticks; t++) {
        const before = graph.vertices.map(v => ({ x: v.position.x, y: v.position.y, z: v.position.z }));

        fdg.step(CANVAS_W, CANVAS_H, isPinned);

        let max = 0;
        graph.vertices.forEach((v, i) => {
            max = Math.max(
                max,
                Math.hypot(
                    v.position.x - before[i].x,
                    v.position.y - before[i].y,
                    v.position.z - before[i].z
                )
            );
        });
        out.push(max);
    }

    return out;
}

/** The farthest any vertex strays from the model origin over the run. */
export function maxAbsPosition(
    fdg: ForceDirectedGraph,
    graph: Graph,
    ticks: number,
    isPinned: (tag: Tag) => boolean = () => false
): number {
    let max = 0;

    for (let t = 0; t < ticks; t++) {
        fdg.step(CANVAS_W, CANVAS_H, isPinned);

        for (const v of graph.vertices)
            max = Math.max(max, Math.hypot(v.position.x, v.position.y, v.position.z));
    }

    return max;
}

/**
 * Step until the solver reports `settleFrames` consecutive steps quieter than
 * `settleEpsilon`, or until `maxSteps` is reached. Returns the number of steps
 * run and the final per-step travel.
 *
 * The detector can fire a few steps short of the fixed point, so a test that
 * needs genuine rest should re-read the returned count and keep going; this
 * helper's contract is only "as quiet as the detector gets".
 */
export function stepsUntilQuiet(
    fdg: ForceDirectedGraph,
    maxSteps: number = 20000
): { steps: number; travel: number } {
    let quiet = 0;
    let steps = 0;
    let travel = Number.POSITIVE_INFINITY;

    while (quiet < K.physics.settleFrames && steps < maxSteps) {
        steps++;
        fdg.stepPhysics();
        travel = fdg.lastMaxDisplacement;
        quiet = travel < K.physics.settleEpsilon ? quiet + 1 : 0;
    }

    return { steps, travel };
}

export function mean(xs: number[]): number {
    return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

export function stddev(xs: number[]): number {
    const m = mean(xs);
    return Math.sqrt(mean(xs.map(x => (x - m) * (x - m))));
}

export function newGraph(order: number = 10, branching: number = 2): Graph {
    return new GraphFactory().generateGraph(order, branching);
}

/** Deterministic xorshift32 in [0, 1), so a seeded fixture is reproducible. */
export function seededRandom(seed: number): () => number {
    let state = seed >>> 0 || 1;

    return () => {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state / 0x100000000;
    };
}

/**
 * A sparse graph built directly rather than through generateGraph: its shape is
 * a deterministic function of `seed`, and its cost excludes generation, which
 * matters when the fixture is the input to a timing or error measurement.
 */
export function sparseGraph(order: number, seed: number, averageDegree: number = 3): Graph {
    const random = seededRandom(seed);
    const graph = new Graph();
    const tags: Tag[] = [];

    for (let i = 0; i < order; i++) {
        const tag = new Tag(
            {
                x: random() * K.space.W_0 - K.space.W_0 / 2,
                y: random() * K.space.H_0 - K.space.H_0 / 2,
                z: random() * K.space.D_0 - K.space.D_0 / 2,
            },
            `n${i}`
        );
        graph.addNode(tag);
        tags.push(tag);
    }

    const target = Math.floor((order * averageDegree) / 2);
    const seen = new Set<string>();

    let edges = 0;
    let guard = 0;

    while (edges < target && guard++ < target * 20) {
        const a = Math.floor(random() * order);
        const b = Math.floor(random() * order);

        if (a === b)
            continue;

        const key = a < b ? `${a}:${b}` : `${b}:${a}`;

        if (seen.has(key))
            continue;

        seen.add(key);
        graph.addEdge(tags[a], tags[b]);
        edges++;
    }

    return graph;
}
