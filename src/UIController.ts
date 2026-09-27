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
} from "./Camera";
import { ContextMenu } from "./ContextMenu";
import { ForceDirectedGraph } from "./ForceDirectedGraph";
import { Graph } from "./Graph";
import { GraphFactory } from "./GraphFactory";
import { defaultGraphSpec, GraphSpec, specLabel } from "./GraphSpec";
import { GraphWizard } from "./GraphWizard";
import { K } from "./K";
import { point, Point2D } from "./Point2D";
import { point3 } from "./Point3D";
import { PhysicsRunner } from "./PhysicsRunner";
import { CameraView, Projector } from "./Projector";
import { RenderBackend, RenderRunner, RenderWorkerFactory } from "./RenderRunner";
import { handleNodeSelectionAttempt } from "./Selection";
import { State } from "./State";
import { Tag } from "./Tag";

/**
 * Builds the graph a `GraphSpec` describes. Supplied by the caller rather than
 * read from globals; the spec is passed by value because the chooser decides
 * which graph to build after the controller exists.
 */
export type GraphSource = (spec: GraphSpec) => Graph;

const defaultGraphSource: GraphSource = spec => new GraphFactory().build(spec);

/** The two keys a focused button activates on. Browsers synthesise a click for
 * both, which is why the hold paths must cancel the default.
 */
const isButtonActivationKey = (event: KeyboardEvent): boolean =>
	event.key === 'Enter' || event.key === ' ';

// A parsed console button: a rotation about one camera axis, or a dolly step.
// The two shapes are discriminated so the handlers can branch on `kind` without
// re-reading the element's attributes.
type CameraButton =
	| { kind: 'rotate'; axis: CameraAxis; direction: CameraDirection }
	| { kind: 'zoom'; zoom: CameraZoom };

export class UIController {

    /**
     * The setInterval handle when the fallback scheduler is in use, else null.
     * Where it exists, requestAnimationFrame drives the simulation instead.
     */
    timer: ReturnType<typeof setInterval> | null = null;

    /** The pending requestAnimationFrame handle, else null. */
    private frameHandle: number | null = null;

    /** Real time accumulated since the last fixed physics step, milliseconds. */
    private accumulator = 0;

    /** Timestamp of the previous frame; null before the first frame or after a wake. */
    private lastFrameTime: number | null = null;

    /** Consecutive steps whose largest travel was below the settle epsilon. */
    private quietSteps = 0;

    /** True once the layout has settled and stepping has stopped. */
    private settled = false;

    /**
     * True when the next animation frame must draw even if no step ran and the
     * camera did not move. Any change that is neither physics nor camera -
     * selection, drag, resize, graph swap - sets it through requestRedraw().
     */
    private needsRedraw = true;

    /**
     * The mutable camera values the last drawn frame used, in reusable scratch.
     * A frame is skipped while these still match the live camera, so a settled,
     * untouched scene issues no canvas work at all. Seeded from
     * `defaultCameraView()`, so the default camera has one definition.
     */
    private readonly lastDrawnCamera = cameraScratch();

    /** True while the simulation loop is scheduled, by either scheduler. */
    get running(): boolean {
        return this.frameHandle !== null || this.timer !== null;
    }

    readonly state: State = new State();

    private solverRef: ForceDirectedGraph | null = null;

    // The physics owner: an in-process solver, or a worker behind the same
    // interface. Null until the solver exists.
    private runnerRef: PhysicsRunner | null = null;

    // The drawing owner: the canvas's own context today, and a worker once Item 5
    // of the render-worker workplan lands. Null until initialize() (or the lazy
    // getter a handler can reach before it) builds one.
    private renderRunnerRef: RenderRunner | null = null;

    body: HTMLElement;
    canvas: HTMLCanvasElement;
    exportElement: HTMLElement;
    resetElement: HTMLElement;

    // What updateSelectionInfo() writes to; resolved by the entrypoint, not
    // looked up here by hardcoded ID.
    selectionInfoLabel: HTMLElement;
    selectionInfoList: HTMLElement;

    // The camera console's container; null in a fixture that builds a
    // controller without the console.
    cameraConsole: HTMLElement | null;

    // The console button currently held, or null. While set, each simulation
    // tick applies one small step, so holding turns or zooms smoothly.
    private heldButton: CameraButton | null = null;

    // One tick's worth of console rotation, radians; derived from a rate so the
    // felt speed survives a retune of the tick period.
    private static readonly ROTATION_PER_TICK =
        K.camera.rotateRadiansPerSecond * K.physics.timerTickPeriodMS / 1000;

    contextMenu: ContextMenu | null = null;

    // The open graph chooser, or null. Owned so terminate() can close it.
    wizard: GraphWizard | null = null;

    // The last chosen graph description, or null before the first choice; the
    // graph itself lives in the solver.
    spec: GraphSpec | null = null;

    // The cached selection: the renderer takes it as an argument instead of
    // rescanning the graph every frame. Refreshed by updateSelectionInfo(),
    // which every selection-changing path already calls.
    private selected: Tag | null = null;

    // The panel's current-graph line; it names the technical spec so the word
    // cloud's short chips never lose the identity of the loaded graph.
    currentGraphLabel: HTMLElement;

    // Logical (CSS-pixel) canvas size; all projected-plane <-> canvas mapping
    // uses these so pointer coordinates survive a scaled HiDPI backing store.
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
        // A test seam: the backend the runner wraps instead of the canvas's own
        // 2D context. Production always draws through the real one.
        private readonly renderBackend: RenderBackend | null = null,
        // A test seam: the worker the runner probes instead of the bundled one.
        private readonly renderWorkerFactory: RenderWorkerFactory | undefined = undefined
	) {
        this.body = body;
        this.canvas = canvas;
		this.exportElement = exportElement;
		this.resetElement = resetElement;
		this.selectionInfoLabel = selectionInfoLabel;
		this.selectionInfoList = selectionInfoList;
        this.currentGraphLabel = currentGraphLabel;
        this.cameraConsole = cameraConsole;
	}

    /** The graph a fresh initialize() shows: the last choice, else the default. */
    private initialGraph(): Graph {
        return this.makeGraph(this.spec ?? defaultGraphSpec());
    }

    // Built lazily so a handler that runs before initialize() (or a test that
    // never initializes) still has one.
    get solver(): ForceDirectedGraph {
        if (this.solverRef === null)
            this.solverRef = new ForceDirectedGraph(this.initialGraph());

        return this.solverRef;
    }

    /** The physics owner, built lazily alongside the solver. */
    get runner(): PhysicsRunner {
        if (this.runnerRef === null)
            this.runnerRef = new PhysicsRunner(this.solver);

        return this.runnerRef;
    }

    /** The drawing owner, built lazily alongside the solver. */
    get renderRunner(): RenderRunner {
        if (this.renderRunnerRef === null)
            this.renderRunnerRef = this.createRenderRunner(this.solver.graph);

        return this.renderRunnerRef;
    }

    // The injected backend in tests, else a probed render worker, else the
    // canvas's own context. A backend that becomes ready later asks for the
    // redraw through onReady, so the controller's private needsRedraw stays
    // private.
    private createRenderRunner(graph: Graph): RenderRunner {
        const onReady = () => this.requestRedraw();

        if (this.renderBackend !== null)
            return RenderRunner.over(this.renderBackend, onReady);

        const runner = RenderRunner.create(this.canvas, onReady, {
            graph,
            workerFactory: this.renderWorkerFactory,
        });

        // entrypoint() refuses to start when the canvas can neither transfer nor
        // give a context, so this is the impossible path.
        if (runner === null)
            throw new Error("UIController: the canvas can neither transfer to an OffscreenCanvas nor give a 2d context");

        return runner;
    }

	onMouseOut = () => {
		this.state.reset();
	};

	onMouseMove = (event: MouseEvent) => {

		// A drag or an orbit is interaction, so a settled layout starts moving again.
		if (this.state.b0Down || this.state.b1Down)
			this.wake();

		if (this.state.b0Down) {

			// Left-drag: each selected node follows the cursor in the view
			// plane through its own depth, the exactly invertible policy. A
			// culled node has no usable depth, so it drags on the near plane.
			const mxy = this.getMousePos(this.canvas, event);
			const projector = this.projector();

			for (const vertex of this.solver.graph.vertices) {

				if (!vertex.isSelected)
					continue;

				const depth = projector.isCulled(vertex.depth)
					? projector.camera.nearPlane
					: vertex.depth;

				vertex.position = projector.unproject(mxy, depth);
			}

			// Writing positions is neither a step nor a camera move, and a frame
			// whose accumulator is below one period runs no step, so without this
			// the drag would freeze between ticks.
			this.requestRedraw();
		}
		else if (this.state.b1Down) {

			// Middle-drag orbits; Shift+middle-drag pans the camera target. The
			// modifier is read per move, so it can change mid-drag.
			const mxy = this.getMousePos(this.canvas, event);

			if (event.shiftKey)
				this.panCameraTo(mxy);
			else
				this.orbitTo(mxy);
		}
	};

	/**
	 * The previous middle-drag anchor, or null after seeding it from the first
	 * move of a gesture. Orbit and Shift+pan consume the anchor identically, so
	 * the "first move seeds and returns, later moves consume-and-restore"
	 * lifecycle lives here once.
	 */
	private takeDragAnchor(mxy: Point2D): Point2D | null {

		const last = this.state.lastMiddleDragPos;

		if (last == null) {
			this.state.lastMiddleDragPos = mxy;
			return null;
		}

		this.state.lastMiddleDragPos = mxy;
		return last;
	};

	// Orbit by the pointer delta since the anchor. The live camera lives in
	// State, so reset() rebuilds the graph without losing the angle.
	orbitTo = (mxy: Point2D) => {

		const last = this.takeDragAnchor(mxy);

		if (last === null)
			return;

		this.state.camera.orbit(mxy.x - last.x, mxy.y - last.y);
	};

	// Shift+middle-drag pans the camera target (D4): the pointer delta is
	// unprojected at the target's depth, and node positions are never touched.
	panCameraTo = (mxy: Point2D) => {

		const last = this.takeDragAnchor(mxy);

		if (last === null)
			return;

		const projector = this.projector();

		// The target's depth is `distance`, so this slides the plane through
		// the target.
		const depth = this.state.camera.distance;

		const now = projector.unproject(mxy, depth);
		const before = projector.unproject(last, depth);

		this.state.camera.panBy(
			point3(now.x - before.x, now.y - before.y, now.z - before.z)
		);
	};

	// Wheel dollies; `focalLength` is constant by design, so only the distance
	// changes, clamped above the near plane.
	onWheel = (event: WheelEvent) => {

		const notches = event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0;

		if (notches !== 0) {
			this.state.camera.dolly(notches);

			// A dolly is interaction, so a settled layout starts moving again.
			this.wake();
		}

		// The canvas fills the viewport; the wheel must not scroll the page.
		event.preventDefault();
	};

	// Parse a console button out of an event target. The container is stable, so
	// one delegated listener per event type serves every button, and the data
	// attributes name the direction (and, for a rotation, the axis).
	private cameraButton(target: EventTarget | null): CameraButton | null {

		const element = this.consoleButton(target);

		if (!element)
			return null;

		// The guards are the runtime half of the CameraAxis/CameraDirection/
		// CameraZoom vocabularies, so this cannot accept a value a type does not
		// name. A zoom is tried first: its button carries no axis or direction.
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

	// The button carrying the console data attributes, from `target` upwards: a
	// rotate button holds an SVG icon, so a press can land on the icon rather
	// than the button itself. The walk stops at the console, so a press on the
	// panel around it finds nothing.
	private consoleButton(target: EventTarget | null): HTMLElement | null {

		let element = target as HTMLElement | null;

		while (element && element !== this.cameraConsole) {

			if (typeof element.getAttribute === 'function' &&
				(element.getAttribute('data-axis') !== null ||
					element.getAttribute('data-zoom') !== null))
				return element;

			element = element.parentElement;
		}

		return null;
	}

	// One step of a console button: a small rotation, or one dolly notch.
	// Anticlockwise is the right-hand positive sense about the axis, so it is the
	// positive step; a zoom names its direction, so the camera owns that sign.
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

	// One tick's worth of a held button. Called from onTimerTick() and the
	// animation frame before the step, so the hold rides the render loop.
	onCameraHoldTick = () => {

		if (this.heldButton)
			this.applyCameraButton(this.heldButton);
	};

	// Begin a hold: one step at once so a tap still moves, then one per tick.
	private startCameraHold(button: CameraButton): void {

		this.heldButton = button;
		this.applyCameraButton(button);

		// A console step is interaction, so a settled layout starts moving again.
		this.wake();
	}

	/** Stop any held console button. Safe when nothing is held. */
	stopCameraHold = () => {
		this.heldButton = null;
	};

	// A press on a console button. The pointer can be released anywhere, so the
	// release half is watched on the window (see toggleEventListeners).
	onCameraPointerDown = (event: PointerEvent) => {

		// The panel is a drag handle: DragController captures the pointer on
		// pointerdown, so a press that starts on the console must not reach it.
		event.stopPropagation();

		const button = this.cameraButton(event.target);

		if (button)
			this.startCameraHold(button);
	};

	onCameraPointerUp = () => {
		this.stopCameraHold();
	};

	/**
	 * Keyboard hold: Enter or Space starts a rotation that keyup ends. The
	 * default action is cancelled so the browser does not also synthesise a
	 * click for the same press, which would double-count it.
	 */
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

	// Pointer and key activation both produce a click, and the hold paths
	// cover those; `detail === 0` is the one click that still steps.
	onCameraButtonClick = (event: MouseEvent) => {

		if (event.detail !== 0)
			return;

		const button = this.cameraButton(event.target);

		if (button)
			this.applyCameraButton(button);
	};

	/** The projection for the current canvas size and live camera. */
	projector(): Projector {
		return Projector.forCanvas(this.width, this.height, this.state.camera);
	}

	onMouseDown = (event: MouseEvent) => {

		this.hideContextMenu();

		// Any press is interaction, so a settled layout starts moving again.
		this.wake();

		var mxy = this.getMousePos(
			this.canvas, 
			event
		);
		
		if (event.button === 0) {

			// macOS Ctrl+click is the context-menu gesture, and the browser reports
			// it as a primary press with ctrlKey set. Flag it so the contextmenu
			// event that follows opens the menu, and do not touch the selection.
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

	// Right-click, or the Ctrl+click gesture macOS reports as a primary press. The
	// native menu is always suppressed; ours opens only for one of those two, so a
	// programmatic event cannot.
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

	// Keyboard path to the actions menu: Shift+F10 and the context-menu key.
	// The menu handles Escape while focused; this covers focus on the canvas.
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

		// clientX/clientY and the bounding rect share the viewport frame, so
		// the subtraction survives scrolling, transforms and devicePixelRatio.
		const rect = cnvs.getBoundingClientRect();

		return point(
			evt.clientX - rect.left,
			evt.clientY - rect.top
		)
	};

	onMouseUp = (event: MouseEvent) => {
	
		if (event.button === 0) {
			this.state.b0Down = false;

			// A Ctrl+click flagged b2Down as a context-menu press; release it too.
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

	onExport = (event?: MouseEvent) => {

		// The link is inside the overlay panel and carries an href, so the
		// default navigation must be suppressed or the page reloads.
		event?.preventDefault();

		// The backend produces the PNG (a worker's convertToBlob, or the
		// element's own toDataURL). A `data:` URL cannot be opened by top-frame
		// navigation, so the download rides an object URL instead: no popup and
		// no blocked navigation.
		void this.renderRunner.exportPng().then(blob => {

			const url = URL.createObjectURL(blob);

			const link = document.createElement('a');
			link.href = url;
			link.download = 'cuniform.png';
			link.click();

			// Revoking synchronously can cancel the download in some browsers.
			setTimeout(() => URL.revokeObjectURL(url), 0);
		}).catch(error => {
			// A worker that is still probing cannot export; a click that early
			// must not surface an unhandled rejection.
			console.error("export failed", error);
		});
	};

	// Opens the chooser and leaves the running graph, timer, listeners, context
	// menu and camera alone until a choice is made; cancelling changes nothing.
	onReset = (event?: MouseEvent) => {

		event?.preventDefault();

		this.openGraphWizard();

		return false;
	};

	// Replace the simulated graph in place: the timer, listeners, context menu
	// and camera are untouched, only the graph the solver steps changes.
	loadGraph = (graph: Graph) => {

		this.solverRef = new ForceDirectedGraph(graph);

		// Re-initialise the physics owner, dropping any in-flight worker message
		// from the graph that was just replaced.
		if (this.runnerRef !== null)
			this.runnerRef.setGraph(this.solverRef);

		// The drawing owner's worker mirror is keyed to a graph too: a swap
		// re-initialises it and bumps its generation.
		if (this.renderRunnerRef !== null)
			this.renderRunnerRef.setGraph(this.solverRef.graph);

		// A swap happens between gestures, so no button may still be held.
		this.state.reset();

		// A fresh graph must never inherit the previous layout's settled state.
		this.wake();

		this.updateSelectionInfo();
	};

	private applyGraphSpec = (spec: GraphSpec) => {

		this.spec = spec;
		this.loadGraph(this.makeGraph(spec));
		this.updateCurrentGraphLabel();
		this.closeGraphWizard();
	};

	// Open the chooser. The context menu is hidden first so the two overlays
	// can never be open together; the wizard is stored before it is opened so a
	// synchronous completion cannot leave a stale reference.
	openGraphWizard = () => {

		this.closeGraphWizard();
		this.hideContextMenu();

		this.wizard = new GraphWizard(this.body, {
			onComplete: this.applyGraphSpec,
			onCancel: this.closeGraphWizard,
			onDismiss: () => this.canvas.focus(),
			// First run: there is no previous graph to keep, so there is nothing
			// to cancel back to.
			dismissible: this.spec !== null,
			initialSpec: this.spec,
		});

		this.wizard.open();
	};

	closeGraphWizard = () => {

		if (this.wizard) {
			this.wizard.close();
			this.wizard = null;
		}
	};

	/** The panel's current-graph line: the technical name of the loaded graph. */
	private updateCurrentGraphLabel = () => {
		this.currentGraphLabel.innerHTML = specLabel(this.spec ?? defaultGraphSpec());
	};

	clearSelection = () => {
		this.solver.graph.clearSelection();
		this.updateSelectionInfo();
	};

	// One fixed tick, drawing included: the meaning tests and the setInterval
	// fallback depend on, so it never consults the settle state. It also
	// deliberately bypasses the idle-frame skip: this path steps on every
	// interval and never settles, so skipping a draw would freeze the picture
	// while the physics kept moving.
	onTimerTick = () => {
		this.renderFrame(this.advanceOneTick());
	};

	// Physics for one fixed tick, without drawing. Returns the live camera, so
	// the draw resolves its projector from the same camera this step ran under
	// (invariant 2). A held console button turns or zooms the camera first.
	private advanceOneTick(): CameraView {

		this.onCameraHoldTick();

		const graph = this.solver.graph;

		// The pin is expressed as an index and a position, so it crosses to a
		// worker as data and the solver never reads browser state itself. The
		// cached selection is used here, so no O(N) scan runs per tick.
		const selected = this.state.b0Down ? this.selected : null;
		const pinnedIndex = selected === null ? -1 : graph.vertices.indexOf(selected);
		const pinnedPosition = pinnedIndex >= 0 ? graph.vertices[pinnedIndex].position : null;

		this.runner.step(
			pinnedIndex,
			pinnedPosition?.x ?? 0,
			pinnedPosition?.y ?? 0,
			pinnedPosition?.z ?? 0
		);

		// A worker answers asynchronously; this copies whatever it last reported
		// onto the tags before the backend projects. In-process it is current.
		this.runner.sync(graph);

		this.trackSettle();

		return this.state.camera;
	}

	private renderFrame(camera: CameraView = this.state.camera): void {

		// The backend projects and draws, so the main thread no longer has an
		// O(N) projection pass of its own; a worker does both in its own realm.
		const drawn = this.renderRunner.draw(
			this.solver.graph,
			camera,
			this.selected,
			this.width,
			this.height
		);

		// A backend that is not ready yet keeps the frame pending: consuming the
		// request here would leave the canvas blank until the next interaction.
		if (!drawn)
			return;

		// Record the view this frame drew with and consume any pending request, so
		// the next idle frame can be skipped. The record is scratch, not a copy.
		this.recordDrawnCamera(camera);
		this.needsRedraw = false;
	}

	/** Ask the next animation frame to draw even if nothing stepped or moved. */
	private requestRedraw(): void {
		this.needsRedraw = true;
	}

	// Overwrite the scratch fingerprint with `view`'s mutable values. Allocation
	// free: the orientation array is reused and the target Point3D is mutated.
	private recordDrawnCamera(view: CameraView): void {
		copyCameraView(view, this.lastDrawnCamera);
	}

	// Stop stepping once the layout has been quiet for settleFrames steps. Any
	// interaction calls wake() to start it again.
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
	
	// Attach or detach the whole listener set from one list, so the two
	// directions cannot drift; a listener added later cannot survive reset().
	private toggleEventListeners(attach: boolean) {

		// The handlers mix MouseEvent and no-argument callbacks, so the
		// parameter is left open.
		const bind = (
			target: EventTarget,
			type: string,
			fn: (event: any) => void
		) => {
			if (attach)
				target.addEventListener(type, fn);
			else
				target.removeEventListener(type, fn);
		};

		bind(this.canvas, "mousemove", this.onMouseMove);
		bind(this.canvas, "mousedown", this.onMouseDown);
		bind(this.canvas, "mouseup", this.onMouseUp);
		bind(this.canvas, "mouseout", this.onMouseOut);
		bind(this.canvas, "contextmenu", this.onContextMenu);
		bind(this.canvas, "keydown", this.onKeyDown);
		bind(this.canvas, "wheel", this.onWheel);

		bind(this.exportElement, "click", this.onExport);

		bind(this.resetElement, "click", this.onReset);

		// One delegated listener per event type on the console container, plus
		// the guard that stops a press on a button from starting a panel drag.
		// A held button is released wherever the pointer is, so pointerup is
		// watched on the window; blur covers the lost focus case.
		//
		if (this.cameraConsole) {
			bind(this.cameraConsole, "pointerdown", this.onCameraPointerDown);
			bind(this.cameraConsole, "keydown", this.onCameraKeyDown);
			bind(this.cameraConsole, "keyup", this.onCameraKeyUp);
			bind(this.cameraConsole, "click", this.onCameraButtonClick);

			bind(window, "pointerup", this.onCameraPointerUp);
			bind(window, "pointercancel", this.onCameraPointerUp);
			bind(window, "blur", this.onCameraPointerUp);
		}

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

	/** Re-read the graph's selection into the cache. One home for "selection changed". */
	private refreshSelection = () => {
		this.selected = this.solver.graph.selectedVertex();
	};

	updateSelectionInfo = () => {
	
		this.refreshSelection();

		// Every selection-changing path funnels through here (a click, a clear, a
		// graph swap), and none of them is a step or a camera move, so the frame
		// would otherwise be skipped. This is the one home for that request.
		this.requestRedraw();

		const selectedNode = this.selected;
		
		const selectedNodeInfoLabel = this.selectionInfoLabel;
		const list = this.selectionInfoList;
		
		while (list.children.length > 0) {
			const first = list.firstChild;
			if (!first)
				break;
			list.removeChild(first);
		}
	
		if (!selectedNode) {
			selectedNodeInfoLabel.innerHTML = 'Click on a node to select...';
		}
		else {
			selectedNodeInfoLabel.innerHTML = selectedNode.label;
	
			this.solver.graph.neighbours(selectedNode)
			.forEach(
				neighbour => {
					const neighbourString = neighbour.label;
				
					const item = document.createElement('li');
					item.innerHTML = neighbourString;
					
					list.appendChild(item);
				}
			)
		}
	};

	// Fill the viewport. The backend sizes the backing store in device pixels so
	// lines stay sharp on HiDPI, and applies the transform that keeps drawing in
	// CSS pixels; the element always carries the logical CSS size.
	resizeCanvas = () => {

		const width = this.body.clientWidth;
		const height = this.body.clientHeight;

		const dpr = window.devicePixelRatio || 1;

		this.width = width;
		this.height = height;

		this.canvas.style.width = `${width}px`;
		this.canvas.style.height = `${height}px`;

		// The backend owns the backing store: with a worker the element is a
		// placeholder whose width/height no longer govern anything.
		this.renderRunner.resize(width, height, dpr);
	};

	onResize = () => {
		this.resizeCanvas();

		// A resize is interaction, so a settled layout starts moving again.
		this.wake();

		// The backing store was just re-created, so a redraw is mandatory no matter
		// what the camera or the settle state say.
		this.requestRedraw();
	};

	// The browser loop: requestAnimationFrame where it exists, else the original
	// fixed interval. The fallback keeps the pre-Plan-6 behaviour exactly.
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

	// One animation frame: run the fixed steps the accumulator says are due, up to
	// the per-frame cap, then draw only if something actually changed: a step ran,
	// a requestRedraw() was posted, or the live camera no longer matches the last
	// drawn view. A settled, untouched scene therefore issues no canvas work,
	// leaving the previous frame on the canvas.
	onAnimationFrame = (timestamp: number): void => {

		this.frameHandle = null;

		// The first frame establishes the clock; there is no elapsed time yet.
		const elapsed = this.lastFrameTime === null ? 0 : timestamp - this.lastFrameTime;
		this.lastFrameTime = timestamp;

		// A backwards or non-numeric clock must not run the simulation.
		this.accumulator += elapsed > 0 ? elapsed : 0;

		const period = K.physics.timerTickPeriodMS;
		let steps = 0;

		while (this.accumulator >= period && steps < K.physics.maxStepsPerFrame) {

			// A settled layout has nothing left to step, so drop the backlog
			// rather than run it - unless a console button is held, whose
			// rotation or zoom rides this fixed clock and must keep turning.
			if (this.settled && this.heldButton === null) {
				this.accumulator = 0;
				break;
			}

			this.accumulator -= period;
			steps++;

			// Once settled, only the camera is still moving. Turning or zooming
			// it without re-stepping the solved layout is what lets a hold
			// outlive the settle without paying for the physics again.
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

		// Idempotent: tear down any previous run first, so a second initialize()
		// cannot double the timer, the listeners or the context menu.
		this.terminate();

		// Reset the existing state object rather than allocating a new one, so
		// handlers holding a reference see the cleared flags.
		this.state.reset();

		// The default placeholder guarantees a valid graph, so no render path
		// needs a "no graph" special case; the first-run chooser replaces it.
		this.solverRef = new ForceDirectedGraph(this.initialGraph());

		// One drawing owner for this run, built before resizeCanvas() draws
		// through it: a probed render worker, the canvas's own context, or the
		// injected test backend. It is handed the graph so a worker mirror is
		// initialised before the first frame.
		this.renderRunnerRef = this.createRenderRunner(this.solverRef.graph);

		this.resizeCanvas();

		// The first drawn frame is not optional, whatever the camera scratch says.
		this.needsRedraw = true;

		// One physics owner for this run: a worker when the browser has one, else
		// the in-process solver.
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

		// Stop the physics owner too: a worker must not outlive the controller.
		if (this.runnerRef !== null) {
			this.runnerRef.terminate();
			this.runnerRef = null;
		}

		// The drawing owner holds the canvas: a render worker must not outlive the
		// controller either.
		if (this.renderRunnerRef !== null) {
			this.renderRunnerRef.terminate();
			this.renderRunnerRef = null;
		}

		// A button held across a reset must not keep turning the new graph.
		this.stopCameraHold();

		// A chooser must not outlive the controller that owns it.
		this.closeGraphWizard();

		if (this.contextMenu) {
			this.body.removeChild(this.contextMenu.element);
			this.contextMenu = null;
		}

		this.toggleEventListeners(false)
	}	
}
