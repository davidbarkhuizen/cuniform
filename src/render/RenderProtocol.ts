import { emphasisFromWire } from "../core/Emphasis";
import { Graph } from "../graph/Graph";
import { K } from "../core/K";
import { buildMirrorGraph, packMirror, writePositions } from "../graph/MirrorGraph";
import { projectGraph } from "../view/Projection";
import { CameraView, Projector } from "../view/Projector";
import { render } from "./Renderer";
import { RenderSurface, resizeBackingStore } from "./RenderSurface";

/**
 * The protocol between the main thread and the render worker, plus the worker-side engine. Pure: only
 * `render.worker.ts` touches `self`, `OffscreenCanvas` or `postMessage`.
 */

/** A camera as it crosses the boundary: 9 orientation entries, 3 target coordinates, distance. */
export const CAMERA_VALUES = 13;

export interface InitRequest {
    type: "init";
    generation: number;
    /** Node labels, in insertion order: the render mirror needs the real ones. */
    labels: string[];
    /** Undirected edge endpoints as node-index pairs, length 2E. */
    edges: Int32Array;
    positions: Float64Array;
}

export interface FrameRequest {
    type: "frame";
    generation: number;
    /** Monotonic id, echoed in the ack so the main thread can drop a stale frame. */
    frameId: number;
    camera: Float64Array;
    /** The frame's model positions, length 3N, posted with transfer and returned in the ack. */
    positions: Float64Array;
    selected: number;
    /** The `Emphasis` wire value; an unknown value decodes to `nodes`. */
    emphasis: number;
    /** Logical (CSS-pixel) canvas size and the device-pixel ratio to size the store with. */
    width: number;
    height: number;
    dpr: number;
}

export interface ExportRequest {
    type: "export";
    requestId: number;
}

export type RenderRequest = InitRequest | FrameRequest | ExportRequest;

export interface ReadyResponse {
    type: "ready";
}

export interface DrawnResponse {
    type: "drawn";
    generation: number;
    frameId: number;
    positions: Float64Array;
    /** This frame's view depths, length N, posted with transfer. */
    depths: Float64Array;
}

/** Produced by the worker entry, not the engine: `convertToBlob` is outside the `RenderSurface` subset. */
export interface PngResponse {
    type: "png";
    requestId: number;
    blob: Blob;
}

export type RenderResponse = ReadyResponse | DrawnResponse | PngResponse;

/** The writable backing store behind a surface: the worker's `OffscreenCanvas`. */
export interface RenderTarget {
    width: number;
    height: number;
}

/** The `init` message for `graph`, with node insertion order as the index space. */
export function initRequest(graph: Graph, generation: number): InitRequest {

    const vertices = graph.vertices;

    // The render mirror needs the real labels; the rest of the wire form is the shared encoding.
    const labels: string[] = new Array(vertices.length);

    for (let i = 0; i < vertices.length; i++)
        labels[i] = vertices[i].label;

    const wire = packMirror(graph);

    return { type: "init", generation, labels, edges: wire.edges, positions: wire.positions };
}

export function encodeCamera(view: CameraView): Float64Array {
    return encodeCameraInto(view, new Float64Array(CAMERA_VALUES));
}

/** `encodeCamera` into caller-owned scratch; posted by clone, not transfer, because the sender reuses it. */
export function encodeCameraInto(view: CameraView, out: Float64Array): Float64Array {

    for (let i = 0; i < 9; i++)
        out[i] = view.orientation[i];

    out[9] = view.target.x;
    out[10] = view.target.y;
    out[11] = view.target.z;
    out[12] = view.distance;

    return out;
}

/**
 * `focalLength` and `nearPlane` are fixed for a camera's life (`Camera.ts`), so they are read from `K`, never
 * sent.
 */
export function decodeCamera(values: Float64Array): CameraView {
    return {
        orientation: [
            values[0], values[1], values[2],
            values[3], values[4], values[5],
            values[6], values[7], values[8],
        ],
        target: {
            x: values[9],
            y: values[10],
            z: values[11],
        },
        distance: values[12],
        focalLength: K.camera.focalLength,
        nearPlane: K.camera.nearPlane,
    };
}

/**
 * Rebuilds the main thread's `Tag` graph through the shared `buildMirrorGraph`, then projects and draws it.
 * Pixels and depths come from the one projector that camera implies (invariant 2).
 */
export class RenderWorkerEngine {

    graph: Graph | null = null;

    private surface: RenderSurface | null = null;
    private target: RenderTarget | null = null;
    private generation = -1;

    // Cached so a frame at an unchanged size never reallocates the backing store.
    private sizedWidth = -1;
    private sizedHeight = -1;
    private sizedDpr = -1;

    /** Inject the drawing surface and its writable canvas, so the engine names no canvas type. */
    attach(surface: RenderSurface, target: RenderTarget): void {
        this.surface = surface;
        this.target = target;
        this.sizedWidth = -1;
        this.sizedHeight = -1;
        this.sizedDpr = -1;
    }

    handle(request: RenderRequest): DrawnResponse | null {

        if (request.type === "init") {
            this.build(request);
            return null;
        }

        if (request.type === "frame")
            return this.draw(request);

        // `export` is the entry's to fulfil: `convertToBlob` is outside the drawing subset.
        return null;
    }

    private draw(request: FrameRequest): DrawnResponse | null {

        const surface = this.surface;
        const graph = this.graph;

        // A frame before init, or one for a graph since replaced, has nothing to draw.
        if (surface === null || graph === null || this.target === null)
            return null;

        if (request.generation !== this.generation)
            return null;

        this.resize(request.width, request.height, request.dpr);

        // The frame's positions are the model state: write them onto the mirror before projecting.
        writePositions(graph, request.positions);

        const projector = Projector.forCanvas(request.width, request.height, decodeCamera(request.camera));

        projectGraph(graph, projector);

        const selected = request.selected >= 0
            ? graph.vertices[request.selected] ?? null
            : null;

        render(surface, graph, projector.camera, selected, emphasisFromWire(request.emphasis));

        // A fresh depth array crosses back (transferred), so the main thread can restore `Tag.depth`.
        const depths = new Float64Array(graph.vertices.length);

        for (let i = 0; i < depths.length; i++)
            depths[i] = graph.vertices[i].depth;

        return {
            type: "drawn",
            generation: request.generation,
            frameId: request.frameId,
            positions: request.positions,
            depths,
        };
    }

    private resize(width: number, height: number, dpr: number): void {

        if (width === this.sizedWidth && height === this.sizedHeight && dpr === this.sizedDpr)
            return;

        this.sizedWidth = width;
        this.sizedHeight = height;
        this.sizedDpr = dpr;

        const target = this.target;
        const surface = this.surface;

        if (target === null || surface === null)
            return;

        // The same helper the in-process backend uses, so both realms size the backing store identically.
        resizeBackingStore(target, surface, width, height, dpr);
    }

    private build(request: InitRequest): void {
        this.graph = buildMirrorGraph(request.labels, request.edges, request.positions);
        this.generation = request.generation;
    }
}
