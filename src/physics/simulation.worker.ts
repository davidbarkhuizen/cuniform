// Not in PURE_MODULES: the one module that touches the worker globals (docs/invariants.md).

import { PhysicsWorkerEngine, WorkerRequest } from "./PhysicsProtocol";
import { WorkerScope } from "../core/WorkerChannel";

const scope = self as unknown as WorkerScope<WorkerRequest>;
const engine = new PhysicsWorkerEngine();

scope.onmessage = event => {

    const response = engine.handle(event.data);

    if (response !== null) {
        // A transfer list, so the positions cross as a pointer move, not a copy.
        scope.postMessage(response, [response.positions.buffer]);
    }
};
