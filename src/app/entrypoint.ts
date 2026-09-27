import { DragController } from "../ui/DragController";
import { RenderRunner } from "../render/RenderRunner";
import { UIController } from "./UIController";

/**
 * The demo's element ids, in one place. `web/index.html` is the other half of
 * this contract, and `test/layout.test.ts` pins that side; `src/index.ts` passes
 * these rather than re-typing the literals.
 */
export const SELECTION_INFO_PANEL_ID = 'selectionInfoPanel';
export const CANVAS_ID = 'canvas';
export const EXPORT_ELEMENT_ID = 'export_canvas_link';
export const RESET_ELEMENT_ID = 'reset_link';

const SELECTED_NODE_LABEL_ID = 'selectedNodeInfoLabel';
const SELECTED_NODE_LIST_ID = 'selectedNodeInfoList';

const CAMERA_CONSOLE_ID = 'cameraConsole';

const EMPHASIS_CONSOLE_ID = 'emphasisConsole';

const CURRENT_GRAPH_LABEL_ID = 'currentGraphLabel';

/** The panel's touch grip; without it the whole panel is the touch drag surface. */
const PANEL_DRAG_HANDLE_ID = 'panelDragHandle';

/** The one reporter for a required element that is missing, so every failure
 * names the offending id the same way. */
const reportMissing = (id: string) => console.error(`could not find element for ID: ${id}`);

export const entrypoint = (
    selectionInfoPanelID: string = SELECTION_INFO_PANEL_ID,
    canvasElementID: string = CANVAS_ID,
    exportElementID: string = EXPORT_ELEMENT_ID,
    resetElementID: string = RESET_ELEMENT_ID
): UIController | null => {

    const e = (id: string) => document.getElementById(id);

    const canvas = e(canvasElementID) as HTMLCanvasElement | null;

    if (!canvas) {
        reportMissing(canvasElementID);
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
            reportMissing(entry.id);

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
        EMPHASIS_CONSOLE_ID,
    ]);

    if (!elements)
        return null;

    const [
        body,
        exportElement,
        resetElement,
        selectionInfoLabel,
        selectionInfoList,
        currentGraphLabel,
        cameraConsole,
        emphasisConsole,
    ] = elements;

    const selectionInfoPanel = e(selectionInfoPanelID);

    if (selectionInfoPanel)
        new DragController(selectionInfoPanel, e(PANEL_DRAG_HANDLE_ID));
    else
        reportMissing(selectionInfoPanelID);

    const uiController = new UIController(
        body,
        canvas,
        exportElement,
        resetElement,
        selectionInfoLabel,
        selectionInfoList,
        currentGraphLabel,
        cameraConsole,
        // The two production defaults: the shipped graph source, no injected
        // backend and no injected worker.
        undefined,
        null,
        undefined,
        emphasisConsole
    );

    uiController.initialize();

    return uiController;
};
