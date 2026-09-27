// cuniform performance benchmark.
//
// Run with `npm run bench` (or `./cli bench`): it compiles this file with the
// test tsconfig and runs it under `node --expose-gc`. It is deliberately not
// part of `npm test` — it takes seconds, not milliseconds, and its numbers are
// machine-dependent. Read the output as a before/after comparison, not a gate.
//
// The renderer section uses FakeContext2D, so it measures the renderer's JS
// work only. A real canvas is slower; check that in a browser.
//
// See docs/performance/README.md for the baseline this harness produced.

import { PerformanceObserver } from "perf_hooks";

import { ForceDirectedGraph } from "../src/ForceDirectedGraph";
import { Graph } from "../src/Graph";
import { GraphFactory } from "../src/GraphFactory";
import { radius } from "../src/Kernel";
import { Projector } from "../src/Projector";
import { render } from "../src/Renderer";
import { Tag } from "../src/Tag";
import { FakeContext2D } from "../test/support/dom";

const CANVAS_W = 1280;
const CANVAS_H = 800;
const AVERAGE_DEGREE = 3;

const GENERATION_ORDERS = [512, 1024, 2048, 4096, 8192];
const STEP_CASES: Array<[number, number]> = [[256, 8], [512, 6], [1024, 4], [2048, 2], [4096, 1]];
const REPULSION_ORDERS = [256, 512, 1024, 2048];
const RENDER_ORDERS = [512, 1024, 2048, 4096];
const GC_ORDER = 1024;
const KERNEL_SAMPLES = 1000000;

/** Deterministic xorshift32, so runs are comparable. */
function makeRandom(seed: number): () => number {
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

// A sparse graph built directly, not through generateGraph, so the solver
// sections exclude generation cost and the shape is reproducible.
function makeSparseGraph(order: number, random: () => number): Graph {
    const graph = new Graph();
    const tags: Tag[] = [];

    for (let i = 0; i < order; i++) {
        const tag = new Tag(
            { x: random() * 600 - 300, y: random() * 600 - 300, z: random() * 600 - 300 },
            `n${i}`
        );
        graph.addNode(tag);
        tags.push(tag);
    }

    const target = Math.floor((order * AVERAGE_DEGREE) / 2);
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

function row(label: string, value: string): void {
    console.log(label.padEnd(26) + value);
}

/** Warm once, then average `reps` timed runs. */
function timePer(fn: () => void, reps: number): number {
    fn();

    const start = process.hrtime.bigint();

    for (let i = 0; i < reps; i++)
        fn();

    return Number(process.hrtime.bigint() - start) / 1e6 / reps;
}

function benchGeneration(): void {
    console.log("\n== graph generation (GraphFactory.generateGraph) ==");
    row("order", "ms");

    for (const order of GENERATION_ORDERS) {
        const ms = timePer(() => { new GraphFactory().generateGraph(order, AVERAGE_DEGREE); }, 2);
        row(String(order), ms.toFixed(2));
    }
}

function benchSolver(): void {
    console.log("\n== solver step (repulsion + springs + integrate + project) ==");
    row("N / E", "step ms");

    for (const [order, reps] of STEP_CASES) {
        const graph = makeSparseGraph(order, makeRandom(1234 + order));
        const solver = new ForceDirectedGraph(graph);
        const projector = Projector.forCanvas(CANVAS_W, CANVAS_H);

        const ms = timePer(() => { solver.step(CANVAS_W, CANVAS_H, () => false, projector); }, reps);
        row(`${order} / ${graph.edges.length}`, ms.toFixed(2));
    }
}

function benchRepulsion(): void {
    console.log("\n== repulsion pass alone (all pairs) ==");
    row("N", "ms");

    for (const order of REPULSION_ORDERS) {
        const graph = makeSparseGraph(order, makeRandom(99 + order));
        const solver = new ForceDirectedGraph(graph);
        const out = graph.vertices.map(() => ({ x: 0, y: 0, z: 0 }));
        const reps = order <= 512 ? 6 : 2;

        const ms = timePer(() => { solver.accumulateRepulsion(out); }, reps);
        row(String(order), ms.toFixed(2));
    }
}

function benchKernel(): void {
    console.log("\n== distance kernel ==");
    row("variant", "ms / 1e6 calls");

    const random = makeRandom(24680);
    const deltas = new Float64Array(KERNEL_SAMPLES * 3);

    for (let i = 0; i < deltas.length; i++)
        deltas[i] = random() * 1200 - 600;

    // The sums stop the loop being optimised away and let the two variants be
    // checked as doing the same work.
    const sums = new Float64Array(2);

    const hypotMs = timePer(() => {
        let sum = 0;
        for (let i = 0; i < KERNEL_SAMPLES; i++)
            sum += Math.hypot(deltas[3 * i], deltas[3 * i + 1], deltas[3 * i + 2]);
        sums[0] = sum;
    }, 3);

    const radiusMs = timePer(() => {
        let sum = 0;
        for (let i = 0; i < KERNEL_SAMPLES; i++)
            sum += radius(deltas[3 * i], deltas[3 * i + 1], deltas[3 * i + 2]);
        sums[1] = sum;
    }, 3);

    row("Math.hypot", hypotMs.toFixed(2));
    row("Kernel.radius", `${radiusMs.toFixed(2)}  (${(hypotMs / radiusMs).toFixed(2)}x)`);
    row("checksum delta", Math.abs(sums[0] - sums[1]).toExponential(2));
}

function benchProjection(): void {
    console.log("\n== projection loop ==");

    const graph = makeSparseGraph(4096, makeRandom(7));
    const projector = Projector.forCanvas(CANVAS_W, CANVAS_H);

    const ms = timePer(() => {
        for (const node of graph.vertices) {
            const projected = projector.project(node.position);
            node.translatedPosition = projector.viewport.toCanvas(projected.screen);
            node.depth = projected.depth;
        }
    }, 20);

    row("4096 nodes", `${ms.toFixed(2)} ms`);
}

function benchRender(): void {
    console.log("\n== renderer (FakeContext2D: JS overhead only) ==");
    row("N / E", "render ms (canvas ops/frame)");

    for (const order of RENDER_ORDERS) {
        const graph = makeSparseGraph(order, makeRandom(4321 + order));
        const projector = Projector.forCanvas(CANVAS_W, CANVAS_H);
        const solver = new ForceDirectedGraph(graph);

        // Populate depth/translatedPosition the way a real tick would.
        solver.step(CANVAS_W, CANVAS_H, () => false, projector);

        const context = new FakeContext2D();
        context.canvas = { width: CANVAS_W, height: CANVAS_H };

        const before = context.ops.length;
        render(context as unknown as CanvasRenderingContext2D, graph, projector.camera);
        const opsPerFrame = context.ops.length - before;

        const reps = order <= 1024 ? 10 : 3;
        const ms = timePer(
            () => render(context as unknown as CanvasRenderingContext2D, graph, projector.camera),
            reps
        );

        row(`${order} / ${graph.edges.length}`, `${ms.toFixed(2)}  (${opsPerFrame})`);
    }
}

/** Run `workload` `reps` times under a GC observer and report wall vs GC time. */
async function measureGc(label: string, workload: () => void, reps: number): Promise<void> {
    workload(); // warm

    let gcMs = 0;
    let gcCount = 0;

    const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
            if (entry.duration > 0) {
                gcMs += entry.duration;
                gcCount++;
            }
        }
    });

    observer.observe({ entryTypes: ["gc"] });

    const start = process.hrtime.bigint();

    for (let i = 0; i < reps; i++)
        workload();

    const wallMs = Number(process.hrtime.bigint() - start) / 1e6;

    // Let the observer drain queued entries before disconnecting.
    await new Promise(resolve => setTimeout(resolve, 20));
    observer.disconnect();

    row(
        label,
        `${wallMs.toFixed(1)} ms / GC ${gcMs.toFixed(1)} ms / ${(100 * gcMs / wallMs).toFixed(1)}% in ${gcCount} pauses`
    );
}

async function benchGc(): Promise<void> {
    console.log("\n== GC during 20 repetitions ==");
    row("workload", "wall ms / GC ms / GC %");

    const graph = makeSparseGraph(GC_ORDER, makeRandom(555));
    const solver = new ForceDirectedGraph(graph);
    const projector = Projector.forCanvas(CANVAS_W, CANVAS_H);
    const unpinned = () => false;
    const out = graph.vertices.map(() => ({ x: 0, y: 0, z: 0 }));

    await measureGc("repulsion x20", () => solver.accumulateRepulsion(out), 20);
    await measureGc("step x20", () => solver.step(CANVAS_W, CANVAS_H, unpinned, projector), 20);
}

async function main(): Promise<void> {
    const hasGc = typeof (global as { gc?: () => void }).gc === "function";

    console.log("cuniform performance benchmark");
    console.log(`node ${process.version}  (forced GC: ${hasGc ? "available" : "run with --expose-gc"})`);

    benchGeneration();
    benchSolver();
    benchRepulsion();
    benchKernel();
    benchProjection();
    benchRender();
    await benchGc();
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
