# Performance work plans: supporting larger graphs

This directory holds the engineering plans for making `cuniform` handle larger
graphs. They were written from a measurement pass over the current solver,
graph factory and renderer, not from intuition; the numbers below are the
baseline each plan is judged against.

Scope note: the original analysis numbered seven items `P0`–`P6`. These plans
cover the six optimizations (`P0`–`P5`). The remaining item — raising
`K.chooser.maxOrder` and gating large-graph UX — is a rollout consequence of
the six, not an optimization in its own right, and is tracked at the end of
this file rather than as its own plan.

## Baseline (what "larger" costs today)

Measured headlessly on Node 25, one thread, sparse graphs (average degree 3),
1280×800 canvas, one projector per step. The simulation tick budget is
`K.physics.timerTickPeriodMS = 50`, i.e. 20 Hz.

`ForceDirectedGraph.step()`:

| N | `step()` ms | repulsion alone ms | repulsion share |
| ---: | ---: | ---: | ---: |
| 64 | 1.4 | 0.4 | 30% |
| 256 | 9.5 | 7.4 | 78% |
| 512 | 30.9 | 27.4 | 89% |
| 1024 | 132.4 | 112.5 | 85% |
| 2048 | 494 | 457 | 93% |
| 4096 | 2116 | 2084 | 98% |

The all-pairs repulsion pass in `src/ForceDirectedGraph.ts` is the dominant
cost and scales cleanly quadratically. 1024 nodes already runs 2.6× over the
tick budget and blocks the main thread; 4096 runs 42× over. The projection loop
is not a problem at these sizes (1.7 ms for 4096 nodes).

Graph generation (`GraphFactory.generateGraph`) is worse than the physics at
the same order:

| order | time |
| ---: | ---: |
| 256 | 83 ms |
| 512 | 1.0 s |
| 1024 | 5.4 s |
| 2048 | 55 s |

Kernel micro-optimizations measured on the repulsion pass at N=1024:

| variant | ms | vs current |
| --- | ---: | ---: |
| current `accumulateRepulsion()` | 113.2 | 1.0× |
| flat buffers, no allocation, `Math.hypot` | 64.4 | 1.8× |
| flat buffers, no allocation, `Math.sqrt` | 29.4 | 3.9× |
| flat buffers, `sqrt`, split `pow` | 28.6 | 4.0× |

Barnes–Hut prototype versus the exact pairwise kernel (unoptimized object
tree; the point is the scaling, not the constant factor):

| opening angle θ | N=2048 | N=4096 | mean force error | max force error |
| ---: | ---: | ---: | ---: | ---: |
| 0.5 | 2.7× | 3.6× | 0.2% | 1.5% |
| 0.9 | 6.7× | 10.1× | 1.1% | 13% |

Other measured costs:

- **GC**: explicit pauses were 17% of repulsion wall time at N=256, 6% at
  N=1024 and 3% at N=2048. The source is allocation churn — roughly two fresh
  `Point3D` objects per pair in `addRadial`, plus per-step `.map()` arrays and
  a `Projection`/`Point2D` per node.
- **Renderer JS overhead** (`FakeContext2D`, so a *lower bound*; real
  `arc`/`fill`/`fillText` is far costlier): 4.0 ms at N=1024, 8.5 ms at
  N=2048, 21 ms at N=4096. It issues about `E` strokes + `N` fills + `N`
  `fillText` calls per frame, allocates a closure per draw item, and sorts
  every frame.
- **Hit-testing** is fine: 0.5 ms per click at N=2048.

## Target tiers

| tier | N | what it needs |
| --- | ---: | --- |
| interactive at 20 Hz | 512–1024 | Plan 02 + Plan 03 (kernel micro-optimizations) |
| interactive at 20 Hz | 1k–4k | Plan 01 (Barnes–Hut) on top, plus Plan 05 for the frame |
| usable, not necessarily 20 Hz | 4k–20k | tuned typed-array octree, coarse rendering, Plan 06 to keep input alive |
| interactive | > 20k | WebGL/offscreen renderer and a GPU or tuned native kernel; out of scope here |

## The six plans

| # | file | objective | depends on |
| ---: | --- | --- | --- |
| 1 | [`01-barnes-hut-repulsion.md`](01-barnes-hut-repulsion.md) | all-pairs repulsion `O(N²)` → Barnes–Hut octree `O(N log N)` | 02, 03 (recommended first) |
| 2 | [`02-hot-loop-allocations.md`](02-hot-loop-allocations.md) | remove per-pair and per-step allocation from the solver | — |
| 3 | [`03-distance-kernel.md`](03-distance-kernel.md) | `Math.hypot` → `Math.sqrt` in hot loops; review `Math.pow` | — |
| 4 | [`04-graph-generation.md`](04-graph-generation.md) | `O(V²·E)` generation → `O(V + E)`; `hasEdge` O(1) | — |
| 5 | [`05-renderer-scaling.md`](05-renderer-scaling.md) | bound frame cost: label culling, batched strokes, no per-item closures | — |
| 6 | [`06-simulation-worker.md`](06-simulation-worker.md) | decouple physics cadence from rendering; move the solver off the main thread | 02 (buffers), 01 (ideally) |

Recommended landing order: **4 → 3 → 2 → 1 → 5 → 6**. Plan 4 is independent and
unblocks reproducible large-N testing. Plans 3 and 2 are small, safe kernel
changes that lower the constant factor, so Plan 1's algorithmic win is measured
on an already-optimized base and its internal buffers follow the same pattern.
Plan 5 is independent of the solver and can proceed in parallel. Plan 6 depends
on the flat buffers from Plan 2 and is best done after Plan 1.

## Shared invariants (every plan must preserve)

These are asserted by the suite and are not negotiable without an explicit,
reviewed change to the test:

1. **The pure half stays DOM-free.** `test/architecture.test.ts` asserts that
   the modules listed in `PURE_MODULES` reference no `window`, `document` or
   canvas type. New solver/geometry modules (the octree, the physics runner)
   must join that list; only `Renderer.ts` may draw.
2. **One projector per tick.** `UIController.onTimerTick()` resolves the
   projector once and passes the same camera to `step()` and `render()`, so the
   renderer's cull boundary sees the depth values that were cached with that
   camera.
3. **Frozen pre-step snapshot.** Every force in a step is computed from
   positions as they were at the start of the step; no node sees a
   half-updated neighbour. The current code gets this from fixed passes; any
   restructuring must keep it.
4. **Deterministic order.** Iteration order is the `vertices`/`edges` insertion
   order, and the renderer's painter sort is stable so equal depths preserve
   edge-before-node order. Reproducibility of a layout and of the render tests
   depends on this.
5. **Pinned-node semantics.** A dragged node keeps the position the pointer
   writes, has its velocity zeroed, and is skipped by integration; it still
   exerts forces. Dragging also never teleports depth.
6. **The exact 2D reduction.** With identity orientation, `focalLength ==
   distance` and `z == 0`, projection must reduce bit-exactly to the 2D
   viewport mapping.
7. **`Tag` owns its points.** The solver must not alias a `Tag.position` into
   scratch state in a way that lets a read observe a half-written step.

## Cross-cutting prerequisite: a committed benchmark

None of these plans can be accepted on "it feels faster". Before or with the
first plan, add a committed, runnable benchmark — proposed as
`bench/physics.bench.js` plus an `npm run bench` script — that:

- builds sparse graphs at a fixed list of orders with a seeded PRNG,
- times `step()`, `accumulateRepulsion()`/the octree, the projection loop, the
  renderer against `FakeContext2D`, and generation,
- reports ms/step and, where an approximation is involved, mean and max force
  error against the exact kernel,
- runs with `node --expose-gc` so GC share can be reported.

The numbers on this page came from a throwaway version of exactly that script.
Committing it makes every later plan's acceptance criteria checkable in CI or
on demand.

## Deferred: raising the cap and large-graph UX

Once Plans 1–3 land, `K.chooser.maxOrder` (currently 64, pinned low explicitly
"because repulsion is O(N²) per tick") can rise. Proposed follow-up, not
covered by the six plans:

- raise `maxOrder` to a measured ceiling; keep the chooser validation messages
  derived from `K` as they are today,
- add a large-graph mode that disables labels and thins edges (Plan 5),
- show a one-off warning above a threshold order,
- update the README's `Complexity` section, which currently states that
  spatial subdivision is "the first thing to change for a large graph".
