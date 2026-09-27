// The physics worker entry (README, "Cadence").
//
// Deliberately not in PURE_MODULES: this is the one module that touches the
// worker globals. The physics and the message protocol live in
// PhysicsProtocol.ts, which stays pure and is driven here.

import { PhysicsWorkerEngine, WorkerRequest } from "./PhysicsProtocol";

// Typed locally rather than through the WebWorker lib, which cannot be combined
// with the DOM lib the rest of the project needs.
interface WorkerScope {
    onmessage: ((event: { data: WorkerRequest }) => void) | null;
    postMessage: (message: unknown, transfer: Transferable[]) => void;
}

const scope = self as unknown as WorkerScope;
const engine = new PhysicsWorkerEngine();

scope.onmessage = event => {

    const response = engine.handle(event.data);

    if (response !== null) {
        // A transfer list, so the positions cross as a pointer move, not a copy.
        scope.postMessage(response, [response.positions.buffer]);
    }
};
