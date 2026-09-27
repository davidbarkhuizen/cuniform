/**
 * The two ends of the worker boundary, declared once.
 *
 * `WorkerPort` is the main-thread view of a worker: a fake can stand in for tests,
 * and the real `Worker` is adapted at the factory without the runner depending on
 * it. `WorkerScope` is the worker-side view of its own global, typed locally
 * rather than through the WebWorker lib, which cannot be combined with the DOM lib
 * the rest of the project needs.
 *
 * Both runners and both worker entries describe their seam with these, so the
 * protocol has one description. The modules that actually touch a browser global
 * remain the ones the architecture test classifies as DOM-facing; this module only
 * names types.
 */

export interface WorkerPort<Request, Response> {
    /** `transfer` is optional: the physics request carries no transferable. */
    postMessage(message: Request, transfer?: Transferable[]): void;
    terminate(): void;
    onmessage: ((event: { data: Response }) => void) | null;
    /** Fired when the worker script itself fails to load or throws. */
    onerror: ((event: unknown) => void) | null;
}

export interface WorkerScope<Request> {
    onmessage: ((event: { data: Request }) => void) | null;
    postMessage: (message: unknown, transfer: Transferable[]) => void;
}
