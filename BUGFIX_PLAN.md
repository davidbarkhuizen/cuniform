# cuniform — Bug Fix Workplan

Derived from the codebase review of the current `master` (commit `86d04e0`).
Each item lists the location, the defect, the intended fix, and a verifiable
acceptance criterion.

> **Status:** the physics and graph-construction items below have since been
> implemented under [`PHYSICS_ALIGNMENT_PLAN.md`](PHYSICS_ALIGNMENT_PLAN.md).
> See [Status after the physics alignment](#status-after-the-physics-alignment)
> for what landed, and for corrections to three of the diagnoses here.

## Guiding principles

1. **Make it testable first.** The core defect (an unstable integrator) was only
   measurable by loading the built bundle under a stubbed DOM. Phase 0 makes
   that repeatable so every later fix is provable.
2. **Fix defects before re-tuning.** Do not touch `K.ts` constants until the
   integrator is stable, or tuning will mask the bug and never converge.
3. **One logical change per commit.** The physics rewrite is the risky part;
   everything else is small and mechanical.

---

## Status after the physics alignment

`PHYSICS_ALIGNMENT_PLAN.md` was executed in five focused PRs (`#22`–`#26`).

**Done:**

| Item | Landed as |
| --- | --- |
| 0.1 solver purity (no `window` in the solver) | PR #22 |
| 0.4 `typecheck` / `test` / `ci` scripts | PR #22 |
| 1.1 unstable integration | PR #23 |
| 1.2 mis-scaled force constants and world | PRs #23, #24 |
| 1.3 misleading `displacementAtNode` comment | PR #23 |
| 3.1 position dedup never worked | PR #26 |
| 3.2 complete graph, argument ignored | PR #26 |
| 5.1 `window.state` read out of the solver | PR #22 (UI globals remain) |
| 5.3 dead branch in the spring force | PR #23 |

**Deliberately not done:**

- **1.2's `r2 + eps` softening.** The reference keeps the exact `r == 0` guard
  and nothing more, so the guard is retained. Softening is parked as a
  non-reference extension in `PHYSICS_ALIGNMENT_PLAN.md` §5 Phase 6.
- **5.2 spring force is O(V·E).** Still true; an adjacency list is a
  performance change, not a physics-alignment one.

**Still open from this document:** Phases 2, 4 and 6 (drag controller,
entrypoint, rendering, data-model and tooling items), plus 5.2.

### Corrections to the diagnoses above

1. **§5.3 is wrong.** It claims the `tag_A`/`tag_B` swap "cancels out exactly"
   and that deleting it is behaviour-preserving. The swap in fact made the
   spring **always attractive**, so compressed edges never pushed; deleting it
   would have inverted the whole law (repulsion when stretched). The correct
   form, now implemented, is `k*(r - l)` along the unit vector from the node to
   its neighbour — `PHYSICS_ALIGNMENT_PLAN.md` §3.2 item 2.
2. **§1.1's arithmetic is misleading.** The current update reduced to
   `r += -200*(r - 40)` only if `200` were the spring constant; `200` is
   `scalarForceConstant`, the *repulsion* coefficient, and the per-edge spring
   gain was `0.1`. The instability was real — measured at 230 units of travel
   per tick after 500 ticks — but not for the stated reason.
3. **§1.1's proposed fix diverges from the reference.** `mass`, `damping`,
   `maxSpeed`, `maxForce` and a Fruchterman–Reingold temperature are not part of
   the reference model, and the proposed pseudocode applies `dt` a second time
   on the position update. The reference — and what landed — is
   `v = v*FRICTION + F*TIME_STEP; x += v`.
4. **§5.5 is not a physics defect.** Direct cursor-to-node assignment matches
   the reference's own `motion_notify_event`; it is a UX preference.
5. **§3.1's dedup defect** is real but was masked in practice: the coordinates
   are continuous and uniform, and 200/200 were already unique.

---

## Phase 0 — Test scaffolding (prerequisite)

**Why first:** there is currently no test framework, `npm test` runs a
nonexistent `test` binary, and the simulation reads `window.state` directly, so
it cannot be exercised headlessly.

| # | Change | File |
|---|---|---|
| 0.1 | Remove the `window.state` read from the solver so `ForceDirectedGraph.iterate` is pure w.r.t. injected state (see 5.1). Until then, tests stub the global. | `src/ForceDirectedGraph.ts` |
| 0.2 | Add `node:test` specs run through the already-present `ts-node`. No new dependencies. | `package.json`, `test/*.test.ts` |
| 0.3 | Extract the DOM/canvas stubs used during review into a reusable harness. | `test/helpers/dom.ts` |
| 0.4 | Add scripts: `typecheck` (`tsc --noEmit`), `test` (`ts-node --test`), `ci` (typecheck + build + test). | `package.json` |

**Acceptance:** `npm run ci` passes on the unfixed tree *except* for the tests
that assert the corrected behaviour (those are added in Phase 1 and must fail
first).

---

## Phase 1 — The solver (highest priority)

### 1.1 Unstable integration

- **Where:** `src/ForceDirectedGraph.ts:276-290` (`displacementAtNode`), `:325-334` (apply loop)
- **Defect:** net force is used directly as a position delta. No mass, no
  timestep, no damping, no velocity. For a spring this reduces to
  `r += -200·(r - 40)`, a discrete oscillator with gain 200 (stability limit 2).
- **Observed:** locks into a 2-cycle; every node travels ~199 units *per tick*
  indefinitely. All 10 nodes collapse into a 40×40 cluster inside a 2000×1232
  world (8 of 10 at identical coordinates).
- **Fix:** semi-implicit (symplectic) Euler with explicit damping.

```ts
// per tick, for every node:
//   v += (F_spring + F_repulsion) / mass * dt
//   v *= (1 - damping)
//   v  = clampMagnitude(v, maxSpeed)
//   p += v * dt
```

- **New tunables in `K.physics`:** `mass = 1`, `dt = 1`, `damping = 0.85`
  (per-tick velocity retained), `maxSpeed = 50` (world units/tick). Add
  `maxForce` as a safety clamp.

- **Note on the generic approach:** the usual robust implementation is
  Fruchterman–Reingold, where forces are scaled by `k = sqrt(area / n)` and
  positions are capped at `temperature` (a per-tick max displacement that
  decays by e.g. ×0.99). That is a drop-in alternative to the `maxSpeed` clamp
  and is the recommended direction if the current force model proves fiddly to
  tune. **Flag as a design decision — confirm which the maintainer prefers.**

- **Acceptance (regression test):** after 500 ticks of a 10-node graph,
  - max per-tick node travel `< 1.0` world unit (converged, not oscillating);
  - node spread `stddev(x) > 200` and `stddev(y) > 100` (not a blob);
  - mean edge length within `[0.5, 2.0] × equilibriumDisplacement`.

### 1.2 Repulsion and rest length are mis-scaled for the world

- **Where:** `src/K.ts:5-7` vs `K.space.W_0/H_0`
- **Defect:** with `equilibriumDisplacement = 40` in a 2000×1232 world, even a
  *stable* solver settles into a cluster occupying ~2% of the canvas.
- **Fix:** after 1.1 lands and the solver is provably stable, re-tune the
  force-law constants so typical nearest-neighbour spacing is ~10–15% of the
  world's short axis (~120–200 units). Two coupled constants matter:
  `scalarForceConstant · nodeCharge²` (repulsion) and `springConstant` (attraction).
  Balance them so repulsion between a node's ~4 nearest neighbours equals the
  spring pull at the target spacing.
- **Provisional starting point** (to be confirmed empirically, not trusted):
  `springConstant ≈ 0.5`, `equilibriumDisplacement ≈ 150`,
  `scalarForceConstant ≈ 80000` with `nodeCharge` folded in or retained.
- **Guard:** keep `r2 == 0` handling but add softening
  (`r2 + eps`) so coincident nodes produce a finite, non-NaN force. Two nodes
  *do* currently spawn coincident (see 3.1), which today only escapes NaN
  because of the `continue`.
- **Acceptance:** the blob test above passes *and* the rendered graph visibly
  fills the canvas.

### 1.3 Remove the misleading doc comment

- **Where:** `src/ForceDirectedGraph.ts:278` — `// ERROR - DISPLACEMENT IS ! USING VELOCITY`
- **Fix:** delete once 1.1 is done; the comment describes the bug being fixed.

---

## Phase 2 — Runtime-breaking defects

### 2.1 Panel dragging assigns a literal string

- **Where:** `src/DragController.ts:49-50`
- **Defect:** `` `$(this.dragY + this.startTop)` `` — the `$` sits outside the
  `${}`, so the assignment stores the literal text. Confirmed in the built
  bundle: `style.top="$(this.dragY + this.startTop)"`.
- **Fix:**
```ts
this.element.style.top  = `${this.dragY + this.startTop}px`;
this.element.style.left = `${this.dragX + this.startLeft}px`;
```
  Note the missing `px` unit is a second latent bug — bare numbers are invalid
  for `style.top`. Also reset `dragX`/`dragY` on drag end, and drop the unused
  `event` parameter.
- **Acceptance:** unit test asserting the two `style` strings after a
  synthesized dragstart/drag/dragend sequence.
- **Consider:** `DragController` sets `draggable = true` on the panel, which
  makes text selection inside the panel awkward. Verify this is still wanted.

### 2.2 App refuses to start without an unused feature

- **Where:** `src/entrypoint.ts:32-33`
- **Defect:** hard requirement on `window.Worker`, but no worker is ever
  constructed anywhere in the codebase. Blocks startup entirely where Worker is
  absent. The `canvas == null` check at `:35` is unreachable (canvas was
  already guarded at `:15`).
- **Fix:** delete the Worker requirement, and delete the unreachable canvas
  branch. Keep the `context2d == null` check (that one is real).
- **Acceptance:** entrypoint initializes with `window.Worker` undefined.

### 2.3 Missing return value / dead error handling

- **Where:** `src/entrypoint.ts:9,21-26,60`
- **Defect:** declared `: boolean` but the success path falls off the end and
  returns `undefined`; `getContext('2d')` returns `null` rather than throwing,
  so the try/catch is dead code.
- **Fix:** return `true` on success; drop the try/catch and null-check the
  context directly.
- **Acceptance:** typecheck clean with `strict` on; both branches tested.

---

## Phase 3 — Graph construction correctness

### 3.1 Deduplication never works

- **Where:** `src/GraphFactory.ts:16-19`
- **Defect:** `used.indexOf({x, y})` compares object references, so it is
  always `-1`. Measured: 8 unique positions for 10 nodes.
- **Fix:** compare by value (`used.some(p => p.x === x && p.y === y)`), or use a
  `Set` of `"x,y"` keys. Also:
  - the random range is a continuous uniform distribution, so collisions are
    effectively impossible anyway — **decide whether the uniqueness constraint
    is worth keeping** at all. If kept, add an attempt cap to make the
    `while` loop provably terminating instead of theoretically infinite.
  - coordinates are generated one at a time; consider a Poisson-disk/jittered
    grid for evenly spread initial conditions, which also helps the solver
    converge.
- **Acceptance:** test asserting all initial positions are unique for n=100.

### 3.2 `generateGraph` produces a complete graph and ignores its argument

- **Where:** `src/GraphFactory.ts:33,45-57`
- **Defect:** the doc promises at most `maxEdgesPerVertexPerPass` edges per node;
  the code links every new node to every existing one → complete K10 (45 edges).
  `maxEdgesPerVertexPerPass` is never read. Strictly worse with scale: O(n²)
  edges, which makes the solver O(V³) with the current edge loop.
- **Fix:** implement the documented behaviour — connect each node to at most
  `maxEdgesPerVertexPerPass` random existing nodes (no duplicates, no
  self-loops). Rename the parameter to match its meaning.
- **Acceptance:** test asserting `edges.length <= order · maxEdgesPerVertexPerPass / 2`
  (accounting for double counting) and `n=50` stays fast.

---

## Phase 4 — Rendering and data-model correctness

### 4.1 Edge highlighting is a no-op

- **Where:** `src/ForceDirectedGraph.ts:66-83`
- **Defect:** both branches of the selection check assign `COLOUR_DEFAULT`;
  `selected_node` is computed and compared to no effect.
- **Fix:** highlight incident edges with a distinct colour, or delete the
  selection block and the now-dead `selected_node` scan. Prefer the former —
  it is clearly the intent.
- **Acceptance:** render test asserting the stroke colour used for an incident
  edge differs from a non-incident edge.

### 4.2 `removeNode` can delete the wrong vertex

- **Where:** `src/Graph.ts:13-32`
- **Defect:** no `indexOf` guard. For a tag not in the graph, `splice(-1, 1)`
  **removes the last vertex**. Also throws a bare string (`:40`) with a
  truncated message, and the method is currently unused.
- **Fix:** guard `if (vIdx === -1) return;`; replace `throw "..."` with an
  `Error` carrying a complete message; simplify the edge-removal loop to
  `filter`.
- **Acceptance:** test that removing a foreign tag leaves the vertex list
  untouched; test that removing a real node also removes its edges.

### 4.3 `neighbours` returns duplicates and self-loops

- **Where:** `src/Graph.ts:45-59`
- **Fix:** dedupe; the UI list currently repeats a neighbour once per edge.
- **Acceptance:** test on a graph with duplicated/self edges.

---

## Phase 5 — Architecture and performance

### 5.1 Break the `window` globals out of the core

- **Where:** `src/UIController.ts` (`window.state`, `window.fdg`),
  `src/ForceDirectedGraph.ts:327`
- **Defect:** the physics engine reads a browser global; the UI owns state via
  singletons; a second graph instance is impossible; nothing is unit-testable.
- **Fix:** `ForceDirectedGraph.iterate` should not read `window.state` — pass
  the pinned-node set (or a `pinned: (tag) => boolean`) as an argument.
  `UIController` should take `state` and the graph as constructor dependencies
  instead of reaching for globals. Keep the `window.*` assignment only for
  debugging if desired.
- **Acceptance:** the Phase 1 solver test runs with no DOM stub at all.

### 5.2 Spring force is O(V·E)

- **Where:** `src/ForceDirectedGraph.ts:186-258`
- **Fix:** iterate the node's incident edges via an adjacency list built once
  per graph mutation, not all edges per node. Prerequisite for scaling past K10.

### 5.3 Dead branch in the spring force

- **Where:** `src/ForceDirectedGraph.ts:228-249`
- **Defect:** the `tag_A`/`tag_B` swap based on `scalar_force`'s sign followed by
  `delta = A - B` cancels out exactly; it is equivalent to `deltaX = x_tag - x_other`,
  already computed at `:212-213` and discarded.
- **Fix:** delete the swap; reuse the existing deltas.

### 5.4 Remove dead locals and parameters

- **Where:** `box_side` (`ForceDirectedGraph.ts:85`), `here` (`:311`),
  `node_label_vert_spacing` (`:52`), `selectionInfoPanelID` (unused — see 6.3),
  `State.b1Down`/`b2Down`, `lastB0DragPos`, `Tag.xy`, `Tag.toString` stub,
  `Graph.toString` stub.
- **Fix:** delete. Resolve whether middle/right-button tracking is planned; if
  not, remove the fields and the `onMouseDown`/`onMouseUp`/`onMouseOut` handling
  for them.

### 5.5 Node dragging jumps the node center to the cursor

- **Where:** `src/UIController.ts:44-63`
- **Defect:** the selected node is placed at the mouse position with no grab
  offset, so it snaps. `lastB0DragPos` is written but never read — the
  delta-based version was clearly planned.
- **Fix:** record the offset between cursor and node center on mousedown and
  apply it during the drag; or use `lastB0DragPos` deltas as originally intended.
- **Acceptance:** test that a mousedown away from the node center preserves the
  offset across a mousemove.

---

## Phase 6 — Configuration, tooling, hygiene

| # | Change | File |
|---|---|---|
| 6.1 | `"test": "test"` invokes a nonexistent binary; `"dev": "nodemon"` has no entry target. Replace with real scripts (Phase 0.4). | `package.json` |
| 6.2 | Remove unused `@types/express`; declare `@types/node` (used for `NodeJS.Timeout`) or drop the Node type (6.4). | `package.json` |
| 6.3 | `selectionInfoPanelID` is accepted and passed but never used — `updateSelectionInfo` hardcodes `getElementById` calls. Either thread the ID through or drop the parameter. Add null checks for the two hardcoded elements. | `entrypoint.ts`, `UIController.ts:188-199` |
| 6.4 | `timer: NodeJS.Timeout` pulls Node typings into a browser project. Use `ReturnType<typeof setInterval>`. | `UIController.ts:16` |
| 6.5 | Enable `strict`, `strictNullChecks`, `noUnusedLocals`, `noUnusedParameters` — these surface 8 real findings today and would have caught 2.3. | `tsconfig.json` |
| 6.6 | Add `"skipLibCheck": true` or pin `@types/node`; the hoisted version produces 40+ spurious errors against TS 4.9.5. | `tsconfig.json` / `package.json` |
| 6.7 | Set `mode` explicitly (currently warns and silently falls back to `production`, hiding stack traces in a dev-oriented script). | `webpack.config.js` |
| 6.8 | Stop hardcoding `/usr/bin/google-chrome`; separate build from launch so CI can build. | `build-and-run.sh` |
| 6.9 | `.gitignore` lists `**.js`, `**.js.map`, `**.d.ts` but `dist/main.js.map` and `dist/src/*.d.ts` are already tracked, so the rules do nothing. Either `git rm --cached` the build output or drop the rules and commit deliberately. | `.gitignore` |
| 6.10 | Add `devicePixelRatio` scaling so the canvas is not blurry on HiDPI displays. | `UIController.initialize` |

---

## Suggested PR sequence

1. **PR 1 — Phase 1 only.** Solver rewrite + `K.physics` retune + the Phase 0
   harness minimal enough to run the convergence test. Highest risk; land alone.
2. **PR 2 — Phase 2 + 3.** Small, independent runtime/graph-construction fixes.
3. **PR 3 — Phase 4 + 5.4.** Rendering and data-model correctness plus dead code.
4. **PR 4 — Phase 5.1–5.3.** Architecture and performance refactor (behaviour-preserving).
5. **PR 5 — Phase 6.** Tooling, strictness, hygiene.

## Open decisions for the maintainer

- **1.1:** hand-rolled semi-implicit Euler vs. Fruchterman–Reingold temperature
  schedule. Recommendation: FR if the force model resists tuning.
- **3.1:** keep the (currently broken) unique-position constraint, or drop it for
  a jittered-grid seeding strategy?
- **5.4:** are middle/right mouse buttons and multi-select intended features, or
  dead scaffolding to delete?
- **6.9:** should `dist/` build output stay in the repository at all?
