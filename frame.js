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

let canvas = null;
let context2d = null;
let state = new State();

const updateSelectionInfo = () => {
	
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

const getMousePos = (cnvs, evt) => {

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

const onTimerTick = (event) => {
	window.fdg.iterate(context2d);
};

const onMouseOut = (event) => {
	window.state.b0Down = false;
	window.state.b1Down = false;
	window.state.b2Down = false;
};

const onMouseMove = (event) => {
	/*
	record mouse movement, calc deltas
	call self.force_directed_graph.move(d_x, d_y, d_z), passing deltas
	*/
	if (window.state.b0Down) {

		const mxy = getMousePos(canvas, event);
		const phasePos = window.fdg.wrapReverse(mxy);
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

const calcCanvasXY = (event, canvas) => {
	return {
		x: event.x - canvas.offsetLeft,
		y: event.y - canvas.offsetTop
	};
};

const onMouseDown = (event) => {
	
	var mxy = getMousePos(
		document.getElementById("canvas"), 
		event
	);
	
	if (event.button == 0) {
		window.state.b0Down = true;		
		window.state.b0ClickPos = mxy;    
			
    	const selectionChanged = window.fdg.handleNodeSelectionAttempt(mxy);
    	if (selectionChanged == true)
    		updateSelectionInfo();
	}
	else if (event.button == 1)
		window.state.b1Down = true;
	else if (event.button == 2)
		window.state.b2Down = true;	
}

const onMouseUp = (event) => {
	
	if (event.button == 0) {
		window.state.b0Down = false;
		updateSelectionInfo();
	}
	else if (event.button == 1)
		window.state.b1Down = false;
	else if (event.button == 2)
		window.state.b2Down = false;
}

const deregisterMouseEventListeners = () => {
	canvas.removeEventListener("mousemove", onMouseMove, false);
	canvas.removeEventListener("mousedown", onMouseDown, false);
	canvas.removeEventListener("mouseup", onMouseUp, false);
	canvas.removeEventListener("mouseout", onMouseOut, false);	
}

const registerMouseEventListeners = (canvas) => {
	canvas.addEventListener("mousemove", onMouseMove, false);
	canvas.addEventListener("mousedown", onMouseDown, false);
	canvas.addEventListener("mouseup", onMouseUp, false);
	canvas.addEventListener("mouseout", onMouseOut, false);	
}

const initialize = () => {

	window.state = new State();
		
	const gFactory = new GraphFactory();
	const graph = gFactory.generateGraph(50, 2);
	window.fdg = new ForceDirectedGraph(graph);

	registerMouseEventListeners(canvas);

	setInterval(onTimerTick, 50)

	updateSelectionInfo();
}

const entrypoint = () => {				

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

	initialize()
};

const export_canvas_clicked_handler = () => {
 	window.open(
		canvas.toDataURL('image/png')
	);
};

const reset_clicked_handler = () => {
	
	if (confirm('Reset.\nAre You Sure ?')) {

		deregisterMouseEventListeners()
		initialize()
	}
};