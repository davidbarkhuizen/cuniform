import { DragController } from "./DragController";
import { RenderRunner } from "./RenderRunner";
import { UIController } from "./UIController";

const SELECTED_NODE_LABEL_ID = 'selectedNodeInfoLabel';
const SELECTED_NODE_LIST_ID = 'selectedNodeInfoList';

const CAMERA_CONSOLE_ID = 'cameraConsole';

const CURRENT_GRAPH_LABEL_ID = 'currentGraphLabel';

/** The panel's touch grip; without it the whole panel is the touch drag surface. */
const PANEL_DRAG_HANDLE_ID = 'panelDragHandle';

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

    // Either a transferable canvas with a Worker, or a 2D context. A context is
    // deliberately not resolved here: creating one makes
    // transferControlToOffscreen() throw, and the render runner is what decides
    // between the worker and the in-process backend.
    if (!RenderRunner.supported(canvas)) {
        console.error(`canvas ID ${canvasElementID} can neither transfer to an OffscreenCanvas nor give a 2d context`);
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
        new DragController(selectionInfoPanel, e(PANEL_DRAG_HANDLE_ID));
    else
        console.error(`could not find selection info panel for ID: ${selectionInfoPanelID}`);

    const uiController = new UIController(
        body,
        canvas,
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
