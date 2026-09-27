// cuniform real-canvas frame harness (workplan Item 3).
//
// The committed benchmark (bench/physics.bench.ts) draws into FakeContext2D,
// which charges nothing for real `arc`/`fill`/`fillText` rasterisation, so its
// render column is a JavaScript-work proxy and must not be read as a frame
// cost. This page measures the number a host page actually cares about: the
// main thread's per-frame time on a real canvas, and the long tasks that frame
// time causes.
//
// Serve the repository over HTTP (the page loads ../dist/render-frame.js, the
// same way web/index.html loads ../dist/main.js) and open the page:
//
//     ./cli build
//     npx http-server .            # or any static server
//     open http://localhost:8080/bench/render-frame.html
//
// Query parameters:
//   ?n=4096          pin one node count (default: 1024, 2048, 4096, 8192)
//   ?dpr=2           pin one device pixel ratio (default: 1, then 2)
//   ?frames=300      frames measured per case
//   ?render=main     force the in-process backend; the default is `worker`,
//                    which draws in-process until Item 5 wires the render worker
//
// Physics is never stepped here, so a long task can only be the draw path; the
// graph is a seeded sparse graph, so a run is reproducible. This is a manual
// instrument, not part of `npm test` or `npm run bench`.

import { Camera } from "../src/Camera";
import { Graph } from "../src/Graph";
import { RenderRunner } from "../src/RenderRunner";
import { sparseGraph } from "../test/support/physics";

const CANVAS_W = 1280;
const CANVAS_H = 800;
const DEFAULT_SIZES = [1024, 2048, 4096, 8192];
const DEFAULT_DPRS = [1, 2];
const DEFAULT_FRAMES = 300;
/** A frame over this is a missed 60 Hz frame; the published budget watches it. */
const FRAME_BUDGET_MS = 16.7;

type RenderMode = "main" | "worker";

interface Params {
    sizes: number[];
    dprs: number[];
    frames: number;
    mode: RenderMode;
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

    return {
        sizes: n !== null ? [Number(n)] : DEFAULT_SIZES,
        dprs: dpr !== null ? [Number(dpr)] : DEFAULT_DPRS,
        frames: frames !== null ? Number(frames) : DEFAULT_FRAMES,
        mode: query.get("render") === "main" ? "main" : "worker",
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

/** One animation frame's timestamp; the draw runs once per frame, as the app does. */
function nextFrame(): Promise<number> {
    return new Promise(resolve => window.requestAnimationFrame(resolve));
}

async function measureCase(
    runner: RenderRunner,
    nodes: number,
    dpr: number,
    frames: number
): Promise<Measurement> {

    // The backend owns the backing store and the device transform; the harness
    // only ever hands it the logical size.
    runner.resize(CANVAS_W, CANVAS_H, dpr);

    const graph: Graph = sparseGraph(nodes, 4321 + nodes);
    const camera = new Camera();

    const drawTimes: number[] = [];

    let longTasks = 0;
    let worstLongTask = 0;

    // A long task may be the physics bleeding in; physics never runs here, so
    // anything reported is the draw path.
    const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
            longTasks++;
            worstLongTask = Math.max(worstLongTask, entry.duration);
        }
    });

    try {
        observer.observe({ entryTypes: ["longtask"] });
    } catch {
        // Not every browser exposes longtask; the p50/p95 and >16.7 columns are
        // the contract.
    }

    // Non-standard and Chrome-only; optional by design.
    const memory = (performance as unknown as {
        memory?: { usedJSHeapSize: number };
    }).memory;

    const heapFrom = memory ? memory.usedJSHeapSize : null;

    let heapPeak = heapFrom;

    for (let frame = 0; frame < frames; frame++) {

        await nextFrame();

        // A slow orbit, so every frame is a real redraw and no frame reuses the
        // previous camera.
        camera.orbit(0.35, 0.12);

        const start = performance.now();

        runner.draw(graph, camera, null, CANVAS_W, CANVAS_H);

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

/** The copy-pasteable block for a PR body or the README's measured profile. */
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

    // One runner per page load: transferring canvas control to an OffscreenCanvas
    // is one-way, so the mode is fixed before the first case runs.
    const runner = RenderRunner.create(canvas, () => {});

    if (params.mode === "worker" && !runner.usesWorker)
        console.warn("render-frame: the render worker is not wired yet, so both modes draw in-process");

    console.log(
        `cuniform real-canvas frame harness: ${params.sizes.join(", ")} nodes, ` +
        `dpr ${params.dprs.join(", ")}, ${params.frames} frames, render=${params.mode}`
    );

    const rows: Measurement[] = [];

    for (const nodes of params.sizes) {
        for (const dpr of params.dprs) {
            const row = await measureCase(runner, nodes, dpr, params.frames);

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
