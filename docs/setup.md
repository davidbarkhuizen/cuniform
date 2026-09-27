# Setup

## Running

    ./cli install        # npm install
    ./cli run            # build, then open web/index.html in a browser

`cli` is the single entry point for common tasks; `./cli help` lists every
subcommand. With no recognised option it prints usage.

## Development

    ./cli typecheck      # tsc --noEmit over src/, test/ and bench/
    ./cli test           # compile test/ and run it under node:test
    ./cli ci             # typecheck + test
    ./cli bench          # compile and run the performance benchmark
    ./cli build          # typecheck, then bundle with webpack
    ./cli clean          # remove build artefacts

Except for `clean` (which removes the build directories directly) and `run`
(which goes through `build-and-run.sh`), each delegates to the matching npm
script (`npm run typecheck`, `npm test`, `npm run ci`, `npm run bench`, `npm run
start`, `npm install`). `npm run dev` rebuilds while you edit, and `BROWSER=...
./cli run` (or `bash build-and-run.sh --build-only`) controls how the demo is
launched.

`npm run start` type-checks before it bundles because the webpack loader only
transpiles: `esbuild-loader` strips types without checking them, so `tsc` stays
the thing that reports type errors.

`web/` holds the hand-maintained shell (`index.html`, `stylez.css`); it loads
the generated `dist/main.js`. `dist/` is build output only and is ignored by
git. Webpack emits separate entries for the physics worker
(`dist/simulation.worker.js`) and the render worker (`dist/render.worker.js`),
which the app constructs by URL (see [Cadence](physics.md#cadence) and
[The render worker](model-camera-and-rendering.md#the-render-worker)), and for
the real-canvas frame harness (`dist/render-frame.js`, see
[Performance](performance.md)).

Tests never construct a real `Worker` or `OffscreenCanvas`: both cross the seams
as injected ports ([`test/support/dom.ts`](../test/support/dom.ts)), so the
worker paths run under `node --test` with in-memory fakes.

## Source layout

`src/` is split into packages along its import graph, and each package may
import only the packages below it. `test/architecture.test.ts` reads the imports
back and enforces that direction, so a new cross-package edge fails the suite
rather than eroding the layering.

- `core/` — the vocabulary every other package speaks: the tuning constants
  (`K`), the geometry primitives (`Point2D`, `Point3D`), `Numeric`, the
  buffer-growth policy (`Growth`) and the worker-port types. It imports no other
  project package.
- `graph/` — the graph data model and its builders: `Tag`, `Edge`, `Graph`,
  `GraphSpec`, `GraphFactory`, the worker mirror (`MirrorGraph`), and the SMILES
  reader (`Smiles`) with the molecule catalog (`Molecules`).
- `view/` — the model-to-canvas transform: `Mat3`, `Viewport`, the perspective
  `Projector`, the `Projection` pass and the orbit `Camera`. Pure math, so the
  solver can project without naming a canvas type.
- `physics/` — the solver and its worker: the force `Kernel`, the Barnes-Hut
  `Octree`, the opening-angle policy (`Quality`), `ForceDirectedGraph`, and the
  physics worker's protocol, runner and entry.
- `render/` — the drawing and its worker: `RenderSurface`, `Renderer`, and the
  render worker's protocol, runner and entry.
- `ui/` — the interaction widgets: `ContextMenu`, `GraphWizard`,
  `DragController`, `FocusRing` and node hit-testing (`Selection`).
- `app/` — the composition root: `State`, `UIController` and the demo
  `entrypoint`. `src/index.ts` is the webpack entry that boots it.

Physics, rendering and the UI are peers and none imports another; `app` composes
all three, and the entry sits above `app`.
