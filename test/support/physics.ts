import { ForceDirectedGraph } from "../../src/ForceDirectedGraph";
import { Graph } from "../../src/Graph";
import { GraphFactory } from "../../src/GraphFactory";
import { Tag } from "../../src/Tag";

// Canvas dimensions used by the headless harness. They only affect the
// model -> canvas translation, never the physics.
export const CANVAS_W = 800;
export const CANVAS_H = 600;

/**
 * Two nodes joined by one edge, `r` apart on the x axis:
 *   a at the origin, b at (+r, 0).
 */
export function pairAt(r: number) {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: r, y: 0, z: 0 }, "b");
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(a, b);

    return { graph, a, b, fdg: new ForceDirectedGraph(graph) };
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
