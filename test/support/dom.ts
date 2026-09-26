/**
 * Minimal, dependency-free DOM stand-ins for exercising the UI-facing modules
 * (DragController, UIController, entrypoint) under `node --test`.
 *
 * The physics solver is deliberately DOM-free and needs none of this; these
 * fakes exist only so the non-solver code can be tested headlessly without
 * pulling in jsdom.
 */

import { ForceDirectedGraph } from "../../src/ForceDirectedGraph";
import { Graph } from "../../src/Graph";
import { State } from "../../src/State";
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

export class FakeElement {

    tagName: string;
    id = '';
    style: Record<string, string> = {};
    draggable = false;
    parentElement: FakeElement | null = null;
    offsetTop = 0;
    offsetLeft = 0;
    offsetParent: FakeElement | null = null;
    offsetWidth = 800;
    offsetHeight = 600;
    clientWidth = 800;
    clientHeight = 600;
    width = 0;
    height = 0;
    innerHTML = '';
    children: FakeElement[] = [];
    /** Overrides what getBoundingClientRect() returns. */
    rect: FakeRect = rect();

    private listeners: Map<string, Listener[]> = new Map();

    constructor(tagName = 'DIV') {
        this.tagName = tagName;
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

    /** Number of listeners currently registered for `type`. */
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

    get firstChild(): FakeElement | null {
        return this.children.length > 0 ? this.children[0] : null;
    }

    appendChild(child: FakeElement): FakeElement {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    insertBefore(child: FakeElement): FakeElement {
        child.parentElement = this;
        this.children.unshift(child);
        return child;
    }

    removeChild(child: FakeElement): FakeElement {
        this.children = this.children.filter(c => c !== child);
        return child;
    }
}

/** Records every 2d drawing call, so render() can be asserted on. */
export class FakeContext2D {

    canvas: { width: number; height: number } = { width: 0, height: 0 };

    strokeStyle = '';
    fillStyle = '';
    font = '';

    /** strokeStyle captured at each stroke() call, in order. */
    strokes: string[] = [];
    /** fillStyle captured at each fill() call, in order. */
    fills: string[] = [];
    /** fillStyle captured at each fillText() call, in order. */
    texts: string[] = [];
    /** Arguments captured at each setTransform() call, in order. */
    transforms: number[][] = [];
    /** Arguments captured at each clearRect() call, in order. */
    clears: number[][] = [];

    clearRect(...args: number[]) {
        this.clears.push(args);
    }

    beginPath() {}
    moveTo() {}
    lineTo() {}
    arc() {}
    save() {}
    restore() {}

    fillText(..._args: any[]) {
        this.texts.push(String(this.fillStyle));
    }

    stroke() {
        this.strokes.push(String(this.strokeStyle));
    }

    fill() {
        this.fills.push(String(this.fillStyle));
    }

    setTransform(...args: number[]) {
        this.transforms.push(args);
    }
}

export class FakeCanvas extends FakeElement {

    context: FakeContext2D;

    constructor() {
        super('CANVAS');
        this.context = new FakeContext2D();
    }

    getContext(kind: string): FakeContext2D | null {
        return kind === '2d' ? this.context : null;
    }

    toDataURL(): string {
        return 'data:image/png;base64,FAKE';
    }
}

export interface FakeDom {
    document: any;
    window: any;
    elements: Record<string, FakeElement>;
    intervals: Array<{ id: number; fn: (...args: any[]) => void }>;
    /** Listeners registered on `window`, so viewport events can be fired. */
    windowListeners: Map<string, Listener[]>;
    restore: () => void;
}

/**
 * Install `document`, `window` and timer stubs on globalThis for the duration
 * of a test, returning a handle that restores the previous values.
 *
 * setInterval is intercepted so an initialized UIController cannot keep the
 * node test process alive; call `intervals[i].fn()` to advance the timer.
 */
export function installFakeDom(elements: Record<string, FakeElement> = {}): FakeDom {

    const global = globalThis as any;

    const previous = {
        document: global.document,
        window: global.window,
        setInterval: global.setInterval,
        clearInterval: global.clearInterval,
        confirm: global.confirm,
    };

    const intervals: Array<{ id: number; fn: (...args: any[]) => void }> = [];

    const documentStub = {
        getElementById: (id: string) => elements[id] ?? null,
        createElement: (tag: string) => new FakeElement(tag.toUpperCase()),
    };

    const windowListeners: Map<string, Listener[]> = new Map();

    const windowStub = {
        pageXOffset: 0,
        pageYOffset: 0,
        devicePixelRatio: 1,
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

    global.document = documentStub;
    global.window = windowStub;
    global.confirm = () => false;
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

    return {
        document: documentStub,
        window: windowStub,
        elements,
        intervals,
        windowListeners,
        restore: () => {
            global.document = previous.document;
            global.window = previous.window;
            global.setInterval = previous.setInterval;
            global.clearInterval = previous.clearInterval;
            global.confirm = previous.confirm;
        },
    };
}

/**
 * Build the element map the demo entrypoint expects. IDs listed in `omit` are
 * left out, so a test can simulate a missing element without `delete` (which
 * strict TS rejects on an index signature).
 */
export function demoElements(omit: string[] = []): Record<string, FakeElement> {
    const all: Record<string, FakeElement> = {
        body: new FakeElement('BODY'),
        canvas: new FakeCanvas(),
        export_canvas_link: new FakeElement('A'),
        reset_link: new FakeElement('A'),
        selectionInfoPanel: new FakeElement('DIV'),
        selectedNodeInfoLabel: new FakeElement('LABEL'),
        selectedNodeInfoList: new FakeElement('UL'),
    };

    const out: Record<string, FakeElement> = {};
    for (const key of Object.keys(all)) {
        if (!omit.includes(key)) {
            out[key] = all[key];
        }
    }
    return out;
}

/**
 * Install the fake DOM, run `fn` against it and always restore afterwards.
 * Every UI-facing test used to hand-write this `try/finally` wrapper.
 */
export function withFakeDom<T>(
    elements: Record<string, FakeElement>,
    fn: (dom: FakeDom) => T
): T {
    const dom = installFakeDom(elements);

    try {
        return fn(dom);
    } finally {
        dom.restore();
    }
}

/**
 * Build a UIController over the `demoElements()` map, hiding the seven
 * `as unknown as` casts every UI test used to repeat.
 *
 * `width`/`height` pin the logical size for fixtures that bypass
 * resizeCanvas(); `graph` installs a supplied graph as `window.fdg` (with a
 * fresh `window.state`), mirroring what initialize() would have built.
 */
export function newUIController(
    elements: Record<string, FakeElement>,
    opts: { width?: number; height?: number; graph?: Graph } = {}
): UIController {
    const canvas = elements.canvas as FakeCanvas;

    const controller = new UIController(
        elements.body as unknown as HTMLElement,
        canvas as unknown as HTMLCanvasElement,
        canvas.context as unknown as CanvasRenderingContext2D,
        elements.export_canvas_link as unknown as HTMLElement,
        elements.reset_link as unknown as HTMLElement,
        elements.selectedNodeInfoLabel as unknown as HTMLElement,
        elements.selectedNodeInfoList as unknown as HTMLElement
    );

    if (opts.width !== undefined)
        controller.width = opts.width;

    if (opts.height !== undefined)
        controller.height = opts.height;

    if (opts.graph) {
        const windowStub = (globalThis as any).window;
        windowStub.state = new State();
        windowStub.fdg = new ForceDirectedGraph(opts.graph);
    }

    return controller;
}

export interface FakeMouseEvent {
    button: number; clientX: number; clientY: number;
    screenX: number; screenY: number;
    defaultPrevented: boolean; preventDefault: () => void;
}

/**
 * A mouse event stand-in that records whether `preventDefault()` was called.
 * The four per-file helpers this replaces had drifted: context-menu recorded
 * suppression, pan's `preventDefault` was a no-op (so its suppression was
 * unassertable) and drag-controller carried only screen coordinates.
 */
export function mouseEvent(props: Partial<FakeMouseEvent> = {}): MouseEvent {
    const event: FakeMouseEvent = {
        button: 0, clientX: 0, clientY: 0,
        screenX: 0, screenY: 0,
        defaultPrevented: false,
        preventDefault: () => { event.defaultPrevented = true; },
        ...props,
    };

    return event as unknown as MouseEvent;
}

