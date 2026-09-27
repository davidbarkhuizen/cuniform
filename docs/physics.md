# Physics

The model is a 3D port of the reference implementation documented in
[`pygforce/force-directed-graph-physics.md`](https://github.com/davidbarkhuizen/pygforce/blob/master/force-directed-graph-physics.md).
Both force kernels are purely radial — the magnitude is a function of the scalar
distance `r` only, and the direction is the unit vector along the separation — so
making the space three-dimensional needs only a third component. It is a damped
relaxation, not an energy minimisation:

- **Repulsion** — every node repels every other node, all pairs below
  `barnesHutMinNodes` and approximated by the Barnes-Hut octree above it (see
  [Scaling and complexity](performance.md#scaling-and-complexity)):

      F = k*q^2 / r^1.9

  directed away from the other node, where `r` is the full 3D distance. Note the
  exponent is `1.9`, deliberately slightly softer than a physical `r^2`.
- **Spring** — every edge is a Hooke spring with one shared rest length:

      F = k*(r - l)

  directed from the node toward its neighbour. `r > l` pulls, `r < l` pushes.
- **Net force** is the plain sum of the two. There is no mass, no gravity, no
  cooling schedule and no boundary.
- **Singularity guard** — repulsion is singular as `r -> 0`, so the power law is
  evaluated at `max(r, minimumInteractionRadius)`. That bounds the force for
  every small `r` while leaving every `r >= minimumInteractionRadius` untouched,
  so the reference law is unchanged; this is a documented non-reference
  extension.
- **Coincident centres** — two nodes at exactly the same point have no radial
  direction, which would otherwise leave an unconnected pair in a permanent
  fixed point. They are separated deterministically instead: of the two, the
  earlier node in the graph is pushed `-x` and the later one `+x`, with the same
  clamped magnitude as the singularity guard. "Coincident" means all three
  deltas are zero; a pair agreeing in `(x, y)` but differing in `z` is an
  ordinary radial case.
- **Integration** is damped, semi-implicit Euler at a fixed step, one step per
  timer tick, one axis at a time:

      v = v*FRICTION + F*TIME_STEP
      position += v

  Velocity is updated before position, which is what keeps stiff springs stable.
  The integrator is per-axis and the laws are radial, so `z` needs no new
  stability argument. A single edge still settles at `r ~= 65.46` model units,
  in any direction.
- **Dragging** pins the selected node, holds the position the pointer writes and
  zeroes its velocity, so releasing the mouse does not fling it. The rest of the
  graph still feels its forces while it is held.

Each step runs in fixed passes — all repulsion, all springs, all velocities, then
all positions — so every node sees the same frozen snapshot of positions and the
result is independent of iteration order.

## Cadence

Physics still advances in fixed `timerTickPeriodMS` steps, but `setInterval` no
longer drives them. Where `requestAnimationFrame` exists the browser paints on
its own clock and the scheduler accumulates real elapsed time, runs at most
`maxStepsPerFrame` physics steps per animation frame, and discards the
remainder, so a slow frame cannot spiral into a backlog. A frame draws once, and
only when something changed: it ran a step, something asked for a redraw
(selection, drag, resize, graph swap), or the live camera no longer matches the
view the last frame drew. A settled, untouched scene therefore issues no canvas
work at all and leaves the previous frame on the canvas.

Once the largest node travel stays below `settleEpsilon` for `settleFrames`
consecutive steps the layout is settled and stepping stops, leaving only the
change check above. A drag, orbit, dolly, console rotation or zoom, resize or
graph swap starts it again. Without `requestAnimationFrame` the controller falls
back to the original fixed-interval tick; `onTimerTick()` still means exactly one
tick plus one draw, deliberately bypassing the idle-frame skip, which is what the
tests and the fallback use.

Where the browser has a `Worker`, the physics runs in
`dist/simulation.worker.js`, owned by `PhysicsRunner`. Hit-testing, camera state
and input stay on the main thread, which needs the live camera and is cheap; the
drawing runs in `dist/render.worker.js`, owned by `RenderRunner` (see
[The render worker](model-camera-and-rendering.md#the-render-worker)).

Positions cross the physics boundary as a transferable `Float64Array`, and the
runner posts at most one step at a time. If `Worker` is missing, construction
throws, or a worker script fails to load, the physics falls back to the
in-process solver. A graph swap re-initialises the worker and bumps a generation
counter, so a response computed for the replaced graph is dropped.
