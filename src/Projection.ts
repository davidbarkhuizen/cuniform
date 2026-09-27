import { Graph } from "./Graph";
import { ProjectionScratch, Projector } from "./Projector";

/**
 * The model -> canvas projection pass: cache each node's canvas position and
 * view depth under one projector.
 *
 * Split out of `ForceDirectedGraph.project()` so a projection pass can run
 * without the solver: the render worker (see docs/model-camera-and-rendering.md)
 * draws with this, and bundling the octree and the force kernel to project a
 * graph would be waste. The loop is moved, not rewritten — same order, same
 * `projectInto`/`toCanvasInto` calls — so its output is bit-identical to the
 * solver's own pass.
 *
 * Shared module scratch, so a pass allocates nothing; the pass is synchronous
 * and never re-entered, so one scratch is safe.
 */

const projected: ProjectionScratch = { screenX: 0, screenY: 0, depth: 0 };

/**
 * One projector for the whole pass: the camera and viewport are loop invariants,
 * resolved once per tick, not per node. An indexed loop, so no array iterator is
 * allocated.
 */
export function projectGraph(graph: Graph, projector: Projector): void {

    const vertices = graph.vertices;

    for (let i = 0; i < vertices.length; i++) {
        const node = vertices[i];

        projector.projectInto(node.position, projected);
        projector.viewport.toCanvasInto(
            projected.screenX,
            projected.screenY,
            node.translatedPosition
        );
        node.depth = projected.depth;
    }
}
