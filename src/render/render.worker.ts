// The render worker entry; deliberately not in PURE_MODULES because it touches
// the worker globals. See docs/model-camera-and-rendering.md.

import { ExportRequest, FrameRequest, InitRequest, RenderWorkerEngine } from "./RenderProtocol";
import { RenderSurface } from "./RenderSurface";
import { WorkerScope } from "../core/WorkerChannel";

/** Locally typed: the TS lib lacks the `"2d"` overload and `convertToBlob` here. */
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

// The canvas arrives by transfer, so the main thread's element is a placeholder.
let canvas: RenderCanvas | null = null;

scope.onmessage = event => {

    const request = event.data;

    if (request.type === "init") {

        const transferred = request.canvas;

        if (transferred) {
            const context = transferred.getContext("2d");

            // Silence here would leave the main thread waiting on its first frame forever.
            if (context === null) {
                scope.postMessage({ type: "error", reason: "the transferred canvas gave no 2d context" }, []);
                return;
            }

            canvas = transferred;
            engine.attach(context, transferred);
        }
    }

    if (request.type === "export") {
        void exportPng(request.requestId);
        return;
    }

    try {
        const response = engine.handle(request);

        if (response !== null)
            scope.postMessage(response, [response.positions.buffer, response.depths.buffer]);
    }
    catch (error) {
        scope.postMessage({ type: "error", reason: `the render worker threw: ${String(error)}` }, []);
    }
};

/** `convertToBlob` is not part of the drawing subset, so the entry owns export; every path replies. */
async function exportPng(requestId: number): Promise<void> {

    if (canvas === null) {
        scope.postMessage({ type: "png", requestId, error: "the render worker has no canvas" }, []);
        return;
    }

    try {
        const blob = await canvas.convertToBlob({ type: "image/png" });
        scope.postMessage({ type: "png", requestId, blob }, []);
    }
    catch (error) {
        scope.postMessage({ type: "png", requestId, error: String(error) }, []);
    }
}

// The main thread probes this before transferring control of the canvas.
scope.postMessage({ type: "ready" }, []);
