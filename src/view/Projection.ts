import {
    BAND_STRIDE,
    BAND_X_MAX,
    BAND_X_MIN,
    BAND_Y,
    BAND_Z_MAX,
    BAND_Z_MIN,
    EdgeKind,
    GraphAttributes,
} from "../graph/Attributes";
import { Graph } from "../graph/Graph";
import { K } from "../core/K";
import { isDepthCulled, ProjectionScratch, Projector } from "./Projector";
import { Point2D } from "../core/Point2D";
import { Point3D } from "../core/Point3D";

/**
 * Model -> canvas projection pass, split out of `ForceDirectedGraph.project()` so
 * the render worker can project without the solver (see
 * docs/model-camera-and-rendering.md). The module scratch is safe: the pass is
 * synchronous and never re-entered.
 */

const projected: ProjectionScratch = { screenX: 0, screenY: 0, depth: 0 };
const corner: Point3D = { x: 0, y: 0, z: 0 };
const canvas: Point2D = { x: 0, y: 0 };

/** Four corners' canvas x and y, then the band centre's depth. */
export const BAND_SCREEN_STRIDE = 9;
export const BAND_SCREEN_DEPTH = 8;

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

    if (graph.attributes !== null)
        projectNetwork(graph, graph.attributes, projector);
}

// The x and z of a band's corners, in drawing order around the footprint.
const CORNER_X = [BAND_X_MIN, BAND_X_MAX, BAND_X_MAX, BAND_X_MIN];
const CORNER_Z = [BAND_Z_MIN, BAND_Z_MIN, BAND_Z_MAX, BAND_Z_MAX];

/** Projects the band outlines and the curved edges' control points into the graph's per-frame caches. */
function projectNetwork(graph: Graph, attributes: GraphAttributes, projector: Projector): void {

    const bands = attributes.bands;
    const bandCount = bands.length / BAND_STRIDE;
    const nearPlane = projector.camera.nearPlane;

    if (graph.bandScreen === null || graph.bandScreen.length !== bandCount * BAND_SCREEN_STRIDE)
        graph.bandScreen = new Float64Array(bandCount * BAND_SCREEN_STRIDE);

    const screen = graph.bandScreen;

    for (let b = 0; b < bandCount; b++) {
        const o = b * BAND_STRIDE;
        const s = b * BAND_SCREEN_STRIDE;
        let culled = false;

        corner.y = bands[o + BAND_Y];

        for (let c = 0; c < 4; c++) {
            corner.x = bands[o + CORNER_X[c]];
            corner.z = bands[o + CORNER_Z[c]];

            projector.projectInto(corner, projected);
            projector.viewport.toCanvasInto(projected.screenX, projected.screenY, canvas);

            screen[s + 2 * c] = canvas.x;
            screen[s + 2 * c + 1] = canvas.y;
            culled = culled || isDepthCulled(projected.depth, nearPlane);
        }

        corner.x = (bands[o + BAND_X_MIN] + bands[o + BAND_X_MAX]) / 2;
        corner.z = (bands[o + BAND_Z_MIN] + bands[o + BAND_Z_MAX]) / 2;
        projector.projectInto(corner, projected);

        // A band with a culled corner is not drawn: there is no near-plane clipping.
        screen[s + BAND_SCREEN_DEPTH] = culled ? NaN : projected.depth;
    }

    const edges = graph.edges;

    if (graph.edgeControls === null || graph.edgeControls.length !== edges.length * 2)
        graph.edgeControls = new Float64Array(edges.length * 2);

    const controls = graph.edgeControls;

    for (let j = 0; j < edges.length; j++) {
        const kind = attributes.edgeKind[j] & ~EdgeKind.dotted;

        if (kind !== EdgeKind.residual && kind !== EdgeKind.recurrent) {
            controls[2 * j] = NaN;
            controls[2 * j + 1] = NaN;
            continue;
        }

        // In model space, so a curve rotates with the scene: a residual bows out along +x of its stack, a
        // recurrent loop along -x, each by a share of the height it spans.
        const a = edges[j].v1.position;
        const z = edges[j].v2.position;
        const span = Math.abs(z.y - a.y);
        const bow = kind === EdgeKind.residual
            ? K.network.residualBow * span + K.network.residualOffset
            : -(K.network.recurrentBow * span + K.network.recurrentOffset);

        corner.x = (a.x + z.x) / 2 + bow;
        corner.y = (a.y + z.y) / 2;
        corner.z = (a.z + z.z) / 2;

        projector.projectInto(corner, projected);

        if (isDepthCulled(projected.depth, nearPlane)) {
            controls[2 * j] = NaN;
            controls[2 * j + 1] = NaN;
            continue;
        }

        projector.viewport.toCanvasInto(projected.screenX, projected.screenY, canvas);
        controls[2 * j] = canvas.x;
        controls[2 * j + 1] = canvas.y;
    }
}
