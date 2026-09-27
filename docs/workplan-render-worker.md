# Workplan — Rendering on a dedicated thread

Status: **proposed**, not started. This document is a forward plan; nothing in it
is implemented. It covers the OffscreenCanvas half of the README's
[`Performance → Next steps`](../README.md#next-steps) row 3 ("Rendering or
physics beyond canvas 2D") and the rendering half of row 2 ("Revisit the worker
boundary"). WebGL, GPU forces, WASM kernels and the octree work are out of scope.

This is one plan executed as **five focused PRs**: one instrument, and four
construction steps. Each item is independently landable and independently
revertible; [Sequencing and PR breakdown](#sequencing-and-pr-breakdown) fixes the
order. The work does not depend on the instrument's verdict — it is motivated by
the component goal below.

---

## 0. Ground rules for every item

### Why: a re-usable component, not just this demo

The long-run goal is to turn cuniform into a component a host page can embed. A
host's main thread is not ours: it owns the host's own animation, layout, input
and rendering, and a widget that spends milliseconds per frame issuing canvas
commands steals that frame budget from the page around it. Today's measured
5.9 ms at 4096 and 17.1 ms at 8192 are the *fake* context (`README.md:438`), so
they are a lower bound; the real per-frame cost on the host's thread is larger,
and it grows with the node count.

Per-frame work proportional to N therefore has to leave the main thread as a
matter of architecture, not of this demo's current frame rate. The demo is one
host, with one graph, on one machine; the budget that matters belongs to whoever
embeds the component. A component that draws O(N) subpaths on the host's main
thread is the wrong component even when this demo still renders acceptably.

The consequence for scope: the end state is **all** per-frame heavy work —
physics, projection and drawing — off the host's main thread, with the main
thread owning input, camera state and DOM chrome only. The dedicated render
worker is the first step of that trajectory, not its terminus; the routes to the
end state are in
[End state](#end-state--all-heavy-work-off-the-main-thread).

The real-canvas harness (Item 3) exists to **quantify and guard** the main
thread's occupancy — it produces the number the component publishes and the
threshold a regression tripwire watches. It is not a permission slip: a flat
measurement re-orders priorities and sets thresholds, it does not make host-
thread O(N) drawing correct.

### The constraint that shapes the whole design: the transfer is one-way

`HTMLCanvasElement.transferControlToOffscreen()` permanently hands the canvas's
bitmap to an `OffscreenCanvas`. After it, the element is a placeholder: the main
thread cannot get a 2D context for it, cannot draw into it, and its `width`/
`height` attributes no longer govern the backing store. **There is no
`transferControlBack`.**

That makes the physics worker's failure handling (`PhysicsRunner.ts:276-309`: a
worker that cannot construct, or throws at load, falls back to the in-process
solver) unusable in its current shape for rendering. If the canvas is transferred
and the worker bundle then 404s — the documented `file://` case
(`README.md:258-261`) — the page has a dead canvas and no way to recover it.

The design that follows therefore **probes the worker before transferring
anything**: construct the worker, wait for a `ready` message (or an error, or a
bounded timeout), and only then transfer control. If the probe fails, the canvas
has never had a context, so the in-process backend claims it with
`getContext('2d')` exactly as today. This ordering is the central design
constraint of the plan, and Item 5 exists mainly to implement it correctly.

### The invariants that must survive

The suite enforces the README's invariants
([`Invariants any change must keep`](../README.md#invariants-any-change-must-keep)).
Two of them move rather than hold; both moves are documented and tested.

1. **The pure modules stay DOM-free.** `test/architecture.test.ts:18-40` pins
   `PURE_MODULES`; `:47-52` lists every DOM-facing module with its justifying
   marker. After Item 1, `Renderer.ts` no longer names a canvas type and joins
   `PURE_MODULES`; the marker list loses it and gains `RenderRunner.ts`,
   `RenderSurface.ts` (pure) and the new worker entry. The renderer stays the
   only module that issues drawing calls (`test/architecture.test.ts:75-81`).
2. **One projector per tick.** Today `UIController.advanceOneTick()`
   (`src/UIController.ts:658-689`) resolves one projector, calls
   `this.solver.project(projector)` (`:684`) and hands the same camera to
   `renderFrame()` (`:691-698`), so the cull boundary sees the depths cached with
   that camera. In the worker path the projector is resolved **in the render
   worker**, with the camera that arrived in the frame message, and it still
   projects and draws with that one camera. The invariant's substance — the
   drawer never sees depths cached under a different camera — is preserved; its
   location moves. The repository's wording is updated with Item 5.
3. **Frozen pre-step snapshot.** Untouched. Rendering never reads the physics
   pass's intermediate state.
4. **Deterministic order.** The painter sort is still `(depth descending,
   insertion index ascending)` inside `Renderer.ts`, driven by node insertion
   order, which is preserved across the boundary by the index space (node order)
   the protocol uses.
5. **Pinned-node semantics.** The drag still keeps the pointer position and
   unprojects at the node's own depth. The depth now comes from the frame the
   renderer last drew (see [the depth write-back](#the-depth-write-back)). Because
   a drag is exactly depth-preserving, a one-frame-old depth is the value the
   drag would have written anyway.
6. **The exact 2D reduction.** Untouched. `Projector`/`Viewport` are pure and run
   unchanged wherever they run; the projection loop itself is not rewritten (it
   is *extracted*, not reimplemented — Item 4).
7. **`Tag` owns its points.** Untouched. The render worker's mirror graph is built
   from the same `Tag`/`Graph` classes, so the worker cannot alias a
   half-written tick either.
8. **Allocation-free steady state.** Must be re-established across the new
   boundary, not assumed: pooled, double-buffered position arrays whose *ownership
   returns* with the drawn ack (Item 4/5), and no per-frame `Float64Array`
   allocated by the backend. This is a testable requirement, not a hope.

### Measurement discipline

The committed benchmark measures the renderer against `FakeContext2D`
(`bench/physics.bench.ts:267-309`), which "charges nothing for real
`arc`/`fill`/`fillText` rasterisation" (`README.md:446-449`). The README is
explicit that a fake-context render time must not be presented as a real frame
cost.

Moving drawing off the main thread is a claim about **main-thread frame time and
long tasks on a real canvas**, so the plan measures that claim with a real canvas
before it builds the worker (Item 3) and re-measures after (Item 5). The
fake-context `ops` count remains the *correctness* oracle (identical output), not
the performance one.

The measurement sets the component's budget and its regression tripwire; it does
not gate the move ([§0](#why-a-re-usable-component-not-just-this-demo)). Whatever
it reports, a host that embeds the component must not be the thread doing per-node
drawing.

Two honest caveats the plan must respect:

- Browsers already rasterise much of canvas 2D off the main thread, so the
  main-thread saving is bounded by the *command-building* JS (`arc`, `fill`,
  `stroke`, `fillText`, `setTransform`) plus any main-thread raster fallback, not
  by total CPU. The metric is therefore "main-thread time between animation frames
  and the number of tasks over 50 ms", not "the canvas got cheaper".
- At N ≥ `K.renderer.labelMaxNodes` (150) labels are already culled to the
  selection and its neighbours (`README.md:337-339`), and at N ≥ 4096 the coarse
  preset batches fills (`README.md:345-356`), so the per-frame command count is
  *already* low at the top of the range (2 ops at 4096 on the fake context,
  `README.md:438`). The real-canvas cost there is `arc()` subpaths and their
  rasterisation, not the JS call count.

### Verification commands

| Purpose | Command |
| --- | --- |
| Typecheck + full suite | `npm run ci` (`./cli ci`) |
| Benchmark | `npm run bench` (`./cli bench`) |
| Bundle | `./cli run` / `bash build-and-run.sh --build-only` |
| Real-canvas frame harness | serve the repo over HTTP and open `bench/render-frame.html` (Item 3) |
| `file://` fallback smoke test | `./cli run` (must stay fully in-process and fully working) |
| Worker smoke test | serve `web/` over HTTP and open `index.html` |

`npm test` compiles with `tsconfig.test.json` and runs `node --test`. No test may
construct a real `Worker` or a real `OffscreenCanvas`; both are injected ports.

### Per-PR workflow (global working agreement)

Branch off up-to-date `main` → make the focused change → push → open PR →
squash-merge → return to `main` → delete the branch → sync. One coherent change
per PR.

---

## 1. Where the boundary goes

Three placements were considered. The recommendation is **(A) a dedicated render
worker**, separate from the physics worker.

| | Placement | Extra per-step copy | Physics/render concurrency | Isolation | Verdict |
| --- | --- | --- | --- | --- | --- |
| **A** | New `render.worker.js` owns the `OffscreenCanvas`; the physics worker is untouched | One `Float64Array` main → render (~98 KB at 4096, one `set()` + transfer) | Physics in worker P, drawing in worker R, main thread nearly idle | A rendering fault cannot stop the layout; a physics fault cannot stop drawing | **Chosen** — the first step of the [end state](#end-state--all-heavy-work-off-the-main-thread), and the cheapest one to land and revert |
| **B** | The existing physics worker also draws | None: it already owns positions and a mirror graph (`PhysicsProtocol.ts:82-165`) | Physics and drawing **serialise** in one thread, where today they overlap across threads | One fault takes out both, and the canvas transfer becomes part of the physics worker's fallback | Right end state for packaging, wrong first step ([end-state route 2](#end-state--all-heavy-work-off-the-main-thread)) |
| **C** | Two workers wired by a `MessageChannel` (physics → render), so positions never reach the main thread | None on the main thread: the physics worker posts straight to the render worker | Best overlap, and the main thread does no per-frame O(N) work at all | Two ports, two generations, two lifecycles to keep in step | Not a first step (nothing to channel until A exists); it is [end-state route 1](#end-state--all-heavy-work-off-the-main-thread) |

Why A wins as the first step: it moves the drawing to a thread that otherwise
sleeps without touching the physics protocol at all, so it lands small, tests
headlessly, and reverts cleanly. At 4096 the fake context already charges the main
thread 5.9 ms of pure JS per frame (`README.md:438`) with real rasterisation on
top. The cost is one typed-array copy per step — the same order as the one
`PhysicsRunner.WorkerBackend.receive()` → `sync()` already performs
(`src/PhysicsRunner.ts:188-190, 209-218`), which the README records as "no longer
the bottleneck at the measured sizes" (`README.md:494`).

B's serialisation is why it is the wrong *first* step, not why it is wrong
forever. Stepping at 4096 is 27.4 ms and a frame is 5.9 ms before rasterisation
(`README.md:438`); merged, one thread would spend ~33 ms+ per frame doing both,
coupling the layout rate to the paint rate in exactly the way the current split
avoids. As an end state it is a packaging trade — one bundle, one lifecycle and one
failure mode against camera smoothness during a long step — and the
[end state](#end-state--all-heavy-work-off-the-main-thread) section settles it with
the embedding API rather than with this plan's numbers.

### The frame contract

All payloads are typed arrays; nothing per-frame is a graph object or a string.

| Direction | Message | Payload | Frequency |
| --- | --- | --- | --- |
| main → worker | `init` | `labels: string[]`, `edges: Int32Array` (2E), `positions: Float64Array` (3N), `generation` | once per graph swap |
| main → worker | `frame` | `camera` (13 numbers), `positions: Float64Array` (3N, transferred), `selected` index, `width`/`height`/`dpr`, `generation`, `frameId` | once per drawn frame |
| main → worker | `export` | `requestId` | on demand |
| worker → main | `ready` | — | once, at script load |
| worker → main | `drawn` | `frameId`, the frame's `positions` buffer **returned**, `depths: Float64Array` (N, transferred), `generation` | once per frame |
| worker → main | `png` | `requestId`, `blob: Blob` | on demand |

Per-frame data in each direction is one 3N `Float64Array` in and one N
`Float64Array` plus the returned 3N buffer out. At 4096 that is ~98 KB in and
~33 KB out per frame at up to 60 Hz, all by pointer move.

### The depth write-back

`Renderer` draws from `Tag.translatedPosition` and `Tag.depth`
(`src/Renderer.ts:290-291, 308-309, 416-417, 477-478, 544-547`). Those live on the
main thread's tags today because `solver.project()` writes them
(`src/ForceDirectedGraph.ts:434-452`).

Rather than teach the controller to read depths from a new place, **whichever
backend draws a frame writes that frame's depths back onto the main thread's
tags**. The in-process backend does it by calling the same projection pass it
calls today; the worker backend does it from the `depths` array in the `drawn`
ack (an O(N) loop, ~0.1 ms at 4096, versus the O(N) 3-field pass it replaces).

This keeps three things working with no code change: the drag's depth lookup
(`src/UIController.ts:216-226`), `Selection`'s cull tie-break
(`src/Selection.ts:35-47`), and every fixture that seeds `node.depth` directly
(e.g. `test/hidpi.test.ts:119-123`). `translatedPosition` becomes "the last values
the drawing thread wrote" and is only *read* by the drawer, so on the worker path
it is stale on the main thread; that is documented on `Tag.ts` in Item 5, and the
only other readers are `bench/physics.bench.ts:253-259, 351-355`.

### What does not move

Hit-testing (`src/Selection.ts:12-50`), which re-projects live model positions on
a click; camera state and every input handler; the drag's unprojection; the
wizard, context menu, selection panel and export UI; the physics worker and its
protocol; the depth-cue policy, thresholds and every `K` value.

---

## 2. Item 1 — A drawing surface the renderer is compiled against

**Why first.** The rest of the plan needs one `render()` that can be handed a
main-thread `CanvasRenderingContext2D`, an `OffscreenCanvasRenderingContext2D`, or
`FakeContext2D`, with no branch inside it. Today `Renderer.render` names
`CanvasRenderingContext2D` directly (`src/Renderer.ts:113-118`), which is the only
reason `Renderer.ts` is classified DOM (`test/architecture.test.ts:51`,
`README.md:503-506`).

### Current behaviour

- `src/Renderer.ts:113-118` — `render(context: CanvasRenderingContext2D, graph,
  camera, selected)`.
- The context members the renderer touches, exhaustively: `save`, `restore`,
  `setTransform`, `clearRect`, `canvas.width`, `canvas.height`, `font`,
  `globalAlpha`, `strokeStyle`, `fillStyle`, `beginPath`, `arc`, `moveTo`,
  `lineTo`, `stroke`, `fill`, `fillText`.
- `test/render.test.ts:54-61` and `test/hidpi.test.ts:137-146` already pass
  `FakeContext2D as unknown as CanvasRenderingContext2D`, i.e. the cast exists
  only to satisfy the type.

### Change

1. New `src/RenderSurface.ts` (pure, joins `PURE_MODULES`): the structural subset
   above, deliberately naming no canvas type.

   ```ts
   /**
    * The 2D drawing surface the renderer writes. A structural subset of both
    * CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D, so the same
    * renderer runs on the main thread, in a worker, and against the fake context
    * in tests with no cast and no branch. Styles are `string | object` because
    * the renderer only ever writes a colour string, and `object` covers
    * CanvasGradient/CanvasPattern without naming a canvas type in a pure module.
    */
   export interface RenderSurface {
       readonly canvas: { readonly width: number; readonly height: number };
       font: string;
       globalAlpha: number;
       strokeStyle: string | object;
       fillStyle: string | object;
       save(): void;
       restore(): void;
       setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
       clearRect(x: number, y: number, w: number, h: number): void;
       beginPath(): void;
       moveTo(x: number, y: number): void;
       lineTo(x: number, y: number): void;
       arc(x: number, y: number, r: number, start: number, end: number, ccw: boolean): void;
       stroke(): void;
       fill(): void;
       fillText(text: string, x: number, y: number): void;
   }
   ```

2. `src/Renderer.ts` — `render(surface: RenderSurface, ...)`. Type-only: not one
   arithmetic expression, comparison or call order changes.
3. `test/architecture.test.ts` — move `Renderer.ts` from `DOM_MODULES` to
   `PURE_MODULES`, add `RenderSurface.ts`, keep the "only module that draws" test
   as-is (it is a regex over drawing calls, and `Renderer.ts` remains the only
   match).
4. Drop the now-unnecessary `as unknown as CanvasRenderingContext2D` casts at the
   call sites (`test/render.test.ts:59`, `test/hidpi.test.ts:140`,
   `bench/physics.bench.ts:294, 304`).

### Tests

- No new test file. The existing render goldens (`test/render.test.ts`, 544
  lines; `test/hidpi.test.ts`) are the test: they must pass with the cast removed.
- `test/architecture.test.ts` gains the new classification and still fails if
  `Renderer.ts` names a canvas type.

### Acceptance criteria

- `render()`'s signature names only `RenderSurface`.
- `grep -n CanvasRenderingContext2D src/Renderer.ts` is empty.
- `npm run ci` green with the casts removed; the render tests' assertions are
  untouched.
- `test/architecture.test.ts` lists `Renderer.ts` and `RenderSurface.ts` as pure
  and no longer lists `Renderer.ts` as DOM.

### Evidence

None required: this is a type-level change with no runtime effect. State that
explicitly in the PR, and show the diff is signature-only.

### Risks and mitigations

- *`string | object` is loose.* It is the minimum that makes both real 2D contexts
  and the fake assignable without naming a canvas type. A tighter alternative —
  `fillStyle: string` — does not typecheck, because
  `CanvasRenderingContext2D.fillStyle` is the wider union. Document the choice in
  the interface comment with that reason.
- *The architecture test's purity notion shifts.* Renderer.ts naming no type is
  not the same as drawing being safe off-thread; the worker entry and the
  OffscreenCanvas context are covered by Items 4 and 5.

### Documentation

- README invariant 1 (`README.md:501-506`): `Renderer.ts` is no longer the module
  listed "for the canvas type"; it joins the pure list, and the new module list is
  stated.

---

## 3. Item 2 — A render backend on the main thread (the seam only)

**Why.** Every later item plugs into one interface, and the controller stops
owning a canvas context. This lands the seam with **only** the in-process backend,
so the PR changes no pixels and no concurrency: it is the same work in the same
order, behind a name.

### Current behaviour

`UIController` owns the context and everything chained to it:

- `src/UIController.ts:108` — `context2D: CanvasRenderingContext2D`, taken by the
  constructor (`:153-174`) and obtained in `src/entrypoint.ts:31-36`.
- `:684` — `this.solver.project(projector)` every tick.
- `:691-698` — `renderFrame()` calls `render(this.context2D, ...)` and clears
  `needsRedraw`.
- `:850-866` — `resizeCanvas()` sizes the backing store and calls
  `this.context2D.setTransform(dpr, ...)` at `:865`.
- `:549-566` — `onExport()` reads `canvas.toDataURL()` through the private
  `pngBlob()` helper (`:35-48`).
- `:971-1002` — `terminate()` stops the physics owner but owns no render resource.

### Change

New `src/RenderRunner.ts` (DOM classification, marker `Worker` — it will name the
worker factory), mirroring `PhysicsRunner`'s shape exactly:

```ts
/** The slice of a render worker the runner uses; a fake stands in for tests. */
export interface RenderWorkerPort {
    postMessage(message: RenderRequest, transfer: Transferable[]): void;
    terminate(): void;
    onmessage: ((event: { data: RenderResponse }) => void) | null;
    onerror: ((event: unknown) => void) | null;
}

export type RenderWorkerFactory = (canvas: HTMLCanvasElement) => RenderWorkerPort | null;

export interface RenderBackend {
    readonly usesWorker: boolean;
    /** True once the backend can accept frames. */
    readonly ready: boolean;
    /** Accept one frame. False means "not ready; keep the redraw pending". */
    draw(graph: Graph, camera: CameraView, selected: Tag | null, width: number, height: number): boolean;
    resize(width: number, height: number, dpr: number): void;
    exportPng(): Promise<Blob>;
    terminate(): void;
}
```

- `InProcessBackend` (private to the module): owns the main-thread 2D context,
  resolves `Projector.forCanvas(width, height, camera)`, projects with the
  extracted `projectGraph()` (Item 4, landed here as its own commit or in Item 4 —
  see the note below), calls `render(surface, graph, camera, selected)`, and
  returns `true`. `ready` is true from construction.
- `RenderRunner`: `draw`/`resize`/`exportPng`/`terminate` delegate to the backend;
  exposes `usesWorker`; and takes an `onReady: () => void` callback so a backend
  that becomes usable later can ask for a redraw without the runner reaching into
  the controller's private `needsRedraw`.
- The default factory returns `null` for now, so the runner is always in-process;
  Item 5 supplies the real factory. `entrypoint.ts` keeps resolving the 2D context
  but hands the **canvas** to the runner and the runner's backend to the
  controller; `UIController.context2D` is deleted.
- `advanceOneTick()` (`:658-689`) stops calling `solver.project()`; `renderFrame()`
  (`:691-698`) calls `this.renderRunner.draw(...)` and clears `needsRedraw` **only
  when `draw()` returns true** (so a not-yet-ready backend keeps the frame
  pending).
- `resizeCanvas()` delegates the `setTransform`/backing-store step to
  `renderRunner.resize(width, height, dpr)` and keeps setting the element's CSS
  size.
- `onExport()` becomes `void this.renderRunner.exportPng().then(download)`, with
  the existing object-URL download code shared; `InProcessBackend.exportPng()`
  is exactly today's `pngBlob(this.canvas)`.
- `terminate()` calls `renderRunner.terminate()`.

Note on `projectGraph()`: the projection extraction belongs with the engine that
first needs it standalone (Item 4). If it lands here instead, this PR contains two
mechanical moves; either order is fine, but the extraction must be its own commit
with the acceptance below.

### Tests

New `test/render-runner.test.ts` (in-process half) and updates to the controller
fixtures:

- the controller draws through the backend: a spy backend records one `draw` per
  drawn frame and zero on a settled, untouched scene (the idle-frame skip,
  `src/UIController.ts:931`, still holds);
- `resize` is called by `resizeCanvas()` with the logical size and
  `devicePixelRatio`, and the element's backing store and CSS size still change
  (`test/hidpi.test.ts` assertions move onto the backend);
- `draw()` returning `false` leaves `needsRedraw` set: the next frame retries;
- the drag still reads a fresh depth after a backend that wrote tags (the
  `test/hidpi.test.ts:120-135` fixture is unchanged, which is the point);
- `terminate()` disposes the backend; a second `initialize()` is still idempotent
  (`test/entrypoint.test.ts`).

`test/support/dom.ts:474-501` (`newUIController`) gains an injectable fake
backend; `:542-560` (`uiFixture`) threads it through.

### Acceptance criteria

- `UIController` has no `CanvasRenderingContext2D` field and no direct `render()`
  call; `grep -n "render(" src/UIController.ts` finds only the backend call.
- `npm run ci` green with the render, hidpi, cadence and entrypoint tests passing
  after only mechanical fixture updates.
- The fake-context `ops` count for a frame is **identical** to `main` at every
  size and threshold in `bench/physics.bench.ts` (add an assertion for one size,
  or state the diff is empty).

### Evidence

`npm run bench` before/after: the render table must be unchanged to the reported
precision. No new timing claim.

### Risks and mitigations

- *The seam hides real work and the PR looks like churn.* Justified by Items 4–5
  and by `context2D` leaving the controller; state that in the PR body.
- *`draw()` returning a boolean is easy to ignore.* The idle-frame test above is
  the guard: a `false` return that cleared `needsRedraw` would blank the canvas
  after the first frame.

### Documentation

- README "Cadence": one sentence that the controller draws through a render
  backend, which is in-process until Item 5.

---

## 4. Item 3 — A real-canvas frame harness (the instrument)

**Why.** The component goal is to keep per-frame work off the host's main thread
([§0](#why-a-re-usable-component-not-just-this-demo)), and the repository has no
way to measure what the main thread is actually spending on a real canvas.
`FakeContext2D` deliberately cannot (`README.md:526-529`). This item builds the
instrument, records the baseline, and turns the number into a published budget and
a regression tripwire for the component. It is also what Item 5's PR quotes.

### Change

New `bench/render-frame.html` + `bench/render-frame.ts`, compiled by the existing
build (either a webpack entry or a `tsc` pass — whichever keeps `./cli build`
unchanged) and **not** part of `dist/main.js` or the app.

- Draws the *current* renderer at N ∈ {1024, 2048, 4096, 8192} on a real canvas at
  1280×800, `devicePixelRatio` 1 and 2, for 300 frames per size, with the graph
  seeded and the camera orbiting slowly so every frame is a real redraw.
- Reports per size: engine draw time p50/p95 ms, **main-thread long tasks**
  (`PerformanceObserver({ type: 'longtask' })`) with a count and worst duration,
  frames over 16.7 ms, and `performance.memory` GC-sawtooth if available.
- Accepts `?render=main|worker` so Items 2–5 can A/B the same page in the same
  build, and `?n=4096&dpr=2` to pin a case.
- Prints a copy-pasteable block, in the style of `bench/physics.bench.ts:343-373`,
  to paste into the PR and into the README's measured profile.

### What the measurement decides — and what it does not

It **decides**:

- the baseline the later PRs are judged against, and the "before" column of Item
  5's evidence;
- the **budget** the component publishes: the main-thread milliseconds and long
  tasks a host should expect per node count, which is the number an embedder
  needs and the number a regression tripwire watches;
- the accepted **threshold** and the size range the worker is enabled for by
  default, if the cost turns out to be negligible at small N and material at
  large N;
- whether the extra position copy is worth removing early, i.e. whether the
  [end-state](#end-state--all-heavy-work-off-the-main-thread) routes are pulled
  forward or left as the component API is designed.

It **does not** decide whether the work happens. The motivation is architectural
and measurement-independent: the host's main thread is not the component's to
spend. If the baseline comes back flat, that changes the priority order and the
threshold, and the plan proceeds — the result is recorded in the README as the
budget, not as a reason to leave O(N) drawing on the embedder's thread.

For expectation, not justification: at 4096 the fake context alone charges 5.9 ms
of main-thread JS per frame (`README.md:438`) with rasterisation on top, and 8192
is 17.1 ms — a whole 60 Hz frame — before any real drawing. Those are already
host-frame-sized numbers, and they are a floor.

### Tests

None. This is a manual instrument; it is not part of `npm test` (`bench/` already
sits outside the suite's runtime budget).

### Acceptance criteria

- The page runs from a static HTTP server with the committed build, at every size
  in the list, and reports the columns above.
- The numbers are reproducible within a stated spread (report best-of-N as the
  other bench does).
- The baseline is recorded in the PR and in the README's measured profile, with
  the sizes and dpr settings that form the component's published budget.

### Evidence

The baseline block itself, on named hardware and browser, becomes the "before"
half of every later PR's evidence and the component's published main-thread
budget.

### Risks and mitigations

- *Long-task attribution.* A long task may be physics bleeding in. Run the harness
  with the physics stepping stopped (a settled graph, or a fixed step count) so
  the measurement is the draw path.
- *`performance.memory` is Chrome-only.* Treat it as optional; the p95 and
  long-task columns are the contract.

### Documentation

- README "Performance": a line pointing at the harness for real-canvas frame
  measurement, keeping the fake-context table's stated limitation
  (`README.md:421-431`) honest.

---

## 5. Item 4 — The render protocol, the engine and the worker entry (headless)

**Why.** The correctness core, landed **without wiring it into the app**: a pure
engine that produces pixel-identical output to today's renderer for a given
graph, camera and selection, plus the worker entry that hosts it. Reviewable and
testable entirely under `node --test` with `FakeContext2D`; no browser needed.

### Change

1. `src/Projection.ts` (pure) — extract `projectGraph(graph, projector)` from
   `ForceDirectedGraph.project()` (`src/ForceDirectedGraph.ts:434-452`), which
   becomes a one-line delegate. The loop is **moved, not rewritten**: same order,
   same `projectInto`/`toCanvasInto` calls, so the output is bit-identical. This
   is what lets the render worker project without bundling the solver, the octree
   and the kernel.
2. `src/RenderProtocol.ts` (pure, joins `PURE_MODULES`) — the messages in
   [the frame contract](#the-frame-contract) plus `RenderWorkerEngine`, mirroring
   `PhysicsProtocol.ts`:
   - `handle(request)` applies `init` (build a mirror `Graph` from `labels` +
     `edges` + `positions`, exactly as `PhysicsWorkerEngine.build()` does at
     `src/PhysicsProtocol.ts:122-149`) and `frame` (write positions onto the
     mirror's tags, resolve `Projector.forCanvas(width, height, camera)`,
     `projectGraph`, then `render(surface, graph, projector.camera, selectedTag)`),
     returning the `drawn` response with the returned buffer and the depth array;
   - `attach(surface: RenderSurface)` injects the drawing surface, so the engine
     names no canvas type and no DOM global;
   - `exportPng()` is delegated to a `RenderSurface`-adjacent export hook the
     worker entry supplies (it needs `convertToBlob`, which is not part of the
     drawing subset) — or the engine returns a request the entry fulfils; either
     way the engine stays pure.
   - **Share the mirror builder.** `PhysicsWorkerEngine` currently labels nodes
     `n${i}` (`src/PhysicsProtocol.ts:128-135`) while the render mirror needs real
     labels. Extract one `buildMirrorGraph(labels, edges, positions)` used by
     both, so the two mirrors cannot drift; `PhysicsWorkerEngine` passes generated
     labels and its behaviour is unchanged (its labels are never read — physics
     only needs topology and positions).
3. `src/render.worker.ts` (DOM classification, marker `self`) — the entry,
   modelled on `simulation.worker.ts:11-26`: type the scope locally, create
   `new OffscreenCanvas(...)`-free context from the **transferred** canvas (the
   transfer arrives as the first message's `event.data.canvas`), wire `onmessage`
   to the engine, `postMessage({ type: 'ready' })` on load, and implement export
   with `context.canvas.convertToBlob({ type: 'image/png' })`.
4. `webpack.config.js` — a third entry, `'render.worker': './src/render.worker.ts'`,
   alongside `main` and `simulation.worker` (the two-entry rationale at
   `webpack.config.js:11-13` applies unchanged).

### Tests

New `test/render-worker.test.ts`, driving `RenderWorkerEngine` with
`FakeContext2D`:

- **Pixel identity.** For a set of fixtures spanning every threshold
  (`labelMaxNodes`, `batchEdgesMinEdges`, `performance.minNodes`; small, mid and
  coarse), `engine.handle(frame)` produces an `ops` list **identical** to calling
  `render()` directly on the same graph/camera/selection — the same assertion
  style as `test/render.test.ts:206, 401, 518`. This is the whole correctness
  contract of the move.
- `depths` matches `ForceDirectedGraph.project()`'s depths for the same camera,
  so the drag's plane is unchanged.
- A frame before `init` returns no response; an `init` after a swap with a new
  `generation` rebuilds the mirror and drops frames from the old generation.
- `init` with self-loops and duplicate edges builds the same mirror the physics
  engine does (reuse `test/physics-runner.test.ts`'s fixtures).
- Resize and `dpr` change the backing store and the transform, and the clear is
  still in device space (`test/hidpi.test.ts:137-146` semantics).

Plus `test/projection.test.ts` (or an added case in `test/solver.test.ts`) pinning
that `projectGraph()` and the old `ForceDirectedGraph.project()` agree
bit-for-bit on a random graph, including culled depths.

### Acceptance criteria

- `render.worker.js` is emitted by the build and, inspected, contains no
  `ForceDirectedGraph`/`Octree`/`Kernel` code (the projection extraction worked).
- The engine's `ops` are identical to the direct renderer at every fixture, and
  the engine's test file constructs no `Worker`, `OffscreenCanvas` or DOM global.
- `test/architecture.test.ts` classifies `RenderProtocol.ts`, `Projection.ts` and
  `RenderSurface.ts` as pure, and `render.worker.ts` as DOM with its `self`
  marker.

### Evidence

The `ops`-identity table (per fixture: `ops`, `fillText` count) proves the move is
behaviour-preserving. No timing claim; the harness in Item 5 supplies that.

### Risks and mitigations

- *Two mirror implementations drift.* Mitigated by the shared
  `buildMirrorGraph()`; the duplicate-edge/self-loop fixtures are shared with the
  physics tests.
- *The engine silently bundles physics.* Mitigated by the bundle-content
  acceptance check.
- *`FakeContext2D` cannot express OffscreenCanvas quirks* (e.g. `font` applied
  before the first `fillText`). Mitigated in Item 5's manual worker smoke test.

### Documentation

- README "Depth cue": the project-and-draw pass is `projectGraph` + `render`,
  shared by every path.

---

## 6. Item 5 — Wire it in: handshake, transfer, resize, export, depth write-back

**Why.** This is the item that actually moves the pixels off the main thread, and
the one that must get the one-way transfer and the backpressure right.

### Current behaviour

Everything Item 2 redirected is still in-process, and the worker entry from Item 4
is unreachable from the app.

### Change

1. `RenderRunner.WorkerBackend` and the real default factory:
   - **Probe before transfer.** Construct the worker; post nothing but the
     handshake; wait for `ready`. On `onerror`, a failed `new Worker`, or
     `K.renderer.workerReadyTimeoutMS` elapsing, fall back to `InProcessBackend`
     *without ever having called `transferControlToOffscreen()`*. Only on `ready`
     call `transferControlToOffscreen()`, post `init` (transferring the
     `OffscreenCanvas` and the first position buffer), and flip `ready`.
   - **One frame in flight, latest-state coalescing.** Post a frame only when no
     frame is outstanding; while one is, remember that a redraw is pending and
     post it from the `drawn` handler (**a single `pump()`**, so re-entry cannot
     double-post). Mirrors `PhysicsRunner.WorkerBackend.step()`'s one-step-in-
     flight rule (`src/PhysicsRunner.ts:164-182`).
   - **Pooled position buffers, returned by the worker.** Keep three: one being
     filled, one in flight, one in the worker's hands coming back in the `drawn`
     ack. A steady-state frame allocates no `Float64Array`. Fill from the graph's
     tags with the extracted `readPositions()` helper (today private at
     `src/PhysicsRunner.ts:50-58`) rather than from `runner.positions()`, which
     allocates on the in-process physics path (`:112-119`).
   - **Depth write-back** from the `drawn` ack onto the main thread's tags (an
     in-place loop over the transferred `Float64Array`).
   - **Generation.** A graph swap re-inits the worker and bumps the generation,
     dropping a `drawn` ack computed for the replaced graph, exactly as
     `PhysicsRunner` does (`src/PhysicsRunner.ts:192-218`).
   - **Export** via the worker (`convertToBlob`); the in-process backend keeps
     `toDataURL`. A placeholder canvas's `toDataURL` is not reliable after a
     transfer, which is why export must not be left on the element.
2. `entrypoint.ts` — build the runner over the canvas and hand the controller the
   backend; still return `null` when neither path can draw (no worker and no 2D
   context).
3. `K.ts` — `renderer.workerReadyTimeoutMS: 250` with the comment: an order of
   magnitude above a same-origin script load, below perceptible first-paint
   latency, and the bound on how long a failed worker delays the first frame.
4. `UIController` — the runner's `onReady` calls `requestRedraw()`, so a backend
   that becomes ready later draws immediately; `renderFrame()`/`advanceOneTick()`
   are unchanged from Item 2.
5. Optional but recommended for the A/B: a `?render=main|worker` URL override,
   feature-detected and defaulting to `worker`, so Item 3's harness compares both
   in one build and a user can force the fallback.
6. `resizeCanvas()` — with the worker path the element's `width`/`height` are
   ignored by the placeholder, so the backend's `resize()` is the only writer of
   the backing store; the element's CSS size is still set on the main thread.
   `getBoundingClientRect()` still works for pointer mapping.

### Tests

Extend `test/render-runner.test.ts` with a `FakeRenderWorker` (mirroring
`test/physics-runner.test.ts:19`):

- **No transfer before ready**: the fake records `transferControlToOffscreen` on
  the canvas (or its absence) and the message order.
- **Fallback on load failure**: `onerror` before `ready` leaves the canvas
  untransferred and the backend in-process; a `ready` that never arrives times out
  to in-process; over `file://`-like absence of `Worker`/`OffscreenCanvas`, the
  in-process backend is chosen with no probe at all.
- **Backpressure**: three `draw()` calls during one in-flight frame post exactly
  one more frame, and it carries the *newest* camera and selection.
- **Buffer reuse**: after `ready`, `N` frames allocate zero new `Float64Array`s
  (identity-compare the pooled buffers across frames, or count allocations in the
  fake).
- **Stale ack**: a `drawn` message from a replaced generation is ignored, and the
  tags' depths are not overwritten from it.
- **Depth write-back**: after a `drawn`, `graph.vertices[i].depth` equals the
  reported depth, and the drag fixture (seed via a `drawn` rather than directly)
  unprojects on the plane the worker drew.
- **Export**: worker path resolves a `Blob` from the `png` response; in-process
  path still produces `data:image/png;base64,...` traffic
  (`test/support/dom.ts:262-264`).
- **Lifecycle**: `terminate()` terminates the worker; a second `initialize()` does
  not leak one.
- `test/cadence.test.ts` — the draw-count assertions (`:53-75`) run against the
  in-process backend by default and must be unchanged; add one case with the fake
  worker asserting one post per drawn frame and none while settled.

### Acceptance criteria

- On the Item 3 harness at N = 4096, `?render=worker` shows the main thread's
  per-frame work reduced to the pack-and-post path: the engine's `ops` no longer
  appear on the main thread, p95 main-thread frame time falls by the baseline's
  engine+draw cost, and long tasks over 50 ms disappear or shrink; `?render=main`
  reproduces the baseline.
- The drawn `ops` for a given graph/camera/selection are identical between the two
  modes (the correctness oracle).
- `./cli run` over `file://` is fully in-process and unchanged; serving `web/`
  over HTTP exercises the worker.
- A steady-state frame in worker mode allocates no typed array on the main thread.

### Evidence

The Item 3 harness block, before (`?render=main`, i.e. today) and after
(`?render=worker`), on the same hardware/browser, plus the `ops`-identity table
and the worker's own CPU time. State the metric honestly: main-thread frame time
and long tasks, not total CPU.

### Risks and mitigations

- *The worker bundle 404s and the canvas is already transferred.* Prevented by the
  probe; the timeout is the bound. Belt and braces: a post-transfer `onerror`
  (a crash, not a load failure) can be handled by replacing the canvas element
  with a fresh clone, re-running `resizeCanvas()` and re-binding listeners — named
  here as optional hardening, deliberately not in scope, because the probe covers
  the documented failure.
- *A frame backlog builds up.* Prevented by one-in-flight plus latest-state
  coalescing; tested.
- *Per-frame allocation creeps back in.* Prevented by the zero-allocation test.
- *The main-thread saving is smaller than expected because rasterisation is
  already off-main.* Expected: the saving is the command-building JS, which is the
  part that blocks the host's thread. It changes the published budget and the size
  at which the worker is worth enabling by default, not whether the host thread
  keeps the drawing; the in-process path stays available as the documented
  fallback and as the harness's control.
- *`translatedPosition` reads stale on the main thread.* No reader outside the
  drawer and `bench/`; documented on `Tag.ts` and asserted by keeping the bench's
  own projection step (`bench/physics.bench.ts:253-259`).
- *HiDPI regressions.* `test/hidpi.test.ts` semantics move to the backend, and the
  harness runs dpr 1 and 2.
- *Bundle duplication.* `Renderer` ships in both `main.js` (fallback) and
  `render.worker.js`; state the size delta in the PR.
- *Two workers, three graph copies.* Bounded by N and small; the memory delta at
  8192 is measured and reported. If it is the blocker, the
  [end-state](#end-state--all-heavy-work-off-the-main-thread) routes apply.

### Documentation

- README "Cadence" (`README.md:230-261`): rendering joins physics off the main
  thread; the probe/fallback rule; the one-frame-in-flight rule; the `file://`
  caveat now covers both workers.
- README intro/"Cadence": state the embedding target plainly — a host's main
  thread is not the component's to spend — so the worker boundary reads as
  architecture rather than as an optimisation for this demo.
- README invariant 2 (`README.md:507-509`): restated as one projector per frame,
  resolved in whichever realm draws.
- README invariant 8 (allocation) gains the boundary: the returned-buffer pool.
- README "Depth cue" / `Tag.ts`: depth is written by the frame's drawer.
- README "Constants": `renderer.workerReadyTimeoutMS`.
- README "Next steps": row 3 loses its OffscreenCanvas half and keeps WebGL
  (`instanced points and lines`) as the remaining canvas-2D escape; row 2 (worker
  boundary) gains the new main → render copy and points at the end-state routes.
- `webpack.config.js` comment: the third entry and why.

---

## End state — all heavy work off the main thread

The target is fixed by the component goal: on the host's main thread, a frame
costs only input handling, camera state and DOM chrome — no physics, no
projection and no canvas commands proportional to N. Reaching it takes one of two
routes after this plan's render worker lands; which one is settled when the
embedding API is designed, because the API is what decides how many workers the
host is asked to host.

After this plan, exactly two per-frame O(N) tasks are left on the main thread,
both small but both avoidable, and the routes differ in which they remove:

- the position copy and forward to the render worker (~98 KB `set()` at 4096);
- the depth write-back loop, kept only so the drag can unproject on the selected
  node's plane ([the depth write-back](#the-depth-write-back)).

1. **A `MessageChannel` between the physics worker and the render worker.** The
   physics worker posts each `positions` response to both the main thread and a
   port held by the render worker, which removes the copy and forward. The depth
   write-back stays: the drag still needs the selected node's depth on the main
   thread. Cost: the render worker must exist before the physics worker is
   constructed, two generations must agree, and `setGraph` must re-init both in
   the right order. `src/PhysicsRunner.ts`, `src/PhysicsProtocol.ts`,
   `src/RenderProtocol.ts`.
2. **One simulation worker that owns physics, projection and drawing.** Removes
   every position copy between domains, and — because the worker then owns both
   the graph and the pointer's target — lets hit-testing and the drag's
   unprojection move in with it: the main thread sends canvas coordinates and
   reads back a selection index, so the depth write-back goes too and the
   remaining per-frame O(N) work on the main thread is zero. Benefit: one bundle
   to ship, one lifecycle, one failure mode, and the two independent fallback
   axes collapse to one. Cost: physics and rendering serialise inside the one
   worker (B in [the placement table](#1-where-the-boundary-goes)), which caps
   camera responsiveness at step + draw where two workers would overlap them.

Both routes take the heavy work off the host's main thread; they differ in
packaging, in how much camera smoothness is worth during a long step, and in
whether hit-testing moves with the graph. Route 1 is the smaller change and keeps
the existing `Selection.ts` contract; route 2 is the cleaner component.

### Packaging for reuse

Whichever route lands, the worker boundary must stop being demo-shaped before this
is a component:

- The default worker URLs are hard-coded relative paths
  (`src/PhysicsRunner.ts:79`, and the render worker in Item 5). A host's bundler
  resolves its own asset graph, so the component must accept an injected worker
  factory/URL — the `WorkerFactory` seam already exists for tests
  (`src/PhysicsRunner.ts:26`) and becomes the public one.
- The component must not require the host to have a `document` at import time, and
  must degrade to the in-process path when `Worker`/`OffscreenCanvas` are absent —
  the [fallback rules](#6-item-5--wire-it-in-handshake-transfer-resize-export-depth-write-back)
  already cover the second; the first is a packaging checklist item.
- The published budget from Item 3 (main-thread ms and long tasks per node count)
  is part of the component's contract, not an internal number.

This is deliberately not an item in this plan; it is the plan *after* this one.

---

## Sequencing and PR breakdown

Recommended order (each PR off up-to-date `main`, squash-merged, branch deleted):

| # | Item | Branch | Why here |
| ---: | --- | --- | --- |
| 1 | **Item 1** — `RenderSurface` | `refactor/render-surface` | Type-only; makes the engine pure and removes the casts. No behaviour to review. |
| 2 | **Item 2** — render backend seam | `refactor/render-backend-seam` | In-process only; no pixels change, so the seam's review is mechanical. Builds on 1's surface. |
| 3 | **Item 3** — real-canvas harness | `perf/real-canvas-frame-harness` | Fixes the metric, the baseline and the component's published budget before any worker exists. Records the numbers; does not gate the work. |
| 4 | **Item 4** — protocol, engine, worker entry | `feat/render-worker-engine` | Headless and testable; the `ops`-identity proof lands before anything is wired. |
| 5 | **Item 5** — wire it in | `feat/offscreen-render-worker` | The transfer, handshake, backpressure, resize and export; the harness then supplies before/after. |

Dependency notes:

- Items overlap in `Renderer.ts` (1, 4), `UIController.ts` (2, 5),
  `RenderRunner.ts` (2, 5) and `test/support/dom.ts` (2, 5); the order above
  serialises them.
- Item 3 lands before Item 4 so the "before" column exists before anything moves,
  and so the budget the component publishes is measured on the code a host would
  otherwise get. It cannot end the plan; a flat baseline re-orders priorities and
  sets the threshold.
- If a reviewer prefers fewer PRs, 1 + 2 form one coherent "make the seam" change
  and 4 + 5 one "add the worker" change, at the cost of the identity proof sharing
  a PR with the wiring.

## Definition of done

Per item:

1. The stated acceptance criteria are met and each has a test (or an explicit,
   justified "manual instrument" note for Item 3).
2. `npm run ci` is green and the suite's runtime has not grown materially; no test
   constructs a real `Worker` or `OffscreenCanvas`.
3. Item 3's harness numbers (or the `ops`-identity table where no timing claim is
   made) are quoted in the PR.
4. The README is updated: the affected invariants, the Cadence worker section, the
   Constants table, the Performance harness pointer, and the Next steps rows.
5. The invariants in [§0](#the-invariants-that-must-survive) hold, including the
   `PURE_MODULES`/`DOM_MODULES` classification and `Renderer.ts` remaining the only
   drawer.

## Decisions

Decision 1 and decision 7 were settled on 2026-09-27: the boundary is a
**dedicated render worker**, separate from the physics worker, and the component
goal — all per-frame heavy work off the host's main thread — justifies the work
independently of any frame measurement. The rest carry a recommendation and are
settled at review of the item that implements them.

| # | Decision | Recommendation | Consequence |
| --- | --- | --- | --- |
| 1 | Where the boundary goes | **A: a dedicated render worker**, separate from the physics worker | One extra position copy per step in exchange for physics/render concurrency and fault isolation. The end state picks between the merge and the channel later; neither is a precondition. |
| 2 | How frames reach the canvas | **`transferControlToOffscreen`**, with a probe-then-transfer handshake | Zero-copy presentation; the transfer is one-way, so the probe and the ready timeout are mandatory, not optional. |
| 3 | What crosses per frame | **Model positions + camera in; depths + returned buffer out** — the worker projects | Removes the main thread's O(N) per-tick projection; keeps the cull boundary and the depth cache in one realm; keeps the drag reading `Tag.depth`. |
| 4 | Backpressure | **One frame in flight, latest-state coalescing, pooled returned buffers** | A slow worker cannot queue frames; steady state allocates nothing. |
| 5 | What happens if the worker fails | **In-process fallback**, never a dead canvas | The probe prevents the unrecoverable case; a post-transfer crash is left as documented hardening. |
| 6 | Is the worker the default once it works | **Yes, feature-detected, with `?render=main` as the escape hatch** | The `file://` demo and Node tests keep the in-process path; the harness can A/B in one build. |
| 7 | Why the work happens at all | **The component goal**: every per-frame O(N) task — physics, projection, drawing — belongs off the host's main thread | The motivation is architectural and measurement-independent. Item 3 sets the budget and the regression threshold; a flat baseline re-orders priorities, it does not cancel the work. |
| 8 | How the worker is constructed in a host | **An injectable worker factory/URL**, with the demo path as this repo's default | `src/PhysicsRunner.ts:79`'s relative path is demo-shaped; the component API exposes the seam. Part of the packaging plan, not this one. |
