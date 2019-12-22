function State() { 
    
    this.b0Down = false;
    this.b1Down = false; 
    this.b2Down = false; 
    
    this.b0ClickPos = {x:0, y:0};
    this.lastB0DragPos = {x:0, y:0};
    
    this.curPos = {x:0, y:0};
}


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
		selectedNodeInfoLabel.innerHTML = 'Select a Node...';
	}
	else {
		selectedNodeInfoLabel.innerHTML = selectedNode.label;

		window.fdg.graph.neighbours(selectedNode).forEach(
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
	return {
        x: evt.clientX - left + window.pageXOffset,
        y: evt.clientY - top + window.pageYOffset
    };
};

const onTimerTick = (event) => {
	window.fdg.iterate(
		document
			.getElementById("canvas")
			.getContext('2d')
	);
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

		const canvas = document.getElementById("canvas");
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

const checkRequirements = () => {
	
	let csv_error_string = ''; 
	
	if (!!window.Worker != true)
		csv_error_string = csv_error_string + 'web worker not supported' + ',';
		
	const checkCanvas = document.getElementById('canvas');
	if (checkCanvas == null) {
		csv_error_string = csv_error_string + 'canvas not supported' + ',';
	}
	else if (checkCanvas.getContext == false){
		csv_error_string = csv_error_string + 'no [canvas] context' + ',';
	}				
	
	return csv_error_string;
}					

const draw = () => {				
	
	const failedRequirements = checkRequirements();				
	if (failedRequirements != '') {
		console.error('Minimum Requirements Not Met');
		console.error(failedRequirements);
	}
	
	const canvas = document.getElementById('canvas')
	if (canvas != null) {
		if (canvas.getContext) {
		
			window.state = new State();
		
			const gFactory = new GraphFactory();
			const graph = gFactory.generateGraph(50, 2);
			window.fdg = new ForceDirectedGraph(graph);
			
			canvas.addEventListener("mousemove", onMouseMove, false);
			canvas.addEventListener("mousedown", onMouseDown, false);
			canvas.addEventListener("mouseup", onMouseUp, false);
			canvas.addEventListener("mouseout", onMouseOut, false);
			
			window.timerTickWorker = new Worker('drone.js');
			window.timerTickWorker.onmessage = onTimerTick;
			window.timerTickWorkerStarted = true;
			window.timerTickWorker.postMessage('50'); // !!	
		}
	}
	else
	{
		console.error('Could not find canvas element')
	}
};

const export_canvas_clicked_handler = () => {
 	window.open(
		document
			.getElementById('canvas')
			.toDataURL('image/png')
	);
};

const reset_clicked_handler = () => {
	
	if (confirm('Reset.\nAre You Sure ?')) {

		const gFactory = new GraphFactory();
		const graph = gFactory.generateGraph(50, 2);
		window.fdg = new ForceDirectedGraph(graph);

		//var canvas = document.getElementById('canvas');
		//var context = canvas.getContext('2d');
		//context.clearRect(0, 0, canvas.width, canvas.height);
	}
};