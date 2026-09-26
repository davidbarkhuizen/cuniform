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
 * Builds the graph a `GraphSpec` describes. Supplied by the caller rather than
 * read from globals; the spec is passed by value because the chooser decides
 * which graph to build after the controller exists.
 */
export type GraphSource = (spec: GraphSpec) => Graph;

const defaultGraphSource: GraphSource = spec => new GraphFactory().build(spec);

type CameraDirection = 'cw' | 'acw';

// A parsed console button: which camera axis and which way.
interface CameraButton {
    axis: CameraAxis;
    direction: CameraDirection;
}

// The canvas as a PNG Blob. Browsers refuse top-frame navigation to a `data:`
// URL, so the download must carry the image on a `blob:` object URL instead.
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

    readonly state: State = new State();

    private solverRef: ForceDirectedGraph | null = null;

    body: HTMLElement;
    canvas: HTMLCanvasElement;
    context2D: CanvasRenderingContext2D;
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
    // tick applies one small rotation step, so holding turns smoothly.
    private heldRotation: CameraButton | null = null;

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

    // Built lazily so a handler that runs before initialize() (or a test that
    // never initializes) still has one.
    get solver(): ForceDirectedGraph {
        if (this.solverRef === null)
            this.solverRef = new ForceDirectedGraph(this.initialGraph());

        return this.solverRef;
    }

	onMouseOut = () => {
		this.state.reset();
	};

	onMouseMove = (event: MouseEvent) => {

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

	// Orbit by the pointer delta since the anchor. The live camera lives in
	// State, so reset() rebuilds the graph without losing the angle.
	orbitTo = (mxy: Point2D) => {

		const last = this.state.lastMiddleDragPos;

		// First move of a gesture establishes the anchor.
		if (last == null) {
			this.state.lastMiddleDragPos = mxy;
			return;
		}

		this.state.camera.orbit(mxy.x - last.x, mxy.y - last.y);
		this.state.lastMiddleDragPos = mxy;
	};

	// Shift+middle-drag pans the camera target (D4): the pointer delta is
	// unprojected at the target's depth, and node positions are never touched.
	panCameraTo = (mxy: Point2D) => {

		const last = this.state.lastMiddleDragPos;

		// First move of a gesture establishes the anchor.
		if (last == null) {
			this.state.lastMiddleDragPos = mxy;
			return;
		}

		const projector = this.projector();

		// The target's depth is `distance`, so this slides the plane through
		// the target.
		const depth = this.state.camera.distance;

		const now = projector.unproject(mxy, depth);
		const before = projector.unproject(last, depth);

		this.state.camera.panBy(
			point3(now.x - before.x, now.y - before.y, now.z - before.z)
		);

		this.state.lastMiddleDragPos = mxy;
	};

	// Wheel dollies; `focalLength` is constant by design, so only the distance
	// changes, clamped above the near plane.
	onWheel = (event: WheelEvent) => {

		const notches = event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0;

		if (notches !== 0)
			this.state.camera.dolly(notches);

		// The canvas fills the viewport; the wheel must not scroll the page.
		event.preventDefault();
	};

	// Parse a console button out of an event target. The container is stable, so
	// one delegated listener per event type serves all six buttons, and the
	// data attributes name the axis and direction.
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

	// One tick of rotation for `button`. Anticlockwise is the right-hand
	// positive sense about the axis, so it is the positive step.
	private rotateBy(button: CameraButton): void {

		const step = button.direction === 'acw'
			? UIController.ROTATION_PER_TICK
			: -UIController.ROTATION_PER_TICK;

		this.state.camera.rotateLocal(button.axis, step);
	}

	// One tick's worth of a held button. Called from onTimerTick() before the
	// step, so the rotation rides the render loop.
	onCameraRotateTick = () => {

		if (this.heldRotation)
			this.rotateBy(this.heldRotation);
	};

	// Begin rotating: one step at once so a tap still moves, then one per tick.
	private startCameraHold(button: CameraButton): void {

		this.heldRotation = button;
		this.rotateBy(button);
	}

	/** Stop any held rotation. Safe when nothing is held. */
	stopCameraHold = () => {
		this.heldRotation = null;
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

		if (event.key !== 'Enter' && event.key !== ' ')
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

		if (event.key !== 'Enter' && event.key !== ' ')
			return;

		event.preventDefault();
		this.stopCameraHold();
	};

	// Pointer and key activation both produce a click, and the hold paths
	// cover those; `detail === 0` is the one click that still rotates.
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
		
		if (event.button === 0) {
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

	// Right-click. The native menu is always suppressed; ours opens only while
	// the right button is actually held, so a programmatic event cannot.
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

		// A `data:` URL cannot be opened by top-frame navigation, so the PNG is
		// downloaded from an object URL instead: no popup and no blocked nav.
		const url = URL.createObjectURL(pngBlob(this.canvas));

		const link = document.createElement('a');
		link.href = url;
		link.download = 'cuniform.png';
		link.click();

		// Revoking synchronously can cancel the download in some browsers.
		setTimeout(() => URL.revokeObjectURL(url), 0);
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

		// A swap happens between gestures, so no button may still be held.
		this.state.reset();

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

	onTimerTick = () => {
		// A held console button turns the camera first, so the projection and
		// the draw below both use the new view.
		this.onCameraRotateTick();

		// One projector for both the step and the draw, so the renderer's cull
		// boundary and depth cue see the camera that produced each cached depth.
		const projector = this.projector();

		// The solver receives the pinned-node predicate as a value, so it never
		// reads browser state itself.
		this.solver.step(
			this.width,
			this.height,
			tag => tag.isSelected && this.state.b0Down,
			projector
		);
		render(this.context2D, this.solver.graph, projector.camera);
	};
	
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

	updateSelectionInfo = () => {
	
		const selectedNode = this.solver.graph.selectedVertex();
		
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

	// Fill the viewport. The backing store is sized in device pixels so lines
	// stay sharp on HiDPI, while drawing stays in CSS pixels via the transform.
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

	onResize = () => {
		this.resizeCanvas();
	};

	initialize = () => {

		// Idempotent: tear down any previous run first, so a second initialize()
		// cannot double the timer, the listeners or the context menu.
		this.terminate();

		this.resizeCanvas();

		// Reset the existing state object rather than allocating a new one, so
		// handlers holding a reference see the cleared flags.
		this.state.reset();

		// The default placeholder guarantees a valid graph, so no render path
		// needs a "no graph" special case; the first-run chooser replaces it.
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
