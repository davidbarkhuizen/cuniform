import { DragController } from "./DragController";
import { UIController } from "./UIController";

export const entrypoint = (
    selectionInfoPanelID: string,
    canvasElementID: string,
    exportElementID: string,
    resetElementID: string
): boolean => {		
    
    const e = (id: string) => document.getElementById(id);

    const canvas = e(canvasElementID) as HTMLCanvasElement;
    
    if (!canvas) {
        console.error(`could not find canvas element for ID: ${canvasElementID}`);
        return false;
    }
    
    let context2d: CanvasRenderingContext2D;
    try {
        context2d = canvas.getContext('2d');
    } catch (e) {
        console.log(`error attempting to get 2d context from canvas: ${e}`)
        return false;
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
		console.error(`unsupported requirements: ${unsupportedRequirements.join(', ')}`);
		return false;
	}

    new DragController(e(selectionInfoPanelID));
    
    const uiController = new UIController(
        e('body'), 
        canvas, 
        context2d, 
        e(exportElementID), 
        e(resetElementID)
    );
	uiController.initialize()
};