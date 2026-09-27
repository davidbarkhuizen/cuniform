# Node and edge emphasis — a panel toggle between two display configurations

| | |
| --- | --- |
| **Status** | Planned |
| **Area** | new `src/core/Emphasis.ts`, `src/render/Renderer.ts`, `src/render/RenderSurface.ts`, `src/render/RenderProtocol.ts`, `src/render/RenderRunner.ts`, `src/core/K.ts`, `src/app/UIController.ts`, `src/app/State.ts`, `src/app/entrypoint.ts`, `web/index.html`, `web/stylez.css`, `bench/render-frame.ts`, `test/architecture.test.ts`, `test/render.test.ts`, `test/render-worker.test.ts`, `test/render-runner.test.ts`, `test/display-emphasis.test.ts` (new), `test/layout.test.ts`, `test/support/dom.ts`, `docs/model-camera-and-rendering.md`, `docs/visual-layout-and-interaction.md`, `docs/constants.md`, `docs/invariants.md`, `docs/next-steps.md` |
| **Depends on** | nothing outstanding — `main` is green at 946ffa4 (`npm run ci`, 524 tests) |
| **Blocks** | nothing |
| **Evidence** | measured on `main`: the shipped palette gives nodes only **3.78:1** contrast against edges at full opacity; dimming node fills to `0.70` in an edge-priority frame drops that to **1.95:1**, below the 3:1 UI floor, while dimming edges to `0.55` in a node-priority frame *raises* node/edge contrast to **6.75:1**. `test/render.test.ts` already pins that the per-item path interleaves edges with nodes (`farthest-first across edges and nodes`) while the batched path draws every edge before any node (`batch mode draws every edge before any node`). |

## 1. Goal

Add a **display emphasis** control to the floating panel that switches the
whole frame between two configurations:

- **`nodes`** — the vertices are the subject: edges recede behind them.
- **`edges`** — the structure is the subject: edges are drawn over the vertices
  and heavier.

The choice is **global** (all nodes against all edges, not selection-scoped), it
is **not persisted** (a reload starts at `nodes`), and it changes **only the
frame the drawer produces** — never the graph, the physics, the camera, the
selection or the hit-test.

The toggle is a legibility control, not a data operation: switching it must not
`wake()` a settled simulation, must not move the camera, and must not alter a
single model coordinate.

## 2. What the frame does today, and the evidence

The renderer has **one emphasis for the whole frame**. Every knob that could
distinguish nodes from edges is shared:

- **One painter order.** `render()` builds a single list of edge and node draw
  items and sorts it `(depth descending, insertion index ascending)`
  ([`src/render/Renderer.ts`](../../src/render/Renderer.ts)). An edge's
  representative depth is the mean of its endpoints, so an edge can sit in front
  of one endpoint and behind the other.
- **One depth ramp.** `alphaAt()` maps a depth to `[depthCue.minAlpha,
  depthCue.maxAlpha]` = `[0.35, 1.0]` for nodes and edges alike.
- **One palette.** `K.colours.nodeDefault` `#39d98a` against
  `K.colours.edgeDefault` `#4b5b70`. The contrast advantage is already the
  nodes': 3.78:1, which `test/layout.test.ts` pins at `> 3`.
- **Edge weight is never set.** The renderer does not touch `lineWidth` and
  [`RenderSurface`](../../src/render/RenderSurface.ts) does not declare it, so
  every edge and the selection ring stroke at the context default.

The demo's startup graph is 11 nodes, so the visible frame is the **per-item**
path; the size-gated paths only appear once the chooser is used.

### The three draw paths already disagree about who is on top

| Path | Gate | Order today |
| --- | --- | --- |
| per-item | below both thresholds | **depth-interleaved**: an edge can cover a node behind it |
| batched edges | `edges.length >= K.renderer.batchEdgesMinEdges` (2000) | **every edge before every node** (`drawBatchedEdges()` runs first) |
| coarse | `vertices.length >= K.renderer.performance.minNodes` (4096) | every edge, then colour-batched node fills, then the ring/labels |

So "nodes on top" is already the behaviour above 2000 edges and
depth-interleaved below it. Any emphasis policy that is defined only in the
per-item comparator will **silently do nothing above the thresholds** — the
central implementation risk of this change (§7).

### The measured cost of each lever

WCAG relative luminance, sRGB compositing over the canvas `#04070e`:

| Frame | near (alpha 1.0) | mid (0.675) | far (0.35) |
| --- | ---: | ---: | ---: |
| baseline (both scales 1.0) | 3.78 | 2.79 | 1.67 |
| node-priority, `edgeAlphaScale` 0.55 | **6.75** | **4.01** | 1.93 |
| edge-priority, `nodeAlphaScale` 0.70 | **1.95** | 1.62 | 1.24 |
| edge-priority, `nodeAlphaScale` 0.85 | **2.77** | 2.14 | 1.43 |

The asymmetry is the point: **dimming edges is safe, dimming nodes is not.**
Edges are already the dimmer element, so pushing them back only widens the
separation; nodes are the only bright thing in the frame, so fading them toward
the near-black canvas collapses the very contrast the configuration is meant to
preserve. That is why §4.2/§4.3 ship `nodeAlphaScale = 1.0` and let **paint
order and edge width** carry the edge-priority read.

`K.depthCue.minAlpha = 0.35` is the fade floor, so a `0.55` edge scale leaves
the farthest edge at alpha `0.193` — dim, but still present over the mesh.

## 3. Decisions of record

Chosen deliberately before implementation. The plan is built around them and
individual PRs do not reopen them.

| # | Decision | Choice |
| --- | --- | --- |
| D1 | Scope | **Global**: every node against every edge, independent of the selection |
| D2 | The two configurations | `nodes` (default) and `edges`; switching always changes the frame, so the control is never a no-op |
| D3 | Default | **`nodes`**, set in `initialize()`; no storage, a reload starts there |
| D4 | Levers | Paint order, a per-class alpha scale, and edge width |
| D5 | Where the vocabulary lives | The `Emphasis` enum and its guard in a pure `src/core/Emphasis.ts`; the preset values in `K.renderer.emphasis` |
| D6 | Where the choice lives | `State.emphasis`, so it survives `state.reset()` and a graph swap exactly as the camera does |
| D7 | Wire form | A **numeric** field on `FrameRequest`, not `InitRequest`, so it can change live; unknown values decode to `nodes` |
| D8 | Labels and ring | Keep the full depth-ramp alpha and the node radius; only node **fills** take a node scale. In `edges` mode the selection's ring and labels are re-drawn after the edge pass |
| D9 | One policy, three paths | The per-item, batched and coarse paths all honour the same order/alpha/width policy; no path is exempt |
| D10 | Redraw rule | A toggle calls `requestRedraw()`, never `wake()` — it is neither a step nor a camera move |
| D11 | Panel control | Two real `<button>`s in a new `.emphasisSection`, in a `role="group"`, carrying `aria-pressed` and a `data-emphasis` value |
| D12 | Selection semantics | Unchanged. The yellow selection highlight composes with, and is never replaced by, the emphasis |

Why each, briefly:

- **D1/D2 — global and symmetric.** The request is about the graph's two
  elements taking turns as the subject, which is a property of the frame, not of
  one selected node. A selection-scoped toggle would do nothing with an empty
  selection, and the existing yellow highlight already answers "where is the
  selection".
- **D3 — `nodes` default.** The shipped palette already gives nodes the
  contrast advantage (3.78:1), so node-priority is the natural resting state;
  and a fresh load is a demo, not a preference store. Persisting a display
  choice would add a storage dependency and a storage test for no functional
  gain.
- **D4 — the three levers, and why alpha is one-sided.** Order is free and
  strong. Edge width is what makes "the mesh is the subject" read once edges are
  on top. Alpha is included because it is the cheapest way to push edges back in
  `nodes` mode, but the measurements in §2 show it must not be used to push
  *nodes* back, so the shipped `edges` preset leaves `nodeAlphaScale` at 1.0.
- **D5 — the vocabulary in `core`.** `core` is "the vocabulary every other
  package speaks". Every package already imports it, `ui` is forbidden from
  importing `render`, and the controller needs the type and the guard. Putting
  it in `render` would force either an `app → render` type dependency in
  `State.ts` or a duplicated guard.
- **D6 — the choice on `State`, not in the controller's ad-hoc fields.**
  `state.camera` already survives `reset()`, and `reset()` is called on
  mouse-out, graph swap and `initialize()`. A display choice that vanished on a
  graph swap would be a bug, and putting it beside the camera is the one place
  that cannot forget.
- **D7 — the frame, not init.** The emphasis can change between any two frames,
  and a graph swap re-sends `init`. Carrying it on the frame keeps the two
  independent; a numeric field keeps the documented "nothing per-frame is a
  string" rule.
- **D8 — labels stay legible.** Text is the one thing the depth fade must not
  compound: a label at `0.19` alpha is unreadable, so the node scale applies to
  the fill and never to `fillText`. Re-drawing the selection's ring and labels
  after the edge pass is bounded by `degree(selected) + 1`, the same bound the
  coarse path already relies on.
- **D9 — one policy everywhere.** The three paths are a performance ladder, not
  three renderers. A configuration that reversed above 2000 edges would be a
  bug the eye may not catch on a large graph.
- **D11 — buttons, not a checkbox.** Two named configurations are a segmented
  control, not a boolean: `aria-pressed` on two buttons tells a screen reader
  which is active, and `DragController.ownsInteractivePress()` already excludes
  any press whose ancestor is a `BUTTON`, so no `stopPropagation` guard is
  needed (§4.7).

## 4. Design

### 4.1 The configuration

A pure `src/core/Emphasis.ts`:

```ts
export const Emphasis = { nodes: 0, edges: 1 } as const;
export type Emphasis = (typeof Emphasis)[keyof typeof Emphasis];

/** The wire and DOM guard, the analogue of isCameraAxis/isCameraZoom. */
export function isEmphasis(value: unknown): value is Emphasis;
export function emphasisFromWire(value: number): Emphasis; // unknown -> nodes
```

The values live in `K.renderer.emphasis`, keyed by that enum, so
`docs/constants.md` remains the one home for tunables:

| Field | `nodes` (default) | `edges` |
| --- | --- | --- |
| paint order | edges first, nodes on top | nodes first, edges on top |
| `edgeAlphaScale` | 0.55 | 1.0 |
| `nodeAlphaScale` | 1.0 | 1.0 |
| `edgeWidthPx` | 1.0 | 2.5 |

The renderer resolves the preset **once per frame** into local numbers; it never
allocates a config object per draw (invariant 8).

`nodeAlphaScale` exists as a field even though both shipped presets set it to
`1.0`: it is the seam that makes the mechanism complete and testable in both
directions, and its measured safe range is recorded next to it so a future tune
does not rediscover §2.

### 4.2 Paint order: a leading sort key

`itemKind` already distinguishes the two classes (`EDGE_ITEM = 0`,
`NODE_ITEM = 1`). The comparator gains one leading term:

```ts
const rank = (item: number) =>
  emphasis === Emphasis.nodes ? itemKind[item] : 1 - itemKind[item];

itemOrder.sort((a, b) =>
  (rank(a) - rank(b)) || (itemDepth[b] - itemDepth[a]) || (a - b));
```

For `nodes` this is the existing `edge`-before-`node` tie-break promoted to an
absolute rule; for `edges` it is its mirror. Depth and insertion order still
order **within** a class, so invariant 4 becomes
`(emphasis rank, depth descending, insertion index ascending)` — still an
explicit total order, so a layout remains reproducible.

### 4.3 Per-class alpha

One helper, so clamping has one home:

```ts
const scaledAlpha = (base: number, scale: number) =>
  Math.min(1, Math.max(0, base * scale));
```

It is applied to `alphaAt()` in `drawEdge()`/`drawNode()`, to `bucketAlpha()` in
`drawBatchedEdges()`, and to the collapsed alpha in `drawBatchedNodeFills()`.
`drawCoarseNode()` (the ring and the labels) deliberately does **not** take the
node scale (D8).

### 4.4 Edge width and `RenderSurface.lineWidth`

`RenderSurface` gains `lineWidth: number`. Both real contexts
(`CanvasRenderingContext2D`, `OffscreenCanvasRenderingContext2D`) already have
it, so the interface grows by one line and the fake context in
`test/support/dom.ts` by one field.

The width is set at the edge pass, not globally: the selection-ring stroke must
set its own width or it would inherit `2.5` in `edges` mode. A
`NODE_RING_WIDTH = 1` constant beside `SELECTION_RADIUS` names that.

`test/architecture.test.ts`'s drawing-call detector already includes `stroke`
and `fill`; `lineWidth` is an assignment, not a call, so it does not move the
"only `Renderer.ts` draws" assertion.

### 4.5 One policy, three paths

| Path | `nodes` | `edges` |
| --- | --- | --- |
| per-item | edges-first rank, depth within each class, edge alphas scaled | mirrored rank: nodes first, then edges, at `edgeWidthPx` |
| batched edges | `drawBatchedEdges()` first, then the node loop; alpha scaled | the node loop first, then `drawBatchedEdges()`; edges drawn last |
| coarse | edges, colour-batched fills, ring/labels | colour-batched fills, ring/labels, **then** edges |

The batched and coarse paths currently call `drawBatchedEdges()` before the node
pass and, in the coarse case, `return` immediately afterwards. Both are
restructured so the edge pass is a call that can be made first or last, rather
than a fixed prefix.

In `edges` mode the edge pass is followed by a bounded **selection emphasis**
pass that re-draws the selected node's ring and the labels of the selection and
its incident neighbours (D8) — the same set `drawCoarseNodeWork()` already
draws, bounded by the selected node's degree rather than by N. Without it, a
2.5 px mesh would overpaint the one label a user is reading.

### 4.6 The wire and worker parity

`FrameRequest` gains `emphasis: number`. `RenderWorkerEngine.draw()` decodes it
with `emphasisFromWire()` and passes it to `render()`, so
`test/render-worker.test.ts`'s pixel-identity contract is extended to assert
in-process and worker frames are **byte-identical in both configurations**, not
just the default. `RenderBackend.draw()` and `RenderRunner.draw()` gain a sixth
positional argument; a numeric parameter, not an options object, so the
steady-state frame still allocates nothing.

`docs/model-camera-and-rendering.md`'s protocol table gains the field on the
`frame` row.

### 4.7 The panel control and the controller

Markup, in `web/index.html`, as a new section **after the camera console and
before the actions** (matching the panel's identity → readings → camera →
actions reads):

```html
<div id="emphasisConsole" class="emphasisSection" role="group"
     aria-label="display emphasis">
  <div class="sectionHeading">display</div>
  <div class="emphasisRow">
    <button type="button" class="emphasisButton"
            data-emphasis="nodes" aria-pressed="true">nodes</button>
    <button type="button" class="emphasisButton"
            data-emphasis="edges" aria-pressed="false">edges</button>
  </div>
</div>
```

`web/stylez.css` gets `.emphasisSection` (`cursor: default`, the panel's own
separator) and `.emphasisButton`, mirroring `.cameraSection`/`.cameraButton`
including the `:focus-visible` outline and a pressed/selected state.

`entrypoint.ts` resolves the container with the same nullable pattern as
`cameraConsole`, and `UIController`:

- stores `state.emphasis` (`nodes` from `initialize()`),
- reads the pressed button from a **delegated `click`** on the container,
  through `isEmphasis()` on the `data-emphasis` value,
- updates `aria-pressed` on both buttons, then calls `requestRedraw()` (D10).

A `click` listener is enough: Enter and Space on a real `<button>` produce one.
`DragController.ownsInteractivePress()` walks ancestors and ignores any press
whose target is inside a `BUTTON`, so — unlike the camera console's *hold*
listener — no `pointerdown`/`stopPropagation` guard is required (D11). The
listener joins `toggleEventListeners()`, so `terminate()` cannot leave it
behind.

### 4.8 Determinism, allocation and invariants

- **Invariant 2 (one projector per frame)** — untouched; the emphasis never
  reaches the projector.
- **Invariant 4 (deterministic order)** — restated with the emphasis rank as
  the leading key (§4.2).
- **Invariant 8 (allocation-free steady state)** — the preset is resolved to
  local numbers once per frame; no object is built per draw.
- **The renderer stays DOM-free** — `core/Emphasis.ts` joins `PURE_MODULES`,
  and `Renderer.ts` continues to name no canvas type.

## 5. Phased delivery

### PR 1 — this workplan

`docs/workplans/display-emphasis.md` plus one linking row in
`docs/next-steps.md`. No source changes.

### PR 2 — the configuration and the wire

`core/Emphasis.ts`, `K.renderer.emphasis`, `RenderSurface.lineWidth`,
`Renderer.ts`, `RenderRunner.ts`, `RenderProtocol.ts`, `bench/render-frame.ts`,
the render/worker/runner tests, and the `architecture.test.ts` classification.
No UI: the frame is drawn in the default `nodes` configuration and the feature
is exercised only by tests.

This PR **changes the default frame** if `nodes` ships `edgeAlphaScale = 0.55`,
and therefore updates the `test/render.test.ts` goldens. If review prefers the
status quo as the baseline, the alternative is `nodes` = `edgeAlphaScale 1.0` +
today's comparator, leaving the goldens untouched and the whole divergence in
`edges` (§10, Q1). The decision is made in this PR, not carried silently.

### PR 3 — the panel control and the docs

`web/index.html`, `web/stylez.css`, `entrypoint.ts`, `UIController.ts`,
`State.ts`, `test/layout.test.ts`, `test/display-emphasis.test.ts`, and the four
docs pages. The panel shows a control that does something only because PR 2
landed.

## 6. Test plan

### New tests

- **`test/display-emphasis.test.ts`** — `isEmphasis()` accepts only the two
  wire values and rejects `'nodes'`, `null`, `undefined`, `2`, `-1`, `NaN`;
  `emphasisFromWire()` maps an unknown number to `nodes`; the two presets differ
  in exactly the declared fields; the default is `nodes`.
- **Controller** — pressing the `edges` button sets `state.emphasis`, flips
  `aria-pressed` on both buttons, and requests exactly one redraw; pressing
  `nodes` returns; a click on the section's padding changes nothing; a button
  press is ignored by `DragController` (the panel does not move); the listener
  is detached by `terminate()`; `state.reset()` does not clear the choice, and a
  graph swap preserves it.
- **Renderer, both presets, per path** — for the per-item path, a node nearer
  than an edge is filled *after* that edge in `nodes` mode (nodes on top) and
  *before* it in `edges` mode; for the forced batch path, the last edge stroke
  precedes the first fill in `nodes` and follows the last fill in `edges`; for
  the forced coarse path, the same, and the selection's ring/label survive as
  the last ops. `FakeContext2D` records `lineWidth` so the edge stroke width and
  the ring width are both asserted.
- **Alpha** — the `nodes` preset scales only edge alphas (asserted against
  `alphaAt`), the `edges` preset leaves every alpha at the unscaled ramp.
- **Worker parity** — `RenderWorkerEngine` output equals the in-process
  `render()` output op-for-op in both configurations.

### Existing tests: expected impact

| File | Impact |
| --- | --- |
| `test/render.test.ts` | `render.length` 4 → 5; the goldens change under `nodes` if Q1 resolves to scaling; two new presets covered |
| `test/render-worker.test.ts` | `frameFor()` gains the field; parity is parameterised over both configurations |
| `test/render-runner.test.ts` | every `.draw(...)` and `frames()`/`ack()` gains the argument; a frame carries the emphasis |
| `test/support/dom.ts` | `RenderBackend.draw`, `RecordedDraw`, `FakeContext2D.lineWidth`, `demoElements()` |
| `test/layout.test.ts` | a new section-order assertion (camera < emphasis < actions) and CSS coverage for the section and its buttons |
| `test/architecture.test.ts` | `core/Emphasis.ts` added to `PURE_MODULES` |
| `test/entrypoint.test.ts` | the new element resolved; its absence is still a reported miss |
| `bench/render-frame.ts` | the draw call gains the argument |

## 7. Risks and mitigations

1. **The size-gated paths hardcode edges-first.** The single most likely bug:
   `edges` mode appears to work in the demo (11 nodes, per-item path) and does
   nothing above 2000 edges. *Mitigation:* D9 and the forced-batch/forced-coarse
   renderer tests in PR 2, which assert the order per path rather than only on
   the per-item path.
2. **`lineWidth` is a new interface field.** A real context has it; the fake
   must grow it or the structural `RenderSurface` check fails. *Mitigation:*
   the field is added in PR 2 with the fake, and the ring width gets its own
   constant so `edges` mode cannot thicken it.
3. **Goldens churn.** If `nodes` scales edges, every exact-op-sequence assertion
   in `test/render.test.ts` changes at once. *Mitigation:* Q1 decides whether the
   default is the status quo; either way the new nodes/edges contrast is asserted
   so the golden is not the only guard.
4. **A dim node is a lost node.** The measurements in §2 show a `0.70` node
   scale falls below the 3:1 floor. *Mitigation:* `nodeAlphaScale = 1.0` in the
   shipped `edges` preset, a comment recording the measured range, and a test
   that pins the preset's values.
5. **Edges over the selection's label.** Drawing the mesh last can bury the one
   label a user is reading. *Mitigation:* D8/§4.5's bounded selection-emphasis
   pass; the cheaper alternative (accept the overpaint) is Q2.
6. **Panel drag vs the control.** The panel is a drag surface. *Mitigation:*
   real `<button>`s, which `DragController` already excludes, plus a controller
   test that a press on a button does not move the panel.
7. **A stale worker frame.** The emphasis rides the frame message, so a worker
   frame computed before a toggle lands with the old value and is then replaced.
   *Mitigation:* none needed beyond the existing latest-state coalescing; the
   controller requests exactly one redraw, as selection does.

## 8. Out of scope

- **Per-selection emphasis.** The toggle is global (D1); "emphasise the
  selection's neighbourhood" is a different feature and would overlap the
  existing yellow highlight.
- **Persistence.** No `localStorage`, no URL parameter, no config file (D3).
  A host that embeds cuniform can set `state.emphasis` before `initialize()`.
- **Palette changes.** The two configurations share the palette. A
  configuration-specific edge colour is the strongest remaining lever but it
  breaks `test/layout.test.ts`'s palette-contrast assertion and is not needed
  once order and width are in.
- **Node radius scaling.** The chosen lever set is order, alpha and edge width;
  a node-size component is a follow-up if the width-only `edges` read proves
  too weak in the demo.
- **Hover.** There is no hover feature; nothing here adds one.
- **WebGL.** The renderer stays canvas 2D.

## 9. Verification

1. `npm run ci` green on PR 1, PR 2 and PR 3; the test count rises in PR 2 and
   PR 3.
2. PR 1 `git diff main --stat` touches exactly two files: the new workplan and
   one `docs/next-steps.md` row.
3. PR 2: forced-batch and forced-coarse renderer tests assert that `edges` mode
   puts edges after nodes and `nodes` mode does the opposite, so the large-graph
   paths cannot silently diverge.
4. PR 2: `test/render-worker.test.ts` asserts op-for-op equality between the
   in-process and worker frames in **both** configurations.
5. PR 3: `npm run start`, serve `web/`, and check the demo at its 11-node
   default: toggling flips the frame, the selected node stays labelled, the
   panel does not drag when a button is pressed, and a `reset` to a 4096-node
   graph keeps the same behaviour above both thresholds.
6. After merge, fold the durable parts into
   `docs/model-camera-and-rendering.md`, `docs/visual-layout-and-interaction.md`
   and `docs/constants.md`, set the Status to Implemented, and drop the
   `docs/next-steps.md` row.

## 10. Open questions

- **Q1 — Is `nodes` the exact status quo, or does it actively push edges
  back?** The plan's table scales edges `0.55` in `nodes`, which is the clearer
  pair but changes every golden. Keeping `nodes` byte-identical to `main` makes
  the golden suite the regression baseline and puts all divergence in `edges`.
  *Recommendation:* ship the status-quo `nodes` in PR 2, see both modes in the
  demo, and add the edge scale in a follow-up if the pair reads too weakly.
- **Q2 — Re-draw the selection's label after the edge pass, or accept the
  overpaint?** Re-drawing costs one bounded pass in `edges` mode only.
  *Recommendation:* re-draw; an unreadable selection label is a worse demo than
  one extra bounded pass.
- **Q3 — Should the emphasis ride the `frame` message (per frame) or `init`
  (per graph)?** Per frame is proposed. *Recommendation:* per frame — it is one
  number, the toggle is live, and `init` already re-sends on a graph swap.
- **Q4 — Naming.** `Emphasis` / `emphasis` / `emphasisSection` /
  `data-emphasis` are the proposed names; `highlight` was rejected because it
  already names the selection (`SELECTION_COLOUR`, `.highlight`, "the selection
  highlight" in `K.ts`). *Recommendation:* keep `emphasis` as the frame
  configuration and leave `highlight` to the selection.

## 11. Post-implementation notes

Recorded after the feature PRs land, so the plan and the code do not drift.
