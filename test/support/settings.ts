// The `K.renderer` threshold override, shared by the test suite and the
// benchmark. It lives outside `support/dom.ts` so the benchmark can use it
// without pulling in the DOM fakes.

import { K } from "../../src/core/K";

/** The `K.renderer` thresholds a caller may need to move for one scope. */
export interface RendererSettings {
    labelMaxNodes?: number;
    batchEdgesMinEdges?: number;
    minNodes?: number;
}

/**
 * Run `fn` with the given `K.renderer` thresholds overridden, always restoring
 * every one of them.
 *
 * `K` must not be mutated at runtime, so a caller that needs a size-gated path
 * takes the override for exactly its own scope. One helper for all three keys, so
 * a new overridable key cannot be covered by one suite and silently missed by
 * another.
 */
export function withRendererSettings<T>(settings: RendererSettings, fn: () => T): T {

    const saved = {
        labelMaxNodes: K.renderer.labelMaxNodes,
        batchEdgesMinEdges: K.renderer.batchEdgesMinEdges,
        minNodes: K.renderer.performance.minNodes,
    };

    if (settings.labelMaxNodes !== undefined)
        K.renderer.labelMaxNodes = settings.labelMaxNodes;

    if (settings.batchEdgesMinEdges !== undefined)
        K.renderer.batchEdgesMinEdges = settings.batchEdgesMinEdges;

    if (settings.minNodes !== undefined)
        K.renderer.performance.minNodes = settings.minNodes;

    try {
        return fn();
    } finally {
        K.renderer.labelMaxNodes = saved.labelMaxNodes;
        K.renderer.batchEdgesMinEdges = saved.batchEdgesMinEdges;
        K.renderer.performance.minNodes = saved.minNodes;
    }
}
