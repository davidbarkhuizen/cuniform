import {
    CameraAxis,
    CameraDirection,
    CameraZoom,
    cameraScratch,
    copyCameraView,
    isCameraAxis,
    isCameraDirection,
    isCameraZoom,
    sameCameraView,
} from "../view/Camera";
import { ContextMenu } from "../ui/ContextMenu";
import { AncestorNode, attributeOf, firstAncestor } from "../ui/Dom";
import { Emphasis, emphasisValue, isEmphasisName } from "../core/Emphasis";
import { ForceDirectedGraph } from "../physics/ForceDirectedGraph";
import { Graph } from "../graph/Graph";
import { K } from "../core/K";
import { point, Point2D } from "../core/Point2D";
import { point3 } from "../core/Point3D";
import { PhysicsRunner } from "../physics/PhysicsRunner";
import { CameraView, Projector } from "../view/Projector";
import { fitView } from "../view/Fit";
import { buildGraph, BuiltGraph } from "../network/BuildGraph";
import { carryPositions } from "../network/Carry";
import { componentDetails, modelSummary } from "../network/Details";
import { fileSource, ModelSource, TextFile } from "./ModelSource";
import { NetworkModel } from "../network/NetworkModel";
import { readFormat2 } from "../network/Format2";
import { BAND_STRIDE } from "../graph/Attributes";
import { RenderBackend, RenderRunner, RenderWorkerFactory } from "../render/RenderRunner";
import { handleNodeSelectionAttempt, nodeAt } from "../ui/Selection";
import { State } from "./State";
import { Tag } from "../graph/Tag";

/** Builds the graph to show; supplied by the caller, not read from globals. */
export type GraphSource = () => Graph;

/** Until a model is loaded there is nothing to show. */
const defaultGraphSource: GraphSource = () => new Graph();

const NO_MODEL_LABEL = 'no model loaded';

/** The two keys a focused button activates on; browsers synthesise a click for both. */
const isButtonActivationKey = (event: KeyboardEvent): boolean =>
    event.key === 'Enter' || event.key === ' ';

type CameraButton =
    | { kind: 'rotate'; axis: CameraAxis; direction: CameraDirection }
    | { kind: 'zoom'; zoom: CameraZoom };

export class UIController {

    /** The setInterval handle when the fallback scheduler is in use, else null. */
    timer: ReturnType<typeof setInterval> | null = null;

    private frameHandle: number | null = null;

    /** Real time accumulated since the last fixed physics step, milliseconds. */
    private accumulator = 0;

    /** Timestamp of the previous frame; null before the first frame or after a wake. */
    private lastFrameTime: number | null = null;

    private quietSteps = 0;

    private settled = false;

    /** Set through requestRedraw() by any change that is neither physics nor camera. */
    private needsRedraw = true;

    /** Reusable scratch holding the last drawn camera; seeded from `defaultCameraView()`. */
    private readonly lastDrawnCamera = cameraScratch();

    get running(): boolean {
        return this.frameHandle !== null || this.timer !== null;
    }

    readonly state: State = new State();

    private solverRef: ForceDirectedGraph | null = null;

    // The physics owner: an in-process solver or a worker behind the same interface.
    private runnerRef: PhysicsRunner | null = null;

    // The drawing owner: an in-process canvas backend or a render worker behind the same interface.
    private renderRunnerRef: RenderRunner | null = null;

    body: HTMLElement;
    canvas: HTMLCanvasElement;
    exportElement: HTMLElement;
    resetElement: HTMLElement;

    // Written by updateSelectionInfo(); resolved by the entrypoint, not by hardcoded ID.
    selectionInfoLabel: HTMLElement;
    selectionInfoList: HTMLElement;

    // The camera console's container; null in fixtures without one.
    cameraConsole: HTMLElement | null;

    // The emphasis control's container; null in fixtures without one.
    emphasisConsole: HTMLElement | null;

    // The console button currently held; each tick applies one step while it is set.
    private heldButton: CameraButton | null = null;

    // Radians per tick, derived from a rate so felt speed survives a tick-period retune.
    private static readonly ROTATION_PER_TICK =
        K.camera.rotateRadiansPerSecond * K.physics.timerTickPeriodMS / 1000;

    contextMenu: ContextMenu | null = null;

    // Cached selection passed to the renderer; refreshed by updateSelectionInfo().
    private selected: Tag | null = null;

    // The loader's file picker, the model panel's list, the selection's expand/collapse button and the
    // panel's edges-per-unit field; null in fixtures without them.
    modelFileInput: HTMLInputElement | null = null;
    modelInfoList: HTMLElement | null = null;
    expandToggle: HTMLElement | null = null;
    edgesPerUnitInput: HTMLInputElement | null = null;

    // The components shown at the unit level (D7 L1), by id, and how many weights each unit draws.
    readonly expanded = new Set<string>();
    edgesPerUnit = K.network.edgesPerUnit;

    // The loaded network, and the render graph built from it; null until a model opens.
    model: NetworkModel | null = null;
    built: BuiltGraph | null = null;
    private modelName: string | null = null;
    private loadError: string | null = null;

    // Only the latest open may land, so a slow file cannot replace a later one.
    private openRequest = 0;

    // Names what is on screen.
    currentGraphLabel: HTMLElement;

    // Logical (CSS-pixel) canvas size; all canvas mapping uses these, not the HiDPI backing store.
    width: number = 0;
    height: number = 0;

    constructor(
        body: HTMLElement,
        canvas: HTMLCanvasElement,
        exportElement: HTMLElement,
        resetElement: HTMLElement,
        selectionInfoLabel: HTMLElement,
        selectionInfoList: HTMLElement,
        currentGraphLabel: HTMLElement,
        cameraConsole: HTMLElement | null,
        private readonly makeGraph: GraphSource = defaultGraphSource,
        // Test seam: the backend the runner wraps instead of the canvas's own 2D context.
        private readonly renderBackend: RenderBackend | null = null,
        // Test seam: the worker the runner probes instead of the bundled one.
        private readonly renderWorkerFactory: RenderWorkerFactory | undefined = undefined,
        emphasisConsole: HTMLElement | null = null
    ) {
        this.body = body;
        this.canvas = canvas;
        this.exportElement = exportElement;
        this.resetElement = resetElement;
        this.selectionInfoLabel = selectionInfoLabel;
        this.selectionInfoList = selectionInfoList;
        this.currentGraphLabel = currentGraphLabel;
        this.cameraConsole = cameraConsole;
        this.emphasisConsole = emphasisConsole;
    }

    private initialGraph(): Graph {
        return this.makeGraph();
    }

    // Built lazily for handlers that run before initialize().
    get solver(): ForceDirectedGraph {
        if (this.solverRef === null)
            this.solverRef = new ForceDirectedGraph(this.initialGraph());

        return this.solverRef;
    }

    get runner(): PhysicsRunner {
        if (this.runnerRef === null)
            this.runnerRef = new PhysicsRunner(this.solver);

        return this.runnerRef;
    }

    get renderRunner(): RenderRunner {
        if (this.renderRunnerRef === null)
            this.renderRunnerRef = this.createRenderRunner(this.solver.graph);

        return this.renderRunnerRef;
    }

    // onReady routes a late-ready backend's redraw request, keeping needsRedraw private.
    private createRenderRunner(graph: Graph): RenderRunner {
        const onReady = () => this.requestRedraw();

        if (this.renderBackend !== null)
            return RenderRunner.over(this.renderBackend, onReady);

        const runner = RenderRunner.create(this.canvas, onReady, {
            graph,
            workerFactory: this.renderWorkerFactory,
            replaceCanvas: this.replaceCanvas,
        });

        // entrypoint() refuses such a canvas, so this path is unreachable.
        if (runner === null)
            throw new Error("UIController: the canvas can neither transfer to an OffscreenCanvas nor give a 2d context");

        return runner;
    }

    onMouseOut = () => {
        this.state.reset();
    };

    // A culled node has no usable depth, so it drags on the near plane.
    private dragSelectedTo(mxy: Point2D): void {

        const projector = this.projector();

        for (const vertex of this.solver.graph.vertices) {

            if (!vertex.isSelected)
                continue;

            const depth = projector.isCulled(vertex.depth)
                ? projector.camera.nearPlane
                : vertex.depth;

            vertex.position = projector.unproject(mxy, depth);
        }

        // No step or camera move here, so the idle-frame skip would freeze the drag.
        this.requestRedraw();
    }

    onMouseMove = (event: MouseEvent) => {

        if (this.state.b0Down || this.state.b1Down)
            this.wake();

        if (this.state.b0Down) {
            this.dragSelectedTo(this.getMousePos(this.canvas, event));
        }
        else if (this.state.b1Down) {

            const mxy = this.getMousePos(this.canvas, event);

            if (event.shiftKey)
                this.panCameraTo(mxy);
            else
                this.orbitTo(mxy);
        }
    };

    /** Previous middle-drag anchor, or null after seeding it from the gesture's first move. */
    private takeDragAnchor(mxy: Point2D): Point2D | null {

        const last = this.state.lastMiddleDragPos;

        if (last == null) {
            this.state.lastMiddleDragPos = mxy;
            return null;
        }

        this.state.lastMiddleDragPos = mxy;
        return last;
    };

    orbitTo = (mxy: Point2D) => {

        const last = this.takeDragAnchor(mxy);

        if (last === null)
            return;

        this.state.camera.orbit(mxy.x - last.x, mxy.y - last.y);
    };

    panCameraTo = (mxy: Point2D) => {

        const last = this.takeDragAnchor(mxy);

        if (last === null)
            return;

        const projector = this.projector();

        // Unprojecting at `distance` slides the plane through the camera target.
        const depth = this.state.camera.distance;

        const now = projector.unproject(mxy, depth);
        const before = projector.unproject(last, depth);

        this.state.camera.panBy(
            point3(now.x - before.x, now.y - before.y, now.z - before.z)
        );
    };

    // Wheel dollies; `focalLength` is constant by design, so only the distance changes.
    onWheel = (event: WheelEvent) => {

        const notches = event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0;

        if (notches !== 0) {
            this.state.camera.dolly(notches);

            this.wake();
        }

        event.preventDefault();
    };

    // Parse a console button out of an event target.
    private cameraButton(target: EventTarget | null): CameraButton | null {

        const element = this.consoleButton(target);

        if (!element)
            return null;

        // Guards are the runtime half of the Camera* vocabularies; zoom is tried first.
        const zoom = element.getAttribute('data-zoom');

        if (isCameraZoom(zoom))
            return { kind: 'zoom', zoom };

        const axis = element.getAttribute('data-axis');
        const direction = element.getAttribute('data-direction');

        if (!isCameraAxis(axis))
            return null;

        if (!isCameraDirection(direction))
            return null;

        return { kind: 'rotate', axis, direction };
    }

    // Walks up because a press can land on a button's SVG icon; the walk stops at the console.
    private consoleButton(target: EventTarget | null): HTMLElement | null {

        const element = firstAncestor<AncestorNode>(
            target,
            node => attributeOf(node, 'data-axis') !== null ||
                attributeOf(node, 'data-zoom') !== null,
            this.cameraConsole
        );

        return element as HTMLElement | null;
    }

    // Anticlockwise is the right-hand positive sense about the axis, hence the positive step.
    private applyCameraButton(button: CameraButton): void {

        if (button.kind === 'zoom') {
            this.state.camera.zoom(button.zoom);
            return;
        }

        const step = button.direction === 'acw'
            ? UIController.ROTATION_PER_TICK
            : -UIController.ROTATION_PER_TICK;

        this.state.camera.rotateLocal(button.axis, step);
    }

    onCameraHoldTick = () => {

        if (this.heldButton)
            this.applyCameraButton(this.heldButton);
    };

    // One step at once so a tap still moves, then one per tick.
    private startCameraHold(button: CameraButton): void {

        this.heldButton = button;
        this.applyCameraButton(button);

        this.wake();
    }

    stopCameraHold = () => {
        this.heldButton = null;
    };

    // The release half is watched on the window; see toggleEventListeners.
    onCameraPointerDown = (event: PointerEvent) => {

        // DragController captures the pointer on pointerdown, so a console press must not reach it.
        event.stopPropagation();

        const button = this.cameraButton(event.target);

        if (button)
            this.startCameraHold(button);
    };

    onCameraPointerUp = () => {
        this.stopCameraHold();
    };

    /** Cancels the default so the browser does not also synthesise a click for the same press. */
    onCameraKeyDown = (event: KeyboardEvent) => {

        if (!isButtonActivationKey(event))
            return;

        // Auto-repeat would restart the step; the tick handler advances a hold.
        if (event.repeat)
            return;

        const button = this.cameraButton(event.target);

        if (!button)
            return;

        event.preventDefault();
        this.startCameraHold(button);
    };

    onCameraKeyUp = (event: KeyboardEvent) => {

        if (!isButtonActivationKey(event))
            return;

        event.preventDefault();
        this.stopCameraHold();
    };

    // Pointer and key activation both produce a click, which the hold paths cover; only `detail === 0` steps.
    onCameraButtonClick = (event: MouseEvent) => {

        if (event.detail !== 0)
            return;

        const button = this.cameraButton(event.target);

        if (button)
            this.applyCameraButton(button);
    };

    // Walks up from `target`; `isEmphasisName` is the runtime half of the vocabulary.
    private emphasisButton(target: EventTarget | null): Emphasis | null {

        const element = firstAncestor<AncestorNode>(
            target,
            node => isEmphasisName(attributeOf(node, 'data-emphasis')),
            this.emphasisConsole
        );

        if (element === null)
            return null;

        const name = attributeOf(element, 'data-emphasis');

        return isEmphasisName(name) ? emphasisValue(name) : null;
    }

    /** DragController already excludes BUTTON presses, so no pointerdown guard; redraws without waking. */
    onEmphasisClick = (event: MouseEvent) => {

        const emphasis = this.emphasisButton(event.target);

        if (emphasis !== null)
            this.setEmphasis(emphasis);
    };

    /** The one writer of the display emphasis. */
    setEmphasis = (emphasis: Emphasis) => {

        if (this.state.emphasis === emphasis)
            return;

        this.state.emphasis = emphasis;
        this.updateEmphasisButtons();
        this.requestRedraw();
    };

    /** Keeps the buttons' `aria-pressed` in sync after a toggle; the markup ships with `nodes` pressed. */
    private updateEmphasisButtons = () => {

        if (this.emphasisConsole === null)
            return;

        for (const button of Array.from(
            this.emphasisConsole.querySelectorAll('[data-emphasis]')
        )) {
            const name = button.getAttribute('data-emphasis');

            if (!isEmphasisName(name))
                continue;

            button.setAttribute(
                'aria-pressed',
                emphasisValue(name) === this.state.emphasis ? 'true' : 'false'
            );
        }
    };

    projector(): Projector {
        return Projector.forCanvas(this.width, this.height, this.state.camera);
    }

    onMouseDown = (event: MouseEvent) => {

        this.hideContextMenu();

        this.wake();

        let mxy = this.getMousePos(
            this.canvas,
            event
        );

        if (event.button === 0) {

            // macOS Ctrl+click arrives as a primary press with ctrlKey; flag it for the contextmenu event.
            if (event.ctrlKey) {
                this.state.b2Down = true;
                return;
            }

            this.state.b0Down = true;

            const selectionChanged = handleNodeSelectionAttempt(
                this.solver.graph,
                mxy,
                this.projector()
            );
            if (selectionChanged)
                this.updateSelectionInfo();
        }
        else if (event.button === 1) {
            this.state.b1Down = true;
            this.state.lastMiddleDragPos = mxy;
            event.preventDefault();
        }
        else if (event.button === 2) {
            this.state.b2Down = true;
        }
    }

    // The native menu is always suppressed; ours opens only for a real right-click or Ctrl+click.
    onContextMenu = (event: MouseEvent) => {

        event.preventDefault();

        if (!this.state.b2Down && !event.ctrlKey)
            return;

        this.openContextMenu(event.clientX, event.clientY);
    };

    openContextMenu = (x: number, y: number) => {
        if (this.contextMenu)
            this.contextMenu.open(x, y);
    };

    // Keyboard path to the menu; Escape here covers canvas focus, the menu handles its own.
    onKeyDown = (event: KeyboardEvent) => {

        const opensMenu =
            event.key === 'ContextMenu' ||
            (event.shiftKey && event.key === 'F10');

        if (opensMenu) {
            event.preventDefault();

            const rect = this.canvas.getBoundingClientRect();
            this.openContextMenu(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2
            );
            return;
        }

        if (event.key === 'Escape')
            this.hideContextMenu();
    };

    hideContextMenu = () => {
        if (this.contextMenu)
            this.contextMenu.hide();
    };

    getMousePos = (cnvs: HTMLCanvasElement, evt: MouseEvent) => {

        // Both share the viewport frame, so the subtraction survives scrolling, transforms and DPR.
        const rect = cnvs.getBoundingClientRect();

        return point(
            evt.clientX - rect.left,
            evt.clientY - rect.top
        )
    };

    onMouseUp = (event: MouseEvent) => {

        if (event.button === 0) {
            this.state.b0Down = false;

            // A Ctrl+click set b2Down too, so release it as well.
            this.state.b2Down = false;

            this.updateSelectionInfo();
        }
        else if (event.button === 1) {
            this.state.b1Down = false;
            this.state.lastMiddleDragPos = null;
        }
        else if (event.button === 2)
            this.state.b2Down = false;
    }

    // The canvas listens to Pointer Events only, so mouse, pen and touch share one event model; mouse and pen
    // take the handlers above unchanged, and touch takes the gesture map below.
    onPointerDown = (event: PointerEvent) => {
        if (event.pointerType === 'touch')
            this.onTouchDown(event);
        else
            this.onMouseDown(event);
    };

    onPointerMove = (event: PointerEvent) => {
        if (event.pointerType === 'touch')
            this.onTouchMove(event);
        else
            this.onMouseMove(event);
    };

    onPointerUp = (event: PointerEvent) => {
        if (event.pointerType === 'touch')
            this.onTouchEnd(event, true);
        else
            this.onMouseUp(event);
    };

    onPointerCancel = (event: PointerEvent) => {
        if (event.pointerType === 'touch')
            this.onTouchEnd(event, false);
        else
            this.onMouseOut();
    };

    // A lifted finger also fires pointerout, so only mouse and pen leaving the canvas reset the buttons.
    onPointerOut = (event: PointerEvent) => {
        if (event.pointerType !== 'touch')
            this.onMouseOut();
    };

    private longPressTimer: ReturnType<typeof setTimeout> | null = null;

    private cancelLongPress(): void {
        if (this.longPressTimer !== null) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
    }

    private pinchGeometry(): { spread: number; centroid: Point2D } {
        const [a, b] = Array.from(this.state.touches.values());

        return {
            spread: Math.hypot(b.x - a.x, b.y - a.y),
            centroid: point((a.x + b.x) / 2, (a.y + b.y) / 2),
        };
    }

    /**
     * One finger on a node selects and drags it; on empty canvas it orbits, a tap clears the selection, and a
     * still long press opens the actions menu. A second finger cancels that and pinches (dolly) and pans.
     */
    onTouchDown = (event: PointerEvent) => {

        event.preventDefault();

        this.hideContextMenu();
        this.wake();

        const state = this.state;
        const at = this.getMousePos(this.canvas, event);

        state.touches.set(event.pointerId, at);

        if (state.touches.size === 1) {

            state.touchStart = at;
            state.touchMoved = false;

            const graph = this.solver.graph;

            if (nodeAt(graph, at, this.projector()) !== null) {
                if (handleNodeSelectionAttempt(graph, at, this.projector()))
                    this.updateSelectionInfo();

                state.b0Down = true;
                state.touchMode = 'drag';
            }
            else {
                state.touchMode = 'orbit';
                state.lastMiddleDragPos = at;
            }

            const { clientX, clientY } = event;

            this.cancelLongPress();
            this.longPressTimer = setTimeout(() => {
                this.longPressTimer = null;

                if (state.touches.size !== 1 || state.touchMoved)
                    return;

                state.b0Down = false;
                state.touchMode = 'none';
                this.openContextMenu(clientX, clientY);
            }, K.ui.longPressMS);

            return;
        }

        this.cancelLongPress();

        // A second finger turns any one-finger gesture into a pinch; a third is ignored.
        if (state.touches.size === 2) {
            state.b0Down = false;
            state.touchMode = 'pinch';

            const { spread, centroid } = this.pinchGeometry();

            state.pinchSpread = spread;
            state.lastMiddleDragPos = centroid;

            // The drag's pin is released, so the frame must redraw without it.
            this.requestRedraw();
        }
    };

    onTouchMove = (event: PointerEvent) => {

        const state = this.state;

        if (!state.touches.has(event.pointerId))
            return;

        const at = this.getMousePos(this.canvas, event);

        state.touches.set(event.pointerId, at);

        if (state.touchStart !== null && !state.touchMoved) {
            const travel = Math.hypot(at.x - state.touchStart.x, at.y - state.touchStart.y);

            if (travel >= K.ui.touchSlopPx) {
                state.touchMoved = true;
                this.cancelLongPress();
            }
        }

        if (state.touchMode === 'drag') {
            this.wake();
            this.dragSelectedTo(at);
        }
        else if (state.touchMode === 'orbit' && state.touchMoved) {
            this.wake();
            this.orbitTo(at);
        }
        else if (state.touchMode === 'pinch' && state.touches.size === 2) {

            const { spread, centroid } = this.pinchGeometry();

            this.wake();

            // Fingers apart zooms in, which is a shorter distance.
            if (spread > 0 && state.pinchSpread > 0)
                state.camera.dollyBy(state.pinchSpread / spread);

            state.pinchSpread = spread;

            this.panCameraTo(centroid);
        }
    };

    /** `completed` is false for pointercancel, which never counts as a tap. */
    private onTouchEnd(event: PointerEvent, completed: boolean): void {

        const state = this.state;

        if (!state.touches.has(event.pointerId))
            return;

        const at = state.touches.get(event.pointerId)!;

        state.touches.delete(event.pointerId);
        this.cancelLongPress();

        if (completed && state.touchMode === 'orbit' && !state.touchMoved) {
            // A tap on empty canvas: the same miss a primary click is, so it clears the selection.
            if (handleNodeSelectionAttempt(this.solver.graph, at, this.projector()))
                this.updateSelectionInfo();
        }

        if (state.touchMode === 'drag') {
            state.b0Down = false;
            this.updateSelectionInfo();
        }

        // After any lift the gesture is over until every finger is up, so a pinch never decays into an orbit.
        state.touchMode = 'none';
        state.lastMiddleDragPos = null;

        if (state.touches.size === 0) {
            state.touchStart = null;
            state.touchMoved = false;
        }
    }

    onExport = (event?: MouseEvent) => {

        event?.preventDefault();

        // A `data:` URL cannot be opened by top-frame navigation, so the download rides an object URL.
        void this.renderRunner.exportPng().then(blob => {

            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = 'cuniform.png';
            link.click();

            // Revoking synchronously can cancel the download in some browsers.
            setTimeout(() => URL.revokeObjectURL(url), 0);
        }).catch(error => {
            // An export before the worker is ready must not surface an unhandled rejection.
            console.error("export failed", error);
        });
    };

    // Rebuilds the graph from its source, which re-seeds the layout.
    onReset = (event?: MouseEvent) => {

        event?.preventDefault();

        this.hideContextMenu();

        // The same model again, re-seeded from its band grid; the camera the viewer chose stays.
        if (this.model !== null) {
            this.built = this.buildModel(this.model);
            this.loadGraph(this.built.graph, false);
        }
        else {
            this.loadGraph(this.makeGraph(), false);
        }

        this.updateModelInfo();

        return false;
    };

    // A new model is framed once, on load (D6); `fit` is false for a reload of the same one.
    loadGraph = (graph: Graph, fit: boolean = true) => {

        this.solverRef = new ForceDirectedGraph(graph);

        if (fit)
            this.fitCamera(graph);

        // Re-initialise the physics owner, dropping in-flight messages from the replaced graph.
        if (this.runnerRef !== null)
            this.runnerRef.setGraph(this.solverRef);

        // The render worker's graph mirror must be re-initialised too.
        if (this.renderRunnerRef !== null)
            this.renderRunnerRef.setGraph(this.solverRef.graph);

        // A swap happens between gestures, so no button may still be held.
        this.state.reset();

        // A fresh graph must never inherit the previous layout's settled state.
        this.wake();

        this.updateSelectionInfo();
    };

    /** Frame a banded graph; a plain graph keeps the camera it has. */
    private fitCamera(graph: Graph): void {

        const view = graph.attributes === null ? null : fitView(graph.attributes.bands);

        if (view !== null)
            this.state.camera.setPose(view);
    }

    /**
     * Reads, builds and shows a model from any source. A refusal is shown on the panel's model line and leaves
     * whatever was on screen; resolves true when the model is now shown.
     */
    openModel = async (source: ModelSource): Promise<boolean> => {

        const request = ++this.openRequest;
        let model: NetworkModel;

        try {
            model = readFormat2(await source.load());
        }
        catch (error) {
            if (request === this.openRequest) {
                this.loadError = `could not open ${source.name}: ${error instanceof Error ? error.message : String(error)}`;
                this.updateCurrentGraphLabel();
            }

            return false;
        }

        if (request !== this.openRequest)
            return false;

        this.model = model;
        this.modelName = source.name;
        this.loadError = null;
        this.expanded.clear();
        this.built = this.buildModel(model);
        this.loadGraph(this.built.graph);
        this.updateCurrentGraphLabel();
        this.updateModelInfo();

        return true;
    };

    private buildModel(model: NetworkModel): BuiltGraph {
        return buildGraph(model, { expanded: this.expanded, edgesPerUnit: this.edgesPerUnit });
    }

    /**
     * Rebuilds the shown model at the current level of detail (D7): stable ids keep their positions, new units
     * start around their collapsed node, and both workers re-initialise through the generation path.
     */
    private rebuild(): void {
        if (this.model === null || this.built === null)
            return;

        const previous = this.built;
        const next = this.buildModel(this.model);

        carryPositions(previous, next);

        this.built = next;
        this.loadGraph(next.graph, false);
        this.updateModelInfo();
    }

    /** Expand a collapsed component, or collapse an expanded one, by its id. */
    toggleExpanded = (componentId: string) => {
        if (this.expanded.has(componentId))
            this.expanded.delete(componentId);
        else
            this.expanded.add(componentId);

        this.rebuild();

        // After a collapse the component's node is the natural selection; after an expand, none.
        if (!this.expanded.has(componentId) && this.built !== null) {
            const index = this.built.ids.indexOf(componentId);

            if (index >= 0) {
                this.built.graph.vertices[index].isSelected = true;
                this.updateSelectionInfo();
            }
        }
    };

    /** The selected node's component id, when a network's node is selected. */
    private selectedComponentId(): string | null {
        const built = this.built;
        const selected = this.selected;

        if (built === null || selected === null || this.solver.graph !== built.graph)
            return null;

        const group = built.graph.attributes!.group[built.graph.vertices.indexOf(selected)];
        return built.components[group]?.id ?? null;
    }

    // A real button, so there is no default action to prevent.
    onExpandToggle = () => {
        const id = this.selectedComponentId();

        if (id !== null)
            this.toggleExpanded(id);
    };

    onEdgesPerUnitChange = () => {
        const value = Number(this.edgesPerUnitInput?.value);

        if (!Number.isInteger(value) || value < 1 || value === this.edgesPerUnit)
            return;

        this.edgesPerUnit = value;

        if (this.expanded.size > 0)
            this.rebuild();
    };

    private openFile(file: TextFile | undefined): void {
        if (file !== undefined)
            void this.openModel(fileSource(file));
    }

    onModelFileChange = () => {
        const input = this.modelFileInput;

        this.openFile(input?.files?.[0] ?? undefined);

        // Cleared, so choosing the same file again still fires a change.
        if (input)
            input.value = '';
    };

    // Accepting the drag is what lets the drop land on the canvas.
    onDragOver = (event: DragEvent) => {
        event.preventDefault();
    };

    onDrop = (event: DragEvent) => {
        event.preventDefault();
        this.openFile(event.dataTransfer?.files?.[0] ?? undefined);
    };

    private updateCurrentGraphLabel = () => {
        this.currentGraphLabel.textContent = this.loadError ?? this.modelName ?? NO_MODEL_LABEL;
    };

    /** The button names the toggle the selected component would take, and hides when there is none. */
    private updateExpandToggle(component: { id: string; units: number } | null): void {
        const button = this.expandToggle;

        if (button === null)
            return;

        const usable = component !== null && component.units > 1;

        button.hidden = !usable;
        button.textContent = usable && this.expanded.has(component.id) ? 'collapse' : 'expand';
    }

    private updateModelInfo(): void {
        const list = this.modelInfoList;

        if (list === null)
            return;

        UIController.clearList(list);

        if (this.model === null || this.built === null)
            return;

        const graph = this.built.graph;
        const bands = (graph.attributes?.bands.length ?? 0) / BAND_STRIDE;

        for (const line of modelSummary(this.model, { bands, nodes: graph.vertices.length, edges: graph.edges.length })) {
            const item = document.createElement('li');
            item.textContent = line;
            list.appendChild(item);
        }
    }

    private static clearList(list: HTMLElement): void {
        while (list.children.length > 0) {
            const first = list.firstChild;
            if (!first)
                break;
            list.removeChild(first);
        }
    }

    clearSelection = () => {
        this.solver.graph.clearSelection();
        this.updateSelectionInfo();
    };

    // Deliberately bypasses the idle-frame skip: this path never settles, so a skipped draw would freeze the
    // picture.
    onTimerTick = () => {
        this.renderFrame(this.advanceOneTick());
    };

    // Returns the live camera so the draw projects under the same view this step ran with.
    private advanceOneTick(): CameraView {

        this.onCameraHoldTick();

        const graph = this.solver.graph;

        // The pin crosses to a worker as index and position, so the solver never reads browser state.
        const selected = this.state.b0Down ? this.selected : null;
        const pinnedIndex = selected === null ? -1 : graph.vertices.indexOf(selected);
        const pinnedPosition = pinnedIndex >= 0 ? graph.vertices[pinnedIndex].position : null;

        this.runner.step(
            pinnedIndex,
            pinnedPosition?.x ?? 0,
            pinnedPosition?.y ?? 0,
            pinnedPosition?.z ?? 0
        );

        // A worker answers asynchronously, so this copies its last report onto the tags before projection.
        this.runner.sync(graph);

        this.trackSettle();

        return this.state.camera;
    }

    private renderFrame(camera: CameraView = this.state.camera): void {

        const drawn = this.renderRunner.draw(
            this.solver.graph,
            camera,
            this.selected,
            this.width,
            this.height,
            this.state.emphasis
        );

        // Consuming the request while the backend is not ready would leave the canvas blank.
        if (!drawn)
            return;

        this.recordDrawnCamera(camera);
        this.needsRedraw = false;
    }

    private requestRedraw(): void {
        this.needsRedraw = true;
    }

    // Allocation free: the orientation array is reused and the target Point3D mutated.
    private recordDrawnCamera(view: CameraView): void {
        copyCameraView(view, this.lastDrawnCamera);
    }

    // Stepping stops after K.physics.settleFrames quiet steps; wake() resumes it.
    private trackSettle(): void {

        if (this.runner.maxDisplacement < K.physics.settleEpsilon) {
            this.quietSteps++;

            if (this.quietSteps >= K.physics.settleFrames)
                this.settled = true;
        }
        else {
            this.quietSteps = 0;
            this.settled = false;
        }
    }

    /** Resume stepping after a settle. */
    private wake(): void {
        this.settled = false;
        this.quietSteps = 0;
    }

    // Whether initialize() has bound the listeners, so a canvas swap rebinds only what is live.
    private listenersAttached = false;

    /**
     * Swap in a fresh, untransferred copy of the canvas: a canvas whose control went to a worker can never
     * draw on this thread again. The copy keeps the id, attributes, inline size and fallback text.
     */
    replaceCanvas = (): HTMLCanvasElement => {

        const fresh = this.canvas.cloneNode(true) as HTMLCanvasElement;

        if (this.listenersAttached)
            this.toggleCanvasListeners(false);

        this.canvas.replaceWith(fresh);
        this.canvas = fresh;

        if (this.listenersAttached)
            this.toggleCanvasListeners(true);

        this.requestRedraw();

        return fresh;
    };

    private static bind(attach: boolean, target: EventTarget, type: string, fn: (event: any) => void): void {
        if (attach)
            target.addEventListener(type, fn);
        else
            target.removeEventListener(type, fn);
    }

    // Split from the rest so a canvas swap can move exactly these to the new element.
    private toggleCanvasListeners(attach: boolean) {

        const bind = (type: string, fn: (event: any) => void) => UIController.bind(attach, this.canvas, type, fn);

        // The page must not scroll or zoom under a gesture on the canvas.
        if (attach)
            this.canvas.style.touchAction = 'none';

        bind("pointermove", this.onPointerMove);
        bind("pointerdown", this.onPointerDown);
        bind("pointerup", this.onPointerUp);
        bind("pointercancel", this.onPointerCancel);
        bind("pointerout", this.onPointerOut);
        bind("contextmenu", this.onContextMenu);
        bind("keydown", this.onKeyDown);
        bind("wheel", this.onWheel);
        bind("dragover", this.onDragOver);
        bind("drop", this.onDrop);
    }

    // One list for both directions, so attach and detach cannot drift apart.
    private toggleEventListeners(attach: boolean) {

        this.listenersAttached = attach;

        // The handlers mix MouseEvent and no-argument callbacks, hence the open parameter.
        const bind = (
            target: EventTarget,
            type: string,
            fn: (event: any) => void
        ) => UIController.bind(attach, target, type, fn);

        this.toggleCanvasListeners(attach);

        bind(this.exportElement, "click", this.onExport);

        bind(this.resetElement, "click", this.onReset);

        if (this.modelFileInput)
            bind(this.modelFileInput, "change", this.onModelFileChange);

        if (this.expandToggle)
            bind(this.expandToggle, "click", this.onExpandToggle);

        if (this.edgesPerUnitInput)
            bind(this.edgesPerUnitInput, "change", this.onEdgesPerUnitChange);

        // A held button is released wherever the pointer is, so release is watched on the window; blur covers lost
        // focus.
        if (this.cameraConsole) {
            bind(this.cameraConsole, "pointerdown", this.onCameraPointerDown);
            bind(this.cameraConsole, "keydown", this.onCameraKeyDown);
            bind(this.cameraConsole, "keyup", this.onCameraKeyUp);
            bind(this.cameraConsole, "click", this.onCameraButtonClick);

            bind(window, "pointerup", this.onCameraPointerUp);
            bind(window, "pointercancel", this.onCameraPointerUp);
            bind(window, "blur", this.onCameraPointerUp);
        }

        if (this.emphasisConsole)
            bind(this.emphasisConsole, "click", this.onEmphasisClick);

        bind(window, "resize", this.onResize);
    }

    buildContextMenu = () => {
        const menu = new ContextMenu([
            { label: 'export', onSelect: this.onExport },
            { label: 'reset', onSelect: () => this.onReset() },
            { label: 'clear selection', onSelect: this.clearSelection },
        ], () => this.canvas.focus());

        this.body.appendChild(menu.element);
        this.contextMenu = menu;
    };

    /** Re-reads the graph's selection into the cache. */
    private refreshSelection = () => {
        this.selected = this.solver.graph.selectedVertex();
    };

    updateSelectionInfo = () => {

        this.refreshSelection();

        // Every selection-changing path funnels through here, and none is a step or camera move.
        this.requestRedraw();

        const selectedNode = this.selected;

        const selectedNodeInfoLabel = this.selectionInfoLabel;
        const list = this.selectionInfoList;

        UIController.clearList(list);
        this.updateExpandToggle(null);

        if (!selectedNode) {
            selectedNodeInfoLabel.textContent = 'Click on a node to select...';
        }
        else if (this.built !== null && this.solver.graph === this.built.graph) {
            // A network's component: its place, spec fields and weight statistics (D12).
            selectedNodeInfoLabel.textContent = selectedNode.label;

            const group = this.built.graph.attributes!.group[this.built.graph.vertices.indexOf(selectedNode)];

            for (const line of componentDetails(this.built.componentEntries[group], this.built.components[group])) {
                const item = document.createElement('li');
                item.textContent = line;
                list.appendChild(item);
            }

            this.updateExpandToggle(this.built.components[group]);
        }
        else {
            selectedNodeInfoLabel.textContent = selectedNode.label;

            this.solver.graph.neighbours(selectedNode)
            .forEach(
                neighbour => {
                    const neighbourString = neighbour.label;

                    const item = document.createElement('li');
                    item.textContent = neighbourString;

                    list.appendChild(item);
                }
            )
        }
    };

    // The backend sizes the backing store in device pixels; the element keeps the logical CSS size.
    resizeCanvas = () => {

        const width = this.body.clientWidth;
        const height = this.body.clientHeight;

        const dpr = window.devicePixelRatio || 1;

        this.width = width;
        this.height = height;

        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;

        // The backend owns the backing store; with a worker the element's width/height govern nothing.
        this.renderRunner.resize(width, height, dpr);
    };

    onResize = () => {
        this.resizeCanvas();

        this.wake();

        // The backing store was just re-created, so a redraw is mandatory.
        this.requestRedraw();
    };

    private startSimulationLoop(): void {

        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
            this.lastFrameTime = null;
            this.accumulator = 0;
            this.wake();
            this.frameHandle = window.requestAnimationFrame(this.onAnimationFrame);
            return;
        }

        this.timer = setInterval(this.onTimerTick, K.physics.timerTickPeriodMS);
    }

    onAnimationFrame = (timestamp: number): void => {

        this.frameHandle = null;

        const elapsed = this.lastFrameTime === null ? 0 : timestamp - this.lastFrameTime;
        this.lastFrameTime = timestamp;

        // A backwards or non-numeric clock must not run the simulation.
        this.accumulator += elapsed > 0 ? elapsed : 0;

        const period = K.physics.timerTickPeriodMS;
        let steps = 0;

        while (this.accumulator >= period && steps < K.physics.maxStepsPerFrame) {

            // Drop the backlog once settled, unless a console button is held on this clock.
            if (this.settled && this.heldButton === null) {
                this.accumulator = 0;
                break;
            }

            this.accumulator -= period;
            steps++;

            // Once settled only the camera moves; re-stepping the solved layout would waste physics.
            if (this.settled)
                this.onCameraHoldTick();
            else
                this.advanceOneTick();
        }

        // A slow frame must not leave a backlog that turns into a death spiral.
        if (this.accumulator >= period)
            this.accumulator = 0;

        if (steps > 0 || this.needsRedraw || !sameCameraView(this.lastDrawnCamera, this.state.camera))
            this.renderFrame();

        this.frameHandle = window.requestAnimationFrame(this.onAnimationFrame);
    }

    initialize = () => {

        // Idempotent: tearing down first stops a second initialize() doubling the listeners.
        this.terminate();

        // The same State object is reused so handlers see the cleared flags; camera and emphasis survive reset().
        this.state.reset();

        // A controller reused after a toggle must not keep a stale pressed button.
        this.state.emphasis = Emphasis.nodes;
        this.updateEmphasisButtons();

        this.solverRef = new ForceDirectedGraph(this.initialGraph());
        this.fitCamera(this.solverRef.graph);

        // Built before resizeCanvas() draws through it; handed the graph so a worker mirror starts first.
        this.renderRunnerRef = this.createRenderRunner(this.solverRef.graph);

        this.resizeCanvas();

        this.needsRedraw = true;

        this.runnerRef = new PhysicsRunner(this.solverRef);

        this.updateCurrentGraphLabel();

        this.buildContextMenu();

        this.toggleEventListeners(true);

        this.startSimulationLoop();

        this.updateSelectionInfo();
    }

    terminate = () => {
        if (this.timer != null) {
            clearInterval(this.timer);
            this.timer = null;
        }

        if (this.frameHandle !== null) {
            if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function")
                window.cancelAnimationFrame(this.frameHandle);

            this.frameHandle = null;
        }

        // A worker must not outlive the controller.
        if (this.runnerRef !== null) {
            this.runnerRef.terminate();
            this.runnerRef = null;
        }

        // The drawing owner holds the canvas, so it must not outlive the controller either.
        if (this.renderRunnerRef !== null) {
            this.renderRunnerRef.terminate();
            this.renderRunnerRef = null;
        }

        // A button held across a reset must not keep turning the new graph.
        this.stopCameraHold();

        // A pending long press must not open a menu on a torn-down controller.
        this.cancelLongPress();

        if (this.contextMenu) {
            this.body.removeChild(this.contextMenu.element);
            this.contextMenu = null;
        }

        this.toggleEventListeners(false)
    }
}
