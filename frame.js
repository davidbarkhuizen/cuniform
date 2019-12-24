class Point2D {
	constructor(
		x, y
	) {
		this.x = x
		this.y = y
	}
}

class State {
	constructor(
	) {
		this.b0Down = false;
		this.b1Down = false; 
		this.b2Down = false; 
		
		this.b0ClickPos = new Point2D(0, 0);
		this.lastB0DragPos = new Point2D(0,0)
		
		this.curPos = new Point2D(0, 0);
	}
}

let body = null;
let canvas = null;
let context2d = null;
let state = new State();
let selectionInfoPanel = null;
let resetElement = null;
let exportElement = null;

class UIController {

	constructor(
		canvas, 
		exportElement, 
		resetElement
	) {
		this.canvas = canvas;
		this.exportElement = exportElement;
		this.resetElement = resetElement;
	}

	onMouseOut = (event) => {
		window.state.b0Down = false;
		window.state.b1Down = false;
		window.state.b2Down = false;
	};

	onMouseMove = (event) => {
		/*
		record mouse movement, calc deltas
		call self.force_directed_graph.move(d_x, d_y, d_z), passing deltas
		*/
		if (window.state.b0Down) {
	
	
			const mxy = this.getMousePos(canvas, event);
			const phasePos = window.fdg.wrapReverse(mxy, canvas.width, canvas.height);
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

	onMouseDown = (event) => {
	
		var mxy = this.getMousePos(
			this.canvas, 
			event
		);
		
		if (event.button == 0) {
			window.state.b0Down = true;		
			window.state.b0ClickPos = mxy;    
				
			const selectionChanged = window.fdg.handleNodeSelectionAttempt(mxy, canvas.width, canvas.height);
			if (selectionChanged == true)
				this.updateSelectionInfo();
		}
		else if (event.button == 1)
			window.state.b1Down = true;
		else if (event.button == 2)
			window.state.b2Down = true;	
	}
	
	getMousePos = (cnvs, evt) => {

		// get canvas position
		//
		let obj = cnvs;
		let top = 0;
		let left = 0;
		while (obj && obj.tagName != 'BODY') {
			top += obj.offsetTop;
			left += obj.offsetLeft;
			obj = obj.offsetParent;
		}
	 
		// return relative mouse position
		//
		return new Point2D(
			evt.clientX - left + window.pageXOffset,
			evt.clientY - top + window.pageYOffset
		)
	};

	onMouseUp = (event) => {
	
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
			canvas.toDataURL('image/png')
		);
	};

	onReset = (event) => {
	
		const reset = confirm('Reset.\nAre You Sure ?');
		if (reset == true) {
			this.terminate()
			this.initialize()
		}

		event.preventDefault();

		return false
	};

	deregisterEventListeners = (canvas, exportElement, resetElement) => {
		
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
	
	registerEventListeners = (canvas, exportElement, resetElement) => {
		
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
	
		canvas.width = width;
		canvas.height = height;
	
		window.state = new State();
			
		const gFactory = new GraphFactory();
		const graph = gFactory.generateGraph(30, 2);
		window.fdg = new ForceDirectedGraph(graph);
	
		this.registerEventListeners(this.canvas, this.exportElement, this.resetElement);
	
		timer = setInterval(onTimerTick, 50)
	
		this.updateSelectionInfo();
	}
	
	terminate = () => {
		clearInterval(timer)
		timer = null
		this.deregisterEventListeners(this.canvas, this.exportElement, this.resetElement)
	}
	
}

const calcCanvasXY = (event, canvas) => {
	return {
		x: event.x - canvas.offsetLeft,
		y: event.y - canvas.offsetTop
	};
};

let timer = null


const onTimerTick = (event) => {
	window.fdg.iterate(context2d, canvas.width, canvas.height);
};

const entrypoint = () => {				

	selectionInfoPanel = document.getElementById('selectionInfoPanel')

	body = document.getElementById('body');

	canvas = document.getElementById('canvas');
	if (canvas != null) {
		try {
			context2d = canvas.getContext('2d');
		} catch (e) {
			console.log(`error attempting to get 2d context from canvas: ${e}`)
		}
	}

	const listUnsupportedRequirements = () => {
	
		const unsupportedRequirements = []; 
		
		if (!!window.Worker != true)
			unsupportedRequirements.push('web worker not supported');
			
		if (canvas == null) {
			unsupportedRequirements.push('canvas not supported');
		}
		else if (context2d == null){ 	
			unsupportedRequirements.push('no [canvas] context');
		}				
		
		return unsupportedRequirements;
	}					
	
	const unsupportedRequirements = listUnsupportedRequirements();				
	if (unsupportedRequirements.length > 0) {
				
		console.log('UnSupported Requirements:');
		unsupportedRequirements.forEach(
			txt => console.log(txt)
		)
		
		alert('Minimum Requirements Not Met.\nSee console log for details')
		return
	}

	exportElement = document.getElementById('export_canvas_link');
	resetElement = document.getElementById('reset_link');

	const controller = new UIController(canvas, exportElement, resetElement);
	controller.initialize()
};

// selection info panel drag handlers

// draggable="true" 
// ondrag="onDrag(event)"
// ondragstart="onDragStart(event)"
// ondragend="onDragEnd(event)"

let startDragScreenX = null
let startDragScreenY = null

let dragX = null
let dragY = null

let startTop = null;
let startLeft = null;

const onDragStart = (event) => {

	startDragScreenX = event.screenX;
	startDragScreenY = event.screenY;

	var rect = selectionInfoPanel.getBoundingClientRect();
	var parentRect = selectionInfoPanel.parentElement.getBoundingClientRect();

	startTop = rect.top - parentRect.top;
	startLeft = rect.left - parentRect.left;
}

const onDrag = (event) => {

	if ((event.screenX <= 0) && (event.screenY <= 0)){
		return
	}

	dragX = event.screenX - startDragScreenX;
	dragY = event.screenY - startDragScreenY;
}

const onDragEnd = (event) => {

	selectionInfoPanel.style.top = dragY + startTop;
	selectionInfoPanel.style.left = dragX + startLeft;
}