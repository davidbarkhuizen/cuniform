/**
 * The main-thread and worker-side views of the worker boundary. `WorkerScope` is
 * typed locally because the WebWorker lib cannot be combined with the DOM lib.
 */

export interface WorkerPort<Request, Response> {
    postMessage(message: Request, transfer?: Transferable[]): void;
    terminate(): void;
    onmessage: ((event: { data: Response }) => void) | null;
    /** Fired when the worker script fails to load or throws. */
    onerror: ((event: unknown) => void) | null;
}

export interface WorkerScope<Request> {
    onmessage: ((event: { data: Request }) => void) | null;
    postMessage: (message: unknown, transfer: Transferable[]) => void;
}
