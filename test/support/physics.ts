import { ForceDirectedGraph } from "../../src/ForceDirectedGraph";
import { Graph } from "../../src/Graph";
import { GraphFactory } from "../../src/GraphFactory";
import { Tag } from "../../src/Tag";

// Canvas dimensions used by the headless harness. They only affect the
// model -> canvas translation, never the physics.
export const CANVAS_W = 800;
export const CANVAS_H = 600;

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
        const before = graph.vertices.map(v => ({ x: v.position.x, y: v.position.y }));

        fdg.step(CANVAS_W, CANVAS_H, isPinned);

        let max = 0;
        graph.vertices.forEach((v, i) => {
            max = Math.max(max, Math.hypot(v.position.x - before[i].x, v.position.y - before[i].y));
        });
        out.push(max);
    }

    return out;
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
