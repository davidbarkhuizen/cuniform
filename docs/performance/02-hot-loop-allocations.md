# Plan 2 — Remove hot-loop allocation

Status: implemented · Depends on: nothing · Blocks: nothing, but should precede
Plan 1 (the octree reuses the same buffer pattern) and Plan 6 (transferable
buffers need a structure-of-arrays)

## Objective

Stop allocating objects per pair and per step in the solver. Reuse
solver-owned scratch buffers so a step performs no steady-state allocation.

## Why

- Explicit GC pauses measured 17% of repulsion wall time at N=256, 6% at
  N=1024 and 3% at N=2048. That is pause time alone; allocation and scavenge
  setup are additional cost.
- Replacing the object-returning accumulator with flat buffers while keeping
  `Math.hypot` took the N=1024 repulsion pass from 113 ms to 64 ms — a 1.8×
  win from de-allocation alone (measured).
- Allocation churn is the reason the solver becomes less predictable at scale:
  latency spikes come from GC, not from a smooth quadratic curve.
- Plan 6 cannot transfer positions to a worker efficiently until the solver
  works over flat arrays.

## Current behaviour (allocation sites per step)

`src/ForceDirectedGraph.ts`:

| site | allocations per step |
| --- | --- |
| `addRadial()` returns `point3(...)` | **2 per unordered pair** (one each for `out[i]`, `out[j]`) |
| `step()` `electrostatic = vertices.map(() => zero3())` | N |
| `step()` `forces = vertices.map(... point3(e + s))` | N |
| `netSpringForceAtNode()` per node: `zero3()` + one `addRadial` per incident edge | ~N + 2E |
| `velocityAtTag()` returns `point3(...)` | N |
| `step()` `velocities = vertices.map(...)` | N (plus the N from `velocityAtTag`) |
| projection loop: `projector.project()` returns a `Projection` and a `Point2D` | 2N |

At N=1024 with E≈1536 that is roughly 1.06 million short-lived objects per
step, 21 million per second at 20 Hz.

`netElectrostaticForceAtNode()` and `netForceAtNode()` also allocate, but they
are the test/reference path, not the step path.

## Proposed design

### Solver-owned flat buffers

Give `ForceDirectedGraph` reusable buffers sized to the current vertex count:

```ts
private forceX: Float64Array;  // length N, reused every step
private forceY: Float64Array;
private forceZ: Float64Array;
private velX: Float64Array;
private velY: Float64Array;
private velZ: Float64Array;
```

- Allocate in the constructor and on graph swap (`loadGraph` creates a new
  solver, so the constructor is enough); grow defensively in `step()` if
  `vertices.length` ever exceeds the buffer length.
- `step()` index-maps `vertices` to buffer positions once; the mapping is the
  stable `vertices` order (invariant 4).

### In-place accumulation

- Replace `addRadial` (which returns a new `Point3D`) with an in-place helper
  that adds a radial contribution to one buffer slot, or inline the three
  component additions in the pair loop.
- `accumulateRepulsion` writes into `forceX/forceY/forceZ` rather than a
  `Point3D[]`.
- Add an in-place spring accumulator used by `step()`
  (`accumulateSpringForce(index)`), leaving the public
  `netSpringForceAtNode(tag): Point3D` for tests and non-hot callers. Keep the
  public `netElectrostaticForceAtNode` / `netForceAtNode` exactly as they are —
  they are the reference oracle and their allocation is irrelevant.
- Keep the object-array form `accumulateRepulsion(out: Point3D[])` as a thin
  adapter over the flat path so the existing exactness test in
  `test/forces.test.ts` keeps working without a rewrite. If the adapter makes
  the code harder to read, update the test instead and say so in the PR.

### Keep the operation order identical

The flat version must add contributions in the same order as today
(`i` ascending, `j` ascending; spring edges in adjacency insertion order), so
the computed doubles are bit-for-bit unchanged at this step. This is what lets
the whole existing suite pass without tolerance changes and keeps Plans 1/3
independently reviewable.

### Velocity and position updates in place

- `velocityAtTag` stays public for tests, but `step()` computes the new
  velocity directly into `velX/velY/velZ`.
- Write `tag.velocity.x/y/z` and `tag.position.x/y/z` in place instead of
  assigning freshly built `Point3D` objects.
- Pinned nodes: write zeros into `tag.velocity` in place rather than assigning
  `zero3()`.

### Projection without allocation

The projection loop currently allocates a `Projection` and a `Point2D` per node
per step (2N). Options, to be chosen in the PR:

- add a `Projector.projectInto(p, out)` writing `screenX`, `screenY`, `depth`
  into a reusable scratch object, plus a `Viewport.toCanvasInto`; or
- add a `Projector.projectToNode(p, node)` that writes `node.translatedPosition`
  and `node.depth` directly, accepting that `Projector` then knows about `Tag`.

`Projector` must stay DOM-free (invariant 1). A reusable scratch object per
solver is the least coupling and is preferred; the projection loop is only
1.7 ms at N=4096, so this is a secondary win whose main value is removing 2N
allocations.

### `Tag` shape

Do not change `Tag.position`/`Tag.velocity` away from `Point3D` in this plan.
Migrating `Tag` itself to flat storage is a larger, separate change; Plan 6 can
propose it if worker transfer needs it. This plan only stops allocating new
`Point3D` objects in the step loop.

## Correctness and invariants

- **Frozen snapshot**: buffers are written and read in fixed passes, preserving
  invariant 3. Do not let the spring pass read a force buffer that the
  repulsion pass is still writing.
- **No aliasing**: buffers are solver-owned; never alias `Tag.position` or
  `Tag.velocity` into a scratch buffer, or a read could observe a half-written
  step (invariant 7).
- **Stable order**: the index mapping is the `vertices` order, so force
  accumulation order and therefore results are unchanged (invariant 4).
- **Pinned semantics**: unchanged; only the write strategy changes
  (invariant 5).
- **Bit-exact expectations**: `test/forces.test.ts` asserts exact equality
  between the paired and per-node paths. The flat pair loop must reproduce the
  same summation order or that test fails.

## Test plan

- The full existing suite must pass unchanged. This is the main safety net: a
  de-allocation refactor that changes results is a bug, because the arithmetic
  is identical.
- Add a focused test that `step()` called twice on the same graph produces
  identical positions and velocities (determinism, no buffer carry-over from a
  previous step).
- Add a test that buffers are grown correctly when a larger graph replaces a
  smaller one through `UIController.loadGraph` (or construct the solver at two
  sizes and step both).
- Benchmark: report GC pause share before/after with `node --expose-gc`.

## Acceptance criteria

- N=1024 repulsion pass ≤ 70 ms/step with `Math.hypot` still in place (the
  measured flat/hypot figure was 64 ms), improving further when Plan 3 lands.
- GC pause share during 20 repulsion passes at N=1024 reduced from 6% to under
  2%.
- Zero behaviour change: `./cli ci` green with no tolerance edits.
- The committed benchmark reports allocation/GC columns for later plans.

## Risks and mitigations

| risk | mitigation |
| --- | --- |
| Summation order changes, silently altering layouts | preserve loop order exactly; rely on the exact-equality test |
| Buffers survive a graph swap with stale data | allocate per solver instance; `loadGraph` already builds a fresh solver |
| Aliasing causes a torn read | buffers are solver-owned; never assign `Tag.position` from a buffer, only copy components |
| `Float64Array` indexing conflicts with strict TS | keep indices local and typed; `noUncheckedIndexedAccess` is not enabled |
| Premature complexity in `Projector` | scratch-object variant keeps `Projector` pure and decoupled |

## Out of scope

- Migrating `Tag` to structure-of-arrays.
- Barnes–Hut (Plan 1) — but the octree must use these buffers, not objects.
- Replacing `Math.hypot`/`Math.pow` (Plan 3).
- Changing the integrator or the number of passes.
