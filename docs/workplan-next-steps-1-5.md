# Workplan — README "Next steps" items 1 through 5

Status: **not started**. Scope is the first five rows of the README's
[`Performance → Next steps`](../README.md#next-steps) table; the four scope
decisions were resolved on 2026-09-27 (see
[Resolved decisions](#resolved-decisions)). Items 6–8 are explicitly out of
scope: they are larger designs with their own failure modes (octree traversal
strategy, the worker boundary, and WebGL/OffscreenCanvas or a native kernel) and
land as separate plans and PRs.

This is one plan, executed as **five focused PRs**. Each item below is
independently landable and independently revertible; the sequencing section at
the end says which order avoids rework.

---

## 0. Ground rules for every item

### The invariants that must survive

The suite enforces these (README, "Invariants any change must keep"); they are
the contract, not guidance:

1. **Pure modules stay DOM-free.** `test/architecture.test.ts` pins
   `PURE_MODULES` and lists every DOM-facing module with its justifying marker.
   A new solver or geometry module joins `PURE_MODULES`; only `Renderer.ts`
   draws.
2. **One projector per tick.** `UIController.onTimerTick()` resolves the
   projector once and passes the same camera to step and draw, so the renderer's
   cull boundary sees the depths cached with that camera.
3. **Frozen pre-step snapshot.** Every force in a step comes from the positions
   at the start of the step.
4. **Deterministic order.** Iteration follows `vertices`/`edges` insertion
   order; the painter sort is `(depth descending, insertion index ascending)`.
5. **Pinned-node semantics.** A dragged node keeps the pointer position, has its
   velocity zeroed, is skipped by integration, and still exerts forces.
6. **The exact 2D reduction.** Identity orientation, `focalLength == distance`,
   `z == 0` reduces projection bit-exactly to the 2D mapping.
7. **`Tag` owns its points.** No scratch aliasing into `Tag.position`.
8. **Allocation-free steady state.** A step and a frame run over pooled buffers
   and reusable scratch.

### Measurement discipline

> When timing a change, time it with the committed benchmark and report force
> error alongside any time that moves an approximation; "it feels faster" is not
> evidence, and neither is a fake-context render time presented as a real frame
> cost. (README)

Concretely, every item that can move time or force values must attach before/after
output from `npm run bench` to its PR, and any item that changes an approximation
(theta, edge thinning, node batching) must report the matching error or a clear
statement that the change is JS-call-count only.

### Verification commands

| Purpose | Command |
| --- | --- |
| Typecheck + full suite | `npm run ci` (`./cli ci`) |
| Benchmark | `npm run bench` (`./cli bench`) |
| Bundle | `./cli run` / `bash build-and-run.sh --build-only` |
| Browser smoke test | `BROWSER=... ./cli run` (static `web/index.html`) |

`npm test` compiles with `tsconfig.test.json` and runs `node --test`; the suite
must stay fast — no test may construct a graph of the newly raised `maxOrder`.

### Per-PR workflow (global working agreement)

Branch off up-to-date `main` → make the focused change → push → open PR →
squash-merge → return to `main` → delete the branch → sync. One coherent change
per PR.

---

## Item 1 — Raise `K.chooser.maxOrder` and adapt the chooser

**README row:** "It is still `64`, pinned low back when repulsion was `O(N^2)`.
The solver is now comfortable well past that, so the smallest useful change is to
raise it to a measured ceiling and let the chooser's validation messages follow
`K` as they already do."

### Current behaviour

- `src/K.ts:127-138` — `chooser.minOrder = 2`, `chooser.maxOrder = 64`; the
  comment still says the cap is the old exact/Barnes-Hut crossover and that
  raising it is the first next step.
- `src/GraphSpec.ts:36-65` — `parseRandomSpec()` validates `order` against
  `K.chooser.minOrder/maxOrder` and builds the range message from `K`, so the
  message follows the constant automatically. `branching` is capped at
  `min(K.chooser.maxBranching, order - 1)`.
- `src/GraphWizard.ts:217-243` — `numberField()` creates the two `<input
  type="number">` controls with **no `min`/`max`/`step` attributes**; the only
  feedback is `validationLabel` when `generate` is disabled
  (`validateRandomStep`, `src/GraphWizard.ts:358-370`).
- `test/graph-spec.test.ts` is parameterised by `K` (except one literal `"64"`
  used only as an order large enough to test the branching cap, which stays
  valid). `test/graph-wizard.test.ts` exercises the fields via
  `orderInput`/`branchingInput` and `generateButton.disabled`.

### Measured ceiling

From the committed profile (`npm run bench`, Node 25, sparse graphs, 1280×800):

| N | step ms | tick budget |
| ---: | ---: | --- |
| 1024 | 17.1 | 3 steps per 50 ms tick |
| 2048 | 38.3 | one step per 50 ms tick |
| 4096 | 101.0 | one step per ~2 ticks (~10 Hz) |
| 8192 | not measured (repulsion alone 264.7 ms) | outside the usable band |

`timerTickPeriodMS` is 50 ms and `maxStepsPerFrame` is 2, so **4096** is the
largest measured node count where the solver is still usable (input stays alive
in the worker while the layout advances at ~10 Hz). 8192 has no measured step
time and a 265 ms repulsion pass, so it is the wrong ceiling to advertise.

**Decided:** `K.chooser.maxOrder = 4096`, with `chooser.interactiveOrder = 1024`
driving the hint. The "interactive" alternative (2048, at 38 ms ≤ the 50 ms
tick) was considered and set aside: the worker keeps input alive while the layout
advances, so the usable ceiling is the honest cap to advertise and the hint marks
where the 20 Hz tick budget stops being met.

### Change

1. `src/K.ts`
   - `chooser.maxOrder: 4096` (decided; see [Resolved decisions](#resolved-decisions)).
   - Add `chooser.interactiveOrder: 1024` — the largest measured size that steps
     within a single tick; the threshold for the chooser hint below.
   - Rewrite the comment: it is now a measured usability cap, tied to
     `bench/physics.bench.ts`'s `STEP_CASES`, not the octree crossover.
2. `src/GraphWizard.ts`
   - In `numberField()`, set `min`/`max` (and `step="1"`) from `K` on the
     `<input>` so the native spinner and validation match `parseRandomSpec`.
     Keep `minOrder`/`maxOrder` as the single source; do not restate literals.
   - Add a dedicated, non-blocking hint element (class `wizardHint`) on the
     random step, separate from `validationLabel` so validation semantics stay
     "generate is disabled". `validateRandomStep()` fills it when
     `order > K.chooser.interactiveOrder`, e.g.
     `"4096 nodes: layout advances below 20 Hz"`; it is empty below the
     threshold and on any parse error.
3. `src/GraphSpec.ts` — no logic change required (it already follows `K`). Only
   the comment on the branching cap is re-read to confirm it stays correct.

### Tests

- `test/graph-spec.test.ts` — unchanged parameterisation already covers the new
  bound; add an explicit case that `K.chooser.maxOrder` parses and
  `maxOrder + 1` is rejected with a message quoting the new bound.
- `test/graph-wizard.test.ts` — add: the order input carries
  `min = minOrder`, `max = maxOrder` from `K`; an order above
  `interactiveOrder` shows the hint while `generateButton.disabled === false`;
  the hint clears below the threshold.
- **Do not** add a test that generates `maxOrder` nodes; that belongs to the
  benchmark, not the hot suite.

### Acceptance criteria

- `parseRandomSpec(String(K.chooser.maxOrder), "1").ok === true`;
  `String(K.chooser.maxOrder + 1)` is rejected and the message contains the new
  `maxOrder`.
- The wizard's order input exposes `min`/`max` from `K`; the hint appears above
  `interactiveOrder` and never disables `generate`.
- `npm run ci` is green and the suite's runtime is unchanged (largest test graph
  stays at 512).

### Evidence

Re-run `npm run bench` after the change; the generation and step tables must be
the same as the committed profile (this item changes no code path, only a
constant), and the PR should quote the 1024/2048/4096 step rows to justify the
chosen cap. No force error is involved.

### Risks and mitigations

- *A user asks for a graph that is slower than real time on a weak machine.* The
  worker keeps input alive (README, "Cadence"); the hint names the threshold;
  the wizard is dismissible.
- *The message text is asserted in tests.* The tests read `K`; keep it that way.

### Documentation

- README "Constants" table: `chooser.maxOrder` row → the new value; add
  `chooser.interactiveOrder`.
- README "Next steps" table: delete row 1 (the convention from PR #104 is that a
  landed item leaves the list).

---

## Item 2 — A coarse-rendering / large-graph preset above a threshold

**README row:** "Labels are already culled and edges already batched, but the
debug cost is still real: at 8192 nodes the `FakeContext2D` frame issues 8200
ops. A single 'performance' preset could thin edges further … drop the depth
fade to one bucket, and skip the selection ring on hover."

### Current behaviour

- `src/K.ts:47-60` — `renderer.labelMaxNodes = 150`,
  `renderer.batchEdgesMinEdges = 2000`, `renderer.edgeAlphaBuckets = 8`.
- `src/Renderer.ts:105-224` — `render()` builds one item per visible edge/node,
  sorts by depth, then (above `batchEdgesMinEdges`) draws edges batched into
  one path per (style × alpha bucket) group, and otherwise one path per edge. It
  then walks the sorted items and draws **one `arc()` + `fill()` per node**
  (`drawNode`, 249-292), plus a selection-ring `stroke()` for the selected node
  and `fillText` for labelled nodes. At 8192 nodes the frame's 8200 recorded
  ops are essentially 8192 node fills + ≤16 edge strokes: **node fills dominate
  the JS call count**, and edge batching has already done its work.
- There is **no hover state** anywhere in the codebase (`grep hover src/` finds
  nothing; `State` tracks `b0Down`/`b1Down`/`b2Down` only). The README's "skip
  the selection ring on hover" is aspirational: there is no hover selection ring
  to skip today. See "Spec corrections" below.

### Design

Add a coarse mode gated by a high node threshold, so nothing below it changes
and the small-graph golden tests are untouched.

1. `src/K.ts` — a new `renderer.performance` block:
   ```ts
   performance: {
       // At or above this many vertices the frame switches to the coarse path.
       minNodes: 4096,
       // Collapse the depth fade to a single bucket, so the batched edge groups
       // and the batched node fills collapse to one alpha each.
       edgeAlphaBuckets: 1,
       // One beginPath/fill per node colour instead of one per node.
       batchNodeFills: true,
       // The selected node keeps its selected fill; the ring stroke is dropped.
       selectionRing: false,
       // Edges between two nodes of degree > this are skipped when > 0.
       // Default 0 = off: enable only if a real-canvas measurement justifies it.
       thinEdgesMinDegree: 0,
   }
   ```
   Choosing `minNodes = 4096` lines it up with the item-1 cap and the item-4
   fast threshold, so a user who asks for a large graph gets the tolerant
   physics *and* the cheap frame. Note the threshold is on `vertices.length`,
   independent of `labelMaxNodes`/`batchEdgesMinEdges`, which keep their
   meanings and values.
2. `src/Renderer.ts` — in `render()`:
   - `const coarse = K.renderer.performance.batchNodeFills && vertices.length >= K.renderer.performance.minNodes;`
   - `buckets` for the batched-edge path becomes
     `coarse ? K.renderer.performance.edgeAlphaBuckets : K.renderer.edgeAlphaBuckets`.
   - After edges, when `coarse`, draw node fills **grouped by colour**: build one
     path for the default colour and one for the selected colour (each path
     already has every node's `arc()` in painter order), set `globalAlpha` once
     per group, and issue one `fill()` per non-empty group. Bounded by 2 fills
     regardless of N.
   - Then draw only the nodes that still need per-node work — the selection ring
     (when `selectionRing` is true) and the labels (selection + incident
     neighbours, because `labelAll` is false above `labelMaxNodes`). This loop is
     bounded by `degree(selected) + 1`, not by N.
   - Edge thinning is **off by default** (`thinEdgesMinDegree: 0`) — a resolved
     decision, not a hedge. When enabled it computes each node's degree once per
     coarse frame from `graph.incidentEdges(node).length` into a pooled
     `Int32Array`, and skips an edge when **both** endpoints exceed the
     threshold. Apply the same filter in the counting pass and the fill pass of
     `drawBatchedEdges` so the batch layout cannot drift. It lands only as a
     follow-up with a real-browser measurement, because the fake context cannot
     show the benefit; the preset's measurable win is the batched node fills.

**Spec corrections to record in the README when this lands:**

- "skip the selection ring on hover" → **skip the selection-ring stroke** in
  coarse mode (resolved: no hover feature is added); the selected node still gets
  the selected fill colour. If hover is ever added later, it must force a redraw
  (item 3's trigger list).
- Batching node fills changes compositing: overlapping opaque nodes of one colour
  union into one fill instead of compositing per node. Only above `minNodes`, and
  only for the same colour; document it with the existing batched-edge
  divergence note.

### Tests

- Extend the renderer test helper (`test/render.test.ts:328-343`) to override
  the new keys, or add a `withPerformancePreset()` helper that forces
  `minNodes` to `0` / `Infinity` and restores it.
- Above the threshold on the 4-node fixture:
  - `fills.length <= 2` while `arcs.length` still covers every visible node;
  - the selection ring is not stroked (`selectionRing: false`);
  - every edge is still represented (batched moveTo/lineTo counts unchanged when
    thinning is off);
  - `globalAlpha` is single-valued across the node fills.
- Below the threshold, assert the frame is **unchanged**: forcing
  `minNodes = Infinity` reproduces the current golden op sequence exactly.
- Determinism: two coarse draws of the same fixture are deep-equal.
- `test/architecture.test.ts` still passes (no new module; `Renderer.ts` remains
  the only drawer).

### Acceptance criteria

- At N = 8192 the `FakeContext2D` `ops` count in the benchmark drops from
  ~8200 to a small constant (≤ 2 edge strokes + ≤ 2 node fills + the handful of
  ring/label ops), because `arc` is not counted as a draw op.
- Below `minNodes`, every existing render golden test passes byte-for-byte.
- The coarse path is deterministic and still keeps `(depth descending, insertion
  index ascending)` within each colour group.

### Evidence

Extend `bench/physics.bench.ts`'s `benchRender()` to measure the frame at the
current thresholds and with `performance.minNodes = 0` on the same harness, and
report `ms` and `ops` for both (as the existing legacy/scaled columns do). The
`ops` drop is the acceptance number; the `ms` is a JS-work proxy only — the PR
must say so, and must not present it as a real frame time. If `thinEdgesMinDegree`
is enabled, attach a real-browser measurement (or leave it off).

### Risks and mitigations

- *Visual regression above the threshold.* Gate high (4096), document the
  divergences, and keep the selected fill so selection stays visible.
- *Node batching breaks label/ring placement.* Labels and rings are drawn from
  the same `translatedPosition`/depth values as today; only the fill is batched.
- *A fake-context win that does not help a real canvas.* `arc()` per node is
  unchanged, so real rasterisation still pays N subpaths; the item is a
  call-count/state-change win, and item 8 is the answer if real rasterisation is
  the wall. State this in the PR and README.

---

## Item 3 — Skip the frame entirely when nothing moved

**README row:** "The settle detector stops *stepping* once the layout is quiet,
but the rAF loop still redraws. Track the last drawn camera and the settle flag
and skip `render()` while the camera is still; hover, selection and a resize are
the only things that must force a redraw. This is the cheapest possible frame and
it is the highest-value item at large N."

### Current behaviour

- `src/UIController.ts:819-853` — `onAnimationFrame()` runs the due fixed steps,
  then **always** calls `this.renderFrame()` and schedules the next frame, even
  when `this.settled` stopped stepping and the camera did not move.
- `src/UIController.ts:656-658` — `renderFrame()` draws with
  `this.state.camera` unless given the camera `advanceOneTick()` returned.
- `src/UIController.ts:662-680` — `trackSettle()`/`wake()` already maintain
  `settled` and `quietSteps`.
- `src/State.ts` owns a single long-lived `Camera` (`state.camera`) mutated in
  place by `Camera.orbit/rotateLocal/dolly/panBy/reset`
  (`src/Camera.ts:68-141`). Identity comparison therefore cannot detect a camera
  change; a fingerprint or revision is required.
- `onTimerTick()` (`:617-619`) is the legacy `setInterval` path and is documented
  as "one fixed tick, drawing included"; it never consults the settle state.

### Design

1. **Camera-change detection.** Add a small pure helper next to the camera, e.g.
   `sameCameraView(a, b)` (in `src/Camera.ts`, which stays in `PURE_MODULES`) or
   `cameraFingerprint(view)` in `src/Projector.ts`. Compare the mutable fields:
   the 9 `orientation` entries, `target.x/y/z`, and `distance`
   (`focalLength`/`nearPlane` are fixed for the camera's life). This is a
   fail-safe O(13) check that catches every mutation path, including
   `Camera.reset()`, without having to remember to bump a counter in each
   mutator. The controller stores the last drawn camera's values in a reusable
   scratch view.
2. **A redraw flag.** `private needsRedraw = true;` with
   `private requestRedraw() { this.needsRedraw = true; }`.
3. **In `onAnimationFrame()`:** after the step loop,
   ```ts
   if (steps > 0 || this.needsRedraw || !sameCameraView(this.lastDrawnCamera, this.state.camera))
       this.renderFrame();
   ```
   `renderFrame()` records the fingerprint it drew with and clears
   `needsRedraw`. If a frame is skipped, no `clearRect`/draw call is issued and
   the previous frame remains on the canvas.
4. **Every non-camera, non-physics change must call `requestRedraw()`:**
   - selection changes — `onMouseDown` after `handleNodeSelectionAttempt`,
     `clearSelection()`, `loadGraph()` (new graph, no selection), and the
     wizard's `applyGraphSpec` path;
   - drag — the `b0Down` branch of `onMouseMove` writes `node.position`
     directly, which is neither a camera change nor (necessarily) a step within
     the same frame; without a redraw the drag would lag or freeze;
   - resize — `onResize()` (it already calls `resizeCanvas()`/`wake()`; the
     canvas backing store is re-created, so a redraw is mandatory);
   - `initialize()` sets the initial flag true.
   `wake()` alone is **not** sufficient for drag/load: it only clears `settled`,
   and a frame whose accumulator is below one period runs no step.
5. **Keep the legacy path.** `onTimerTick()` stays "step and draw always",
   because it steps on every interval and never settles; routing it through the
   skip would freeze the picture while physics kept moving. Document the
   asymmetry in the PR and in the `onTimerTick()` comment.
6. **Hover.** No hover exists today. If it is added later, it must call
   `requestRedraw()`; record that in the trigger list so the invariant is
   explicit.

### Tests (`test/cadence.test.ts`)

Using `ui.canvas.context.clears.length` as the draw counter:

- After the graph settles, frames with no camera change and no interaction issue
  **no** further clears (the new behaviour).
- A wheel dolly (camera change) issues a clear even when no step is due.
- A selection click issues a clear.
- A position-writing drag (`state.b0Down = true` + `onMouseMove`) issues a clear.
- A resize issues a clear.
- The existing step-count assertions still hold; the existing "two stepping
  frames → two clears" assertion still passes because stepping frames redraw.
- The `setInterval` fallback test keeps asserting one step per interval callback,
  and (new) one clear per callback.

### Acceptance criteria

- A settled, untouched scene performs zero `render()` calls per animation frame,
  proven by `clears` not increasing.
- Camera interaction, selection, drag, resize and graph swap each force exactly
  one redraw on the next frame.
- The rAF step cadence, `maxStepsPerFrame` cap and backlog drop are unchanged.

### Evidence

The benchmark is physics-only and does not drive rAF, so the evidence here is the
suite's clear-count assertions plus a real-browser check (static `web/index.html`)
showing the canvas stops being redrawn at rest (e.g. via a temporary draw
counter, not committed). No force error is involved.

### Risks and mitigations

- *A missed trigger leaves a stale frame.* The trigger list above is exhaustive
  for today's mutations (camera, positions, selection, canvas size, graph swap);
  each gets a test.
- *Worker responses arriving after stepping stops.* `trackSettle()` requires
  `settleFrames` consecutive quiet responses, so the final responses are applied
  while step-frames are still redrawing. Note this in the PR; if it ever bites,
  give `PhysicsRunner` a response callback that calls `requestRedraw()` (out of
  scope here).
- *rAF vs `setInterval` divergence.* Deliberate and documented.

---

## Item 4 — Default the opening angle from the graph size; expose a quality setting

**README row:** "`barnesHutTheta` is fixed at 0.5. The table above shows 0.9 is
3.7x faster at N=4096 and still 1.8% mean error, so a 'fast' mode is defensible
for large graphs where the eye cannot see the difference. Decide it in one place
(the controller or the solver) rather than exposing theta as a raw knob; report
the error whenever the timing is reported."

### Current behaviour

- `src/K.ts:18-29` — `barnesHutTheta = 0.5`, `barnesHutMinNodes = 64`,
  `barnesHutMaxDepth = 28`.
- `src/ForceDirectedGraph.ts:180-194` — `accumulateRepulsionPass()` runs the
  exact kernel below `barnesHutMinNodes` and otherwise calls
  `octree.build(vertices, K.physics.barnesHutTheta, K.physics.barnesHutMaxDepth)`.
- `src/Octree.ts:98,117-127` — `build()` defaults `theta` to
  `K.physics.barnesHutTheta` and clamps via `clampOpeningAngle()` (ceiling
  `MAX_OPENING_ANGLE = 2/sqrt(3)`).
- The worker builds its **own** `ForceDirectedGraph` from the init message
  (`src/PhysicsProtocol.ts:122-149`), so any physics constant read by the solver
  is evaluated independently in the worker realm. Both realms share the same
  compile-time `K` literals, which is what keeps the backends identical
  (`test/physics-runner.test.ts:56-90`).
- `bench/physics.bench.ts:166-180` already measures theta 0.5 vs 0.9 at N=4096
  with mean/max error, and `:153-164` labels the repulsion section with the
  current theta.

### Design

1. `src/K.ts` — export the setting type once here (so `Quality.ts` can import it
   from `K` without a cycle), then replace the single knob with a coarse policy
   plus named angles. The type is module-level, beside `K`:
   ```ts
   export type QualitySetting = "auto" | "accurate" | "fast";

   export const K = {
       physics: {
           // Which opening angle the solver uses. "auto" picks by graph size, so
           // the default is accurate exactly where the eye can tell and fast where
           // it cannot.
           quality: "auto" as QualitySetting,
           // Accurate angle (README profile: 0.3-0.5% mean error).
           barnesHutTheta: 0.5,
           // Fast angle (README profile: 1.8% mean error at 4096, ~3.7x faster).
           barnesHutFastTheta: 0.9,
           // At or above this order, "auto" uses the fast angle. 2048 is the first
           // measured row where the step no longer fits one 50 ms tick, i.e. where
           // the speed/quality trade tips.
           barnesHutFastMinNodes: 2048,
           // ...
       },
       // ...
   };
   ```
2. `src/Quality.ts` (new, pure) — the one place the decision lives:
   ```ts
   import { K, QualitySetting } from "./K";

   export function openingAngleFor(nodeCount: number, quality: QualitySetting): number
   ```
   - `"accurate"` → `barnesHutTheta`; `"fast"` → `barnesHutFastTheta`;
     `"auto"` → fast when `nodeCount >= barnesHutFastMinNodes`, else accurate.
   - Return the value unclamped; `Octree.build()` clamps as it does today (one
     clamp home).
   Add `Quality.ts` to `PURE_MODULES` in `test/architecture.test.ts` (the test's
   own comment mandates this for a new solver/geometry module). If the reviewer
   prefers no new module, the same function can live in `Kernel.ts`; the
   behaviour and tests are identical.
3. `src/ForceDirectedGraph.ts` — in `accumulateRepulsionPass()`, replace the
   direct `K.physics.barnesHutTheta` read with
   `openingAngleFor(n, K.physics.quality)`. Keep the exact path below
   `barnesHutMinNodes` untouched, so demo-scale forces stay bit-identical.
4. **No protocol or UI change** (resolved: the quality setting stays a K-level
   enum). The README row names only `src/K.ts` and `src/ForceDirectedGraph.ts`,
   and a K-level setting is read identically in both realms, so the worker stays
   deterministic with no message change. Record the constraint:
   `K.physics.quality` is a compile-time default and **must not be mutated at
   runtime**; a future user-facing control would need to cross the worker
   boundary (a `quality` field on `InitRequest` plus a live-change message and a
   `PhysicsRunner` setter) and is deliberately deferred to its own item.

### Reporting the error

- `bench/physics.bench.ts`:
  - include the effective theta in the repulsion row label (e.g.
    `"4096 (theta=0.9)"`), derived from `openingAngleFor(order, K.physics.quality)`;
  - add a `benchQuality()` section comparing `"accurate"` and `"auto"` at 2048
    and 4096, reporting `ms` **and** mean/max force error for each, so the
    default's trade is visible in the committed harness.
- README "Measured profile": the table gains an "effective theta" note (or a
  column). Because `"auto"` changes the forces at ≥2048, the error column for
  those rows must be **regenerated**, not copied.

### Tests

- `test/octree.test.ts` / a new pure test for `openingAngleFor`: boundaries at
  `barnesHutFastMinNodes - 1`, `barnesHutFastMinNodes`, and above;
  `"accurate"`/`"fast"` override the size; a non-finite/oversized result is
  clamped by the existing `clampOpeningAngle` tests.
- Solver equivalence below the threshold: a fixture of `< barnesHutFastMinNodes`
  nodes produces bit-identical step output before and after the change (the fast
  path is not selected).
- Worker/in-process equality above the threshold: run a graph of
  `>= barnesHutFastMinNodes` through `PhysicsRunner` with the fake worker and
  assert the two backends still produce identical positions/velocities
  (`test/physics-runner.test.ts` already has the harness; bump the order).
- A force-error bound at the fast angle already exists
  (`test/barnes-hut.test.ts:119-153`, ≤5% mean at theta 0.9); keep it.
- Confirm the skeleton's existing tests (largest test graph 512) all stay below
  `barnesHutFastMinNodes`, so no golden force values change.

### Acceptance criteria

- Below `barnesHutMinNodes`, forces are unchanged (exact path).
- Between `barnesHutMinNodes` and `barnesHutFastMinNodes`, forces are unchanged
  (accurate angle), proven by a bit-identical fixture.
- At/above `barnesHutFastMinNodes`, `"auto"` selects the fast angle; the bench
  shows the expected speedup with mean error ≤ ~2% at 4096 and the harness
  prints the effective theta next to the timing.
- `npm run ci` is green; the worker and in-process backends remain identical.

### Evidence

`npm run bench` before/after, quoting: repulsion ms and mean/max error at 2048
and 4096 under `"accurate"` and `"auto"`, and the step rows. The PR must not
claim a speedup without the matching error number.

### Risks and mitigations

- *A quality change silently alters large-graph layouts.* It is gated at 2048
  and documented; determinism is preserved because both realms read the same K.
- *A future runtime toggle desyncs the worker.* Explicitly out of scope and
  documented above; the protocol work is named for whoever adds the UI.
- *Bench overrides of `K.physics.barnesHutTheta`.* The existing theta sweep in
  `benchOpeningAngle()` must set `quality` explicitly (e.g. `K.physics.quality =
  "accurate"` while sweeping `barnesHutTheta`) so the sweep still controls the
  value; restore both in a `finally`.

---

## Item 5 — Stop re-scanning for the selection once per tick

**README row:** "`graph.selectedVertex()` is an `O(N)` walk called from inside
`render()`, once per tick. `render` already takes the graph and camera; pass the
selected vertex in from the controller, which knows when the selection changes,
and drop the scan."

### Current behaviour

- `src/Graph.ts:99-102` — `selectedVertex()` is
  `this.vertices.find(v => v.isSelected) ?? null`, an O(N) scan.
- `src/Renderer.ts:105-107` — `render(context, graph, camera)` calls
  `graph.selectedVertex()` at the top of every frame. That value drives edge
  incident colour and label culling.
- `src/UIController.ts` calls `selectedVertex()` at:
  - `:633` in `advanceOneTick()` when `b0Down` (per tick while dragging),
  - `:743` in `updateSelectionInfo()`,
  and `handleNodeSelectionAttempt` (`src/Selection.ts:54`) reads it once per
  click. `clearSelection()` and `loadGraph()` also change selection state.
- `render()` is also called from `bench/physics.bench.ts:256,266` and directly
  in `test/render.test.ts:57` and `test/hidpi.test.ts:140`.

### Design

1. `src/Renderer.ts` — `render(context, graph, camera, selected: Tag | null)`.
   Delete the internal `graph.selectedVertex()` call; thread `selected` into
   `drawEdge`/`drawNode`/`drawBatchedEdges` exactly as today's local is threaded.
   `graph` is still needed for `hasEdge`/`vertices`/`edges`.
2. `src/UIController.ts` — cache the selection so no per-frame or per-tick scan
   remains:
   - `private selected: Tag | null = null;`
   - a single `private refreshSelection() { this.selected = this.solver.graph.selectedVertex(); }`
     called from the two places that already scan (`updateSelectionInfo()`) and
     from `loadGraph()` (set `null`), `clearSelection()` (via
     `updateSelectionInfo`), and `onMouseDown` after a successful
     `handleNodeSelectionAttempt`.
   - `advanceOneTick()` (`:633`) uses `this.selected` instead of
     `graph.selectedVertex()` when deciding the pinned node.
   - `renderFrame()` passes `this.selected` to `render()`.
   `updateSelectionInfo()` already reads the selection, so folding the cache
   update into it keeps one home for "selection changed".
3. **Callers to update:** `UIController.renderFrame`, `bench/physics.bench.ts`
   (`measureRender`), `test/render.test.ts` (`drawWith`), `test/hidpi.test.ts`.
   In tests, keep a tiny local helper that computes `graph.selectedVertex()` once
   per fixture draw so the fixtures stay readable; production never scans.

### Tests

- Renderer: a spy/stub on `graph.selectedVertex` (or a subclass that throws) is
  never called by `render()`; an explicitly passed selection still highlights
  incident edges and culls labels exactly as before (the existing render tests,
  updated to pass the selection).
- Controller: after a click selects a node, `renderFrame` uses the cached node;
  after `clearSelection()` and after `loadGraph()` the cache is `null`; dragging
  pins the cached selected node (cadence/drag tests).
- The existing `test/render.test.ts` selection assertions (incident highlight,
  selected fill, label culling) pass unchanged once the parameter is threaded.

### Acceptance criteria

- `render()` performs no O(N) scan; the only per-frame work is the passed value.
- Selection behaviour (fill colour, incident edge highlight, label culling,
  drag pinning, selection panel) is unchanged.
- All render call sites compile and pass with the new signature.

### Evidence

No timing claim is required: this removes an O(N) walk from the frame, but the
frame is dominated by draw calls. State it as a complexity/cleanliness change
confirmed by the unchanged render goldens, not as a measured speedup.

### Risks and mitigations

- *Cache desync.* Only `Selection.ts`, `clearSelection()` and graph swaps change
  `isSelected` in production; refresh on all three. Tests that set
  `isSelected` directly must pass the selection explicitly, which is the point of
  the signature.
- *Signature churn.* Four call sites, all listed; land this item **first** so
  item 3 builds on the cache rather than rebasing around it.

---

## Sequencing and PR breakdown

Recommended order (each PR off up-to-date `main`, squash-merged, branch deleted):

| # | Item | Branch | Why here |
| ---: | --- | --- | --- |
| 1 | **Item 5** — selection into `render()` | `perf/pass-selection-into-render` | Mechanical signature change; gives item 3 a single "selection changed" hook. Land first to avoid rebasing item 3. |
| 2 | **Item 1** — raise `maxOrder` | `feat/raise-chooser-order-cap` | Tiny, independent; defines what "large graph" means for users. |
| 3 | **Item 4** — size-defaulted opening angle | `perf/size-defaulted-opening-angle` | Makes the raised cap tolerable; bench-first numbers; needs no other item. |
| 4 | **Item 3** — skip the frame when nothing moved | `perf/skip-idle-frames` | Builds on item 5's cache; highest-value idle optimization. |
| 5 | **Item 2** — coarse large-graph preset | `perf/coarse-render-preset` | Largest of the five; measured last, on a baseline that items 1/3/4 have already improved. |

Dependency notes:

- Items **1, 4, 2** all introduce large-graph thresholds. Keep them as three
  named constants (`chooser.maxOrder` / `chooser.interactiveOrder`,
  `physics.barnesHutFastMinNodes`, `renderer.performance.minNodes`) rather than a
  shared global: each is justified by its own measurement and can move
  independently. Aligning them at 1024/2048/4096 is a coincidence of the
  current profile, not a coupling to encode.
- File overlap is serialized by the order above: `Renderer.ts` (items 5, 2),
  `UIController.ts` (items 5, 3), `K.ts` (items 1, 2, 4).
- If a reviewer wants only one PR for all five, items 5 → 3 and 1 → 4 → 2 form
  two coherent changes and could be two PRs; the plan still lands five commits
  with the same per-item evidence.

## Definition of done

For each item:

1. The stated acceptance criteria are met and each has a test.
2. `npm run ci` is green (typecheck + full suite), and `npm test` runtime has not
   grown materially.
3. Any timing or approximation claim is backed by `npm run bench` output in the
   PR, with force error where forces moved.
4. The README is updated: the "Constants" table value, the item's "Next steps"
   row removed, and any divergence (coarse batching, effective theta) documented
   in the Performance section.
5. The invariants in §0 still hold; in particular no new module bypasses
   `PURE_MODULES`/`DOM_MODULES`, and `Renderer.ts` remains the only drawer.

After all five land, the README's "Next steps" table starts at the current row 6
(cheaper octree traversal), which is the first item explicitly reserved for its
own design and PR.

## Resolved decisions

All four scope decisions were settled on 2026-09-27; the item bodies above encode
them. No open questions remain before starting the sequence.

| # | Decision | Resolution | Consequence for the plan |
| ---: | --- | --- | --- |
| 1 | Chooser cap | `K.chooser.maxOrder = 4096`, `chooser.interactiveOrder = 1024` | Item 1 ships the usable ceiling with a non-blocking hint above 1024. The 2048 "interactive" alternative is not used. |
| 2 | Item 2 "hover" | Skip the selection-ring stroke only; no hover feature is added | The README row is reworded as a spec correction when item 2 lands; the ring-skip is the whole of that clause. |
| 3 | Item 4 "quality setting" | K-level enum (auto / accurate / fast) decided in one pure function; no UI control | No worker-protocol or UI change in item 4. A UI control, if ever wanted, is a separate item with its own `InitRequest`/live-change design. |
| 4 | Item 2 edge thinning | Off by default; a follow-up only with real-canvas evidence | The preset lands without thinning; the degree filter is specified but gated. |

Rationale, briefly:

- **4096** is the largest measured node count where the solver is still usable
  (one step per ~2 ticks, ~10 Hz) and the worker keeps input alive; the missing
  8192 step measurement and its 265 ms repulsion pass rule 8192 out.
- **No hover** keeps item 2 inside the README's "small, local" band and avoids
  inventing a redraw trigger (item 3) for a feature nothing uses today.
- **K-level quality** matches the row's named files and its explicit instruction
  to decide the policy in one place rather than expose theta as a knob; both the
  main-thread solver and the worker read the same compile-time `K`, so the
  backends stay identical with no message change.
- **Default-off thinning** keeps `FakeContext2D` ops as the acceptance metric the
  item can actually move; edge thinning's benefit is real-canvas-only and must be
  measured there before it is enabled.
