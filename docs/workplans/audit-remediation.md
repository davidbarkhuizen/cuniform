# Audit remediation — two worker-path bugs, worker robustness, and hygiene

| | |
| --- | --- |
| **Status** | Planned |
| **Area** | `src/render/Renderer.ts`, `src/render/RenderProtocol.ts`, `src/render/RenderRunner.ts`, `src/render/render.worker.ts`, `src/physics/PhysicsRunner.ts`, `src/physics/PhysicsProtocol.ts`, `src/physics/ForceDirectedGraph.ts`, `src/graph/Components.ts`, `src/graph/GraphFactory.ts`, `src/graph/GraphSpec.ts`, `src/graph/Smiles.ts`, `src/app/UIController.ts`, `src/ui/*.ts`, `src/core/K.ts`, new `src/core/Random.ts`, `web/index.html`, `package.json`, new `.github/workflows/ci.yml`, new `.editorconfig`, new `.git-blame-ignore-revs`, `test/architecture.test.ts`, `test/render-worker.test.ts`, `test/render-runner.test.ts`, `test/physics-runner.test.ts`, `test/support/dom.ts`, docs |
| **Depends on** | nothing outstanding: `main` is green at 73eaf32 (`npm run ci`, 561 tests; dev and production bundles build) |
| **Blocks** | nothing; [Next steps](../next-steps.md) row 4 (embeddable component) gets easier once phases B and C land |
| **Evidence** | a codebase audit on 2026-11-01. Two bugs were reproduced with throwaway tests against `main`; they are summarised in §2 and become the regression tests in PRs 3 and 4 |

## 1. Goal

Resolve every finding of the 2026-11-01 audit:

- **Fix the two confirmed bugs on the default (worker) paths.** The selected node
  is never highlighted by the render worker, and a dragged node lags and
  flickers on the physics worker path.
- **Make both workers fail loudly and recover.** No worker failure or graph
  change may leave a frozen canvas, a stuck layout, NaN positions or a promise
  that never settles. This matters most once cuniform is embedded, because a
  host cannot see the workers.
- **Close the hygiene gaps.** Add CI on push, standards-mode HTML, a clean
  `npm audit`, `textContent` in place of `innerHTML`, a correct repository URL,
  reproducible random graphs, a narrower architecture guard and one code style.
- **Either support touch on the canvas or document that it is missing.** This
  plan does both: the limitation is documented first and fixed last.

Each phase leaves `main` green and changes behaviour only where a finding says
it is wrong.

## 2. Findings, and the evidence for each

| # | Finding | Severity | Evidence |
| ---: | --- | --- | --- |
| F1 | The render worker never highlights the selected node | bug, default path | `Renderer.ts:393/398/520` read `node.isSelected`. The worker's mirror graph is rebuilt from wire data and never sets it; the selection crosses only as the `selected` argument (`RenderProtocol.ts:201`). Repro: fills drawn directly were `['#ffd400','#39d98a']`, through the worker `['#39d98a','#39d98a']`. `test/render-worker.test.ts` misses it because its reference draw (`directDraw()`) also renders a mirror, so both sides lack the flag |
| F2 | A dragged node lags and flickers on the physics worker path | bug, default path | `UIController.advanceOneTick()` posts the pin, then `runner.sync(graph)` (`UIController.ts:715`) writes the worker's previous reply over every tag, including the pinned one. Repro: after tick 1 the node was at x=0 (pointer at 100); after tick 2 it was at x=100 (pointer at 200). Mouse-move redraws show the cursor position and tick redraws show the stale one |
| F3 | A render worker failure after the canvas transfer freezes the canvas silently | latent | `WorkerBackend.fail()` returns early once `probePassed`. A frame that is never acked leaves `inFlight` set for good. `render.worker.ts` returns without replying when `getContext` is null. `exportPng()` never settles when the worker has no canvas or `convertToBlob` rejects |
| F4 | A graph grown in place stops rendering, and goes NaN on the physics worker | latent | Render: `sendFrame()` pops a buffer, finds the length wrong, and drops it (`RenderRunner.ts:345`); after three frames nothing is sent again. Physics: `WorkerBackend.sync()` writes a `latest` sized to the old N, so new tags read `undefined` and become NaN. A new edge at constant N is never sent to either mirror. `Graph` is append-only and the solver supports in-place growth (`test/solver.test.ts`), so this is a supported input |
| F5 | A second `initialize()` on the same canvas leaves it blank in worker mode | latent, inferred from the spec | The second `transferControlToOffscreen()` throws, and the fallback then calls `getContext('2d')` on the transferred canvas, which throws `InvalidStateError`. The repro was reasoned from the spec, not run; PR 6 runs it in a browser before anything else |
| F6 | `innerHTML` with node labels | latent XSS | `UIController.ts:681/853/856/864`, `ContextMenu.ts:45` and 16 sites in `GraphWizard.ts`. Today's labels are generated or come from the catalog; once a host supplies them, any label is markup |
| F7 | A physics worker that hangs freezes the layout silently | latent | Only `onerror` triggers the fallback; with a step in flight, `inFlight` blocks every later step |
| F8 | No CI on GitHub | hygiene | No `.github/workflows`, although the repo is public and `npm run ci` exists |
| F9 | The demo page renders in quirks mode | hygiene | `web/index.html` has no `<!doctype html>` and three overlapping charset declarations |
| F10 | `npm audit`: 3 moderate issues, all dev-only | hygiene | `fast-uri` through webpack's schema validation; `minimatch` through `nodemon` |
| F11 | Malformed repository URL | hygiene | `package.json` reads `git@github:davidbarkhuizen/...`, missing `.com` |
| F12 | Random graphs cannot be reproduced | hygiene | `GraphFactory` calls `Math.random()` with no seed, so invariant 4 holds only once positions exist |
| F13 | The architecture guard's drawing-call pattern is too broad | hygiene | `/\w+\.(…\|fill\|…)\s*\(/` also matches `Float64Array.prototype.fill`, so `ForceDirectedGraph.stepPhysics()` and `labelComponents()` clear buffers with hand-written loops and comments explaining the workaround |
| F14 | The canvas takes mouse input only | gap, undocumented | Only `mousedown`, `mousemove`, `mouseup`, `wheel` and `contextmenu` are bound, so touch cannot select, orbit or zoom, and `docs/known-limitations.md` does not say so |
| F15 | Mixed code style | cosmetic | Tabs and spaces mixed within files; `var` in `ForceDirectedGraph`, `Graph`, `GraphFactory` and `UIController` |
| F16 | Coarse edges-on-top frames draw the selection's ring and labels twice | minor | `Renderer.ts:243` draws them under the mesh and `:248` over it, so labels composite twice |
| F17 | The SMILES reader accepts three malformed inputs | minor | A leading bond symbol (`=C`), a bond symbol before a branch (`C=(O)`), and ring-closure bond orders that disagree (`C=1CCCC-1`) |

The audit also checked these and found them sound; this plan leaves them alone:
the octree's self-exclusion, bounded depth and NaN-safe termination; the
traversal stack size; both workers' generation guards; the pure-module layering;
and camera orthonormality (|RRᵀ−I| = 3e-11 after 10⁶ rotations, so no
re-orthonormalisation is needed).

## 3. Decisions of record

Settled before implementation. Each was chosen for correctness first, then for
extensibility (the embedding API in next-steps row 4) and speed. PRs do not
reopen them unless implementation shows one cannot work, in which case §11
records why.

| # | Decision | Choice |
| --- | --- | --- |
| D1 | One selection source | The renderer tests `node === selected` and never reads `Tag.isSelected` |
| D2 | Pin overlay in the runner | The physics runner owns the pin; `sync()` writes it over the worker's reply |
| D3 | Graph shape tracking | Both worker backends record `(vertices.length, edges.length)` at init and re-init when either changes |
| D4 | Worker watchdogs | One ack timeout per worker, 5000 ms, as named constants in `K` |
| D5 | Canvas swap recovery | A render failure after the transfer swaps in a fresh `<canvas>` and continues in-process; the same swap serves a second `initialize()` |
| D6 | Export settles | `exportPng()` always resolves or rejects: the worker replies with an error, and a timeout covers silence |
| D7 | No `innerHTML` | Every site moves to `textContent`, and the architecture test bans `innerHTML` in `src/` |
| D8 | CI is required | A GitHub Actions workflow runs `npm ci`, `npm run ci` and the production build, and is a required check on `main` |
| D9 | Drop nodemon | `npm run dev` becomes `webpack --watch`; nodemon leaves the dependency tree |
| D10 | Seeded random graphs | The random `GraphSpec` carries a `seed`, drawn through a small pure PRNG |
| D11 | Guard by call shape | The guard matches a canvas `fill()` by its no-argument shape, so `typedArray.fill(0)` passes |
| D12 | Style by guard, not tooling | `.editorconfig` plus a source-scanning test (no tab indentation, no `var`); one mechanical reformat commit, listed in `.git-blame-ignore-revs` |
| D13 | Touch via Pointer Events | The canvas moves from mouse events to Pointer Events, with a fixed touch gesture map (§4.11); documented as a limitation until that PR lands |
| D14 | Strict SMILES | All three malformed inputs in F17 throw `SmilesError` |

### Options weighed

Only the decisions with a real alternative are listed.

**D1, one selection source.**
- *Chosen: the renderer tests `node === selected`.*
  - Pro: `render()` already takes `selected` as "the caller's cached selection", so this removes a second source of truth instead of keeping two in sync. It also holds for every future backend, such as WebGL or an embedding host.
  - Pro: one comparison per node, no allocation.
  - Con: `Tag.isSelected` remains as UI state that the renderer ignores, so it needs a doc line.
- *Rejected: the worker engine sets `isSelected` on its mirror each frame.*
  - Pro: a small diff.
  - Con: it keeps two sources, adds O(1) clear-and-set mirror state to every frame, and the next mirror (row 2's merged worker) would have to remember to do the same.

**D2, pin overlay.**
- *Chosen: the runner owns the pin.* `step()` records `(index, x, y, z)` even when it does not post (a step already in flight). `WorkerBackend` writes the pin into `latest` when recording it and again on every reply, so `positions()` and `sync()` always carry it.
  - Pro: one home, next to `stepWithPin()`, so both backends mean the same thing by a pin.
  - Pro: also fixes a pin lost while a step was in flight.
  - Pro: `UIController` is unchanged.
- *Rejected: `UIController` re-applies the pin after `sync()`.*
  - Pro: about three lines.
  - Con: `positions()` stays wrong, the pin rule now lives in two layers, and an embedding host would have to repeat it.

**D3, graph shape tracking.**
- *Chosen: re-init on a change of shape.*
  - Pro: O(1) per frame or step.
  - Pro: honours `Graph`'s documented append-only contract, and catches a new edge at constant N, which the buffer-length check alone cannot.
- *Rejected: forbid in-place growth after hand-off and document it.*
  - Pro: no code.
  - Con: it contradicts the solver's tested behaviour and leaves a NaN trap for embedders.

**D4, watchdog length.**
- *Chosen: 5000 ms.* The worst measured step is 27 ms at 4096 nodes ([Performance](../performance.md)), so this is about 185× headroom.
  - Pro: a false positive needs a pathological stall.
  - Pro: background-tab timer throttling (≥ 1 s) cannot trigger it.
  - Con: a real hang takes 5 s to recover. That is acceptable, because today it never recovers.
- *Rejected: an adaptive timeout from measured frame times.*
  - Con: more state, and a cold start has no measurement to adapt from.

**D5, canvas swap recovery.**
- *Chosen: swap the element.* `UIController.replaceCanvas()` clones the element shallowly (keeping `id`, `tabindex`, `role`, `aria-label` and the fallback text), calls `replaceWith()`, re-binds only the canvas listeners, resizes and redraws. `RenderRunner` takes a `replaceCanvas: () => HTMLCanvasElement` callback, so the runner stays DOM-agnostic beyond the type it already names. A module-level `WeakSet` of transferred canvases lets `RenderRunner.create()` ask for a swap up front instead of failing (F5).
  - Pro: the user never sees a frozen picture.
  - Pro: one mechanism covers F3 and F5.
  - Pro: the embedding API inherits it.
  - Con: it is the largest PR in the plan, and the canvas element's identity changes, so a host holding a reference must re-read it. That is documented as part of the component contract.
- *Rejected: report only* (`console.error` plus an `onError` hook).
  - Pro: small.
  - Con: the picture stays frozen. It fixes the silence, not the failure.
- *Rejected: restart the worker.*
  - Con: impossible, because the `OffscreenCanvas` died with the old worker.

**D7, no `innerHTML`.**
- *Chosen: ban it everywhere.*
  - Pro: a one-line guard with no exceptions to remember.
  - Pro: the static strings lose nothing by moving to `textContent`.
- *Rejected: change only the label sites.*
  - Con: the next label site would reintroduce the hole with nothing to stop it.

**D8, required CI.**
- *Chosen: required.*
  - Pro: the squash-merge workflow then cannot land a red `main`.
  - Con: a merge waits about a minute for the run.
- *Rejected: advisory CI.*
  - Con: CI then reports a regression after it has merged.

**D9, drop nodemon.**
- *Chosen: `webpack --watch`.*
  - Pro: removes the vulnerable `minimatch` path, one dependency, and its `allowScripts` entry.
  - Pro: webpack's own watcher rebuilds only what changed.
  - Con: the dev loop no longer type-checks before each bundle. `docs/setup.md` gains `npm run typecheck -- --watch` for a second terminal.
- *Rejected: an `overrides` pin of `minimatch@^11`.*
  - Con: nodemon 3 calls the v3 default-export API, so the pin breaks `npm run dev`.

**D10, seeded random graphs.**
- *Chosen: a `seed` in the spec.* A new pure `core/Random.ts` exports `mulberry32(seed)`: 32-bit state, a few operations per draw, and a well-known output quality that is ample for layout seeding. A spec without a seed draws one, so behaviour is unchanged. The seed shows in the current-graph label, and the chooser gains an optional seed field (blank means random).
  - Pro: any layout bug becomes reproducible from the panel.
  - Pro: the tests can assert exact generated graphs.
- *Rejected: a seed only in tests* (an injected RNG).
  - Con: a user-visible bad layout still cannot be reproduced.

**D11, guard by call shape.**
- *Chosen: match `\.fill\s*\(\s*\)`* for the canvas call, keeping the other drawing names.
  - Pro: no new dependency; the guard stays a cheap tripwire.
  - Con: `context.fill("evenodd")` would slip through. Nothing in `src/` uses a fill rule, and the guard is a tripwire, not a proof.
- *Rejected: a receiver allowlist* (`context.`, `ctx.`, `surface.`).
  - Con: renaming a variable defeats it.
- *Rejected: a type-aware check through the TypeScript compiler API.*
  - Pro: exact.
  - Con: compiles `src/` inside a unit test, slow for a tripwire.

**D12, style by guard.**
- *Chosen: a guard test.*
  - Pro: no new devDependencies, and it uses the repo's existing tests-as-guards pattern.
  - Con: it covers only indentation and `var`, not full formatting.
- *Rejected: Prettier plus ESLint.*
  - Pro: complete formatting.
  - Con: two dependency trees, configuration, and a much larger first diff.
- *Rejected: leave it.*
  - Con: every edit keeps choosing between tabs and spaces.

**D13, touch via Pointer Events.**
- *Chosen: migrate the canvas to Pointer Events with a touch gesture map.*
  - Pro: one event model for mouse, pen and touch. `DragController` already uses Pointer Events.
  - Con: gestures need a design (§4.11), and the controller's mouse tests move to pointer fakes.
- *Rejected: document the limitation only.*
  - Con: it leaves the gap open. The documentation still lands first (PR 9), so the gap is honest in the meantime.

## 4. Design

### 4.1 One selection source (F1, D1)

- `Renderer.ts`: `drawNode()` and `drawBatchedNodeFills()` compute
  `const isSelected = node === selected` and use it for the fill colour and the
  ring. `drawBatchedNodeFills()` gains the `selected` argument.
- `Tag.isSelected` keeps its role as UI state, read by `Selection.ts`, the drag
  and `Graph.selectedVertex()`. `UIController.refreshSelection()` stays the one
  bridge from that state to the renderer's `selected`.
- `docs/model-camera-and-rendering.md` says that `selected` is the only selection
  input to the renderer.

### 4.2 Pin overlay (F2, D2)

The `PhysicsBackend` interface is unchanged. `WorkerBackend` gains:

```ts
private pinIndex = -1;
private pinX = 0; private pinY = 0; private pinZ = 0;

step(pinnedIndex, x, y, z) {
    this.recordPin(pinnedIndex, x, y, z);   // always, even when not posting
    if (this.inFlight || this.disposed) return;
    ...post...
}

private recordPin(...) { /* store the pin, then applyPin(this.latest) */ }
private applyPin(buffer: Float64Array) {
    const i = this.pinIndex;
    if (i < 0 || 3 * i + 2 >= buffer.length) return;
    buffer[3 * i] = this.pinX; buffer[3 * i + 1] = this.pinY; buffer[3 * i + 2] = this.pinZ;
}
// receive(): this.latest = message.positions; this.applyPin(this.latest);
// reinit(): pinIndex = -1
```

A release is `step(-1, …)`, which clears the pin. The worker still integrates
the pinned node with zero velocity (invariant 5), so the overlay only removes
the round-trip lag and never changes the physics.

### 4.3 Graph shape tracking (F4, D3)

A pure helper in `graph/Graph.ts`:

```ts
export interface GraphShape { vertices: number; edges: number; }
export function graphShape(graph: Graph): GraphShape;
export function sameShape(a: GraphShape, b: GraphShape): boolean;
```

- **Physics `WorkerBackend`** records the shape in its constructor and in
  `reinit()`. `PhysicsRunner.step()` compares it with the solver's graph and
  calls `reinit()` on any change before posting. `reinit()` reads the current
  tag positions, so the worker resumes from the live layout.
- **Render `WorkerBackend`** records the shape in `sendInit()`. `draw()`
  compares, and on a change it bumps the generation and re-inits, using the same
  path as `setGraph()`: `initialised = false`, and the pool is rebuilt at the new
  size.
- **The dropped-buffer path closes as well.** `sendFrame()` pushes a mismatched
  buffer back onto the pool before returning, so the pool can never drain even
  if a future path skips the shape check.

### 4.4 Render worker failure and canvas swap (F3, F5, D4, D5)

**Detection**, in `render/RenderRunner.ts` and `render.worker.ts`:

1. The worker replies `{ type: "error", reason }` instead of returning silently
   when `getContext("2d")` is null, and wraps `engine.handle()` in try/catch so
   a throw while drawing also replies with `error`.
2. `RenderResponse` gains `ErrorResponse`. The backend's `receive()` treats it
   as a failure.
3. A frame watchdog: `sendFrame()` arms one timer for
   `K.renderer.workerFrameTimeoutMS = 5000`, `receive()` disarms it, and expiry
   is a failure.
4. `worker.onerror` after the probe is also a failure; today it is ignored.

**Recovery.** A failure before the probe falls back exactly as today. A failure
after the probe:

1. calls `dispose(reason)`, which terminates the worker and rejects pending
   exports;
2. calls the runner's `replaceCanvas()` callback to get a fresh element;
3. builds an `InProcessBackend` on it and replaces the backend;
4. logs `console.error("render worker failed; continuing in-process", reason)`
   once, and calls `onReady()` so the controller redraws.

`UIController.replaceCanvas()` performs the swap:

```ts
private replaceCanvas = (): HTMLCanvasElement => {
    const fresh = this.canvas.cloneNode(true) as HTMLCanvasElement; // keeps attrs and fallback text
    this.toggleCanvasListeners(false);
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
    this.toggleCanvasListeners(true);
    this.resizeCanvas();          // the new backend sizes its backing store
    this.requestRedraw();
    return fresh;
};
```

`toggleEventListeners()` splits into `toggleCanvasListeners()` (the seven canvas
bindings) and the rest, still one list per target, so attach and detach cannot
drift.

**A second `initialize()` (F5).** `RenderRunner` keeps a module-level
`WeakSet<HTMLCanvasElement>` of transferred canvases. `create()` checks it
before the worker path and, for a transferred canvas, asks `replaceCanvas()`
first. `initialize()` therefore stays idempotent, as its comment claims.

**Export (D6).** The worker replies `{ type: "png", requestId, error }` when it
has no canvas or `convertToBlob` rejects, and the backend rejects that promise.
Each export arms a `workerFrameTimeoutMS` timer that rejects on silence.
`InProcessBackend.exportPng()` moves from `toDataURL` plus `atob` to
`canvas.toBlob`, which is asynchronous and avoids a base64 copy of the whole
image.

### 4.5 Physics worker watchdog (F7, D4)

`WorkerBackend.step()` arms `K.physics.workerStepTimeoutMS = 5000` when it posts
and disarms it in `receive()`. Expiry calls the existing `onFailure(latest)`,
which already terminates the worker, writes the last positions onto the solver's
tags and continues in-process. Physics recovery is lossless because the main
thread owns the `Tag`s. `terminate()` clears the timer.

### 4.6 No `innerHTML` (F6, D7)

- All 21 sites move to `textContent`. `GraphWizard` and `ContextMenu` set only
  text, and the selection list builds `li` elements whose text is set the same
  way.
- `test/architecture.test.ts` adds `/\binnerHTML\b/` to the patterns banned in
  every `src/` module.
- A new test gives a node the label `<img src=x onerror=alert(1)>` and asserts
  that the selection panel contains the literal text and no `IMG` child.

### 4.7 CI (F8, D8)

`.github/workflows/ci.yml`:

- triggers: `push` to `main` and `pull_request`;
- `actions/checkout`, then `actions/setup-node` with `node-version: 24` (the
  development machine runs v24.21.0) and `cache: npm`;
- `npm ci`, then `npm run ci`, then `NODE_ENV=production npx webpack`;
- one job on `ubuntu-latest`, with a 10-minute timeout.

After the first green run, the job is marked as a required status check on
`main` with
`gh api -X PUT repos/davidbarkhuizen/cuniform/branches/main/protection …`,
requiring status checks only, with no review requirement and no admin
enforcement change, so the squash-merge workflow is otherwise unchanged.

### 4.8 Hygiene bundle (F9, F10, F11)

- `web/index.html`: `<!doctype html>`, `<html lang="en">`, one
  `<meta charset="utf-8">`, and
  `<meta name="viewport" content="width=device-width, initial-scale=1">`.
  Standards mode can change percentage heights, so `stylez.css` is checked
  (`html, body { height: 100% }`) and the page is compared by eye at three
  window sizes.
- `npm audit fix` for `fast-uri`. nodemon is removed (D9), and `dev` becomes
  `npx webpack --watch --config webpack.config.js`. `allowScripts` drops
  `nodemon@3.1.14`. `npm audit` must report 0 issues.
- `package.json`: `"url": "git+https://github.com/davidbarkhuizen/cuniform.git"`.

### 4.9 Architecture guard and buffer clears (F13, D11)

- The drawing-call regex drops `fill` from its alternation and adds
  `/\w+\.fill\s*\(\s*\)/`.
- `ForceDirectedGraph.stepPhysics()` clears the three force buffers with
  `.fill(0, 0, n)`, and `labelComponents()` initialises with `.fill(-1)`. The
  two workaround comments go.
- `npm run bench` runs before and after. A typed-array `fill` is not expected to
  be slower than the loop; any regression beyond noise blocks the PR.

### 4.10 Renderer double draw and strict SMILES (F16, F17, D14)

- `Renderer.ts`: the first `drawCoarseNodeWork()` in the coarse edges-on-top
  branch (line 243) is deleted, and the call after the mesh stays. The golden
  for that path in `test/display-emphasis.test.ts` changes to one ring and one
  label set.
- `Smiles.ts` throws `SmilesError` in three cases:
  - a bond symbol with no preceding atom: "a bond symbol has no preceding atom";
  - a pending bond at `(`: "a bond symbol cannot precede a branch";
  - a ring closure with explicit orders on both sides that differ: "ring-closure
    bond orders disagree".
  `test/molecules.test.ts` already parses the whole catalog, so a catalog entry
  that relied on lenience shows up at once.

### 4.11 Touch and Pointer Events on the canvas (F14, D13)

The canvas listens to `pointerdown`, `pointermove`, `pointerup`,
`pointercancel` and `wheel`, and sets `touch-action: none` on the canvas only.
Mouse behaviour is unchanged (`pointerType === "mouse"` maps button 0, 1 and 2
exactly as today). Touch maps as follows:

| Gesture | Action | Equivalent today |
| --- | --- | --- |
| one finger down on a node, then move | select and drag the node | left-drag on a node |
| one finger tap on empty canvas | clear the selection | left-click on empty canvas |
| one finger drag on empty canvas | orbit | middle-drag |
| two-finger pinch | dolly, by the ratio of finger spread | wheel |
| two-finger drag (centroid moves) | pan | Shift+middle-drag |
| long press, 500 ms, without moving | open the actions menu | right-click |

- A second finger cancels a one-finger drag. Active pointers are tracked in a
  `Map<pointerId, Point2D>` on `State`, and `state.reset()` clears it.
- Pinch dollies continuously: `Camera` gains `dollyBy(factor)`, and
  `dolly(notches)` becomes `dollyBy(K.camera.dollyPerWheelNotch ** notches)`, so
  one clamp path serves both.
- The canvas's `aria-label` and `docs/visual-layout-and-interaction.md` gain the
  touch gestures, and `docs/known-limitations.md` drops the line that PR 9 adds.

## 5. Phased delivery

One branch and one PR per row, each cut from `main` after the previous PR has
squash-merged; nothing is stacked. Every PR passes `npm run ci` locally and, from
PR 2 on, in CI.

| PR | Scope | Findings | Size |
| ---: | --- | --- | --- |
| 1 | This workplan | — | doc |
| 2 | CI workflow, then the required check | F8 | S |
| 3 | One selection source, and parity tests against the source graph | F1 | S |
| 4 | Pin overlay in the physics runner | F2 | S |
| 5 | Graph shape tracking in both runners | F4 | M |
| 6 | Render worker failure detection, canvas swap, export settles | F3, F5 | L |
| 7 | Physics worker watchdog | F7 | S |
| 8 | `textContent` everywhere, and the `innerHTML` ban | F6 | S |
| 9 | Hygiene: doctype, audit and nodemon, repository URL, touch limitation documented | F9, F10, F11, F14 (doc) | S |
| 10 | Style: `.editorconfig`, guard test, mechanical reformat, `.git-blame-ignore-revs` | F15 | M (mechanical) |
| 11 | Architecture guard by call shape, and `.fill()` clears | F13 | S |
| 12 | Coarse double draw | F16 | XS |
| 13 | Strict SMILES | F17 | S |
| 14 | Seeded random graphs | F12 | M |
| 15 | Touch and Pointer Events on the canvas | F14 | L |
| 16 | Status → Implemented, §11 notes, and fold the durable parts into the README docs | — | doc |

Why this order:

- **CI comes first** so every later PR is checked by it.
- **The confirmed user-visible bugs (PRs 3 and 4)** come next because they are
  small and visible on the demo today.
- **PR 5 precedes PR 6** because the canvas swap re-inits through the same path
  that shape tracking adds.
- **The reformat (PR 10)** lands after the behavioural fixes, so their diffs
  stay readable, and before the remaining feature work, so that work starts on
  uniform code.
- **Touch (PR 15)** is last because it is the only new feature and rewrites the
  controller's input layer.

### PR 2 — CI

The workflow from §4.7. Once its first run on the PR is green, merge, then set
branch protection. Verify by pushing a deliberately failing commit to a scratch
branch PR, seeing the check go red, and closing that PR.

### PR 3 — one selection source

- `Renderer.ts` as in §4.1.
- `test/render-worker.test.ts`: `directDraw()` renders the **source** graph,
  with the selection's `isSelected` set as the UI would, instead of a mirror, so
  parity now means "the worker draws what the main thread would". The F1 repro
  becomes a named test: a worker frame with a selection fills
  `K.colours.nodeSelected` exactly once and strokes one ring.
- The same parity is asserted on the batched and coarse paths.

### PR 4 — pin overlay

- `PhysicsRunner.ts` as in §4.2.
- `test/physics-runner.test.ts` gets the F2 repro as a named test, using a
  queued fake port that replies only when the test delivers. After each
  `step` and `sync`, the pinned tag equals the pointer. A pin recorded while a
  step is in flight survives the reply. A release (`-1`) lets the worker's
  position win again.

### PR 5 — graph shape tracking

- `graphShape()`/`sameShape()` and both runners as in §4.3.
- Tests:
  - adding a vertex in place on the physics worker path yields finite positions
    for every tag after the next reply (today this is NaN);
  - adding an edge at constant N reaches the worker mirror, asserted through the
    fake engine's edge count;
  - adding a vertex in place on the render worker path keeps frames flowing for
    10 frames (today they stop after 3);
  - a mismatched buffer returns to the pool.

### PR 6 — render worker failure and canvas swap

1. **Browser check of F5 first.** `./cli run`, then call
   `uiController.initialize()` twice from the console and record what happens
   in §11. If the browser does not throw as the spec implies, the WeakSet part
   of D5 is dropped and the rest proceeds.
2. Detection, recovery, the split listener lists and export, as in §4.4.
3. Tests, using `FakeRenderWorker` from `test/support/dom.ts`, which grows an
   `error` reply and a "never ack" mode:
   - an error reply after the probe swaps the canvas: the controller's `canvas`
     is a new element with the same `id`, the old one is detached, and drawing
     continues on the new one's 2D context;
   - a silent worker trips the watchdog at `workerFrameTimeoutMS` (driven with
     `node:test` mock timers);
   - `onerror` after the probe swaps the canvas;
   - export rejects on an error reply, on timeout and on dispose;
   - a second `initialize()` on a transferred canvas swaps first and draws;
   - the canvas listeners are bound once on the new element and none remain on
     the old one.
4. Manual browser checks: from the console, run `worker.terminate()` on the
   render worker (reached through a debug hook exposed only in development
   mode), then confirm the demo keeps drawing in-process, with one console
   error. Then repeat a double `initialize()`.

### PR 7 — physics watchdog

§4.5. Tests: a silent fake worker hands back to in-process after
`workerStepTimeoutMS`, with the tags at the last reported positions; a timely
reply never trips the timer; `terminate()` leaves no pending timer (asserted
through the mock timers).

### PR 8 — `textContent`

§4.6, with the guard and the hostile-label test.

### PR 9 — hygiene

- §4.8.
- `docs/known-limitations.md` gains: "The canvas takes mouse input only: touch
  cannot select, orbit or zoom (the panel itself supports touch). See
  workplans/audit-remediation.md PR 15."
- `docs/setup.md`: the `dev` script, and the second-terminal typecheck.
- `test/layout.test.ts` asserts that `index.html` starts with `<!doctype html>`.

### PR 10 — style

- `.editorconfig` with `indent_style = space`, `indent_size = 4` for `*.ts`,
  `*.js`, `*.css` and `*.html`.
- `test/architecture.test.ts` checks every file under `src/`, `test/` and
  `bench/`: no line starts with a tab, and nothing matches `/\bvar\s/`.
- One mechanical commit converts tabs and `var`, adding nothing else; review it
  with `git diff -w`, which must show only `var` → `let`/`const` changes.
- `.git-blame-ignore-revs` lists that commit's hash. Because the squash-merge
  produces a new hash, the follow-up adds the merged hash after the merge,
  folded into PR 11's branch as its first commit.

### PR 11 — guard by call shape

§4.9, with the before and after bench numbers in the PR description.

### PR 12 — coarse double draw

§4.10, first half.

### PR 13 — strict SMILES

§4.10, second half. Tests: one per new error, each asserting its `position`, and
the whole catalog still parses.

### PR 14 — seeded random graphs

- `core/Random.ts` (`mulberry32`) joins `PURE_MODULES`.
- `GraphSpec` random gains `seed: number`. `parseRandomSpec()` takes an optional
  seed field: blank means draw one, otherwise it must be a whole number below
  2³².
- `GraphFactory.generateGraph(order, branching, seed)` draws every random number
  through the PRNG.
- `specLabel()` appends `, seed N`, and the chooser gains the field.
- Tests:
  - the same spec produces identical graphs (positions and edges);
  - different seeds produce different graphs;
  - `mulberry32` matches a pinned known-answer sequence for a fixed seed, so a
    refactor cannot silently change every seeded layout;
  - the wizard rejects a non-numeric seed and names the field.

### PR 15 — touch

- §4.11.
- `test/support/dom.ts` grows a pointer-event fake.
- Every existing mouse test is ported to the equivalent pointer event with
  `pointerType: "mouse"`, and must pass unchanged in its assertions.
- New tests cover each row of the gesture table, cancel on a second finger, the
  pinch clamp, and `reset()` clearing the pointer map.
- Manual check on a phone, or Chrome's device toolbar with touch emulation.

### PR 16 — close-out

- Status → Implemented, and §11 filled in.
- [Invariants](../invariants.md) gains "the renderer's only selection input is
  `selected`", and invariant 5 notes the runner's pin overlay.
- [Next steps](../next-steps.md) row 4 notes what this plan already delivered
  toward the embedding API: the canvas swap, the watchdogs, shape tracking and
  `textContent`.
- The workplan is then retired as the earlier ones were.

## 6. Test plan

### New tests

Named per PR above. In summary:

- **regression tests for F1, F2 and F4**, written as the throwaway repros were,
  and failing on today's `main`;
- **failure-path tests** for both workers, driven by mock timers and fake ports,
  with no real `Worker` (the existing seam);
- **architecture guards**: the `innerHTML` ban, the narrowed `fill` pattern, no
  tab indentation, no `var`;
- **known-answer and determinism tests** for the seeded generator;
- **pointer gesture tests**.

### Existing tests: expected impact

| File | Impact |
| --- | --- |
| `test/render-worker.test.ts` | `directDraw()` renders the source graph (PR 3); new error, watchdog and export cases (PR 6) |
| `test/render-runner.test.ts` | shape tracking (PR 5), recovery (PR 6), `toBlob` export (PR 6) |
| `test/physics-runner.test.ts` | pin overlay (PR 4), shape tracking (PR 5), watchdog (PR 7) |
| `test/support/dom.ts` | `FakeRenderWorker` error and silent modes, `cloneNode`/`replaceWith` on `FakeElement`, `toBlob` on `FakeCanvas`, the pointer fake |
| `test/display-emphasis.test.ts` | the coarse edges-on-top golden loses its first ring and label pass (PR 12) |
| `test/graph-generation.test.ts`, `test/graph-wizard.test.ts`, `test/graph-spec.test.ts` | the seed field and the spec shape (PR 14) |
| `test/selection.test.ts`, `test/drag-controller.test.ts`, `test/camera*.test.ts`, `test/pan.test.ts` | mouse events → pointer events (PR 15) |
| `test/architecture.test.ts` | new guards (PRs 8, 10, 11); `core/Random.ts` joins `PURE_MODULES` (PR 14) |
| `test/layout.test.ts` | doctype assertion (PR 9) |

## 7. Risks and mitigations

1. **The canvas swap breaks a host that holds the element.** *Mitigation:* the
   swap happens only after a failure that would otherwise freeze the picture.
   The replacement keeps the `id`. The behaviour is documented as part of the
   component contract.
2. **A watchdog false positive.** It would cost a canvas swap and in-process
   drawing. *Mitigation:* 185× headroom over the worst measured step, and a
   test that a slow-but-answering worker (4000 ms) does not trip it.
3. **The pin overlay hides a worker bug.** If the worker ever moved a pinned
   node, the overlay would mask it. *Mitigation:* the existing
   `PhysicsWorkerEngine` test that a pinned node keeps its position stays as
   the guard on the worker side.
4. **Standards mode shifts the layout.** *Mitigation:* the CSS height check and
   the three-size visual comparison in PR 9; the layout tests pin the structure.
5. **The reformat collides with an open branch.** *Mitigation:* the sequential,
   unstacked PR rule means no other branch is open when PR 10 is cut.
6. **SMILES strictness rejects a catalog entry.** *Mitigation:* the catalog test
   runs in the same PR; a failing entry is corrected to valid SMILES, never the
   rule relaxed.
7. **The gesture map conflicts with page scrolling.** *Mitigation:*
   `touch-action: none` applies only to the canvas, and the panel keeps its own
   touch scrolling (its grip handles the drag).

## 8. Out of scope

- [Next steps](../next-steps.md) rows 1–3 and 5–10 (octree tuning, the merged
  worker, WebGL, packaging as a component, component packing, the DRY rows).
  This plan removes blockers for row 4 but does not design its API.
- Full formatting tooling (Prettier or ESLint); see D12.
- Keyboard equivalents for orbit and pan beyond the existing camera console.
- A cooling schedule or velocity clamp ([Known limitations](../known-limitations.md)).

## 9. Verification

Per PR: `npm run ci` locally and in CI, plus the PR's named tests failing
before and passing after (stated in the PR description for PRs 3, 4 and 5).

At close-out, on `main`:

- `npm run ci` is green, with the test count above 561 and every new test named
  in this plan present;
- `npm audit` reports 0 issues;
- `NODE_ENV=production npx webpack` builds;
- `npm run bench` is within noise of the 73eaf32 baseline;
- in the browser, in worker mode, a selection shows yellow with a ring, a drag
  tracks the pointer without flicker, a killed render worker leaves the demo
  drawing, a double `initialize()` draws, and touch gestures work under
  emulation.

## 10. Open questions to settle during implementation

1. **Does a real browser throw on the second transfer, and on `getContext` after
   it?** This is settled by the first step of PR 6, and decides whether the
   WeakSet half of D5 ships.
2. **Is the long-press menu needed if a menu button is added to the panel?** If
   PR 15 finds a visible panel button simpler and more discoverable, it can
   replace the long press. Record the choice in §11.

## 11. Post-implementation notes

(Filled in as PRs land.)
