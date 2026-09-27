import { entrypoint } from './app/entrypoint';

document.addEventListener("DOMContentLoaded", function() {

    // The ids are entrypoint's own defaults: the demo names them once there, so
    // this call site cannot drift from web/index.html.
    entrypoint();
});
