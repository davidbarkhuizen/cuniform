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

    // getContext('2d') returns null when the context is unavailable; it does
    // not throw, so there is no try/catch and the result is checked directly.
    const context2d = canvas.getContext('2d');

    if (context2d == null) {
        console.error(`could not get a 2d context for canvas ID: ${canvasElementID}`);
        return false;
    }

    const selectionInfoPanel = e(selectionInfoPanelID);

    if (selectionInfoPanel) {
        new DragController(selectionInfoPanel);
    }
    else {
        console.error(`could not find selection info panel for ID: ${selectionInfoPanelID}`);
    }

    const uiController = new UIController(
        e('body'),
        canvas,
        context2d,
        e(exportElementID),
        e(resetElementID)
    );

    uiController.initialize();

    return true;
};
