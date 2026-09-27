import test from "node:test";
import assert from "node:assert/strict";
import { posix } from "node:path";

import { readAllSources } from "./support/files";

/**
 * The layering the rest of the suite depends on, asserted once over the real
 * sources: the simulation, the geometry, the static data and the drawing code
 * run headless, and every browser global sits behind an explicitly listed
 * module.
 *
 * These are the only checks that read source text, so a module-boundary
 * regression has one home rather than a token check beside each module.
 */

const sources = readAllSources();

/**
 * Source with comments removed, so the purity rules below are about code rather
 * than prose. `render/RenderSurface.ts` legitimately names both real context
 * types in its documentation; the boundary the test enforces is that a pure
 * module never *uses* one.
 */
function code(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
}

/** The DOM-free half: the solver, the projection and the catalog data. */
const PURE_MODULES = [
    // core
    "core/Growth.ts",
    "core/K.ts",
    "core/Numeric.ts",
    "core/Point2D.ts",
    "core/Point3D.ts",
    "core/WorkerChannel.ts",
    // graph
    "graph/Components.ts",
    "graph/Edge.ts",
    "graph/Graph.ts",
    "graph/GraphFactory.ts",
    "graph/GraphSpec.ts",
    "graph/MirrorGraph.ts",
    "graph/Molecules.ts",
    "graph/Smiles.ts",
    "graph/Tag.ts",
    // view
    "view/Camera.ts",
    "view/Mat3.ts",
    "view/Projection.ts",
    "view/Projector.ts",
    "view/Viewport.ts",
    // physics
    "physics/ForceDirectedGraph.ts",
    "physics/Kernel.ts",
    "physics/Octree.ts",
    "physics/PhysicsProtocol.ts",
    "physics/Quality.ts",
    // render
    "render/RenderProtocol.ts",
    "render/RenderSurface.ts",
    "render/Renderer.ts",
    // ui
    "ui/FocusRing.ts",
    "ui/Selection.ts",
    // app
    "app/State.ts",
];

/**
 * The DOM-facing modules, with the marker that justifies each exemption. Listing
 * them explicitly is what keeps the worker boundary narrow: a purity regression
 * in the solver cannot hide by being "not in PURE_MODULES".
 */
const DOM_MODULES: Array<[string, RegExp]> = [
    ["physics/simulation.worker.ts", /\bself\b/],
    ["render/render.worker.ts", /\bself\b/],
    ["physics/PhysicsRunner.ts", /new Worker\b/],
    ["render/RenderRunner.ts", /getContext\b/],
    ["app/UIController.ts", /\bwindow\b/],
];

test("the solver, projection and data stay free of browser globals", () => {
    for (const name of PURE_MODULES) {
        const source = sources[name];

        assert.ok(source, `${name} is missing from src/`);

        const body = code(source);

        assert.ok(!/\bwindow\b/.test(body), `${name} must not reference window`);
        assert.ok(!/\bdocument\b/.test(body), `${name} must not reference document`);
        assert.ok(!/CanvasRenderingContext2D/.test(body), `${name} must not name a canvas type`);
    }
});

test("the modules that touch browser globals are classified explicitly", () => {
    for (const [name, marker] of DOM_MODULES) {
        const source = sources[name];

        assert.ok(source, `${name} is missing from src/`);
        assert.ok(marker.test(source), `${name} must justify its DOM classification`);
        assert.ok(!PURE_MODULES.includes(name), `${name} must not be listed as pure`);
    }
});

test("the renderer is the only module that draws", () => {
    const drawingCall = /\w+\.(clearRect|beginPath|moveTo|lineTo|arc|stroke|fill|fillText)\s*\(/;

    const drawers = Object.keys(sources).filter(name => drawingCall.test(sources[name]));

    assert.deepEqual(drawers, ["render/Renderer.ts"], "drawing must live behind the Renderer module");
});

test("no module reaches for shared state through window", () => {
    for (const [name, source] of Object.entries(sources)) {
        assert.ok(!/window\.state\b/.test(source), `${name} still reads window.state`);
        assert.ok(!/window\.fdg\b/.test(source), `${name} still reads window.fdg`);
    }

    assert.ok(
        !/declare global/.test(sources["app/UIController.ts"] ?? ""),
        "the Window augmentation should be gone from app/UIController.ts"
    );
});

/**
 * The package boundaries, read off the import graph rather than the docs: each
 * package may import only the packages below it.
 *
 * `core` is the vocabulary every other package speaks and has no project
 * imports of its own; `graph` is the data model built on it; `view` turns model
 * space into canvas space. Physics, rendering and the UI are peers above those
 * and none imports another; `app` is the composition root, and the bundle entry
 * (`index.ts`, package `.`) sits on top of it.
 */
const PACKAGE_DEPENDENCIES: Record<string, string[]> = {
    ".": ["app"],
    "core": [],
    "graph": ["core"],
    "view": ["core", "graph"],
    "physics": ["core", "graph", "view"],
    "render": ["core", "graph", "view"],
    "ui": ["core", "graph", "view"],
    "app": ["core", "graph", "view", "physics", "render", "ui"],
};

/** `core/K.ts` -> `core`; the bundle entry `index.ts` -> `.`. */
function packageOf(path: string): string {
    const slash = path.indexOf("/");

    return slash === -1 ? "." : path.slice(0, slash);
}

/** The `src/`-relative module path an import specifier names. */
function resolveImport(from: string, specifier: string): string {
    const resolved = posix.normalize(posix.join(posix.dirname(from), specifier));

    return resolved.endsWith(".ts") ? resolved : `${resolved}.ts`;
}

test("packages depend only on the layers below them", () => {
    const importStatement = /from\s+["']([^"']+)["']/g;

    for (const [path, source] of Object.entries(sources)) {
        const from = packageOf(path);

        assert.ok(from in PACKAGE_DEPENDENCIES, `${path} is not in a known package`);

        for (const [, imported] of code(source).matchAll(importStatement)) {
            // The project uses no path aliases, so only a relative specifier
            // can reach another source module.
            if (!imported.startsWith("."))
                continue;

            const target = resolveImport(path, imported);
            const to = packageOf(target);

            if (to === from)
                continue;

            assert.ok(
                PACKAGE_DEPENDENCIES[from].includes(to),
                `${path} imports ${target}, so ${from} must not depend on ${to}`
            );
        }
    }
});
