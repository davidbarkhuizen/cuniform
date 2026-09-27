// cuniform real-canvas frame harness (docs/performance.md): a manual instrument, not part of `npm test`.
// It measures real-canvas per-frame time and long tasks, unlike bench/physics.bench.ts (FakeContext2D).
// Run `./cli build`, serve the repo over HTTP, then open bench/render-frame.html.
// Query params: ?n= ?dpr= ?frames= ?render= ?emphasis=.

import { Camera } from "../src/view/Camera";
import { Emphasis, emphasisFromWire } from "../src/core/Emphasis";
import { Graph } from "../src/graph/Graph";
import { RenderMode, RenderRunner, renderModeFromLocation } from "../src/render/RenderRunner";
import { sparseGraph } from "../test/support/physics";

const CANVAS_W = 1280;
const CANVAS_H = 800;
const DEFAULT_SIZES = [1024, 2048, 4096, 8192];
const DEFAULT_DPRS = [1, 2];
const DEFAULT_FRAMES = 300;
/** A frame over this is a missed 60 Hz frame; the published budget watches it. */
const FRAME_BUDGET_MS = 16.7;

interface Params {
    sizes: number[];
    dprs: number[];
    frames: number;
    mode: RenderMode;
    emphasis: Emphasis;
}

interface Measurement {
    nodes: number;
    edges: number;
    dpr: number;
    backend: string;
    frames: number;
    p50: number;
    p95: number;
    worst: number;
    overBudget: number;
    longTasks: number;
    worstLongTask: number;
    heapFromMB: number | null;
    heapToMB: number | null;
    heapPeakMB: number | null;
}

function queryParams(): Params {
    const query = new URLSearchParams(window.location.search);

    const n = query.get("n");
    const dpr = query.get("dpr");
    const frames = query.get("frames");

    // An unknown name falls back to `nodes`, the same decoder the frame uses.
    const emphasis = query.get("emphasis");

    return {
        sizes: n !== null ? [Number(n)] : DEFAULT_SIZES,
        dprs: dpr !== null ? [Number(dpr)] : DEFAULT_DPRS,
        frames: frames !== null ? Number(frames) : DEFAULT_FRAMES,
        mode: renderModeFromLocation(),
        emphasis: emphasisFromWire(emphasis === "edges" ? Emphasis.edges : Emphasis.nodes),
    };
}

function percentile(sorted: number[], fraction: number): number {
    if (sorted.length === 0)
        return 0;

    return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

function toMB(bytes: number | null): number | null {
    return bytes === null ? null : bytes / (1024 * 1024);
}

function nextFrame(): Promise<number> {
    return new Promise(resolve => window.requestAnimationFrame(resolve));
}

async function measureCase(
    runner: RenderRunner,
    nodes: number,
    dpr: number,
    frames: number,
    emphasis: Emphasis
): Promise<Measurement> {

    // The backend owns the backing store and device transform; hand it only the logical size.
    runner.resize(CANVAS_W, CANVAS_H, dpr);

    const graph: Graph = sparseGraph(nodes, 4321 + nodes);
    const camera = new Camera();

    // Each case is a different graph, so a worker mirror is re-initialised here.
    runner.setGraph(graph);

    const drawTimes: number[] = [];

    let longTasks = 0;
    let worstLongTask = 0;

    // Physics never runs here, so any long task is the draw path.
    const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
            longTasks++;
            worstLongTask = Math.max(worstLongTask, entry.duration);
        }
    });

    try {
        observer.observe({ entryTypes: ["longtask"] });
    } catch {
        // Not every browser exposes longtask; the p50/p95 and >16.7 columns are the contract.
    }

    // Non-standard and Chrome-only; optional by design.
    const memory = (performance as unknown as {
        memory?: { usedJSHeapSize: number };
    }).memory;

    const heapFrom = memory ? memory.usedJSHeapSize : null;

    let heapPeak = heapFrom;

    for (let frame = 0; frame < frames; frame++) {

        await nextFrame();

        // A slow orbit so every frame is a real redraw.
        camera.orbit(0.35, 0.12);

        const start = performance.now();

        runner.draw(graph, camera, null, CANVAS_W, CANVAS_H, emphasis);

        drawTimes.push(performance.now() - start);

        if (memory)
            heapPeak = Math.max(heapPeak ?? 0, memory.usedJSHeapSize);
    }

    // Let the observer drain queued entries before disconnecting.
    await new Promise(resolve => setTimeout(resolve, 50));
    observer.disconnect();

    const sorted = [...drawTimes].sort((a, b) => a - b);

    return {
        nodes: graph.vertices.length,
        edges: graph.edges.length,
        dpr,
        backend: runner.usesWorker ? "worker" : "main",
        frames,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        worst: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
        overBudget: drawTimes.filter(ms => ms > FRAME_BUDGET_MS).length,
        longTasks,
        worstLongTask,
        heapFromMB: toMB(heapFrom),
        heapToMB: toMB(memory ? memory.usedJSHeapSize : null),
        heapPeakMB: toMB(heapPeak),
    };
}

function heapColumn(row: Measurement): string {
    if (row.heapFromMB === null)
        return "n/a";

    return `${row.heapFromMB.toFixed(1)} -> ${row.heapToMB!.toFixed(1)} MB (peak ${row.heapPeakMB!.toFixed(1)})`;
}

function formatRow(row: Measurement): string {
    return (
        `N=${row.nodes} E=${row.edges} dpr=${row.dpr} backend=${row.backend}  ` +
        `draw p50 ${row.p50.toFixed(2)} ms  p95 ${row.p95.toFixed(2)} ms  worst ${row.worst.toFixed(2)} ms  ` +
        `>${FRAME_BUDGET_MS}ms ${row.overBudget}/${row.frames}  ` +
        `long tasks ${row.longTasks} (worst ${row.worstLongTask.toFixed(1)} ms)  ` +
        `heap ${heapColumn(row)}`
    );
}

function markdown(rows: Measurement[], frames: number): string {
    const lines = [
        `Real canvas ${CANVAS_W}x${CANVAS_H}, ${frames} frames per case, physics stopped (draw path only).`,
        "",
        "| N | E | dpr | backend | draw p50 ms | draw p95 ms | worst ms | >16.7 ms | long tasks | worst long task ms | heap |",
        "| ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ];

    for (const row of rows) {
        lines.push(
            `| ${row.nodes} | ${row.edges} | ${row.dpr} | ${row.backend} | ` +
            `${row.p50.toFixed(2)} | ${row.p95.toFixed(2)} | ${row.worst.toFixed(2)} | ` +
            `${row.overBudget}/${row.frames} | ${row.longTasks} | ${row.worstLongTask.toFixed(1)} | ` +
            `${heapColumn(row)} |`
        );
    }

    return lines.join("\n");
}

async function main(): Promise<void> {
    const params = queryParams();

    const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
    const report = document.getElementById("report");

    if (!canvas || !report)
        throw new Error("render-frame.html is missing the canvas or the report element");

    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${CANVAS_H}px`;

    // Transferring canvas control is one-way, so one runner per page load fixes the mode.
    const runner = RenderRunner.create(canvas, () => {}, { mode: params.mode });

    if (runner === null)
        throw new Error("render-frame: the canvas can neither transfer to an OffscreenCanvas nor give a 2d context");

    console.log(
        `cuniform real-canvas frame harness: ${params.sizes.join(", ")} nodes, ` +
        `dpr ${params.dprs.join(", ")}, ${params.frames} frames, render=${params.mode}, ` +
        `backend=${runner.usesWorker ? "worker" : "main"}, emphasis=${params.emphasis}`
    );

    const rows: Measurement[] = [];

    for (const nodes of params.sizes) {
        for (const dpr of params.dprs) {
            const row = await measureCase(runner, nodes, dpr, params.frames, params.emphasis);

            rows.push(row);

            console.log(formatRow(row));
            report.textContent += formatRow(row) + "\n";
        }
    }

    const block = markdown(rows, params.frames);

    console.log("\n" + block);
    report.textContent += "\n" + block;

    // The headless collector reads this; the page itself never posts anywhere.
    (window as unknown as { __renderFrameReport?: unknown }).__renderFrameReport = { params, rows, block };

    document.title = "render-frame done";
}

main().catch(error => {
    console.error(error);
    document.title = "render-frame failed";
});
