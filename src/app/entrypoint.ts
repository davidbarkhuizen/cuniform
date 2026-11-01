import { DragController } from "../ui/DragController";
import { RenderRunner } from "../render/RenderRunner";
import { modelParameter, urlSource } from "./ModelSource";
import { UIController } from "./UIController";

/** Element ids shared with `web/index.html`, which `test/layout.test.ts` pins. */
export const SELECTION_INFO_PANEL_ID = 'selectionInfoPanel';
export const CANVAS_ID = 'canvas';
export const EXPORT_ELEMENT_ID = 'export_canvas_link';
export const RESET_ELEMENT_ID = 'reset_link';

const SELECTED_NODE_LABEL_ID = 'selectedNodeInfoLabel';
const SELECTED_NODE_LIST_ID = 'selectedNodeInfoList';

const CAMERA_CONSOLE_ID = 'cameraConsole';

const EMPHASIS_CONSOLE_ID = 'emphasisConsole';

const CURRENT_GRAPH_LABEL_ID = 'currentGraphLabel';

/** The loader's file picker and the model panel's list; optional, so an embedding host may leave them out. */
export const MODEL_FILE_INPUT_ID = 'modelFileInput';
export const MODEL_INFO_LIST_ID = 'modelInfoList';
export const EXPAND_TOGGLE_ID = 'expandToggle';
export const EDGES_PER_UNIT_ID = 'edgesPerUnitInput';

/** The panel's touch grip; without it the whole panel is the touch drag surface. */
const PANEL_DRAG_HANDLE_ID = 'panelDragHandle';

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

    // A 2d context must not be resolved here: creating one makes
    // transferControlToOffscreen() throw, and the render runner decides the backend.
    if (!RenderRunner.supported(canvas)) {
        console.error(`canvas ID ${canvasElementID} can neither transfer to an OffscreenCanvas nor give a 2d context`);
        return null;
    }

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
        // Production defaults: the shipped graph source, no injected backend or worker.
        undefined,
        null,
        undefined,
        emphasisConsole
    );

    uiController.modelFileInput = e(MODEL_FILE_INPUT_ID) as HTMLInputElement | null;
    uiController.modelInfoList = e(MODEL_INFO_LIST_ID);
    uiController.expandToggle = e(EXPAND_TOGGLE_ID);
    uiController.edgesPerUnitInput = e(EDGES_PER_UNIT_ID) as HTMLInputElement | null;

    uiController.initialize();

    // `?model=<url>` opens a model from a local static server during development (D3).
    const model = modelParameter(typeof location === 'undefined' ? '' : location.search);

    if (model !== null)
        void uiController.openModel(urlSource(model));

    return uiController;
};
