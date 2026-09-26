import { CameraAxis } from "./Camera";
import { ContextMenu } from "./ContextMenu";
import { ForceDirectedGraph } from "./ForceDirectedGraph";
import { Graph } from "./Graph";
import { GraphFactory } from "./GraphFactory";
import { defaultGraphSpec, GraphSpec, specLabel } from "./GraphSpec";
import { GraphWizard } from "./GraphWizard";
import { K } from "./K";
import { point, Point2D } from "./Point2D";
import { point3 } from "./Point3D";
import { Projector } from "./Projector";
import { render } from "./Renderer";
import { handleNodeSelectionAttempt } from "./Selection";
import { State } from "./State";

/**
 * Builds the graph a `GraphSpec` describes. Supplied by the caller so the
 * controller's real dependencies are visible in its signature instead of being
 * read from globals.
 *
 * The spec is passed by value rather than captured, because the chooser is what
 * decides which graph to build and it does so after the controller exists.
 */
export type GraphSource = (spec: GraphSpec) => Graph;

const defaultGraphSource: GraphSource = spec => new GraphFactory().build(spec);

/** The direction a console button rotates the camera. */
type CameraDirection = 'cw' | 'acw';

/** A parsed console button: which camera axis and which way. */
interface CameraButton {
    axis: CameraAxis;
    direction: CameraDirection;
}

/**
 * The canvas as a PNG Blob. Browsers refuse top-frame navigation to a `data:`
 * URL, so the canvas image has to be carried by a `blob:` object URL instead;
 * this builds the Blob that object URL points at. Module scope because it is a
 * pure canvas -> bytes conversion with no controller state behind it.
 */
function pngBlob(canvas: HTMLCanvasElement): Blob {
	const [header, base64] = canvas.toDataURL('image/png').split(',');
	const mime = /:(.*?);/.exec(header)?.[1] ?? 'image/png';

	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i++)
		bytes[i] = binary.charCodeAt(i);

	return new Blob([bytes], { type: mime });
}

export class UIController {

    timer: ReturnType<typeof setInterval> | null = null;

    /** Controller-owned pointer state; no longer a window global. */
    readonly state: State = new State();

    private solverRef: ForceDirectedGraph | null = null;

    body: HTMLElement;
    canvas: HTMLCanvasElement;
    context2D: CanvasRenderingContext2D;
    exportElement: HTMLElement;
    resetElement: HTMLElement;

    /**
     * The two elements updateSelectionInfo() writes to. Resolved and
     * null-checked by the entrypoint, rather than looked up here by hardcoded
     * ID.
     */
    selectionInfoLabel: HTMLElement;
    selectionInfoList: HTMLElement;

    /**
     * The camera console's container. Its buttons are static chrome in
     * web/index.html, so one delegated listener per event type is enough;
     * null in a fixture that builds a controller without the console.
     */
    cameraConsole: HTMLElement | null;

    /**
     * The console button currently held, or null. While it is set, each
     * simulation tick applies one small rotation step, so holding a button
     * turns the view smoothly at the render rate instead of jumping a fixed
     * angle on the press.
     */
    private heldRotation: CameraButton | null = null;

    /**
     * One tick's worth of console rotation, radians. Derived from a rate so the
     * felt speed does not change if the tick period is retuned.
     */
    private static readonly ROTATION_PER_TICK =
        K.camera.rotateRadiansPerSecond * K.physics.timerTickPeriodMS / 1000;

    contextMenu: ContextMenu | null = null;

    /** The open graph chooser, or null. Owned so terminate() can close it. */
    wizard: GraphWizard | null = null;

    /**
     * The last chosen graph description, or null before the first choice. It is
     * what a fresh initialize() rebuilds and what seeds the chooser's random
     * step; the graph itself lives in the solver.
     */
    spec: GraphSpec | null = null;

    /**
     * The panel's current-graph line. It names the technical spec - the full
     * systematic name for a molecule - so the word cloud's short chips never
     * lose the identity of the loaded graph.
     */
    currentGraphLabel: HTMLElement;

    /**
     * Logical (CSS-pixel) canvas size. All projected-plane <-> canvas mapping
     * uses these so pointer coordinates stay correct when the backing store is
     * scaled for a HiDPI display.
     */
    width: number = 0;
    height: number = 0;

	constructor(
        body: HTMLElement,
        canvas: HTMLCanvasElement, 
        context2D: CanvasRenderingContext2D,
		exportElement: HTMLElement, 
		resetElement: HTMLElement,
		selectionInfoLabel: HTMLElement,
		selectionInfoList: HTMLElement,
        currentGraphLabel: HTMLElement,
        cameraConsole: HTMLElement | null,
        private readonly makeGraph: GraphSource = defaultGraphSource
	) {
        this.body = body;
        this.canvas = canvas;
        this.context2D = context2D;
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

    /**
     * The live solver. Built lazily so a handler that runs before initialize()
     * (and a test that never initializes) still has one; initialize() replaces
     * it with the last chosen spec, and loadGraph() replaces it in place.
     */
    get solver(): ForceDirectedGraph {
        if (this.solverRef === null)
            this.solverRef = new ForceDirectedGraph(this.initialGraph());

        return this.solverRef;
    }

	onMouseOut = () => {
		this.state.b0Down = false;
		this.state.b1Down = false;
		this.state.b2Down = false;
		this.state.lastMiddleDragPos = null;
	};

	onMouseMove = (event: MouseEvent) => {

		if (this.state.b0Down) {

			// Left-drag: every selected node follows the cursor in the view
			// plane through its own current depth. A screen point is a ray in
			// 3D, so the plane through the node's depth is the policy that is
			// exactly invertible, matches the pixel under the cursor, and never
			// teleports the node in depth. A culled node has no usable depth,
			// so it drags on the near plane.
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
		}
		else if (this.state.b1Down) {

			// Middle-drag orbits; Shift+middle-drag pans the camera target.
			// The modifier is read on every move, so it can be pressed or
			// released mid-drag.
			const mxy = this.getMousePos(this.canvas, event);

			if (event.shiftKey)
				this.panCameraTo(mxy);
			else
				this.orbitTo(mxy);
		}
	};

	/**
	 * Orbit the camera by the pointer delta since the anchor. The live camera
	 * lives in State, so a reset() rebuilds the graph without losing the angle.
	 */
	orbitTo = (mxy: Point2D) => {

		const last = this.state.lastMiddleDragPos;

		// First move of a gesture establishes the anchor; there is no delta yet.
		if (last == null) {
			this.state.lastMiddleDragPos = mxy;
			return;
		}

		this.state.camera.orbit(mxy.x - last.x, mxy.y - last.y);
		this.state.lastMiddleDragPos = mxy;
	};

	/**
	 * Shift+middle-drag pans the camera target (D4). The pointer delta is
	 * converted to projected-plane model units and unprojected at the target's
	 * depth, so the model under the cursor tracks the cursor. Node positions are
	 * never touched, so a pan cannot perturb the simulation.
	 */
	panCameraTo = (mxy: Point2D) => {

		const last = this.state.lastMiddleDragPos;

		// First move of a gesture establishes the anchor; there is no delta yet.
		if (last == null) {
			this.state.lastMiddleDragPos = mxy;
			return;
		}

		const projector = this.projector();

		// The target's depth is `distance`, so this unprojects onto the plane
		// through the target - the plane a pan should slide.
		const depth = this.state.camera.distance;

		const now = projector.unproject(mxy, depth);
		const before = projector.unproject(last, depth);

		this.state.camera.panBy(
			point3(now.x - before.x, now.y - before.y, now.z - before.z)
		);

		this.state.lastMiddleDragPos = mxy;
	};

	/**
	 * Wheel dollies the camera. `focalLength` is constant by design, so the
	 * wheel changes only the distance, clamped above the near plane.
	 */
	onWheel = (event: WheelEvent) => {

		const notches = event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0;

		if (notches !== 0)
			this.state.camera.dolly(notches);

		// The canvas fills the viewport; never let the wheel scroll the page
		// out from under the graph.
		event.preventDefault();
	};

	/**
	 * Parse a console button out of an event target. One delegated listener per
	 * event type serves all six buttons: the container is stable across
	 * presses, so the handler count is fixed, and the data attributes on the
	 * pressed button name the camera axis and direction. Anything else in the
	 * section - the heading, the container itself - is not a rotation.
	 */
	private cameraButton(target: EventTarget | null): CameraButton | null {

		const element = target as HTMLElement | null;

		if (!element || typeof element.getAttribute !== 'function')
			return null;

		const axis = element.getAttribute('data-axis');
		const direction = element.getAttribute('data-direction');

		if (axis !== 'x' && axis !== 'y' && axis !== 'z')
			return null;

		if (direction !== 'cw' && direction !== 'acw')
			return null;

		return { axis, direction };
	}

	/**
	 * Apply one tick of rotation for `button`. Anticlockwise is the right-hand
	 * positive sense about the axis, so it is the positive step.
	 */
	private rotateBy(button: CameraButton): void {

		const step = button.direction === 'acw'
			? UIController.ROTATION_PER_TICK
			: -UIController.ROTATION_PER_TICK;

		this.state.camera.rotateLocal(button.axis, step);
	}

	/**
	 * One tick's worth of a held button. Called from onTimerTick() before the
	 * step, so the projection and the draw that follow already see the new
	 * view: the rotation rides the render loop, which is what makes a held
	 * button look smooth rather than stepped.
	 */
	onCameraRotateTick = () => {

		if (this.heldRotation)
			this.rotateBy(this.heldRotation);
	};

	/**
	 * Begin rotating: one step at once so a tap still moves, then one more per
	 * tick until released.
	 */
	private startCameraHold(button: CameraButton): void {

		this.heldRotation = button;
		this.rotateBy(button);
	}

	/** Stop any held rotation. Safe when nothing is held. */
	stopCameraHold = () => {
		this.heldRotation = null;
	};

	/**
	 * A press on a console button. The pointer can be released anywhere, so the
	 * release half is watched on the window (see toggleEventListeners) rather
	 * than on the button.
	 */
	onCameraPointerDown = (event: PointerEvent) => {

		// The panel is a drag handle: DragController captures the pointer on
		// pointerdown, which would retarget the compatibility click away from a
		// button. A press that starts on the console must not reach the panel.
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

		if (event.key !== 'Enter' && event.key !== ' ')
			return;

		// Auto-repeat would restart the step on every repeat event; the tick
		// handler is what advances a held button.
		if (event.repeat)
			return;

		const button = this.cameraButton(event.target);

		if (!button)
			return;

		event.preventDefault();
		this.startCameraHold(button);
	};

	onCameraKeyUp = (event: KeyboardEvent) => {

		if (event.key !== 'Enter' && event.key !== ' ')
			return;

		event.preventDefault();
		this.stopCameraHold();
	};

	/**
	 * Pointer and key activation both produce a click, and the hold paths
	 * already account for those, so a click with a click count is ignored. A
	 * click with `detail === 0` is the assistive-technology or programmatic
	 * activation, which has no pointer or key events of its own, so it is the
	 * one click that still rotates.
	 */
	onCameraButtonClick = (event: MouseEvent) => {

		if (event.detail !== 0)
			return;

		const button = this.cameraButton(event.target);

		if (button)
			this.rotateBy(button);
	};

	/** The projection for the current canvas size and live camera. */
	projector(): Projector {
		return Projector.forCanvas(this.width, this.height, this.state.camera);
	}

	onMouseDown = (event: MouseEvent) => {

		this.hideContextMenu();

		var mxy = this.getMousePos(
			this.canvas, 
			event
		);
		
		if (event.button == 0) {
			this.state.b0Down = true;		
				
			const selectionChanged = handleNodeSelectionAttempt(
				this.solver.graph,
				mxy,
				this.projector()
			);
			if (selectionChanged == true)
				this.updateSelectionInfo();
		}
		else if (event.button == 1) {
			// Middle button starts an orbit or pan; prevent autoscroll.
			this.state.b1Down = true;
			this.state.lastMiddleDragPos = mxy;
			event.preventDefault();
		}
		else if (event.button == 2) {
			this.state.b2Down = true;
		}
	}

	/**
	 * Right-click. The native browser menu is always suppressed; ours is shown
	 * only while the right button is actually held, so a programmatic
	 * contextmenu event cannot open it.
	 */
	onContextMenu = (event: MouseEvent) => {

		event.preventDefault();

		if (!this.state.b2Down)
			return;

		this.openContextMenu(event.clientX, event.clientY);
	};

	openContextMenu = (x: number, y: number) => {
		if (this.contextMenu)
			this.contextMenu.open(x, y);
	};

	/**
	 * Keyboard path to the actions menu. Shift+F10 and the dedicated
	 * context-menu key are the standard ways to open a context menu without a
	 * pointer; escaping is handled by the menu itself while it has focus, and
	 * here for the case where focus is still on the canvas.
	 */
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

		// clientX/clientY are viewport coordinates, and the canvas's bounding
		// rect is measured in the same frame, so subtracting it is correct
		// under scrolling, CSS transforms and devicePixelRatio. The old
		// offsetParent walk only worked because the body cannot scroll, and it
		// double-counted scroll by adding pageXOffset/pageYOffset on top.
		const rect = cnvs.getBoundingClientRect();

		// return relative mouse position
		//
		return point(
			evt.clientX - rect.left,
			evt.clientY - rect.top
		)
	};

	onMouseUp = (event: MouseEvent) => {
	
		if (event.button == 0) {
			this.state.b0Down = false;
			this.updateSelectionInfo();
		}
		else if (event.button == 1) {
			this.state.b1Down = false;
			this.state.lastMiddleDragPos = null;
		}
		else if (event.button == 2)
			this.state.b2Down = false;
	}

	// reset, export handlers

	onExport = (event?: MouseEvent) => {

		// The link sits inside the overlay panel and carries an href, so the
		// default navigation has to be suppressed or the page reloads.
		event?.preventDefault();

		// A `data:` URL cannot be opened by top-frame navigation in any current
		// browser, so the PNG is downloaded from an object URL instead: no
		// popup, no blank tab and no blocked navigation.
		const url = URL.createObjectURL(pngBlob(this.canvas));

		const link = document.createElement('a');
		link.href = url;
		link.download = 'cuniform.png';
		link.click();

		// Revoking synchronously can cancel the download in some browsers; one
		// task's delay lets the navigation start first.
		setTimeout(() => URL.revokeObjectURL(url), 0);
	};

	/**
	 * Reset no longer rebuilds the graph. It opens the chooser, and the running
	 * graph, the timer, the listeners, the context menu and the camera are all
	 * left alone until a choice is actually made. A cancelled chooser changes
	 * nothing.
	 */
	onReset = (event?: MouseEvent) => {

		event?.preventDefault();

		this.openGraphWizard();

		return false;
	};

	/**
	 * Replace the simulated graph in place. This is the reset path: the timer,
	 * the listeners, the context menu and the camera are all left alone, only
	 * the graph the solver steps changes.
	 *
	 * `initialize()` keeps its lifecycle meaning - attach the listeners, build
	 * the menu, start the timer - so changing content never re-registers a
	 * listener.
	 */
	loadGraph = (graph: Graph) => {

		this.solverRef = new ForceDirectedGraph(graph);

		// A swap happens between gestures, so no button may still be held.
		this.state.b0Down = false;
		this.state.b1Down = false;
		this.state.b2Down = false;
		this.state.lastMiddleDragPos = null;

		this.updateSelectionInfo();
	};

	private applyGraphSpec = (spec: GraphSpec) => {

		this.spec = spec;
		this.loadGraph(this.makeGraph(spec));
		this.updateCurrentGraphLabel();
		this.closeGraphWizard();
	};

	/**
	 * Open the chooser. The context menu is hidden first, so the two overlays
	 * can never be open together, and the wizard is stored before it is opened
	 * so a synchronous completion cannot leave a stale reference.
	 */
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

	onTimerTick = () => {
		// A held console button turns the camera first, so the projection taken
		// below and the draw that follows both use the new view.
		this.onCameraRotateTick();

		// Advance the physics, then draw. The solver is told which node is
		// pinned via a predicate, so it never reads browser state itself; the
		// camera reaches it only as a value object, so it stays DOM-free.
		this.solver.step(
			this.width,
			this.height,
			tag => tag.isSelected && this.state.b0Down,
			this.projector()
		);
		render(this.context2D, this.solver.graph);
	};
	
	/**
	 * Attach or detach the whole listener set from one list, so the two
	 * directions cannot drift. Deriving detach from the same lines as attach is
	 * what stops a newly added listener from surviving reset(), which the suite
	 * has already been bitten by.
	 */
	private toggleEventListeners(attach: boolean) {

		// The handlers are a mix of MouseEvent and no-argument callbacks, so the
		// parameter is left open here; the per-type addEventListener overloads
		// that used to enforce this are gone with the duplicated lists.
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

		// mouse
		//
		bind(this.canvas, "mousemove", this.onMouseMove);
		bind(this.canvas, "mousedown", this.onMouseDown);
		bind(this.canvas, "mouseup", this.onMouseUp);
		bind(this.canvas, "mouseout", this.onMouseOut);
		bind(this.canvas, "contextmenu", this.onContextMenu);
		bind(this.canvas, "keydown", this.onKeyDown);
		bind(this.canvas, "wheel", this.onWheel);

		// export link
		//
		bind(this.exportElement, "click", this.onExport);

		// reset link
		//
		bind(this.resetElement, "click", this.onReset);

		// camera console: one delegated listener per event type on the
		// container, plus the guard that keeps a press on a button from
		// starting a panel drag. Skipped when the console is absent, on attach
		// and detach alike.
		//
		if (this.cameraConsole) {
			bind(this.cameraConsole, "pointerdown", this.onCameraPointerDown);
			bind(this.cameraConsole, "keydown", this.onCameraKeyDown);
			bind(this.cameraConsole, "keyup", this.onCameraKeyUp);
			bind(this.cameraConsole, "click", this.onCameraButtonClick);
		}

		// A held console button is released wherever the pointer happens to
		// be, so the release half is watched on the window. blur covers the
		// pointerup the browser never delivers when the window loses focus.
		//
		if (this.cameraConsole) {
			bind(window, "pointerup", this.onCameraPointerUp);
			bind(window, "pointercancel", this.onCameraPointerUp);
			bind(window, "blur", this.onCameraPointerUp);
		}

		// viewport
		//
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

	updateSelectionInfo = () => {
	
		const selectedNode = this.solver.graph.selectedVertex();
		
		const selectedNodeInfoLabel = this.selectionInfoLabel;
		const list = this.selectionInfoList;
		
		// clear current items
		while (list.children.length > 0) {
			const first = list.firstChild;
			if (!first)
				break;
			list.removeChild(first);
		}
	
		// no selection => discard old info
		//
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

	/**
	 * Fill the viewport. CSS keeps the canvas element full-screen; the backing
	 * store is sized here in device pixels so lines stay sharp on HiDPI
	 * displays, while drawing coordinates remain CSS pixels thanks to the
	 * context transform.
	 */
	resizeCanvas = () => {

		const width = this.body.clientWidth;
		const height = this.body.clientHeight;

		const dpr = window.devicePixelRatio || 1;

		this.width = width;
		this.height = height;

		this.canvas.width = width * dpr;
		this.canvas.height = height * dpr;
		this.canvas.style.width = `${width}px`;
		this.canvas.style.height = `${height}px`;

		this.context2D.setTransform(dpr, 0, 0, dpr, 0, 0);
	};

	/** Keep the graph mapped to the viewport when the window is resized. */
	onResize = () => {
		this.resizeCanvas();
	};

	initialize = () => {

		// Idempotent: tear down any previous run before starting a new one, so
		// a second initialize() without terminate() cannot double the timer,
		// the listeners or the context menu. It also closes an open chooser.
		this.terminate();

		this.resizeCanvas();

		// Reset the existing state object rather than allocating a new one, so
		// handlers holding a reference see the cleared flags.
		this.state.b0Down = false;
		this.state.b1Down = false;
		this.state.b2Down = false;
		this.state.lastMiddleDragPos = null;

		// The last chosen spec, else the documented default placeholder, so the
		// app always has a valid graph and no render path needs a "no graph"
		// special case. The first-run chooser replaces it before first paint.
		this.solverRef = new ForceDirectedGraph(this.initialGraph());
		this.updateCurrentGraphLabel();

		this.buildContextMenu();

		this.toggleEventListeners(true);
	
		this.timer = setInterval(this.onTimerTick, K.physics.timerTickPeriodMS);
	
		this.updateSelectionInfo();
	}
	
	terminate = () => {
		if (this.timer != null) {
			clearInterval(this.timer);
			this.timer = null;
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
