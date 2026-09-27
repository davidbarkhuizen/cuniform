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
// Read docs/performance.md for the current profile this harness produced and
// the optimizations still open.

import { PerformanceObserver } from "perf_hooks";

import { ForceDirectedGraph } from "../src/physics/ForceDirectedGraph";
import { Graph } from "../src/graph/Graph";
import { GraphFactory } from "../src/graph/GraphFactory";
import { K, QualitySetting } from "../src/core/K";
import { radius } from "../src/physics/Kernel";
import { projectGraph } from "../src/view/Projection";
import { CameraView, Projector } from "../src/view/Projector";
import { openingAngleFor } from "../src/physics/Quality";
import { render } from "../src/render/Renderer";
import { FakeContext2D } from "../test/support/dom";
import { disconnectedPaths, seededRandom, sparseGraph } from "../test/support/physics";

const CANVAS_W = 1280;
const CANVAS_H = 800;
const AVERAGE_DEGREE = 3;

const GENERATION_ORDERS = [512, 1024, 2048, 4096, 8192];
const STEP_CASES: Array<[number, number]> = [[256, 8], [512, 6], [1024, 4], [2048, 2], [4096, 1]];
const REPULSION_ORDERS = [256, 512, 1024, 2048, 4096, 8192];
const RENDER_ORDERS = [512, 1024, 2048, 4096, 8192];
const GC_ORDER = 1024;
const KERNEL_SAMPLES = 1000000;
const ERROR_SAMPLE = 64;

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
        const graph = sparseGraph(order, 1234 + order);
        const solver = new ForceDirectedGraph(graph);
        const projector = Projector.forCanvas(CANVAS_W, CANVAS_H);

        const ms = timePer(() => { solver.step(CANVAS_W, CANVAS_H, () => false, projector); }, reps);
        row(`${order} / ${graph.edges.length}`, ms.toFixed(2));
    }
}

/**
 * Time the component anchor on identical work: one component whose centroid is
 * inside the dead zone, where the `anyActive` gate skips the pass, and the same
 * component shifted so its centroid is outside, where the pass runs. Both have
 * the same node and edge counts and the same internal (relative) geometry, and
 * their rows are timed alternately on identical states, so the delta is the
 * anchor's cost. Read the delta against the run-to-run spread reported for one
 * row, not as an absolute zero: the pass is O(N + C) over pooled buffers, so on
 * this machine its cost sits inside the noise of a few hundredths of a
 * millisecond per step.
 */
function benchComponentAnchor(): void {
    console.log("\n== per-component anchor (same topology, dead zone vs engaged) ==");
    row("N / E", "skipped ms | engaged ms | delta | run spread");

    const cases: Array<[number, number]> = [[1024, 12], [4096, 4]];

    for (const [order, reps] of cases) {
        // One path, so internal forces cancel in the centroid exactly and the
        // component translates as a rigid body. The engaged copy is shifted far
        // enough that its centroid is well outside the 150-unit dead zone.
        const skipped = disconnectedPaths(0, order, 1);
        const engaged = disconnectedPaths(0, order, 1, { x: 4000, y: 0, z: 0 });

        // Alternate the two so neither pays a first-run warm-up the other does
        // not, and so both see the same spread of positions.
        const step = (fixture: ReturnType<typeof disconnectedPaths>) =>
            fixture.fdg.stepPhysics();

        step(skipped);
        step(engaged);

        const skippedRuns: number[] = [];
        const engagedRuns: number[] = [];

        for (let rep = 0; rep < reps; rep++) {
            let start = process.hrtime.bigint();
            step(skipped);
            skippedRuns.push(Number(process.hrtime.bigint() - start) / 1e6);

            start = process.hrtime.bigint();
            step(engaged);
            engagedRuns.push(Number(process.hrtime.bigint() - start) / 1e6);
        }

        const average = (runs: number[]) => runs.reduce((sum, ms) => sum + ms, 0) / runs.length;
        const spread = (runs: number[]) => Math.max(...runs) - Math.min(...runs);

        const skippedMs = average(skippedRuns);
        const engagedMs = average(engagedRuns);
        const delta = engagedMs - skippedMs;

        row(
            `${order} / ${skipped.graph.edges.length}`,
            `${skippedMs.toFixed(3)} | ${engagedMs.toFixed(3)} | ${delta >= 0 ? "+" : ""}${delta.toFixed(3)} | ${spread(skippedRuns).toFixed(3)} / ${spread(engagedRuns).toFixed(3)}`
        );
    }
}

interface RepulsionMeasurement {
    ms: number;
    mean: number;
    max: number;
}

/** Time the repulsion pass and measure its error against the exact reference. */
function measureRepulsion(order: number, seed: number, reps: number): RepulsionMeasurement {
    const graph = sparseGraph(order, seed);
    const solver = new ForceDirectedGraph(graph);
    const out = graph.vertices.map(() => ({ x: 0, y: 0, z: 0 }));

    // Zeroed each call: accumulateRepulsion adds onto its input.
    const ms = timePer(() => {
        for (const point of out) {
            point.x = 0;
            point.y = 0;
            point.z = 0;
        }
        solver.accumulateRepulsion(out);
    }, reps);

    for (const point of out) {
        point.x = 0;
        point.y = 0;
        point.z = 0;
    }
    solver.accumulateRepulsion(out);

    // Bounded-error check against the exact per-node reference, on a fixed
    // stride sample so one O(N) reference call per sampled node stays cheap.
    const stride = Math.max(1, Math.floor(order / ERROR_SAMPLE));
    const exact: Array<{ x: number; y: number; z: number }> = [];

    let exactTotal = 0;

    for (let i = 0; i < order; i += stride) {
        const force = solver.netElectrostaticForceAtNode(graph.vertices[i]);

        exact.push(force);
        exactTotal += Math.hypot(force.x, force.y, force.z);
    }

    // Normalised by the mean exact force magnitude: a body near a force balance
    // has an exact magnitude near zero and would otherwise dominate a per-node
    // ratio while its absolute error stays tiny.
    const scale = exactTotal / exact.length;

    let total = 0;
    let worst = 0;

    exact.forEach((force, k) => {
        const approximate = out[k * stride];

        const error = Math.hypot(
            approximate.x - force.x,
            approximate.y - force.y,
            approximate.z - force.z
        ) / scale;

        total += error;
        worst = Math.max(worst, error);
    });

    return { ms, mean: total / exact.length, max: worst };
}

function reportRepulsion(label: string, measurement: RepulsionMeasurement): void {
    row(
        label,
        `${measurement.ms.toFixed(2)}   ` +
        `${(100 * measurement.mean).toFixed(2)}% / ${(100 * measurement.max).toFixed(2)}%`
    );
}

function benchRepulsion(): void {
    console.log(
        `\n== repulsion pass alone (exact below N=${K.physics.barnesHutMinNodes}, ` +
        `Barnes-Hut above; quality=${K.physics.quality} picks the angle by size) ==`
    );
    row("N", "ms   mean err / max err");

    for (const order of REPULSION_ORDERS) {
        const reps = order <= 1024 ? 4 : 2;
        const theta = openingAngleFor(order, K.physics.quality);
        reportRepulsion(`${order} (theta=${theta})`, measureRepulsion(order, 99 + order, reps));
    }
}

function benchOpeningAngle(): void {
    console.log("\n== opening angle, N=4096 (quality pinned to accurate) ==");
    row("theta", "ms   mean err / max err");

    const originalTheta = K.physics.barnesHutTheta;
    const originalQuality = K.physics.quality;

    try {
        // The sweep must control the value, so "auto" cannot switch it underneath.
        K.physics.quality = "accurate";

        for (const theta of [0.5, 0.9]) {
            K.physics.barnesHutTheta = theta;
            reportRepulsion(String(theta), measureRepulsion(4096, 99 + 4096, 2));
        }
    } finally {
        K.physics.barnesHutTheta = originalTheta;
        K.physics.quality = originalQuality;
    }
}

/** The size/quality trade the "auto" default makes, with its force error. */
function benchQuality(): void {
    console.log(
        `\n== quality policy (auto = accurate below N=${K.physics.barnesHutFastMinNodes}, ` +
        `fast at or above) ==`
    );
    row("N / quality", "ms   mean err / max err");

    const originalQuality = K.physics.quality;

    try {
        for (const order of [2048, 4096]) {
            for (const quality of ["accurate", "auto"] as QualitySetting[]) {
                K.physics.quality = quality;
                const theta = openingAngleFor(order, quality);

                reportRepulsion(
                    `${order} / ${quality} (theta=${theta})`,
                    measureRepulsion(order, 99 + order, 2)
                );
            }
        }
    } finally {
        K.physics.quality = originalQuality;
    }
}

function benchKernel(): void {
    console.log("\n== distance kernel ==");
    row("variant", "ms / 1e6 calls");

    const random = seededRandom(24680);
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

    const graph = sparseGraph(4096, 7);
    const projector = Projector.forCanvas(CANVAS_W, CANVAS_H);

    const ms = timePer(() => projectGraph(graph, projector), 20);

    row("4096 nodes", `${ms.toFixed(2)} ms`);
}

interface RenderMeasurement {
    ms: number;
    ops: number;
    texts: number;
}

/** Render into a fresh context per frame; the fake records every call. */
function measureRender(graph: Graph, camera: CameraView, reps: number): RenderMeasurement {
    let bestMs = Infinity;
    let ops = 0;
    let texts = 0;

    // The frame takes the selection as an argument now; resolve it once, as the
    // controller does, rather than letting the renderer scan per frame.
    const selected = graph.selectedVertex();

    // Best of three batches: the fake context's recording makes single batches
    // noisy enough to swamp the difference between the two paths.
    for (let batch = 0; batch < 3; batch++) {

        const contexts: FakeContext2D[] = [];

        for (let i = 0; i <= reps; i++) {
            const context = new FakeContext2D();
            context.canvas = { width: CANVAS_W, height: CANVAS_H };
            contexts.push(context);
        }

        render(contexts[0], graph, camera, selected);

        if (batch === 0) {
            ops = contexts[0].ops.length;
            texts = contexts[0].texts.length;
        }

        const start = process.hrtime.bigint();

        for (let i = 1; i <= reps; i++)
            render(contexts[i], graph, camera, selected);

        bestMs = Math.min(bestMs, Number(process.hrtime.bigint() - start) / 1e6 / reps);
    }

    return { ms: bestMs, ops, texts };
}

/** Run `fn` with the renderer thresholds forced, always restoring them. */
function withRendererThresholds<T>(labelMaxNodes: number, batchEdgesMinEdges: number, fn: () => T): T {
    const label = K.renderer.labelMaxNodes;
    const batch = K.renderer.batchEdgesMinEdges;

    K.renderer.labelMaxNodes = labelMaxNodes;
    K.renderer.batchEdgesMinEdges = batchEdgesMinEdges;

    try {
        return fn();
    } finally {
        K.renderer.labelMaxNodes = label;
        K.renderer.batchEdgesMinEdges = batch;
    }
}

/** Run `fn` with the coarse preset's node threshold forced, always restoring it. */
function withCoarsePreset<T>(minNodes: number, fn: () => T): T {
    const original = K.renderer.performance.minNodes;

    K.renderer.performance.minNodes = minNodes;

    try {
        return fn();
    } finally {
        K.renderer.performance.minNodes = original;
    }
}

function benchRender(): void {
    console.log(
        `\n== renderer (FakeContext2D: JS overhead only; labels culled above ` +
        `N=${K.renderer.labelMaxNodes}, edges batched above E=${K.renderer.batchEdgesMinEdges}, ` +
        `coarse preset at N>=${K.renderer.performance.minNodes}) ==`
    );
    row("N / E", "ms legacy -> scaled -> coarse   ops legacy -> scaled -> coarse   texts");

    for (const order of RENDER_ORDERS) {
        const graph = sparseGraph(order, 4321 + order);
        const projector = Projector.forCanvas(CANVAS_W, CANVAS_H);
        const solver = new ForceDirectedGraph(graph);

        // Populate depth/translatedPosition the way a real tick would.
        solver.step(CANVAS_W, CANVAS_H, () => false, projector);

        const reps = order <= 1024 ? 10 : 3;

        // Thresholds forced off is the unbatched frame: every label, one path per
        // edge. The coarse preset is forced off too, or it would still run at
        // 4096+. "coarse" forces the large-graph preset on the same fixture. The ms
        // columns are JS-work proxies only: the fake context charges nothing for
        // real arc/fill rasterisation, so they are not a real frame time.
        const legacy = withCoarsePreset(Infinity, () =>
            withRendererThresholds(Infinity, Infinity, () => measureRender(graph, projector.camera, reps))
        );
        const scaled = measureRender(graph, projector.camera, reps);
        const coarse = withCoarsePreset(0, () => measureRender(graph, projector.camera, reps));

        row(
            `${order} / ${graph.edges.length}`,
            `${legacy.ms.toFixed(2)} -> ${scaled.ms.toFixed(2)} -> ${coarse.ms.toFixed(2)}   ` +
            `${legacy.ops} -> ${scaled.ops} -> ${coarse.ops}   ${scaled.texts}`
        );
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

    const graph = sparseGraph(GC_ORDER, 555);
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
    benchComponentAnchor();
    benchRepulsion();
    benchOpeningAngle();
    benchQuality();
    benchKernel();
    benchProjection();
    benchRender();
    await benchGc();
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
