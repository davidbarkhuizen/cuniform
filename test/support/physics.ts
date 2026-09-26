import { ForceDirectedGraph } from "../../src/ForceDirectedGraph";
import { Graph } from "../../src/Graph";
import { GraphFactory } from "../../src/GraphFactory";
import { K } from "../../src/K";
import { Point3D } from "../../src/Point3D";
import { Tag } from "../../src/Tag";

// Canvas dimensions used by the headless harness. They only affect the
// model -> canvas translation, never the physics.
export const CANVAS_W = 800;
export const CANVAS_H = 600;

/**
 * k * q^2, the numerator of the reference repulsion law k*q^2 / r^1.9.
 *
 * Derived rather than written as 10000, so a retuned K moves every test that
 * states the law instead of leaving a stale literal behind.
 */
export const REPULSION_CONSTANT =
    K.physics.scalarForceConstant * K.physics.nodeCharge * K.physics.nodeCharge;

/**
 * The separation at which a single edge's repulsion balances its spring:
 * k*q^2 / r^1.9 = springConstant * (r - equilibriumDisplacement) settles at
 * r* ~= 65.46 for the reference constants (reference doc section 9).
 */
export const ANALYTIC_EQUILIBRIUM = 65.46;

/** Two nodes joined by one edge, at the given model positions. */
export function edgeBetween(aPos: Point3D, bPos: Point3D) {
    const graph = new Graph();
    const a = new Tag(aPos, "a");
    const b = new Tag(bPos, "b");
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(a, b);

    return { graph, a, b, fdg: new ForceDirectedGraph(graph) };
}

/**
 * Two nodes joined by one edge, `r` apart on the x axis:
 *   a at the origin, b at (+r, 0).
 */
export function pairAt(r: number) {
    return edgeBetween({ x: 0, y: 0, z: 0 }, { x: r, y: 0, z: 0 });
}

/** A lone node at the model origin, plus its solver. */
export function singleNode(label = "a") {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, label);
    graph.addNode(a);

    return { graph, a, fdg: new ForceDirectedGraph(graph) };
}

/** A tag at (x, y, 0), defaulting to the origin. */
export function tag(label: string, x = 0, y = 0): Tag {
    return new Tag({ x, y, z: 0 }, label);
}

/**
 * Advance `ticks` steps and return, for each step, the largest distance any
 * single node travelled from its position at the start of that step.
 *
 * This is the primary convergence signal: a relaxing layout settles towards
 * zero per-step travel, whereas an unstable integrator keeps moving.
 */
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

/**
 * Advance `ticks` steps and return the largest distance from the model origin
 * any vertex reached over the whole run. `isPinned` is forwarded to `step()`,
 * so a caller can hold a node in place while the rest of the graph relaxes.
 */
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
