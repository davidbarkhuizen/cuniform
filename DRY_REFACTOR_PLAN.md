# cuniform — DRY Remediation Workplan

Remove the code repetition found in the DRY review of `main`. The review
concluded that **no copy is divergent** — there is no defect hiding in a second
copy of anything — so every change here is behaviour-preserving hygiene, and the
existing 111-test suite is the safety net rather than a fixture to be rewritten.

All line references are against `main` at `57bf523`
(`feat: full-screen canvas and a floating menu/selection overlay (#39)`). Line
numbers will move as the phases land; each change is therefore also identified by
symbol name, which is the durable reference.

---

## Status: complete

Six focused PRs. Each branched from an up-to-date `main`, was verified
independently, and was squash-merged before the next began — so there was no
rebasing and no long-lived branch.

| PR | Finding | Title | Risk | Net LOC (estimated) | Merged |
| --- | --- | --- | --- | --- | --- |
| 1 | test duplication | Consolidate the test support scaffolding | none (test-only) | ~−150 | [#41](https://github.com/davidbarkhuizen/cuniform/pull/41) `41aa862` |
| 2 | H1 | Build one event-listener table in `UIController` | low | ~−25 | [#42](https://github.com/davidbarkhuizen/cuniform/pull/42) `a47ddeb` |
| 3 | H2 | Extract the shared radial-force kernel | medium | ~−70 | [#43](https://github.com/davidbarkhuizen/cuniform/pull/43) `1eff4bd` |
| 4 | H3 | Introduce a `Viewport` value object | medium | ~neutral | [#44](https://github.com/davidbarkhuizen/cuniform/pull/44) `b3e8dcf` |
| 5 | M2, M3 | Give "the selected node" one home | medium | ~−35 | [#45](https://github.com/davidbarkhuizen/cuniform/pull/45) `e2f451b` |
| 6 | M1 | One representation for a 2D point | low (wide) | ~−30 | [#46](https://github.com/davidbarkhuizen/cuniform/pull/46) `3028da6` |

**Outcome on `main`:** `npm run ci` green — typecheck clean, **127 tests, 0
failures** (up from 111). `./cli build` bundles and the built `dist/index.html`
passed the full interaction matrix in headless Chrome at `devicePixelRatio` 1
and 2 after PRs 2, 4, 5 and 6. The listener list and the model→canvas scale each
exist exactly once. Two deviations from the plan's sketches were made
deliberately and are recorded in the PRs: the force kernel takes the radius the
caller already computed (PR 3), and the selection rewrite captures the hit
node's pre-clear state to preserve the toggle (PR 5).

**The net-LOC estimates above were not met.** Measured against `738a561`,
`src/` went 1429 → 1408 lines and `test/` 2493 → 2732. The consolidation in PR 1
did remove the duplication — roughly 200 lines of it — but the shared support
modules that replace it (~190 lines), a new `src/Viewport.ts` (~50 lines), and
the new tests every later PR's acceptance requires (~330 lines) cost more than
the duplication did. The line counts were not bought back by deleting coverage
or explanatory comments; §9's "test/ shrinks by ~150" assumed deduplication with
no new tests, which the per-PR acceptance criteria contradict.

---

## 1. Scope

**In scope** — the three high and three medium findings from the review, plus the
test-suite scaffolding that the review called the dominant source of repetition.

| ID | Finding | Where | Severity |
| --- | --- | --- | --- |
| H1 | `registerEventListeners` / `deregisterEventListeners` are mirror images | `src/UIController.ts:253-305` | high |
| H2 | The two force accumulators share ~80 % of their bodies | `src/ForceDirectedGraph.ts:148-251` | high |
| H3 | The transform is a 4-number parameter clump; the wrap helpers are asymmetric | `src/ForceDirectedGraph.ts:21-56, 371, 377` | high |
| M1 | `Point2D` and `{x, y}` are two representations of one concept | `src/Point2D.ts`, `src/Tag.ts:14-48`, `src/State.ts:26-29` | medium |
| M2 | "The selected node" is resolved four different ways | `src/ForceDirectedGraph.ts:60-65`, `src/UIController.ts:76-82, 236-238, 320-322` | medium |
| M3 | `handleNodeSelectionAttempt` makes three passes and has a dead branch | `src/ForceDirectedGraph.ts:375-432` | medium |
| T | ~150 lines of test scaffolding duplicated across files | `test/` | high value |

**Out of scope** — the review's low-severity items and consistency notes. They are
real, but bundling them would make the PRs un-reviewable and would put cosmetic
churn next to semantic change. They are inventoried in §8 for a later sweep.

**Explicitly out of scope for every PR:** re-indenting files. `src/` mixes tabs
and 4-spaces within individual files; a repo-wide reformat would bury the real
diff. Formatting is a separate, mechanical PR at most.

---

## 2. Baseline

Measured on `main` at `57bf523`, before any change:

| Metric | Value |
| --- | --- |
| `npm run typecheck` | clean (`strict`, `noUnusedLocals`, `noUnusedParameters`) |
| `npm test` | **111 tests, 111 pass, 0 fail**, ~0.55 s |
| `test/` size | ~1,900 lines across 17 files + 2 support modules |
| `as unknown as` casts in tests | 31 |
| `try { … } finally { dom.restore(); }` wrappers | 33 |
| `Math.abs(a - b) < 1e-…` assertions | 28 |
| `new UIController(…)` blocks in tests | 3, each with 9 casts |
| Identical helper bodies | 4 (`pairAt` ×2, `tag` ×2, `generated` ≡ `newGraph`) |
| Divergent `mouseEvent` helpers | 4 |

Duplication was confirmed mechanically, not by eye — the `pairAt`, `tag` and
`generated`/`newGraph` pairs are byte-identical (see Appendix B for the commands).

---

## 3. Invariants that must survive every PR

These are enforced by existing tests and are the acceptance floor for each
change. A PR that relaxes one of them is wrong, not merely risky.

1. **Jacobi ordering.** All forces are computed from one frozen position
   snapshot, then all velocities, then all positions.
   `test/pipeline.test.ts:68-119` proves the result is independent of vertex and
   edge iteration order and matches a hand-computed synchronous update. The
   four separate passes in `step()` are therefore *not* duplication to remove —
   only their loop syntax may change.
2. **The physics laws are untouched.** Repulsion `k·q²/r^1.9` clamped at
   `minimumInteractionRadius`, spring `k·(r − l)` with the correct sign.
   `test/forces.test.ts`, `test/robustness.test.ts`, `test/convergence.test.ts`.
3. **The solver stays DOM-free.** No `window` or `document` in
   `src/ForceDirectedGraph.ts`, enforced textually by
   `test/pipeline.test.ts:121-131`. Any refactor that moves canvas access into
   the solver breaks this deliberately.
4. **`render()` still takes exactly one parameter** (`render.length === 1`),
   pinned by `test/render.test.ts:106-110`.
5. **No new dependencies.** `dependencies` is `{}` and stays that way; the test
   harness is deliberately dependency-free (`test/support/dom.ts`).
6. **Every PR is green on its own** and adds or preserves tests.
7. **Test counts do not fall.** The consolidation PR refactors helpers, not
   assertions: the suite stays at 111 tests with only scaffolding changed.

---

## 4. Finding → PR map

```
H1 listener mirror      ──► PR 2
H2 force kernel         ──► PR 3
H3 transform clump      ──► PR 4
M2 selected-node        ──► PR 5
M3 selection attempt    ──► PR 5   (same method, same concept as M2)
M1 Point2D              ──► PR 6
T  test scaffolding     ──► PR 1   (first: no production risk, and it makes
                                    the later PRs cheaper to verify)
```

All of PR 3–PR 6 touch `src/ForceDirectedGraph.ts`. They are sequenced rather
than parallelised so each one reviews and merges against a settled `main`.

---

## 5. Workplan

### PR 1 — Consolidate the test support scaffolding

**Branch:** `test/consolidate-support` · **Files:** `test/support/dom.ts`,
`test/support/physics.ts`, `test/support/assert.ts` (new), and the 6 test files
that carry duplicates. **Production code: untouched.**

| # | Change | Current location |
| --- | --- | --- |
| 1.1 | Move `pairAt(r)` into `test/support/physics.ts`; delete both copies | `forces.test.ts:13-22`, `robustness.test.ts:23-32` |
| 1.2 | Move `tag(label, x, y)` into `test/support/physics.ts`; delete both copies | `graph.test.ts:7-9`, `adjacency.test.ts:10-12` |
| 1.3 | Delete `generated()` and import `newGraph()` — byte-identical | `graph-generation.test.ts:9-11` |
| 1.4 | Add one `mouseEvent({button, clientX, clientY})` factory returning an object that tracks `defaultPrevented`; delete all four variants | `context-menu.test.ts:8-16`, `pan.test.ts:11-18`, `drag-controller.test.ts:7-9`, inline at `hidpi.test.ts:162-167` |
| 1.5 | Add `newUIController(elements, opts?)` to `test/support/dom.ts`; replaces the three 9-cast blocks | `context-menu.test.ts:23-31`, `pan.test.ts:42-50`, `hidpi.test.ts:22-30` |
| 1.6 | Add `withFakeDom(elements, fn)` (installs, runs, restores in `finally`); replace the 33 hand-written wrappers | four test files |
| 1.7 | Add `assertClose(actual, expected, eps = 1e-9, msg?)` to `test/support/assert.ts`; replace the 28 inline tolerance checks | 7 test files |
| 1.8 | Add `readSource(name)` / `readDist(name)`; replace the three hand-built `readFileSync(join(__dirname, …))` paths | `entrypoint.test.ts:118, 127`, `pipeline.test.ts:122`, `layout.test.ts:14-16` |
| 1.9 | Add `maxAbsPosition(graph, ticks)` for the hand-rolled "run N steps, track the extremum" loops | `robustness.test.ts:104-113, 144-149` |

**Why first.** It is the largest single reduction (~150 of ~1,900 lines) and
carries no production risk. It also means PR 2–PR 6 do not have to edit four
copies of a `mouseEvent` helper or three copies of a setup function when a
signature changes.

**Design notes.**

- The four `mouseEvent` variants are not merely redundant, they are *divergent*:
  `context-menu.test.ts`'s version records `defaultPrevented`, `pan.test.ts`'s
  `preventDefault` is a no-op, and `drag-controller.test.ts` needs `screenX`/
  `screenY` instead. One factory with all fields optional and a real
  `preventDefault` removes a genuine hazard: today you cannot assert event
  suppression through the pan helper.
- `newUIController` should take the `demoElements()` map plus optional
  `{ width, height, graph }`, so `pan.test.ts` (600×600, two-node graph) and
  `hidpi.test.ts` (750×750, generated graph) keep their distinct fixtures while
  sharing the construction and the casts.
- `assertClose` uses a **relative-or-absolute** comparison, because the existing
  tolerances range over `1e-6 … 1e-12` and a naive absolute epsilon would weaken
  the tight physics assertions. Each call site keeps its current epsilon
  explicitly where it is not the default.

**Acceptance.**

- `npm run ci` green; **the suite still contains 111 tests** (the diff must not
  delete an assertion, only re-express it).
- `git diff --stat test/` is net-negative, and no `src/` file appears in it.
- A deliberately broken `mouseEvent` (e.g. `preventDefault` removed) still fails
  the context-menu suppression test, proving the shared helper did not blunt it.

**Risk:** low. The one real hazard is silently weakening an assertion while
"simplifying" it; the test-count check and the per-file diff review cover it.

---

### PR 2 — One event-listener table in `UIController` (H1)

**Branch:** `refactor/ui-listener-table` · **Files:** `src/UIController.ts`,
`test/context-menu.test.ts` (listener-count assertions already exist).

| # | Change | Current location |
| --- | --- | --- |
| 2.1 | Collapse `registerEventListeners`/`deregisterEventListeners` into one `toggleEventListeners(attach: boolean)` built from a single list | `src/UIController.ts:253-305` |
| 2.2 | Drop the three parameters that both call sites pass as fields | `:280-284`, `:398`, `:416` |
| 2.3 | Keep `registerEventListeners`/`deregisterEventListeners` as thin named wrappers, or fold them into `initialize`/`terminate` | `:398`, `:416` |

**Why.** 53 lines express one list twice, and the two copies can drift: adding a
listener to one and forgetting the other leaks it across `reset()`, which the
repo has already been bitten by (`context-menu.test.ts:203` "a confirmed reset
rebuilds the menu exactly once and does not double-register").

**Design.**

```ts
/** Attach or detach the whole listener set from one list, so they cannot drift. */
private toggleEventListeners(attach: boolean) {
    const bind = (
        target: EventTarget,
        type: string,
        fn: EventListenerOrEventListenerObject
    ) => attach
        ? target.addEventListener(type, fn)
        : target.removeEventListener(type, fn);

    bind(this.canvas, "mousemove", this.onMouseMove);
    bind(this.canvas, "mousedown", this.onMouseDown);
    bind(this.canvas, "mouseup", this.onMouseUp);
    bind(this.canvas, "mouseout", this.onMouseOut);
    bind(this.canvas, "contextmenu", this.onContextMenu);
    bind(this.exportElement, "click", this.onExport);
    bind(this.resetElement, "click", this.onReset);
    bind(window, "resize", this.onResize);
}
```

The local `bind` helper (rather than `target[method](...)`) avoids a union-typed
method name and keeps the third `useCapture: false` argument, which the current
code passes explicitly and `removeEventListener` ignores.

**Acceptance.**

- `npm run ci` green, suite still 111 tests.
- The existing counts stay exact: `canvas.listenerCount('contextmenu') === 1`
  and `'mousedown' === 1` after `initialize()` **and** after a confirmed
  `onReset()` (`context-menu.test.ts:143, 203`); the resize listener is
  registered once and removed by `terminate()` (`hidpi.test.ts:92-128`).
- New test: after `initialize(); terminate();`, every listener count is back to
  zero — currently implied by `context-menu.test.ts:203` but not asserted
  directly for all eight pairs.
- Manual browser check: left-click select/drag, middle-drag pan, right-click
  menu, window resize, export, reset, panel drag. (This PR is directly in the
  interaction path, so the headless suite is not sufficient on its own.)

**Risk:** low. Behaviour is mechanically identical; the manual pass covers the
listener wiring the fake DOM cannot fully model.

---

### PR 3 — Extract the shared radial-force kernel (H2)

**Branch:** `refactor/force-kernel` · **Files:** `src/ForceDirectedGraph.ts`,
`test/forces.test.ts` / `test/adjacency.test.ts` (add equivalence tests).

| # | Change | Current location |
| --- | --- | --- |
| 3.1 | Add a private static `addRadial(Fx, Fy, dx, dy, magnitude)` kernel: magnitude → unit vector → accumulate, with the single `r === 0` guard | new |
| 3.2 | Rebuild `netElectrostaticForceAtNode` on the kernel, iterating `graph.vertices` | `:148-199` |
| 3.3 | Rebuild `netSpringForceAtNode` on the kernel, iterating `incidentEdges(tag)` | `:201-251` |
| 3.4 | Unify the squared-distance computation on `Math.hypot` | `:170` (`deltaX*deltaX`) vs `:221` (`Math.pow(diff, 2)`) |

**Why.** The two methods share ~80 % of their bodies: accumulator init, the
`dx/dy → r² → r` derivation, the `r == 0` skip, the unit vector, the `Fx/Fy`
accumulation and the point-literal return. Only the iteration source and the
magnitude law differ. They also disagree today on how they square a distance.

**Design.**

```ts
/**
 * Superpose a radial force of magnitude `m` directed along (dx, dy) from this
 * node toward the other endpoint. The r == 0 guard and the unit vector exist
 * here once, so repulsion and springs cannot disagree about direction.
 */
private static addRadial(
    Fx: number, Fy: number,
    dx: number, dy: number,
    magnitude: number
) {
    const r = Math.hypot(dx, dy);
    if (r === 0)
        return { x: Fx, y: Fy };

    return { x: Fx + (magnitude * dx) / r, y: Fy + (magnitude * dy) / r };
}
```

- **Repulsion** iterates every other vertex, `dx = tagA.x − tagB.x` (away from
  `B`), `magnitude = k·q² / max(r, minimumInteractionRadius)^exponent`.
- **Spring** iterates `incidentEdges(tag)`, `dx = other.x − tag.x` (toward the
  neighbour), `magnitude = k·(r − l)`.

The two sign conventions stay explicit at the two call sites, which is where
they belong — the kernel is direction-agnostic and the review comment about the
clamped radius (`:177-181`) moves next to the repulsion magnitude.

**Acceptance.**

- `npm run ci` green; suite 111 tests.
- All existing force assertions hold unchanged: `forces.test.ts` (repulsion
  `10000/r^1.9`, spring sign and magnitude, rest-length zero force),
  `robustness.test.ts` (clamp bound, exactness at and above
  `minimumInteractionRadius`, radial direction), `convergence.test.ts`
  (equilibrium `65.46`), `adjacency.test.ts` (adjacency pass ≡ brute-force edge
  scan, `2·E` visits).
- New test: for a graph containing a duplicate edge, a self-loop and a
  zero-length pair, the kernel produces the same force as the current
  implementation, so the consolidation is provably behaviour-preserving.
- `netElectrostaticForceAtNode` and `netSpringForceAtNode` both shrink to
  ~12 lines; net ~70 lines removed.

**Risk:** medium — this is arithmetic in the hot loop. Mitigation: the physics
tests are unusually complete here (exact expected values, not snapshots), and
the `r == 0` / clamp paths already have dedicated coverage. No change to the
laws is proposed, only to their expression.

---

### PR 4 — Introduce a `Viewport` value object (H3)

**Branch:** `refactor/viewport` · **Files:** new `src/Viewport.ts`,
`src/ForceDirectedGraph.ts`, `src/UIController.ts`, `test/transform.test.ts`.

| # | Change | Current location |
| --- | --- | --- |
| 4.1 | Add `Viewport` owning `w0,h0,w1,h1` with `scale`, `toCanvas`, `toModel` | new |
| 4.2 | Replace `translate`/`reverse` with the `Viewport` methods; delete the duplicated `Math.min(w1/w0, h1/h0)` | `:21-52` (scale at `:29`, `:43`) |
| 4.3 | Keep `wrapReverse` as a delegating one-liner; add the missing `wrapTranslate` | `:54-56` |
| 4.4 | Use `wrapReverse` at the two internal call sites that currently re-derive it by hand | `:377` |
| 4.5 | Hoist **one** `Viewport` out of the per-node loop in `step()` and reuse it | `:369-372` |
| 4.6 | Rewrite `transform.test.ts` against `Viewport`, keeping the round-trip property test | `test/transform.test.ts:20-55` |

**Why.** `translate` and `reverse` each recompute the same scale; `wrapReverse`
exists but is bypassed inside the solver, where `K.space.W_0, K.space.H_0` are
re-spelled by hand; and `wrapTranslate` was simply never written. The four
numbers are threaded through `step()` and `handleNodeSelectionAttempt()` as a
clump.

**Design.**

```ts
/**
 * Model <-> canvas mapping. The scale is uniform on both axes so a canvas whose
 * aspect ratio differs from the model square never stretches the layout, and the
 * y axis is flipped so increasing model y moves up the canvas.
 */
export class Viewport {

    constructor(
        readonly w0: number, readonly h0: number,
        readonly w1: number, readonly h1: number
    ) {}

    /** The demo's model rectangle mapped onto a canvas of `w1` x `h1`. */
    static forCanvas(w1: number, h1: number): Viewport {
        return new Viewport(K.space.W_0, K.space.H_0, w1, h1);
    }

    /** Uniform model -> canvas scale: min(w1/w0, h1/h0). */
    get scale(): number {
        return Math.min(this.w1 / this.w0, this.h1 / this.h0);
    }

    toCanvas(xy: Point2D): Point2D {
        const s = this.scale;
        return { x: this.w1 / 2 + xy.x * s, y: this.h1 / 2 - xy.y * s };
    }

    /** Exact inverse of toCanvas(). */
    toModel(xy: Point2D): Point2D {
        const s = this.scale;
        return { x: (xy.x - this.w1 / 2) / s, y: (this.h1 / 2 - xy.y) / s };
    }
}
```

**Deliberately not changed:** the `step(canvasWidth, canvasHeight, isPinned?)`
and `handleNodeSelectionAttempt(canvasPos, w, h)` signatures. Threading a
`Viewport` through them would be cleaner still but would touch ~25 test call
sites for no correctness gain; `Viewport.forCanvas(w, h)` inside each is enough
to delete the clump from the arithmetic. This is noted as a possible follow-up.

The hoist in 4.5 is a real (if small) win: today `Math.min(w1/w0, h1/h0)` and the
divisions are recomputed for **every node on every tick**, inside the loop.

**Acceptance.**

- `npm run ci` green; suite 111 tests.
- `transform.test.ts` still proves: origin → canvas centre; increasing model y
  moves up; the scale is uniform at a non-square canvas (`1200×600`); and
  `toModel(toCanvas(p)) === p` within `1e-9` for several points and canvas sizes
  — including `assert.equal(fdg.render.length, 1)`'s sibling guard that the
  solver still has exactly one `CanvasRenderingContext2D` occurrence
  (`pipeline.test.ts:130`).
- Manual browser check that selection hit-testing and dragging still land on the
  cursor at both dpr 1 and dpr 2 (the reverse-mapping is what regressed #37's
  neighbourhood).
- `Math.min(w1 / w0, h1 / h0)` appears exactly once in `src/` (grep-able
  acceptance).

**Risk:** medium — `reverse` is the pointer→model mapping, so an error shows up
as "clicks miss the node". The existing `hidpi.test.ts:150` pointer-mapping test
and the round-trip property test both cover it directly.

---

### PR 5 — Give "the selected node" one home (M2 + M3)

**Branch:** `refactor/selection-model` · **Files:** `src/Graph.ts`,
`src/ForceDirectedGraph.ts`, `src/UIController.ts`, `test/render.test.ts`,
`test/context-menu.test.ts`.

| # | Change | Current location |
| --- | --- | --- |
| 5.1 | Add `Graph.selectedVertex()` and `Graph.clearSelection()` | new |
| 5.2 | `render` uses `selectedVertex()` instead of a hand-rolled scan with `break` | `src/ForceDirectedGraph.ts:60-65` |
| 5.3 | `UIController.updateSelectionInfo` uses it instead of `.find()` | `src/UIController.ts:320-322` |
| 5.4 | `UIController.clearSelection` uses `graph.clearSelection()` | `:236-238` |
| 5.5 | `onMouseMove` iterates the selection directly instead of `.filter().forEach()` | `:76-82` |
| 5.6 | Rewrite `handleNodeSelectionAttempt` as one best-distance pass plus one toggle pass; delete the `r2s` array and the dead `closestDistance == null` branch | `src/ForceDirectedGraph.ts:375-432` |

**Why.** M2: the same concept is resolved four different ways, so a change to
what "selected" means (e.g. allowing multi-select, which `onMouseMove`'s
`filter().forEach()` already half-supports) means finding all four. M3: three
passes where one will do, plus a branch that cannot execute — once `closestNode`
is non-null, `closestDistance` was assigned by the branch above
(`:394-398`), so `closestDistance == null` at `:399` is unreachable.

**Design.**

```ts
// src/Graph.ts
/** The first selected vertex, or null. */
selectedVertex(): Tag | null {
    return this.vertices.find(v => v.isSelected) ?? null;
}

/** Deselect everything. */
clearSelection() {
    for (const v of this.vertices)
        v.isSelected = false;
}
```

```ts
// src/ForceDirectedGraph.ts — handleNodeSelectionAttempt
const limit2 = K.ui.minimumNodeSelectionRadius * K.ui.minimumNodeSelectionRadius;

let closest: Tag | null = null;
let best = limit2;

for (const node of this.graph.vertices) {
    const dx = node.position.x - model.x;
    const dy = node.position.y - model.y;
    const r2 = dx * dx + dy * dy;

    if (r2 < best) {
        best = r2;
        closest = node;
    }
}

// Deselect everything, then toggle the hit node. Selection changed if the
// hit node flipped or any node was deselected.
const hadSelection = this.graph.selectedVertex() !== null;
this.graph.clearSelection();

if (closest)
    closest.isSelected = true;

return closest !== null || hadSelection;
```

**Behavioural note to settle in the PR.** The current method *toggles* the hit
node (`:426`, `node.isSelected = !node.isSelected`) while the rewrite above
*selects* it. The toggle is observable: clicking a selected node deselects it,
and `context-menu.test.ts` / `render.test.ts` may rely on it. The rewrite must
preserve the toggle exactly — `if (closest) closest.isSelected = !closest.isSelected;`
— and the plan records it here so the simplification does not quietly change
interaction semantics. The return value must likewise keep its current meaning
("something changed"), which `onMouseDown` uses to decide whether to repaint the
info panel (`src/UIController.ts:133-135`).

**Acceptance.**

- `npm run ci` green; suite 111 tests.
- `render.test.ts` colour assertions unchanged: one fill per vertex in vertex
  order, incident edges highlighted, exactly one extra stroke for the selected
  node's ring (`:44-87`).
- `context-menu.test.ts` unchanged: "clear selection deselects every node and
  resets the info panel" (`:152`), and the toggle-on-click behaviour.
- New tests: selecting the nearest node when two are inside the hit radius picks
  the closer one; clicking the already-selected node deselects it; clicking
  empty space with a selection clears it and reports `true`.
- `handleNodeSelectionAttempt` becomes a single pass over `vertices` plus the
  clear/toggle; the `r2s` allocation disappears.

**Risk:** medium — this is interaction semantics. Mitigation: the rewrite is
pinned by explicit toggle/return-value tests written *before* the change, and
the manual interaction pass (select, re-select, click-away, drag) is required.

---

### PR 6 — One representation for a 2D point (M1)

**Branch:** `refactor/point2d` · **Files:** `src/Point2D.ts`, `src/Tag.ts`,
`src/State.ts`, `src/ForceDirectedGraph.ts`, `src/UIController.ts`,
`src/Viewport.ts` (from PR 4), affected tests.

| # | Change | Current location |
| --- | --- | --- |
| 6.1 | Make `Point2D` an interface and add a `point(x, y)` factory (or keep the class and use it consistently — decide in the PR, see below) | `src/Point2D.ts:1-12` |
| 6.2 | Collapse `Tag`'s five identical literals | `src/Tag.ts:25-48` |
| 6.3 | Give the six point-literal returns a named type | `src/ForceDirectedGraph.ts:34, 48, 195, 247, 263, 294` |
| 6.4 | Replace the literal assignments to `Point2D`-typed fields | `src/UIController.ts:80`, `src/ForceDirectedGraph.ts:358` |
| 6.5 | Reconcile the three `new Point2D(...)` constructions | `src/State.ts:26, 29`, `src/UIController.ts:188` |

**Why.** `Point2D` is a class constructed in exactly three places, while the
value is otherwise always an object literal — and it only compiles because
TypeScript is structural. That is two representations of one concept, and it
means `Tag.position` is typed `Point2D` but is routinely assigned a bare object.

**The decision to make in the PR.** Two coherent options; picking one is the
whole point, so the PR must state which and why:

- **(a) Interface + factory.** `Point2D` becomes `interface Point2D { x: number; y: number }`
  plus `point(x, y): Point2D` and `ZERO`/`zero()`. Literals stay legal and
  idiomatic; the class and its three `new` calls disappear. Smallest diff.
- **(b) Class everywhere.** Keep the class and route every construction through
  it. More uniform, but forces `new Point2D(...)` into hot paths (per-node,
  per-tick) and into every force return.

**Recommendation: (a).** It matches how the value is already used, keeps the
physics loop allocation-light and literal-based, and still gives one canonical
type plus named helpers. (b) would add allocation ceremony to the hot loop for
no type-safety gain, since the shapes are structurally identical either way.

**Acceptance.**

- `npm run ci` green; suite 111 tests.
- `grep` shows a single point type in every signature; no `new Point2D` remains
  if (a) is chosen.
- `Tag`'s constructor is five one-line initialisations.
- No behavioural test changes — this PR must be provably mechanical.

**Risk:** low individually, wide in reach (6 files). It is sequenced last so the
other PRs settle first and the diff reviews as pure type/construction churn.

---

## 6. Verification strategy

**Per PR, before opening it:**

1. `npm run typecheck` — clean.
2. `npm test` — 111/111 (or more, if the PR adds tests).
3. `./cli build` — webpack still bundles; `dist/main.js` regenerates.
4. `ls dist/index.html` assets still load (a build that silently drops `main.js`
   would not be caught by the headless suite).

**Additionally, for PRs 2, 4 and 5** (interaction path), a manual browser pass
over the full interaction matrix from the README: left-click select, left-drag,
middle-drag pan, right-click menu (`export`, `reset`, `clear selection`),
window resize, HiDPI display, panel drag. The fake DOM cannot model real hit
testing or `devicePixelRatio`.

**Deliberate non-silence.** Two existing tests assert on source *text*
(`entrypoint.test.ts:117-133`, `pipeline.test.ts:121-131`,
`render.test.ts:106-110`). They are architecture guards and must keep passing
verbatim; if a refactor trips one, the refactor is wrong, not the test. The
`pipeline.test.ts:130` assertion that `CanvasRenderingContext2D` appears exactly
once in the solver is a live constraint on PR 4 and PR 6.

**Review discipline.** Each PR diff is read for two things specifically: an
assertion that got weaker while being "simplified", and a behaviour change that
rode along with a mechanical change.

---

## 7. Risks

| Risk | PR | Mitigation | Rollback |
| --- | --- | --- | --- |
| An assertion is silently weakened during helper consolidation | 1 | test count held at exactly 111; per-file diff review; break a helper and confirm the test still fails | revert the PR |
| Listener wiring regresses in the real DOM while the fake DOM passes | 2 | manual interaction matrix before merge | revert; the two implementations are independent |
| Force arithmetic changes subtly | 3 | exact-value physics tests, plus a new equivalence test over duplicate edges / self-loop / zero-length pair | revert |
| Pointer→model mapping off, so clicks miss nodes | 4 | `hidpi.test.ts:150` pointer test + round-trip property test + manual select/drag pass | revert |
| Selection toggle semantics quietly change | 5 | toggle/return-value tests written before the rewrite; `render.test.ts` and `context-menu.test.ts` unchanged | revert |
| Point2D change reaches into the hot loop | 6 | option (a) keeps literals; no behavioural test changes allowed | revert |
| Line references in this plan go stale as PRs land | all | every change is identified by symbol as well as line; this table is the anchor (`57bf523`) | n/a |
| Mixed tab/space indentation makes diffs noisy | all | no re-indentation in any PR; touched lines only | n/a |

---

## 8. Deferred — the low-severity inventory

Not covered by the six PRs, deliberately. Each is small; they belong in one
later "cleanup sweep" PR once the structural work has landed.

| Finding | Location |
| --- | --- |
| `render()` re-declares per-node constants (`startAngle`, `endAngle`, `clockwise`) and repeats the arc boilerplate | `src/ForceDirectedGraph.ts:114-138` |
| `render()` sets `context.font` once per node instead of once per frame | `src/ForceDirectedGraph.ts:142` |
| The `if (selected) A else B` colour pair is written twice | `src/ForceDirectedGraph.ts:82-85, 104-110` |
| `step()`'s four `for (var i…)` blocks; `i` survives only via `var` hoisting | `src/ForceDirectedGraph.ts:336-372` |
| `Graph.neighbours()` rescans all edges despite the maintained adjacency index | `src/Graph.ts:74-90` |
| "Other endpoint of an edge" logic in three places | `src/Graph.ts:80`, `src/ForceDirectedGraph.ts:216`, `test/adjacency.test.ts:26` |
| Dead `State.curPos` and write-only `State.b0ClickPos` | `src/State.ts:9,18,26,29`; written at `src/UIController.ts:131` |
| `entrypoint` null-checks the same five elements twice | `src/entrypoint.ts:17-22, 44` |
| `GraphFactory`: `Array<Point2D>()`, O(n²) `.some`, duplicate literal | `src/GraphFactory.ts:10, 20, 23-24` |
| `ContextMenu` sets class names no stylesheet targets; inline styles via `any` | `src/ContextMenu.ts:26, 43, 76-80` |
| `timerTickperiodMS` casing | `src/K.ts:16`, `README.md` |
| `tyeepe="text/css"` typo | `dist/index.html:8` |
| ESLint declared with no config or script | `package.json:22` |
| Mixed tab/space indentation across `src/` | repo-wide |
| `index.html` / `stylez.css` live in `dist/` while being hand-maintained source | `dist/` |

### §8 cleanup sweep

The small items above landed in one later PR
([#48](https://github.com/davidbarkhuizen/cuniform/pull/48)): the render
constants and arc boilerplate, the per-frame font, the shared colour choice,
`step()`'s hoisted `var i`, the adjacency-backed `neighbours()`, the shared
`Edge.otherEndpoint()`, the dead `State.curPos` / `State.b0ClickPos`, the
entrypoint's duplicate null-check, the `GraphFactory` uniqueness scan, the dead
`ContextMenu` class names and its `any`-typed style write, the
`timerTickPeriodMS` casing and the `tyeepe` typo. `npm run ci` stayed green and
the suite went 127 → 129 tests: the two additions pin `otherEndpoint()` and the
typed `setStyle`.

Three items are still deferred, and none is a small code edit:

| Item | Why it stays deferred |
| --- | --- |
| Mixed tab/space indentation | re-indenting is out of scope for every PR (§1); it would bury every real diff |
| ESLint declared with no config or script | a useful config needs a TypeScript parser that is not installed, and §3 forbids new dependencies; this is a tooling decision |
| `index.html` / `stylez.css` live in `dist/` | moving hand-maintained source out of the build output is a build-layout change |

---

## 9. Definition of done

- All six PRs squash-merged into `main`.
- `npm run ci` green on `main`: typecheck clean, **≥ 111 tests, 0 failures**.
- `./cli build` produces a working `dist/index.html`; the manual interaction
  matrix passes after PRs 2, 4 and 5.
- `test/` shrinks by ~150 lines and `src/` by ~130, with no new dependency and
  no behaviour change outside the two explicitly-reviewed spots (PR 5's
  selection return value, PR 4's `Viewport` API shape).
- `Math.min(w1 / w0, h1 / h0)` and the listener list each exist exactly once.
- README's "Model and canvas space" section updated to name `Viewport` if the
  public mapping API changes.
- This workplan's Status table filled in with the merged PR links.

**Outcome.** Every bullet above holds except the line-count target. Measured
against `738a561`, `src/` went 1429 → 1408 lines and `test/` 2493 → 2732: the
consolidation removed roughly 200 lines of duplication, but the shared support
modules that replace it, a new `src/Viewport.ts`, and the new tests the per-PR
acceptance criteria require cost rather more. The measured deltas are recorded
in the Status section at the top; no coverage or comment was deleted to chase
the estimate. Two sketches were deliberately deviated from, and both are
detailed in their PRs: PR 3's kernel takes the radius the caller already
computed rather than recomputing `Math.hypot`, and PR 5 captures the hit node's
pre-clear state so the selection toggle survives.

---

## Appendix A — Evidence for the duplicates

Commands used to establish the baseline in §2 (run from the repo root at
`57bf523`):

```bash
# byte-identical helper bodies
diff <(sed -n '23,32p' test/robustness.test.ts) <(sed -n '13,22p' test/forces.test.ts)
diff <(sed -n '7,9p'   test/graph.test.ts)     <(sed -n '10,12p' test/adjacency.test.ts)

# scaffolding volume
grep -rn "as unknown as" test | wc -l          # 31
grep -rc "dom.restore()" test/*.ts             # 33 across four files
grep -rn "Math.abs(" test/*.ts | wc -l         # 28

# the duplicated scale formula
grep -n "Math.min(w1 / w0, h1 / h0)" src/ForceDirectedGraph.ts   # 29, 43

# the bypassed wrap helper
grep -n "wrapReverse\|K.space.W_0, K.space.H_0" src/ForceDirectedGraph.ts
```

## Appendix B — Why this is not a defect hunt

The review explicitly checked whether any copy is *divergent* (one copy fixed,
another left broken) and found none. The two force methods agree on sign and
guards; the two listener methods agree on the list; the wrap helper and its
bypassed call sites compute the same thing. This plan is therefore scoped as
refactoring under a green suite, not as a bug fix, and every acceptance
criterion is expressed as "the existing behaviour still holds", not "the
behaviour changes to X".
