// Lives outside `support/dom.ts` so the benchmark can use it without pulling in the DOM fakes.

import { K } from "../../src/core/K";

export interface RendererSettings {
    labelMaxNodes?: number;
    batchEdgesMinEdges?: number;
    minNodes?: number;
}

// `K` must not be mutated at runtime; one helper covers all three keys so a new one cannot be missed.
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
