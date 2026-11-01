// Positions across a rebuild (workplan D7): expanding or collapsing builds a new render graph, and the
// layout carries over by stable id. A node whose id survives keeps its position; a component's new units
// are seeded on a grid centred on its collapsed node's last position; a collapsed node returns to the
// centroid of its units. Everything lands inside its band, so invariant 10 holds before the first step.

import { BAND_HALF, BAND_STRIDE, BAND_X_MAX, BAND_X_MIN, BAND_Y, BAND_Z_MAX, BAND_Z_MIN, NO_BAND } from "../graph/Attributes";
import { BuiltGraph } from "./BuildGraph";
import { K } from "../core/K";
import { Point3D } from "../core/Point3D";

const UNIT_SUFFIX = /\/u(\d+)$/;

function clampInto(p: Point3D, bands: Float64Array, b: number): void {
    if (b === NO_BAND)
        return;

    const o = b * BAND_STRIDE;

    p.x = Math.min(Math.max(p.x, bands[o + BAND_X_MIN]), bands[o + BAND_X_MAX]);
    p.y = Math.min(Math.max(p.y, bands[o + BAND_Y] - bands[o + BAND_HALF]), bands[o + BAND_Y] + bands[o + BAND_HALF]);
    p.z = Math.min(Math.max(p.z, bands[o + BAND_Z_MIN]), bands[o + BAND_Z_MAX]);
}

/** Writes `previous`'s layout onto `next`'s nodes by id; nodes with no counterpart keep their band-grid seed. */
export function carryPositions(previous: BuiltGraph, next: BuiltGraph): void {

    const old = new Map<string, Point3D>();

    previous.ids.forEach((id, i) => old.set(id, previous.graph.vertices[i].position));

    // Each previously expanded component's units, for the centroid of a collapse.
    const units = new Map<string, Point3D[]>();

    previous.ids.forEach((id, i) => {
        const match = UNIT_SUFFIX.exec(id);

        if (match === null)
            return;

        const component = id.slice(0, match.index);
        const list = units.get(component) ?? [];
        list.push(previous.graph.vertices[i].position);
        units.set(component, list);
    });

    // How many units each newly expanded component has, for its grid.
    const counts = new Map<string, number>();

    next.ids.forEach(id => {
        const match = UNIT_SUFFIX.exec(id);

        if (match !== null) {
            const component = id.slice(0, match.index);
            counts.set(component, (counts.get(component) ?? 0) + 1);
        }
    });

    const attributes = next.graph.attributes;
    const spacing = K.network.unitSpacing;

    next.ids.forEach((id, i) => {
        const p = next.graph.vertices[i].position;
        const same = old.get(id);
        const match = UNIT_SUFFIX.exec(id);

        if (same !== undefined) {
            p.x = same.x;
            p.y = same.y;
            p.z = same.z;
        }
        else if (match !== null && old.has(id.slice(0, match.index))) {
            const centre = old.get(id.slice(0, match.index))!;
            const n = counts.get(id.slice(0, match.index)) ?? 1;
            const columns = Math.ceil(Math.sqrt(n));
            const rows = Math.ceil(n / columns);
            const k = Number(match[1]);

            p.x = centre.x + ((k % columns) - (columns - 1) / 2) * spacing;
            p.y = centre.y;
            p.z = centre.z + (Math.floor(k / columns) - (rows - 1) / 2) * spacing;
        }
        else if (units.has(id)) {
            const list = units.get(id)!;

            p.x = list.reduce((sum, q) => sum + q.x, 0) / list.length;
            p.y = list.reduce((sum, q) => sum + q.y, 0) / list.length;
            p.z = list.reduce((sum, q) => sum + q.z, 0) / list.length;
        }
        else {
            return;
        }

        if (attributes !== null)
            clampInto(p, attributes.bands, attributes.band[i]);
    });
}
