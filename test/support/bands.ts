import { BAND_HALF, BAND_STRIDE, BAND_X_MAX, BAND_X_MIN, BAND_Y, BAND_Z_MAX, BAND_Z_MIN } from "../../src/graph/Attributes";
import { Graph } from "../../src/graph/Graph";

/** Whether every node lies inside its band's box (invariant: layers in bands). */
export function bandViolations(graph: Graph): string[] {
    const a = graph.attributes!;
    const out: string[] = [];

    graph.vertices.forEach((tag, i) => {
        const band = a.band[i];

        if (band < 0)
            return;

        const o = band * BAND_STRIDE;
        const p = tag.position;
        const inside =
            Math.abs(p.y - a.bands[o + BAND_Y]) <= a.bands[o + BAND_HALF] &&
            p.x >= a.bands[o + BAND_X_MIN] && p.x <= a.bands[o + BAND_X_MAX] &&
            p.z >= a.bands[o + BAND_Z_MIN] && p.z <= a.bands[o + BAND_Z_MAX];

        if (!inside)
            out.push(`node ${i} (${tag.label}) outside band ${band}`);
    });

    return out;
}

