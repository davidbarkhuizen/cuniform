import { DragController } from "./DragController";
import { UIController } from "./UIController";

const SELECTED_NODE_LABEL_ID = 'selectedNodeInfoLabel';
const SELECTED_NODE_LIST_ID = 'selectedNodeInfoList';

const CAMERA_CONSOLE_ID = 'cameraConsole';

const CURRENT_GRAPH_LABEL_ID = 'currentGraphLabel';

export const entrypoint = (
    selectionInfoPanelID: string,
    canvasElementID: string,
    exportElementID: string,
    resetElementID: string
): UIController | null => {

    const e = (id: string) => document.getElementById(id);

    const canvas = e(canvasElementID) as HTMLCanvasElement | null;

    if (!canvas) {
        console.error(`could not find element for ID: ${canvasElementID}`);
        return null;
    }

    // getContext('2d') returns null rather than throwing, so the result is checked directly.
    const context2d = canvas.getContext('2d');

    if (context2d == null) {
        console.error(`could not get a 2d context for canvas ID: ${canvasElementID}`);
        return null;
    }

    /** Resolves every required element once; returns null, logging each missing ID. */
    const required = (ids: string[]): HTMLElement[] | null => {
        const resolved = ids.map(id => ({ id, element: e(id) }));
        const missing = resolved.filter(entry => !entry.element);

        for (const entry of missing)
            console.error(`could not find element for ID: ${entry.id}`);

        if (missing.length > 0)
            return null;

        return resolved.map(entry => entry.element as HTMLElement);
    };

    const elements = required([
        'body',
        exportElementID,
        resetElementID,
        SELECTED_NODE_LABEL_ID,
        SELECTED_NODE_LIST_ID,
        CURRENT_GRAPH_LABEL_ID,
        CAMERA_CONSOLE_ID,
    ]);

    if (!elements)
        return null;

    const [body, exportElement, resetElement, selectionInfoLabel, selectionInfoList, currentGraphLabel, cameraConsole] = elements;

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
        selectionInfoList,
        currentGraphLabel,
        cameraConsole
    );

    uiController.initialize();

    // The first-run chooser is a startup step, not a constructor side effect.
    uiController.openGraphWizard();

    return uiController;
};
