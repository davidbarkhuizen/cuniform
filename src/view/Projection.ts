import { Graph } from "../graph/Graph";
import { ProjectionScratch, Projector } from "./Projector";

/**
 * Model -> canvas projection pass, split out of `ForceDirectedGraph.project()` so
 * the render worker can project without the solver (see
 * docs/model-camera-and-rendering.md). The module scratch is safe: the pass is
 * synchronous and never re-entered.
 */

const projected: ProjectionScratch = { screenX: 0, screenY: 0, depth: 0 };

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
