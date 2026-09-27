import test from "node:test";
import assert from "node:assert/strict";
import { posix } from "node:path";

import { readAllSources } from "./support/files";

// The suite's only source-text checks: the headless half must stay free of browser
// globals, and every module that touches one must be listed explicitly.
const sources = readAllSources();

// Comments are stripped so the purity rules are about code, not prose:
// render/RenderSurface.ts may *name* context types in docs, but a pure module must never *use* one.
function code(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
}

/** The DOM-free half: the solver, the projection and the catalog data. */
const PURE_MODULES = [
    "core/Emphasis.ts",
    "core/Growth.ts",
    "core/K.ts",
    "core/Numeric.ts",
    "core/Point2D.ts",
    "core/Point3D.ts",
    "core/WorkerChannel.ts",
    "graph/Components.ts",
    "graph/Edge.ts",
    "graph/Graph.ts",
    "graph/GraphFactory.ts",
    "graph/GraphSpec.ts",
    "graph/MirrorGraph.ts",
    "graph/Molecules.ts",
    "graph/Smiles.ts",
    "graph/Tag.ts",
    "view/Camera.ts",
    "view/Mat3.ts",
    "view/Projection.ts",
    "view/Projector.ts",
    "view/Viewport.ts",
    "physics/ForceDirectedGraph.ts",
    "physics/Kernel.ts",
    "physics/Octree.ts",
    "physics/PhysicsProtocol.ts",
    "physics/Quality.ts",
    "render/RenderProtocol.ts",
    "render/RenderSurface.ts",
    "render/Renderer.ts",
    "ui/FocusRing.ts",
    "ui/Selection.ts",
    "app/State.ts",
];

// Listing exemptions explicitly keeps a purity regression from hiding by omission.
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

// Each package may import only the packages below it; physics, render and ui are
// peers, and app is the composition root.
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
            // No path aliases: only a relative specifier can reach another source module.
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
