import { entrypoint } from './entrypoint';

export const go = () => {
    entrypoint(
        'selectionInfoPanel',
        'canvas',
        'export_canvas_link',
        'reset_link'
    )    
};