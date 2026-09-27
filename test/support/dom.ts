// Minimal DOM stand-ins for the UI-facing modules under `node --test`; the
// physics solver is DOM-free and needs none of this.

import { Graph } from "../../src/Graph";
import { GraphWizard } from "../../src/GraphWizard";
import { K } from "../../src/K";
import { CameraView } from "../../src/Projector";
import { RenderRequest, RenderResponse, RenderWorkerEngine } from "../../src/RenderProtocol";
import { RenderBackend, RenderWorkerFactory, RenderWorkerPort } from "../../src/RenderRunner";
import { Tag } from "../../src/Tag";
import { UIController } from "../../src/UIController";

type Listener = (event: any) => void;

export interface FakeRect {
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    x: number;
    y: number;
}

function rect(top = 0, left = 0, width = 0, height = 0): FakeRect {
    return {
        top, left, width, height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
    };
}

/**
 * The one focused element, modelling the browser's exclusive focus. Focusing an
 * element blurs the previously focused one, so "which focus() came last" is
 * observable and an overlay that steals focus from another cannot hide.
 */
let activeElement: FakeElement | null = null;

export class FakeElement {

    tagName: string;
    id = '';
    style: Record<string, string> = {};
    draggable = false;
    parentElement: FakeElement | null = null;
    offsetWidth = 800;
    offsetHeight = 600;
    clientWidth = 800;
    clientHeight = 600;
    width = 0;
    height = 0;
    innerHTML = '';
    value = '';
    disabled = false;
    className = '';
    focused = false;
    attributes: Record<string, string> = {};
    /** Anchor-only fields, so an export download can be observed. */
    href = '';
    download = '';
    children: FakeElement[] = [];
    rect: FakeRect = rect();

    private listeners: Map<string, Listener[]> = new Map();

    constructor(tagName = 'DIV') {
        this.tagName = tagName;
    }

    /** Number of times click() has been called directly. */
    clickCount = 0;

    click() {
        this.clickCount++;
    }

    focus() {
        if (activeElement && activeElement !== this)
            activeElement.focused = false;

        activeElement = this;
        this.focused = true;

        // The browser dispatches `focus` after the previous element blurs. Local
        // listeners depend on it — the roving index of both overlays is synced
        // from this event, not only from their own Tab handlers.
        this.dispatch('focus');
    }

    setAttribute(name: string, value: string) {
        this.attributes[name] = value;
    }

    getAttribute(name: string): string | null {
        return this.attributes[name] ?? null;
    }

    addEventListener(type: string, fn: Listener) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
    }

    removeEventListener(type: string, fn: Listener) {
        const list = this.listeners.get(type) ?? [];
        this.listeners.set(type, list.filter(f => f !== fn));
    }

    listenerCount(type: string): number {
        return (this.listeners.get(type) ?? []).length;
    }

    /** Synchronously invoke every listener registered for `type`. */
    dispatch(type: string, event: any = {}) {
        for (const fn of [...(this.listeners.get(type) ?? [])]) {
            fn(event);
        }
    }

    getBoundingClientRect(): FakeRect {
        return this.rect;
    }

    private capturedPointers: Set<number> = new Set();

    setPointerCapture(pointerId: number) {
        this.capturedPointers.add(pointerId);
    }

    hasPointerCapture(pointerId: number): boolean {
        return this.capturedPointers.has(pointerId);
    }

    releasePointerCapture(pointerId: number) {
        this.capturedPointers.delete(pointerId);
    }

    get firstChild(): FakeElement | null {
        return this.children.length > 0 ? this.children[0] : null;
    }

    appendChild(child: FakeElement): FakeElement {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    removeChild(child: FakeElement): FakeElement {
        this.children = this.children.filter(c => c !== child);
        return child;
    }
}

/** One draw call in the order it was issued, for painter-order assertions. */
export interface DrawOp {
    kind: 'stroke' | 'fill' | 'text';
    style: string;
    alpha: number;
    /** The radius of the arc a `fill` acted on, else undefined. */
    radius?: number;
    /** The string a `text` op drew, else undefined. */
    text?: string;
}

/** Records every 2d drawing call, so render() can be asserted on. */
export class FakeContext2D {

    canvas: { width: number; height: number } = { width: 0, height: 0 };

    strokeStyle = '';
    fillStyle = '';
    font = '';

    /** The current alpha, set by the renderer for the depth fade. */
    globalAlpha = 1;

    strokes: string[] = [];
    fills: string[] = [];
    texts: string[] = [];
    strokeAlphas: number[] = [];
    fillAlphas: number[] = [];
    textAlphas: number[] = [];
    textLabels: string[] = [];
    arcs: number[][] = [];
    /** Segment endpoints, so a batched frame can be checked edge by edge. */
    moveTos: number[][] = [];
    lineTos: number[][] = [];
    /** The radius of the arc the nth fill() acted on, in order. */
    fillRadii: number[] = [];
    ops: DrawOp[] = [];
    transforms: number[][] = [];
    clears: number[][] = [];

    /** The most recent arc() radius, so the next fill() can be annotated. */
    private lastArcRadius = 0;

    // The signatures mirror `RenderSurface` (`src/RenderSurface.ts`) exactly, so
    // the fake is a structural stand-in for a real 2D context with no cast.
    clearRect(x: number, y: number, w: number, h: number) {
        this.clears.push([x, y, w, h]);
    }

    beginPath() {}

    moveTo(x: number, y: number) {
        this.moveTos.push([x, y]);
    }

    lineTo(x: number, y: number) {
        this.lineTos.push([x, y]);
    }

    arc(x: number, y: number, radius: number, start: number, end: number, ccw: boolean) {
        this.arcs.push([x, y, radius, start, end, ccw ? 1 : 0]);
        this.lastArcRadius = radius;
    }

    save() {}
    restore() {}

    fillText(text: string, _x: number, _y: number) {
        const drawn = String(text);

        this.texts.push(String(this.fillStyle));
        this.textAlphas.push(this.globalAlpha);
        this.textLabels.push(drawn);
        this.ops.push({ kind: 'text', style: String(this.fillStyle), alpha: this.globalAlpha, text: drawn });
    }

    stroke() {
        this.strokes.push(String(this.strokeStyle));
        this.strokeAlphas.push(this.globalAlpha);
        this.ops.push({ kind: 'stroke', style: String(this.strokeStyle), alpha: this.globalAlpha });
    }

    fill() {
        this.fills.push(String(this.fillStyle));
        this.fillAlphas.push(this.globalAlpha);
        this.fillRadii.push(this.lastArcRadius);
        this.ops.push({
            kind: 'fill',
            style: String(this.fillStyle),
            alpha: this.globalAlpha,
            radius: this.lastArcRadius,
        });
    }

    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
        this.transforms.push([a, b, c, d, e, f]);
    }
}

/** The receiving end of `transferControlToOffscreen()`; a worker fake ignores it. */
export class FakeOffscreenCanvas {
    width = 0;
    height = 0;
}

export class FakeCanvas extends FakeElement {

    context: FakeContext2D;

    /** True once control has been transferred to an OffscreenCanvas. */
    transferred = false;

    /** How many times transferControlToOffscreen() was called. */
    transferCount = 0;

    constructor() {
        super('CANVAS');
        this.context = new FakeContext2D();
    }

    transferControlToOffscreen(): FakeOffscreenCanvas {
        this.transferred = true;
        this.transferCount++;
        return new FakeOffscreenCanvas();
    }

    getContext(kind: string): FakeContext2D | null {
        // A real element refuses a context once control is transferred.
        if (this.transferred)
            return null;

        return kind === '2d' ? this.context : null;
    }

    toDataURL(): string {
        return 'data:image/png;base64,FAKE';
    }
}

/** One recorded frame, so the controller's draw path can be asserted on. */
export interface RecordedDraw {
    graph: Graph;
    camera: CameraView;
    selected: Tag | null;
    width: number;
    height: number;
}

/**
 * A recording stand-in for a render backend: the seam `newUIController` injects
 * so the draw path can be observed without a real context, and so the
 * "not ready yet" and "became ready later" branches can be driven by hand.
 */
export class FakeRenderBackend implements RenderBackend {

    usesWorker = false;
    ready = true;
    onReady: (() => void) | null = null;

    readonly draws: RecordedDraw[] = [];
    readonly resizes: number[][] = [];
    readonly graphs: Graph[] = [];
    exports = 0;
    terminated = false;

    /** When false, draw() reports "not ready" and the controller keeps the frame pending. */
    drawable = true;

    draw(graph: Graph, camera: CameraView, selected: Tag | null, width: number, height: number): boolean {
        this.draws.push({ graph, camera, selected, width, height });
        return this.drawable;
    }

    resize(width: number, height: number, dpr: number): void {
        this.resizes.push([width, height, dpr]);
    }

    setGraph(graph: Graph): void {
        this.graphs.push(graph);
    }

    exportPng(): Promise<Blob> {
        this.exports++;
        return Promise.resolve(new Blob());
    }

    terminate(): void {
        this.terminated = true;
    }

    /** Simulate a backend that becomes usable after a handshake. */
    becomeReady(): void {
        this.ready = true;
        this.onReady?.();
    }
}

/**
 * An in-memory stand-in for the render worker: it runs the real worker engine
 * synchronously, so the runner and the engine can be compared without a worker
 * host. It can be told to hold responses or to fail, which is how the
 * backpressure, stale-generation and fallback paths are exercised.
 */
export class FakeRenderWorker implements RenderWorkerPort {

    onmessage: ((event: { data: RenderResponse }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;

    readonly engine = new RenderWorkerEngine();
    readonly context = new FakeContext2D();

    /** Every message posted to the worker, in order, with its transfer list. */
    readonly posts: Array<{ message: RenderRequest; transfer: Transferable[] }> = [];
    terminated = false;

    private answering = true;

    constructor() {
        this.engine.attach(this.context, this.context.canvas);
    }

    postMessage(message: RenderRequest, transfer: Transferable[]): void {

        if (this.terminated)
            return;

        this.posts.push({ message, transfer });

        if (message.type === "export") {
            this.onmessage?.({ data: { type: "png", requestId: message.requestId, blob: new Blob() } });
            return;
        }

        const response = this.engine.handle(message);

        if (response !== null && this.answering)
            this.onmessage?.({ data: response });
    }

    terminate(): void {
        this.terminated = true;
    }

    /** Announce readiness, as the real worker does at script load. */
    becomeReady(): void {
        this.onmessage?.({ data: { type: "ready" } });
    }

    /** Stop answering, so an ack can be delivered by hand. */
    hold(): void {
        this.answering = false;
    }

    deliver(response: RenderResponse): void {
        this.onmessage?.({ data: response });
    }

    fail(): void {
        this.onerror?.(new Error("the worker script failed to load"));
    }
}

export interface FakeDom {
    document: any;
    window: any;
    elements: Record<string, FakeElement>;
    intervals: Array<{ id: number; fn: (...args: any[]) => void }>;
    /** Animation frames scheduled with requestAnimationFrame and not yet run. */
    animationFrames: Array<{ id: number; callback: (timestamp: number) => void }>;
    /** Run every pending frame once at `timestamp`; callbacks may reschedule. */
    runAnimationFrames: (timestamp: number) => void;
    windowListeners: Map<string, Listener[]>;
    createdElements: FakeElement[];
    /** Object-URL traffic, so a blob: export can be observed. */
    objectUrls: { created: string[]; revoked: string[] };
    restore: () => void;
}

/** FakeDom options; `animationFrame: false` exercises the setInterval fallback. */
export interface FakeDomOptions {
    animationFrame?: boolean;
}

// Install DOM/timer stubs on globalThis, returning a restore handle.
// setInterval is stubbed so an initialized UIController cannot keep node alive,
// and requestAnimationFrame is stubbed so the cadence scheduler can be driven by
// hand instead of by the host's frame clock.
export function installFakeDom(
    elements: Record<string, FakeElement> = {},
    options: FakeDomOptions = {}
): FakeDom {

    const global = globalThis as any;

    // Each installed DOM starts with nothing focused, whatever the last test left.
    activeElement = null;

    const previous = {
        document: global.document,
        window: global.window,
        setInterval: global.setInterval,
        clearInterval: global.clearInterval,
        requestAnimationFrame: global.requestAnimationFrame,
        cancelAnimationFrame: global.cancelAnimationFrame,
        confirm: global.confirm,
        URL: global.URL,
    };

    const intervals: Array<{ id: number; fn: (...args: any[]) => void }> = [];
    const animationFrames: Array<{ id: number; callback: (timestamp: number) => void }> = [];

    let nextFrameId = 1;

    const createdElements: FakeElement[] = [];

    const documentStub = {
        getElementById: (id: string) => elements[id] ?? null,
        createElement: (tag: string) => {
            const element = new FakeElement(tag.toUpperCase());
            createdElements.push(element);
            return element;
        },
    };

    // Object URLs are recorded, not created: tests only assert the traffic.
    const objectUrls: { created: string[]; revoked: string[] } = { created: [], revoked: [] };

    const urlStub = {
        createObjectURL: (_blob: unknown): string => {
            const url = `blob:cuniform/${objectUrls.created.length + 1}`;
            objectUrls.created.push(url);
            return url;
        },
        revokeObjectURL: (url: string): void => {
            objectUrls.revoked.push(url);
        },
    };

    const windowListeners: Map<string, Listener[]> = new Map();

    const requestAnimationFrame = (callback: (timestamp: number) => void): number => {
        const id = nextFrameId++;
        animationFrames.push({ id, callback });
        return id;
    };

    const cancelAnimationFrame = (id: number): void => {
        const idx = animationFrames.findIndex(frame => frame.id === id);
        if (idx !== -1) {
            animationFrames.splice(idx, 1);
        }
    };

    const windowStub: Record<string, unknown> = {
        devicePixelRatio: 1,
        // The viewport the context menu clamps against.
        innerWidth: 1024,
        innerHeight: 768,
        open: (): null => null,
        addEventListener: (type: string, fn: Listener) => {
            const list = windowListeners.get(type) ?? [];
            list.push(fn);
            windowListeners.set(type, list);
        },
        removeEventListener: (type: string, fn: Listener) => {
            const list = windowListeners.get(type) ?? [];
            windowListeners.set(type, list.filter(f => f !== fn));
        },
    };

    // The fallback path is what "rAF is unavailable" means, so leave it undefined.
    if (options.animationFrame ?? true) {
        windowStub.requestAnimationFrame = requestAnimationFrame;
        windowStub.cancelAnimationFrame = cancelAnimationFrame;
    }

    global.document = documentStub;
    global.window = windowStub;
    global.confirm = () => false;
    global.URL = urlStub as unknown as typeof URL;
    global.setInterval = (fn: (...args: any[]) => void) => {
        const id = intervals.length + 1;
        intervals.push({ id, fn });
        return id;
    };
    global.clearInterval = (id: number) => {
        const idx = intervals.findIndex(i => i.id === id);
        if (idx !== -1) {
            intervals.splice(idx, 1);
        }
    };

    if (options.animationFrame ?? true) {
        global.requestAnimationFrame = requestAnimationFrame;
        global.cancelAnimationFrame = cancelAnimationFrame;
    }

    return {
        document: documentStub,
        window: windowStub,
        elements,
        intervals,
        animationFrames,
        runAnimationFrames: (timestamp: number) => {
            // Splice first: a callback reschedules for the next frame.
            const pending = animationFrames.splice(0, animationFrames.length);

            for (const frame of pending)
                frame.callback(timestamp);
        },
        windowListeners,
        createdElements,
        objectUrls,
        restore: () => {
            global.document = previous.document;
            global.window = previous.window;
            global.setInterval = previous.setInterval;
            global.clearInterval = previous.clearInterval;
            global.requestAnimationFrame = previous.requestAnimationFrame;
            global.cancelAnimationFrame = previous.cancelAnimationFrame;
            global.confirm = previous.confirm;
            global.URL = previous.URL;
        },
    };
}

// The element map the demo entrypoint expects; IDs in `omit` are left out
// (`delete` on the index signature is rejected by strict TS).
export function demoElements(omit: string[] = []): Record<string, FakeElement> {
    const all: Record<string, FakeElement> = {
        body: new FakeElement('BODY'),
        canvas: new FakeCanvas(),
        export_canvas_link: new FakeElement('A'),
        reset_link: new FakeElement('A'),
        selectionInfoPanel: new FakeElement('DIV'),
        panelDragHandle: new FakeElement('DIV'),
        selectedNodeInfoLabel: new FakeElement('LABEL'),
        selectedNodeInfoList: new FakeElement('UL'),
        currentGraphLabel: new FakeElement('DIV'),
        cameraConsole: new FakeElement('DIV'),
    };

    const out: Record<string, FakeElement> = {};
    for (const key of Object.keys(all)) {
        if (!omit.includes(key)) {
            out[key] = all[key];
        }
    }
    return out;
}

/** Install the fake DOM, run `fn` against it, always restore afterwards. */
export function withFakeDom<T>(
    elements: Record<string, FakeElement>,
    fn: (dom: FakeDom) => T,
    options: FakeDomOptions = {}
): T {
    const dom = installFakeDom(elements, options);

    try {
        return fn(dom);
    } finally {
        dom.restore();
    }
}

// Build a UIController over the `demoElements()` map. `width`/`height` pin the
// logical size for fixtures that bypass resizeCanvas(); `graph` is wrapped by
// the controller's solver, as initialize() would have done. `backend` replaces
// the runner's in-process backend with a recording fake.
export function newUIController(
    elements: Record<string, FakeElement>,
    opts: {
        width?: number;
        height?: number;
        graph?: Graph;
        backend?: RenderBackend;
        workerFactory?: RenderWorkerFactory;
    } = {}
): UIController {
    const canvas = elements.canvas as FakeCanvas;
    const suppliedGraph = opts.graph;

    const controller = new UIController(
        elements.body as unknown as HTMLElement,
        canvas as unknown as HTMLCanvasElement,
        elements.export_canvas_link as unknown as HTMLElement,
        elements.reset_link as unknown as HTMLElement,
        elements.selectedNodeInfoLabel as unknown as HTMLElement,
        elements.selectedNodeInfoList as unknown as HTMLElement,
        elements.currentGraphLabel as unknown as HTMLElement,
        elements.cameraConsole as unknown as HTMLElement,
        suppliedGraph ? () => suppliedGraph : undefined,
        opts.backend ?? null,
        opts.workerFactory
    );

    if (opts.width !== undefined)
        controller.width = opts.width;

    if (opts.height !== undefined)
        controller.height = opts.height;

    return controller;
}

/** The fake element behind an HTMLElement a component hands back. */
export function el(element: HTMLElement): FakeElement {
    return element as unknown as FakeElement;
}

/** Fill the random form and press generate, as a user choosing that spec would. */
export function generateRandom(wizard: GraphWizard, order: number, branching: number): void {
    wizard.orderInput.value = String(order);
    wizard.branchingInput.value = String(branching);
    el(wizard.generateButton).dispatch("click");
}

/**
 * Replace `graph.selectedVertex` with a thrower, so a regression that scans the
 * graph for the selection fails loudly. `message` names the offending caller.
 */
export function poisonSelection(graph: Graph, message: string): void {
    graph.selectedVertex = () => {
        throw new Error(message);
    };
}

/** Every listener initialize() attaches to the canvas. */
export const CANVAS_EVENTS = [
    'mousemove', 'mousedown', 'mouseup', 'mouseout', 'contextmenu', 'keydown', 'wheel',
];

/** The camera console's own delegated listeners, one per event type. */
export const CAMERA_CONSOLE_EVENTS = ['pointerdown', 'keydown', 'keyup', 'click'];

// Window listeners that end a held console button anywhere; `blur` covers the
// pointerup the browser never delivers when the window loses focus.
export const CAMERA_HOLD_RELEASE_EVENTS = ['pointerup', 'pointercancel', 'blur'];

export interface UIControllerFixture {
    dom: FakeDom;
    elements: Record<string, FakeElement>;
    canvas: FakeCanvas;
    controller: UIController;
}

export interface UIControllerOptions {
    /** Pin the logical size before initialize(), which may recompute it. */
    width?: number;
    height?: number;
    /** The fake body size resizeCanvas() reads. Defaults to the fake 800x600. */
    bodyWidth?: number;
    bodyHeight?: number;
    devicePixelRatio?: number;
    graph?: Graph;
    /** Run initialize() first. Defaults to true: most fixtures want the listeners. */
    initialize?: boolean;
    /** False exercises the setInterval fallback instead of the rAF scheduler. */
    animationFrame?: boolean;
    /** The render backend to inject, so the draw path is observable. */
    backend?: RenderBackend;
    /** The render worker to inject, so the worker path is observable. */
    workerFactory?: RenderWorkerFactory;
}

function uiFixture(
    dom: FakeDom,
    elements: Record<string, FakeElement>,
    options: UIControllerOptions
): UIControllerFixture {
    if (options.devicePixelRatio !== undefined)
        dom.window.devicePixelRatio = options.devicePixelRatio;

    const canvas = elements.canvas as FakeCanvas;
    const controller = newUIController(elements, {
        width: options.width,
        height: options.height,
        graph: options.graph,
        backend: options.backend,
        workerFactory: options.workerFactory,
    });

    if (options.initialize ?? true)
        controller.initialize();

    return { dom, elements, canvas, controller };
}

function preparedElements(options: UIControllerOptions): Record<string, FakeElement> {
    const elements = demoElements();

    if (options.bodyWidth !== undefined)
        elements.body.clientWidth = options.bodyWidth;

    if (options.bodyHeight !== undefined)
        elements.body.clientHeight = options.bodyHeight;

    return elements;
}

/** Install, configure, initialize, run `fn`, always restore — even on throw. */
export function withUIController<T>(
    fn: (ui: UIControllerFixture) => T,
    options: UIControllerOptions = {}
): T {
    const elements = preparedElements(options);
    const dom = installFakeDom(elements, { animationFrame: options.animationFrame });

    try {
        return fn(uiFixture(dom, elements, options));
    } finally {
        dom.restore();
    }
}

// As withUIController(), but the DOM stays installed until `fn` settles: export
// defers object-URL revocation to a timer.
export async function withUIControllerAsync<T>(
    fn: (ui: UIControllerFixture) => Promise<T> | T,
    options: UIControllerOptions = {}
): Promise<T> {
    const elements = preparedElements(options);
    const dom = installFakeDom(elements, { animationFrame: options.animationFrame });

    try {
        return await fn(uiFixture(dom, elements, options));
    } finally {
        dom.restore();
    }
}

export interface FakeMouseEvent {
    button: number; clientX: number; clientY: number;
    shiftKey: boolean;
    /** True for the macOS context-menu gesture, which is a primary press. */
    ctrlKey: boolean;
    /** The event target, so a delegated handler can be exercised. */
    target: unknown;
    /** The click count; 0 marks a keyboard or assistive-technology click. */
    detail: number;
    defaultPrevented: boolean; preventDefault: () => void;
}

// Mouse-event stand-in that records whether `preventDefault()` was called.
export function mouseEvent(props: Partial<FakeMouseEvent> = {}): MouseEvent {
    const event: FakeMouseEvent = {
        button: 0, clientX: 0, clientY: 0, shiftKey: false, ctrlKey: false,
        target: null, detail: 1,
        defaultPrevented: false,
        preventDefault: () => { event.defaultPrevented = true; },
        ...props,
    };

    return event as unknown as MouseEvent;
}

export interface FakeWheelEvent {
    deltaY: number; clientX: number; clientY: number;
    defaultPrevented: boolean; preventDefault: () => void;
}

// Wheel-event stand-in for the dolly; `deltaY` is what the handler reads.
export function wheelEvent(props: Partial<FakeWheelEvent> = {}): WheelEvent {
    const event: FakeWheelEvent = {
        deltaY: 0, clientX: 0, clientY: 0,
        defaultPrevented: false,
        preventDefault: () => { event.defaultPrevented = true; },
        ...props,
    };

    return event as unknown as WheelEvent;
}

export interface FakePointerEvent {
    button: number; clientX: number; clientY: number;
    pointerId: number;
    /** 'mouse', 'pen' or 'touch'; only a touch is held to the drag handle. */
    pointerType: string;
    /** The event target, so a delegated handler can be exercised. */
    target: unknown;
    propagationStopped: boolean;
    defaultPrevented: boolean; preventDefault: () => void;
    stopPropagation: () => void;
}

// Pointer-event stand-in for the panel drag; `propagationStopped` records
// whether a handler stopped the event before it reached an ancestor's listener.
export function pointerEvent(props: Partial<FakePointerEvent> = {}): PointerEvent {
    const event: FakePointerEvent = {
        button: 0, clientX: 0, clientY: 0, pointerId: 1, pointerType: 'mouse',
        target: null,
        propagationStopped: false,
        defaultPrevented: false,
        preventDefault: () => { event.defaultPrevented = true; },
        stopPropagation: () => { event.propagationStopped = true; },
        ...props,
    };

    return event as unknown as PointerEvent;
}

export interface FakeKeyboardEvent {
    key: string;
    shiftKey: boolean;
    /** True for an auto-repeat keydown, which a hold must not restart on. */
    repeat: boolean;
    /** The focused element, so a delegated handler can be exercised. */
    target: unknown;
    defaultPrevented: boolean;
    preventDefault: () => void;
}

export function keyEvent(props: Partial<FakeKeyboardEvent> = {}): KeyboardEvent {
    const event: FakeKeyboardEvent = {
        key: '', shiftKey: false, repeat: false, target: null,
        defaultPrevented: false,
        preventDefault: () => { event.defaultPrevented = true; },
        ...props,
    };

    return event as unknown as KeyboardEvent;
}

// ------------------------------------------------------------- cadence fixtures

/**
 * One node at the origin feels no force, so its travel is exactly zero and the
 * settle detector arms deterministically. The shared arming fixture for any test
 * that needs a settled layout.
 */
export function settledGraph(): Graph {
    const graph = new Graph();
    graph.addNode(new Tag({ x: 0, y: 0, z: 0 }, "solo"));
    return graph;
}

/**
 * Drive the first frame plus `settleFrames` stepping frames, leaving the layout
 * settled with an empty accumulator. Returns the timestamp of the last frame, so
 * a caller can run another frame at the same instant and be sure no step is due.
 *
 * This encodes the animation-frame cadence protocol (frame 0 establishes the
 * clock, then one step per tick period), so it has one home.
 */
export function settleFrames(ui: UIControllerFixture): number {

    const period = K.physics.timerTickPeriodMS;

    ui.dom.runAnimationFrames(0);

    let timestamp = 0;

    for (let frame = 1; frame <= K.physics.settleFrames; frame++) {
        timestamp = period * frame;
        ui.dom.runAnimationFrames(timestamp);
    }

    return timestamp;
}

/** Count physics steps by wrapping the controller's solver. */
export function countSteps(controller: UIController): () => number {

    const solver = controller.solver;
    const realStep = solver.stepPhysics.bind(solver);

    let steps = 0;

    solver.stepPhysics = isPinned => {
        steps++;
        realStep(isPinned);
    };

    return () => steps;
}

// ------------------------------------------------------ renderer size overrides

/** The `K.renderer` thresholds a test may need to move for one scope. */
export interface RendererSettings {
    labelMaxNodes?: number;
    batchEdgesMinEdges?: number;
    minNodes?: number;
}

/**
 * Run `fn` with the given `K.renderer` thresholds overridden, always restoring
 * every one of them.
 *
 * `K` must not be mutated at runtime, so a test that needs a size-gated path
 * takes the override for exactly its own scope. One helper for all three keys, so
 * a new overridable key cannot be covered by one suite and silently missed by
 * another.
 */
export function withRendererSettings<T>(settings: RendererSettings, fn: () => T): T {

    const saved = {
        labelMaxNodes: K.renderer.labelMaxNodes,
        batchEdgesMinEdges: K.renderer.batchEdgesMinEdges,
        minNodes: K.renderer.performance.minNodes,
    };

    if (settings.labelMaxNodes !== undefined)
        K.renderer.labelMaxNodes = settings.labelMaxNodes;

    if (settings.batchEdgesMinEdges !== undefined)
        K.renderer.batchEdgesMinEdges = settings.batchEdgesMinEdges;

    if (settings.minNodes !== undefined)
        K.renderer.performance.minNodes = settings.minNodes;

    try {
        return fn();
    } finally {
        K.renderer.labelMaxNodes = saved.labelMaxNodes;
        K.renderer.batchEdgesMinEdges = saved.batchEdgesMinEdges;
        K.renderer.performance.minNodes = saved.minNodes;
    }
}

