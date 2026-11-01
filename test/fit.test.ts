import test from "node:test";
import assert from "node:assert/strict";

import { BAND_STRIDE, BAND_X_MAX, BAND_X_MIN, BAND_Y, BAND_Z_MAX, BAND_Z_MIN } from "../src/graph/Attributes";
import { buildGraph } from "../src/network/BuildGraph";
import { fitView } from "../src/view/Fit";
import { K } from "../src/core/K";
import { point3 } from "../src/core/Point3D";
import { Projector } from "../src/view/Projector";
import { readFormat2 } from "../src/network/Format2";
import { sequenceModel } from "./support/format2";
import { withUIController } from "./support/dom";

const bandsOf = () => buildGraph(readFormat2(sequenceModel())).graph.attributes!.bands;

/** Every band corner, projected through the fitted camera onto an 800 x 600 canvas. */
function projectedCorners(bands: Float64Array, projector: Projector): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];

    for (let o = 0; o < bands.length; o += BAND_STRIDE)
        for (const x of [bands[o + BAND_X_MIN], bands[o + BAND_X_MAX]])
            for (const z of [bands[o + BAND_Z_MIN], bands[o + BAND_Z_MAX]]) {
                const { screen } = projector.project(point3(x, bands[o + BAND_Y], z));
                out.push(projector.viewport.toCanvas(screen));
            }

    return out;
}

test("the fitted view puts every band on screen and aims at the model's centre", () => {
    const bands = bandsOf();
    const view = fitView(bands)!;
    const projector = Projector.forCanvas(800, 600, view);

    for (const corner of projectedCorners(bands, projector)) {
        assert.ok(corner.x >= 0 && corner.x <= 800, `x ${corner.x} on screen`);
        assert.ok(corner.y >= 0 && corner.y <= 600, `y ${corner.y} on screen`);
    }

    assert.ok(view.distance >= K.camera.minDistance && view.distance <= K.camera.maxDistance);
    assert.ok(Math.abs(view.target.y) < 1e-9, "the band stack is centred on y = 0");
});

test("the fitted view looks slightly down on the bands, so they read as slabs", () => {
    const projector = Projector.forCanvas(800, 600, fitView(bandsOf())!);

    // From above, the near edge of a horizontal slab draws below its far edge.
    const near = projector.viewport.toCanvas(projector.project(point3(0, 0, -100)).screen);
    const far = projector.viewport.toCanvas(projector.project(point3(0, 0, 100)).screen);
    const nearIsCloser = projector.project(point3(0, 0, -100)).depth < projector.project(point3(0, 0, 100)).depth;

    const [lower, upper] = nearIsCloser ? [near, far] : [far, near];
    assert.ok(lower.y > upper.y + 1, "the slab has visible depth on screen");
});

test("a deeper model is framed from further away", () => {
    const shallow = fitView(bandsOf())!;
    const tall = bandsOf().slice();

    for (let o = 0; o < tall.length; o += BAND_STRIDE)
        tall[o + BAND_Y] *= 3;

    assert.ok(fitView(tall)!.distance > shallow.distance);
    assert.equal(fitView(new Float64Array(0)), null);
});

test("loading a banded graph frames it once; reset keeps the viewer's camera", () => {
    withUIController(({ controller }) => {
        const graph = buildGraph(readFormat2(sequenceModel())).graph;

        controller.loadGraph(graph);

        const fitted = fitView(graph.attributes!.bands)!;
        assert.equal(controller.state.camera.distance, fitted.distance);

        controller.state.camera.dolly(3);
        const chosen = controller.state.camera.distance;

        controller.loadGraph(buildGraph(readFormat2(sequenceModel())).graph, false);
        assert.equal(controller.state.camera.distance, chosen, "a reload of the same model keeps the camera");
    });
});
