import { ForceDirectedGraph } from "./ForceDirectedGraph";
import { GraphFactory } from "./GraphFactory";
import { Point2D } from "./Point2D";
import { State } from "./State";

let body: HTMLElement = null;
let canvas: HTMLCanvasElement = null;
let context2d: CanvasRenderingContext2D = null;
let state = new State();
let selectionInfoPanel = null;
let resetElement = null;
let exportElement = null;

declare global {
    interface Window {
        state: State;
        fdg: ForceDirectedGraph;
    }
}

export class UIController {

    timer: NodeJS.Timeout = null;
    
    canvas: HTMLCanvasElement;
    exportElement: HTMLElement;
    resetElement: HTMLElement;

	constructor(
		canvas: HTMLCanvasElement, 
		exportElement: HTMLElement, 
		resetElement: HTMLElement
	) {
		this.canvas = canvas;
		this.exportElement = exportElement;
		this.resetElement = resetElement;
	}

	onMouseOut = (event: MouseEvent) => {
		window.state.b0Down = false;
		window.state.b1Down = false;
		window.state.b2Down = false;
	};

	onMouseMove = (event: MouseEvent) => {
		/*
		record mouse movement, calc deltas
		call self.force_directed_graph.move(d_x, d_y, d_z), passing deltas
		*/
		if (window.state.b0Down) {
		
			const mxy = this.getMousePos(this.canvas, event);
			const phasePos = window.fdg.wrapReverse(mxy, this.canvas.width, this.canvas.height);
			window.state.lastB0DragPos = mxy;
			
			window.fdg.graph.vertices
				.filter(vertex => (vertex.isSelected == true))
				.forEach(
					vertex => {
						vertex.position = {x:phasePos.x, y:phasePos.y};
					}
				)
		}
	};	

	onMouseDown = (event: MouseEvent) => {
	
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
		else if (event.button == 1)
			window.state.b1Down = true;
		else if (event.button == 2)
			window.state.b2Down = true;	
	}
	
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
		else if (event.button == 1)
			window.state.b1Down = false;
		else if (event.button == 2)
			window.state.b2Down = false;
	}

	// reset, export handlers

	onExport = () => {
		window.open(
			this.canvas.toDataURL('image/png')
		);
	};

	onReset = (event: MouseEvent) => {
	
		const reset = confirm('Reset.\nAre You Sure ?');
		if (reset == true) {
			this.terminate()
			this.initialize()
		}

		event.preventDefault();

		return false
	};

	onTimerTick = (event: any) => {
		window.fdg.iterate(context2d, this.canvas.width, this.canvas.height);
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
	}

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

		const width = body.offsetWidth;
		const height = body.offsetHeight * 0.9;
	
		this.canvas.width = width;
		this.canvas.height = height;
	
		window.state = new State();
			
		const gFactory = new GraphFactory();
		const graph = gFactory.generateGraph(30, 5);
		window.fdg = new ForceDirectedGraph(graph);
	
		this.registerEventListeners(this.canvas, this.exportElement, this.resetElement);
	
		this.timer = setInterval(this.onTimerTick, 50)
	
		this.updateSelectionInfo();
	}
	
	terminate = () => {
		clearInterval(timer)
		timer = null
		this.deregisterEventListeners(this.canvas, this.exportElement, this.resetElement)
	}	
}