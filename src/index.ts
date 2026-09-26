import  { entrypoint } from './entrypoint';

document.addEventListener("DOMContentLoaded", function() { 
    
    entrypoint(
        'selectionInfoPanel',
        'canvas',
        'export_canvas_link',
        'reset_link'
    );
});