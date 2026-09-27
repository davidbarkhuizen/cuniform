# Plan 6 — Simulation cadence and a physics worker

Status: implemented (6a in one PR, 6b in the next) · Depends on: Plan 2 (flat
buffers) and ideally Plan 1 (so the step is small enough to be worth
scheduling) · Blocks: usable input at 4k+ nodes

## Objective

Stop a long physics step from freezing the interface. Two independent phases:

- **6a — cadence**: render on `requestAnimationFrame`, run physics on a capped
  fixed-step accumulator, and stop stepping once the layout settles.
- **6b — worker**: move the solver off the main thread, leaving projection,
  hit-testing and rendering on the main thread.

6a is low-risk and delivers most of the responsiveness benefit; 6b is the
larger change and should be a separate PR.

## Why

`UIController.onTimerTick()` currently performs, synchronously on the main
thread every `K.physics.timerTickPeriodMS = 50` ms:

1. a held-camera rotation step,
2. `projector()`,
3. `solver.step(...)`,
4. `render(...)`.

At N=1024 the step alone is 132 ms today (before Plans 1–3), so a single tick
blocks input, timers and paint for ~2.6× the tick period; at N=4096 it is over
2 s. Even after Plans 1–3 a large step can exceed a frame budget. `setInterval`
also queues ticks rather than dropping them, so a slow step makes the backlog
worse rather than self-correcting. Rendering at the physics rate (20 Hz) is
also unnecessary; the browser paints at 60 Hz regardless.

## Current behaviour and test contracts

- `initialize()` sets `this.timer = setInterval(this.onTimerTick, K.physics.timerTickPeriodMS)`;
  `terminate()` clears it.
- `onTimerTick()` is public and is **called directly by tests**
  (`test/camera-console.test.ts`, `test/hidpi.test.ts`, `test/pan.test.ts`).
  Its meaning — "advance one tick and draw" — must be preserved.
- `ForceDirectedGraph.step()` is called directly throughout the suite and both
  advances physics and writes `translatedPosition`/`depth`.
- The fake DOM (`test/support/dom.ts`) stubs `setInterval`; it will need a
  `requestAnimationFrame` stub.
- Camera state and selection state live on the main thread; the pinned-node
  predicate closes over `state.b0Down`.

## Proposed design — 6a, cadence (do this first)

1. **Render on rAF.** Add a main-thread loop driven by
   `requestAnimationFrame` that renders the latest state. Keep `onTimerTick()`
   as a public method that performs exactly one fixed tick (rotate, step,
   render) so existing tests are untouched; the rAF loop calls it when the
   accumulator says a step is due.
2. **Fixed-step accumulator.** Physics keeps a fixed `dt` of
   `K.physics.timerTickPeriodMS`; the scheduler accumulates real elapsed time
   and runs at most `K.physics.maxStepsPerFrame` (proposed 2) steps per frame,
   discarding the remainder so a slow frame cannot cause a spiral of death.
   Rendering happens once per rAF frame regardless of steps run.
3. **Settle detection.** Track the maximum node displacement (or velocity
   magnitude) per step; when it stays below `K.physics.settleEpsilon` for
   `K.physics.settleFrames` consecutive steps, stop stepping. Resume on any
   interaction: a drag, an orbit, a dolly, a console rotation, a resize or a
   graph swap. This is what makes Plan 5's "skip redraw when quiescent"
   possible.
4. **Fallback.** If `requestAnimationFrame` is unavailable, keep the existing
   `setInterval` behaviour. Tests can then exercise either path.

Constants (`src/K.ts`):

```ts
maxStepsPerFrame: 2,
settleEpsilon: 0.01,   // model units of per-step displacement
settleFrames: 10,
```

## Proposed design — 6b, physics worker

### Split physics from projection

Add `ForceDirectedGraph.stepPhysics(isPinned)` that advances positions and
returns/reports nothing else, and keep `step(w, h, isPinned, projector)` as
`stepPhysics` + the projection pass. Every existing `step(...)` call keeps
working; the worker path uses `stepPhysics` only, because projection is cheap
(1.7 ms at N=4096) and needs the main thread's camera.

### New modules

- `src/PhysicsRunner.ts` (main thread, DOM side): owns either an in-process
  solver (fallback) or a `Worker` handle. Public surface:
  `init(graph)`, `step(pinnedIndex, pinnedX, pinnedY, pinnedZ)`, `positions()`,
  `setGraph(...)`, `terminate()`. It hides which backend is in use.
- `src/simulation.worker.ts` (worker entry): holds flat position/velocity
  buffers and the edge list, runs `stepPhysics`, and posts positions back.

Neither is added to `PURE_MODULES`; `ForceDirectedGraph`, the octree and the
projection stay pure. Update `test/architecture.test.ts` with an explicit,
commented classification for the worker entry (it uses `self`/`postMessage`)
so a genuine purity regression is still caught.

### Protocol

Main → worker:

- `init`: node count, initial positions (`Float64Array`), edge index pairs,
  physics constants needed.
- `step`: pinned index (or `-1`) and the pinned position; a transferable
  positions buffer is not needed inbound because the worker owns the state.
- `setGraph` on `loadGraph`; `terminate` on `terminate`.

Worker → main:

- `positions`: a `Float64Array` of `3N` values, posted with a transfer list so
  the cost is a pointer move, not a copy.
- The main thread copies those components into the existing `Tag.position`
  objects, then runs the projection, hit-testing, selection panel and render
  exactly as today. This keeps `Selection.ts`, `Renderer.ts`, `Projector.ts`,
  `Graph.ts` and the whole DOM layer unchanged.

Use transferable `ArrayBuffer`s, not `SharedArrayBuffer`, as the default:
`SharedArrayBuffer` requires cross-origin isolation headers (`COOP`/`COEP`),
which the static `web/index.html` demo does not set. If shared memory is later
wanted for zero-copy, it is a documented, feature-detected upgrade.

### Pinning and dragging

- While a drag is active, the main thread sends the pinned index and position
  with each `step`; the worker pins that node exactly as
  `ForceDirectedGraph.step` does today (position held, velocity zeroed).
- For immediate visual feedback the main thread writes the pointer position
  into its own `Tag` and re-renders without waiting for the worker; the next
  positions message reconciles it. The existing `onMouseMove` loop already
  writes `vertex.position` directly.

### Bundling

`webpack.config.js` currently has a single entry (`./src/index.ts`). Add the
worker as a separate entry (or construct it via `new Worker(new URL(
'./simulation.worker.ts', import.meta.url))`, which webpack 5 handles). Record
the exact configuration in the PR.

### Fallback and lifecycle

- If `typeof Worker === 'undefined'` or construction throws, `PhysicsRunner`
  falls back to the in-process solver and the 6a scheduler drives it.
- `initialize()`/`terminate()` start/stop the runner; `loadGraph` re-inits it;
  a graph swap must not race an in-flight positions message (tag messages with
  a monotonically increasing generation and drop stale ones).

## Correctness and invariants

- **Pure modules stay pure** (invariant 1); only `PhysicsRunner` and the worker
  entry touch worker globals.
- **One projector per tick**, on the main thread (invariant 2): the worker
  never projects.
- **Frozen snapshot** is internal to the worker's `stepPhysics`, unchanged
  (invariant 3).
- **Determinism**: the worker and the in-process backend must produce identical
  positions for identical inputs; assert this with the same-seed test that
  covers both backends.
- **Pinned semantics** (invariant 5) are applied in the worker and covered by a
  drag test.
- **`onTimerTick()` meaning is unchanged** so `camera-console`, `hidpi` and
  `pan` tests keep passing.

## Test plan

- **6a scheduler**: with a fake clock/rAF, assert (a) one step per elapsed fixed
  interval, (b) at most `maxStepsPerFrame` steps when time jumps, (c) stepping
  stops after `settleFrames` quiet steps, (d) any interaction resumes it, (e)
  the `setInterval` fallback still ticks.
- **6b runner**: run a seeded graph through the in-process backend and a fake
  in-memory worker adapter and assert identical positions and velocities for
  the same number of steps; assert a pinned node behaves identically.
- **Drag**: a drag through the runner pins the node, keeps the pointer position
  and zeroes its velocity, as the current `drag-controller`/`solver` tests
  assert.
- **Architecture**: the worker entry is classified, `PURE_MODULES` still
  DOM-free, `Renderer.ts` still the only drawer.
- Extend the fake DOM with a `requestAnimationFrame` stub and restore it like
  `setInterval`.
- Benchmark: report scheduler overhead and the main-thread step cost removed.

## Acceptance criteria

- With the worker enabled, a physics step ≥ 50 ms does not block the main
  thread's event loop: a drag or orbit during such a step still updates at rAF
  cadence.
- In-process fallback keeps `./cli ci` green and produces identical results to
  the worker backend on the same seeded graph.
- No visible behaviour change at demo scale (11 nodes): same layout, same
  camera behaviour, same tests.
- The rAF loop renders at most once per frame regardless of how many physics
  steps ran.

## Risks and mitigations

| risk | mitigation |
| --- | --- |
| Worker bundling/testing complexity | 6a ships first and independently; 6b behind a runner abstraction with an in-process fake for tests |
| Message round-trip adds drag latency | pessimistic local write on the main thread, reconcile on the next message |
| `SharedArrayBuffer` unavailable | transferables by default; feature-detect shared memory later |
| Stale messages after a graph swap | generation counter; drop messages from a superseded generation |
| Scheduler spiral of death | clamp steps per frame and discard the remainder |
| Determinism drift across the boundary | identical-input cross-backend test |
| Architecture test silently weakened for the worker | explicit classification plus a comment explaining why the exemption is narrow |

## Out of scope

- GPU or multi-worker parallel physics.
- Rendering off the main thread.
- Changing the force laws, integrator or constants.
- Adaptive time stepping (variable `dt`); the step stays fixed to preserve
  stability and determinism.
