import { DragController } from "./DragController";
import { UIController } from "./UIController";

const entrypoint = () => {				

	const selectionInfoPanel = document.getElementById('selectionInfoPanel')

	const body = document.getElementById('body');

	const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    
    let context2d: CanvasRenderingContext2D;
    
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

	const exportElement = document.getElementById('export_canvas_link');
	const resetElement = document.getElementById('reset_link');

	const controller = new UIController(canvas, exportElement, resetElement);
	controller.initialize()

	const dragController = new DragController(selectionInfoPanel);
};