// The render worker entry (workplan Items 4-5).
//
// Deliberately not in PURE_MODULES: this is the one module that touches the
// worker globals, the `OffscreenCanvas` and `convertToBlob`. The engine and the
// message protocol live in RenderProtocol.ts, which stays pure and is driven
// here.

import { ExportRequest, FrameRequest, InitRequest, RenderWorkerEngine } from "./RenderProtocol";
import { RenderSurface } from "./RenderSurface";
import { WorkerScope } from "./WorkerChannel";

/**
 * The `OffscreenCanvas` subset this entry uses. Typed locally because the
 * project's TypeScript lib declares neither the `"2d"` overload of
 * `getContext()` nor `convertToBlob()` on `OffscreenCanvas`.
 */
interface RenderCanvas {
    width: number;
    height: number;
    getContext(kind: "2d"): RenderSurface | null;
    convertToBlob(options: { type: string }): Promise<Blob>;
}

/** The init message also carries the transferred canvas; only this entry reads it. */
type WorkerRequest = (InitRequest & { canvas?: RenderCanvas }) | FrameRequest | ExportRequest;

const scope = self as unknown as WorkerScope<WorkerRequest>;
const engine = new RenderWorkerEngine();

// The canvas arrives by transfer on the init message, so the element on the main
// thread is already a placeholder by the time the first frame comes.
let canvas: RenderCanvas | null = null;

scope.onmessage = event => {

    const request = event.data;

    if (request.type === "init") {

        const transferred = request.canvas;

        if (transferred) {
            const context = transferred.getContext("2d");

            if (context === null)
                return;

            canvas = transferred;
            engine.attach(context, transferred);
        }
    }

    if (request.type === "export") {
        void exportPng(request.requestId);
        return;
    }

    const response = engine.handle(request);

    if (response !== null) {
        // Both typed arrays cross by pointer move: the frame's positions return
        // to the main thread and the frame's depths travel with them.
        scope.postMessage(response, [response.positions.buffer, response.depths.buffer]);
    }
};

/** `convertToBlob` is not part of the drawing subset, so the entry owns export. */
async function exportPng(requestId: number): Promise<void> {

    if (canvas === null)
        return;

    const blob = await canvas.convertToBlob({ type: "image/png" });

    scope.postMessage({ type: "png", requestId, blob }, []);
}

// The main thread probes this before transferring control of the canvas: a
// worker that cannot answer must be found out while the canvas is still usable.
scope.postMessage({ type: "ready" }, []);
