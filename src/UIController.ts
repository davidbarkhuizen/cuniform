import { ContextMenu } from "./ContextMenu";
import { ForceDirectedGraph } from "./ForceDirectedGraph";
import { GraphFactory } from "./GraphFactory";
import { K } from "./K";
import { point, Point2D } from "./Point2D";
import { State } from "./State";

declare global {
    interface Window {
        state: State;
        fdg: ForceDirectedGraph;
    }
}

export class UIController {

    timer: ReturnType<typeof setInterval> | null = null;

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

    contextMenu: ContextMenu | null = null;

    /**
     * Logical (CSS-pixel) canvas size. All model <-> canvas mapping uses these
     * so pointer coordinates stay correct when the backing store is scaled for
     * a HiDPI display.
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
		selectionInfoList: HTMLElement
	) {
        this.body = body;
        this.canvas = canvas;
        this.context2D = context2D;
		this.exportElement = exportElement;
		this.resetElement = resetElement;
		this.selectionInfoLabel = selectionInfoLabel;
		this.selectionInfoList = selectionInfoList;
	}

	onMouseOut = () => {
		window.state.b0Down = false;
		window.state.b1Down = false;
		window.state.b2Down = false;
		window.state.lastMiddleDragPos = null;
	};

	onMouseMove = (event: MouseEvent) => {

		if (window.state.b0Down) {

			// Left-drag: every selected node follows the cursor exactly.
			const mxy = this.getMousePos(this.canvas, event);
			const phasePos = window.fdg.wrapReverse(mxy, this.width, this.height);

			for (const vertex of window.fdg.graph.vertices) {
				if (vertex.isSelected)
					vertex.position = point(phasePos.x, phasePos.y);
			}
		}
		else if (window.state.b1Down) {

			// Middle-drag: pan the whole graph.
			this.panTo(this.getMousePos(this.canvas, event));
		}
	};

	/**
	 * Translate every node by the cursor delta, converted from canvas space to
	 * model space. Repulsion and springs are translation invariant, so panning
	 * shifts the layout without disturbing the forces.
	 */
	panTo = (mxy: Point2D) => {

		const last = window.state.lastMiddleDragPos;

		// First move of a pan establishes the anchor; there is no delta yet.
		if (last == null) {
			window.state.lastMiddleDragPos = mxy;
			return;
		}

		const now = window.fdg.wrapReverse(mxy, this.width, this.height);
		const before = window.fdg.wrapReverse(last, this.width, this.height);

		const dx = now.x - before.x;
		const dy = now.y - before.y;

		for (const vertex of window.fdg.graph.vertices) {
			vertex.position.x += dx;
			vertex.position.y += dy;
		}

		window.state.lastMiddleDragPos = mxy;
	};

	onMouseDown = (event: MouseEvent) => {

		this.hideContextMenu();

		var mxy = this.getMousePos(
			this.canvas, 
			event
		);
		
		if (event.button == 0) {
			window.state.b0Down = true;		
				
			const selectionChanged = window.fdg.handleNodeSelectionAttempt(mxy, this.width, this.height);
			if (selectionChanged == true)
				this.updateSelectionInfo();
		}
		else if (event.button == 1) {
			// Middle button starts a pan; prevent the browser's autoscroll.
			window.state.b1Down = true;
			window.state.lastMiddleDragPos = mxy;
			event.preventDefault();
		}
		else if (event.button == 2) {
			window.state.b2Down = true;
		}
	}

	/**
	 * Right-click. The native browser menu is always suppressed; ours is shown
	 * only while the right button is actually held, so a programmatic
	 * contextmenu event cannot open it.
	 */
	onContextMenu = (event: MouseEvent) => {

		event.preventDefault();

		if (!window.state.b2Down)
			return;

		this.openContextMenu(event.clientX, event.clientY);
	};

	openContextMenu = (x: number, y: number) => {
		if (this.contextMenu)
			this.contextMenu.open(x, y);
	};

	hideContextMenu = () => {
		if (this.contextMenu)
			this.contextMenu.hide();
	};
	
	getMousePos = (cnvs: HTMLCanvasElement, evt: MouseEvent) => {

		// get canvas position
		//
		let obj: HTMLElement | null = cnvs as HTMLElement;
		let top = 0;
		let left = 0;
		while (obj && obj.tagName != 'BODY') {
			top += obj.offsetTop;
			left += obj.offsetLeft;
			obj = obj.offsetParent as HTMLElement | null;
		}
	 
		// return relative mouse position
		//
		return point(
			evt.clientX - left + window.pageXOffset,
			evt.clientY - top + window.pageYOffset
		)
	};

	onMouseUp = (event: MouseEvent) => {
	
		if (event.button == 0) {
			window.state.b0Down = false;
			this.updateSelectionInfo();
		}
		else if (event.button == 1) {
			window.state.b1Down = false;
			window.state.lastMiddleDragPos = null;
		}
		else if (event.button == 2)
			window.state.b2Down = false;
	}

	// reset, export handlers

	onExport = (event?: MouseEvent) => {

		// The link sits inside the overlay panel and carries an href, so the
		// default navigation has to be suppressed or the page reloads.
		event?.preventDefault();

		window.open(
			this.canvas.toDataURL('image/png')
		);
	};

	onReset = (event?: MouseEvent) => {
	
		const reset = confirm('Reset.\nAre You Sure ?');

		event?.preventDefault();

		if (reset == true) {
			this.terminate()
			this.initialize()
		}

		return false
	};

	clearSelection = () => {
		window.fdg.graph.clearSelection();
		this.updateSelectionInfo();
	};

	onTimerTick = () => {
		// Advance the physics, then draw. The solver is told which node is
		// pinned via a predicate, so it never reads browser state itself.
		window.fdg.step(
			this.width,
			this.height,
			tag => tag.isSelected && window.state.b0Down
		);
		window.fdg.render(this.context2D);
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

		// export link
		//
		bind(this.exportElement, "click", this.onExport);

		// reset link
		//
		bind(this.resetElement, "click", this.onReset);

		// viewport
		//
		bind(window, "resize", this.onResize);
	}

	buildContextMenu = () => {
		const menu = new ContextMenu([
			{ label: 'export', onSelect: this.onExport },
			{ label: 'reset', onSelect: () => this.onReset() },
			{ label: 'clear selection', onSelect: this.clearSelection },
		]);

		this.body.appendChild(menu.element);
		this.contextMenu = menu;
	};

	updateSelectionInfo = () => {
	
		const selectedNode = window.fdg.graph.selectedVertex();
		
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
	
			window.fdg.graph.neighbours(selectedNode)
			.forEach(
				neighbour => {
					const neighbourString = neighbour.label;
				
					const item = document.createElement('li');
					item.innerHTML = neighbourString;
					
					list.insertBefore(item, list.firstChild);
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

		this.resizeCanvas();
	
		window.state = new State();
			
		const gFactory = new GraphFactory();
		const graph = gFactory.generateGraph(K.initialConditions.order, K.initialConditions.branching);
		window.fdg = new ForceDirectedGraph(graph);
	
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

		if (this.contextMenu) {
			this.body.removeChild(this.contextMenu.element);
			this.contextMenu = null;
		}

		this.toggleEventListeners(false)
	}	
}
