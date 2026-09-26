import test from "node:test";
import assert from "node:assert/strict";

import { readAllSources } from "./support/files";

/**
 * The layering the rest of the suite depends on, asserted once over the real
 * sources: the simulation, the geometry and the static data run headless, and
 * every canvas call sits behind the one module that owns a canvas type.
 *
 * These are the only checks that read source text, so a module-boundary
 * regression has one home rather than a token check beside each module.
 */

const sources = readAllSources();

/** The DOM-free half: the solver, the projection and the catalog data. */
const PURE_MODULES = [
    "ForceDirectedGraph.ts",
    "Graph.ts",
    "GraphFactory.ts",
    "GraphSpec.ts",
    "Camera.ts",
    "Projector.ts",
    "Mat3.ts",
    "Viewport.ts",
    "Point2D.ts",
    "Point3D.ts",
    "Tag.ts",
    "Edge.ts",
    "Selection.ts",
    "State.ts",
    "Smiles.ts",
    "Molecules.ts",
    "K.ts",
];

test("the solver, projection and data stay free of browser globals", () => {
    for (const name of PURE_MODULES) {
        const source = sources[name];

        assert.ok(source, `${name} is missing from src/`);
        assert.ok(!/\bwindow\b/.test(source), `${name} must not reference window`);
        assert.ok(!/\bdocument\b/.test(source), `${name} must not reference document`);
        assert.ok(!/CanvasRenderingContext2D/.test(source), `${name} must not name a canvas type`);
    }
});

test("the renderer is the only module that draws", () => {
    const drawingCall = /\w+\.(clearRect|beginPath|moveTo|lineTo|arc|stroke|fill|fillText)\s*\(/;

    const drawers = Object.keys(sources).filter(name => drawingCall.test(sources[name]));

    assert.deepEqual(drawers, ["Renderer.ts"], "drawing must live behind the Renderer module");
});

test("no module reaches for shared state through window", () => {
    for (const [name, source] of Object.entries(sources)) {
        assert.ok(!/window\.state\b/.test(source), `${name} still reads window.state`);
        assert.ok(!/window\.fdg\b/.test(source), `${name} still reads window.fdg`);
    }

    assert.ok(
        !/declare global/.test(sources["UIController.ts"] ?? ""),
        "the Window augmentation should be gone from UIController.ts"
    );
});
