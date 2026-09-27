import { emphasisFromWire } from "../core/Emphasis";
import { Graph } from "../graph/Graph";
import { K } from "../core/K";
import { buildMirrorGraph, packMirror, writePositions } from "../graph/MirrorGraph";
import { projectGraph } from "../view/Projection";
import { CameraView, Projector } from "../view/Projector";
import { render } from "./Renderer";
import { RenderSurface, resizeBackingStore } from "./RenderSurface";

/**
 * The message protocol between the main thread and a dedicated render worker,
 * plus the worker-side engine that applies it.
 *
 * This module is pure: it names no browser global, so it can be driven by the
 * worker entry, by the main thread and by an in-memory fake in tests. The worker
 * entry (`render.worker.ts`) is the only piece that touches `self`, the
 * `OffscreenCanvas` or `postMessage`.
 *
 * Everything per-frame is a typed array. A frame carries the model positions one
 * way and returns them, plus the frame's depths, the other way, both as pointer
 * moves: the main thread keeps the projection out of its tick and the drawer
 * owns the depths it actually drew.
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
    /** Node positions as `[x0, y0, z0, x1, ...]`, length 3N. */
    positions: Float64Array;
}

export interface FrameRequest {
    type: "frame";
    generation: number;
    /** Monotonic id, echoed in the ack so the main thread can drop a stale frame. */
    frameId: number;
    /** The camera, packed by `encodeCamera`: length `CAMERA_VALUES`. */
    camera: Float64Array;
    /** The frame's model positions, length 3N. Posted with transfer; returned in the ack. */
    positions: Float64Array;
    /** Index of the selected node, or -1. An index, not an object, crosses. */
    selected: number;
    /**
     * The frame's display emphasis, its `Emphasis` wire value. A number rather
     * than a name, because nothing per frame is a string; an unknown value
     * decodes to `nodes`.
     */
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

/** Posted once, at worker script load. */
export interface ReadyResponse {
    type: "ready";
}

export interface DrawnResponse {
    type: "drawn";
    generation: number;
    frameId: number;
    /** The frame's `positions` buffer, handed back so the main thread reuses it. */
    positions: Float64Array;
    /** This frame's view depths, length N. Posted with transfer. */
    depths: Float64Array;
}

/**
 * Produced by the worker entry, not by the engine: `convertToBlob` is not part
 * of the drawing subset `RenderSurface` describes.
 */
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

    // The render mirror needs the real labels; the wire form is otherwise the
    // shared encoding, so only this realm pays for them.
    const labels: string[] = new Array(vertices.length);

    for (let i = 0; i < vertices.length; i++)
        labels[i] = vertices[i].label;

    const wire = packMirror(graph);

    return { type: "init", generation, labels, edges: wire.edges, positions: wire.positions };
}

/** Pack a camera's 13 mutable numbers, so a frame message is a typed array. */
export function encodeCamera(view: CameraView): Float64Array {
    return encodeCameraInto(view, new Float64Array(CAMERA_VALUES));
}

/**
 * `encodeCamera` written into caller-owned scratch, so a steady-state frame
 * allocates nothing. The scratch is posted by structured clone, not transfer,
 * because the sender reuses it.
 */
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
 * Unpack a camera. `focalLength` and `nearPlane` are fixed for a camera's life
 * (`Camera.ts`) and never change at runtime, so both realms read them from `K`
 * rather than paying for them in every frame.
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
 * The worker-side renderer. It rebuilds the same `Tag` graph the main thread
 * has (through the shared `buildMirrorGraph`), projects it with the frame's
 * camera and draws it, so a frame's pixels and depths are produced in one realm
 * by the one projector that camera implies.
 */
export class RenderWorkerEngine {

    graph: Graph | null = null;

    private surface: RenderSurface | null = null;
    private target: RenderTarget | null = null;
    private generation = -1;

    // Cached so a frame at an unchanged size never reallocates the backing
    // store, which on a real canvas is a costly reallocation.
    private sizedWidth = -1;
    private sizedHeight = -1;
    private sizedDpr = -1;

    /**
     * Inject the drawing surface and its writable canvas. The engine then names
     * no canvas type and touches no DOM global.
     */
    attach(surface: RenderSurface, target: RenderTarget): void {
        this.surface = surface;
        this.target = target;
        this.sizedWidth = -1;
        this.sizedHeight = -1;
        this.sizedDpr = -1;
    }

    /** Apply one request; returns the response to post, or null when none is due. */
    handle(request: RenderRequest): DrawnResponse | null {

        if (request.type === "init") {
            this.build(request);
            return null;
        }

        if (request.type === "frame")
            return this.draw(request);

        // `export` is the entry's to fulfil: `convertToBlob` is not part of the
        // drawing subset, so the engine stays pure and returns nothing.
        return null;
    }

    private draw(request: FrameRequest): DrawnResponse | null {

        const surface = this.surface;
        const graph = this.graph;

        // A frame before init, or one computed for a graph that has since been
        // replaced, has nothing to draw.
        if (surface === null || graph === null || this.target === null)
            return null;

        if (request.generation !== this.generation)
            return null;

        this.resize(request.width, request.height, request.dpr);

        // The frame's positions are the model state; write them onto the mirror
        // before projecting, exactly as the main thread's tags would have been.
        writePositions(graph, request.positions);

        const projector = Projector.forCanvas(request.width, request.height, decodeCamera(request.camera));

        projectGraph(graph, projector);

        const selected = request.selected >= 0
            ? graph.vertices[request.selected] ?? null
            : null;

        render(surface, graph, projector.camera, selected, emphasisFromWire(request.emphasis));

        // A fresh depth array crosses back (transferred), so the main thread can
        // restore `Tag.depth` for the drag and the cull tie-break.
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

        // The same helper the in-process backend uses, so both realms size the
        // backing store and set the transform identically.
        resizeBackingStore(target, surface, width, height, dpr);
    }

    private build(request: InitRequest): void {
        this.graph = buildMirrorGraph(request.labels, request.edges, request.positions);
        this.generation = request.generation;
    }
}
