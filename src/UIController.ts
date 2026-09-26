import { ContextMenu } from "./ContextMenu";
import { ForceDirectedGraph } from "./ForceDirectedGraph";
import { GraphFactory } from "./GraphFactory";
import { K } from "./K";
import { Point2D } from "./Point2D";
import { State } from "./State";

declare global {
    interface Window {
        state: State;
        fdg: ForceDirectedGraph;
    }
}

export class UIController {

    timer: NodeJS.Timeout = null;

    body: HTMLElement;
    canvas: HTMLCanvasElement;
    context2D: CanvasRenderingContext2D;
    exportElement: HTMLElement;
    resetElement: HTMLElement;

    contextMenu: ContextMenu | null = null;

	constructor(
        body: HTMLElement,
        canvas: HTMLCanvasElement, 
        context2D: CanvasRenderingContext2D,
		exportElement: HTMLElement, 
		resetElement: HTMLElement
	) {
        this.body = body;
        this.canvas = canvas;
        this.context2D = context2D;
		this.exportElement = exportElement;
		this.resetElement = resetElement;
	}

	onMouseOut = () => {
		window.state.b0Down = false;
		window.state.b1Down = false;
		window.state.b2Down = false;
		window.state.lastMiddleDragPos = null;
	};

	onMouseMove = (event: MouseEvent) => {

		if (window.state.b0Down) {

			// Left-drag: the selected node follows the cursor exactly.
			const mxy = this.getMousePos(this.canvas, event);
			const phasePos = window.fdg.wrapReverse(mxy, this.canvas.width, this.canvas.height);

			window.fdg.graph.vertices
				.filter(vertex => vertex.isSelected)
				.forEach(
					vertex => {
						vertex.position = {x:phasePos.x, y:phasePos.y};
					}
				)
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

		const now = window.fdg.wrapReverse(mxy, this.canvas.width, this.canvas.height);
		const before = window.fdg.wrapReverse(last, this.canvas.width, this.canvas.height);

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
			window.state.b0ClickPos = mxy;    
				
			const selectionChanged = window.fdg.handleNodeSelectionAttempt(mxy, this.canvas.width, this.canvas.height);
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
		let obj = cnvs as HTMLElement;
		let top = 0;
		let left = 0;
		while (obj && obj.tagName != 'BODY') {
			top += obj.offsetTop;
			left += obj.offsetLeft;
			obj = obj.offsetParent as HTMLElement;
		}
	 
		// return relative mouse position
		//
		return new Point2D(
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

	onExport = () => {
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
		window.fdg.graph.vertices.forEach(vertex => {
			vertex.isSelected = false;
		});
		this.updateSelectionInfo();
	};

	onTimerTick = () => {
		// Advance the physics, then draw. The solver is told which node is
		// pinned via a predicate, so it never reads browser state itself.
		window.fdg.step(
			this.canvas.width,
			this.canvas.height,
			tag => tag.isSelected && window.state.b0Down
		);
		window.fdg.render(this.context2D);
	};
	
	deregisterEventListeners = (
            canvas: HTMLCanvasElement, 
            exportElement: HTMLElement, 
            resetElement: HTMLElement
        ) => {
		
		// export link
		//
		exportElement.removeEventListener("click", this.onExport);
		
		// reset link
		//
		resetElement.removeEventListener("click", this.onReset);

		// mouse
		//
		canvas.removeEventListener("mousemove", this.onMouseMove, false);
		canvas.removeEventListener("mousedown", this.onMouseDown, false);
		canvas.removeEventListener("mouseup", this.onMouseUp, false);
		canvas.removeEventListener("mouseout", this.onMouseOut, false);	
		canvas.removeEventListener("contextmenu", this.onContextMenu, false);
	}
	
	registerEventListeners = (
            canvas: HTMLCanvasElement, 
            exportElement: HTMLElement, 
            resetElement: HTMLElement
        ) => {
		
		// export link
		//
		exportElement.addEventListener("click", this.onExport);
		
		// reset link
		//
		resetElement.addEventListener("click", this.onReset);

		// mouse
		//
		canvas.addEventListener("mousemove", this.onMouseMove, false);
		canvas.addEventListener("mousedown", this.onMouseDown, false);
		canvas.addEventListener("mouseup", this.onMouseUp, false);
		canvas.addEventListener("mouseout", this.onMouseOut, false);	
		canvas.addEventListener("contextmenu", this.onContextMenu, false);
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
	
		const selectedNode = window.fdg.graph.vertices.find(
			vertex => (vertex.isSelected == true)
		)
		
		const selectedNodeInfoLabel = document.getElementById('selectedNodeInfoLabel');
		const list = document.getElementById('selectedNodeInfoList');
		
		// clear current items
		while (list.children.length > 0) {
			list.removeChild(list.firstChild);
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

	initialize = () => {

        console.log(this.body.offsetWidth, this.body.offsetHeight, this.body.clientWidth, this.body.clientHeight);

		const width = this.body.clientWidth * 0.8;
		const height = this.body.clientHeight * 0.8;
	
		this.canvas.width = width;
		this.canvas.height = height;
	
		window.state = new State();
			
		const gFactory = new GraphFactory();
		const graph = gFactory.generateGraph(K.initialConditions.order, K.initialConditions.branching);
		window.fdg = new ForceDirectedGraph(graph);
	
		this.buildContextMenu();

		this.registerEventListeners(this.canvas, this.exportElement, this.resetElement);
	
		this.timer = setInterval(this.onTimerTick, K.physics.timerTickperiodMS);
	
		this.updateSelectionInfo();
	}
	
	terminate = () => {
		clearInterval(this.timer);
		this.timer = null;

		if (this.contextMenu) {
			this.body.removeChild(this.contextMenu.element);
			this.contextMenu = null;
		}

		this.deregisterEventListeners(this.canvas, this.exportElement, this.resetElement)
	}	
}
