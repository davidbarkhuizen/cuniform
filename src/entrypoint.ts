import { DragController } from "./DragController";
import { UIController } from "./UIController";

/** Selection-info panel contents that updateSelectionInfo() writes to. */
const SELECTED_NODE_LABEL_ID = 'selectedNodeInfoLabel';
const SELECTED_NODE_LIST_ID = 'selectedNodeInfoList';

export const entrypoint = (
    selectionInfoPanelID: string,
    canvasElementID: string,
    exportElementID: string,
    resetElementID: string
): boolean => {

    const e = (id: string) => document.getElementById(id);

    const required = (id: string): HTMLElement | null => {
        const element = e(id);
        if (!element)
            console.error(`could not find element for ID: ${id}`);
        return element;
    };

    const canvas = required(canvasElementID) as HTMLCanvasElement | null;

    if (!canvas)
        return false;

    // getContext('2d') returns null when the context is unavailable; it does
    // not throw, so there is no try/catch and the result is checked directly.
    const context2d = canvas.getContext('2d');

    if (context2d == null) {
        console.error(`could not get a 2d context for canvas ID: ${canvasElementID}`);
        return false;
    }

    const body = required('body');
    const exportElement = required(exportElementID);
    const resetElement = required(resetElementID);
    const selectionInfoLabel = required(SELECTED_NODE_LABEL_ID);
    const selectionInfoList = required(SELECTED_NODE_LIST_ID);

    if (!body || !exportElement || !resetElement || !selectionInfoLabel || !selectionInfoList)
        return false;

    const selectionInfoPanel = e(selectionInfoPanelID);

    if (selectionInfoPanel)
        new DragController(selectionInfoPanel);
    else
        console.error(`could not find selection info panel for ID: ${selectionInfoPanelID}`);

    const uiController = new UIController(
        body,
        canvas,
        context2d,
        exportElement,
        resetElement,
        selectionInfoLabel,
        selectionInfoList
    );

    uiController.initialize();

    return true;
};
