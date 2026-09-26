# cuniform

2d force-directed graphs in typescript, drawn on a canvas.

## Running

    ./cli install        # npm install
    ./cli run            # build, then open dist/index.html in Chrome

`cli` is the single entry point for common tasks; `./cli help` lists every
subcommand. With no recognised option it builds and runs the app.

## Development

    ./cli typecheck      # tsc --noEmit
    ./cli test           # compile test/ and run it under node:test
    ./cli ci             # typecheck + test
    ./cli build          # webpack bundle only
    ./cli clean          # remove build artefacts

Each wraps the equivalent npm script (`npm run typecheck`, `npm test`,
`npm run ci`, `npm run start`).

The simulation is deliberately decoupled from the browser: `ForceDirectedGraph.step()`
is pure physics and touches neither `window` nor the canvas, so the whole model can
be exercised headlessly in `test/`.

## Physics

The model is a port of the reference implementation documented in
[`pygforce/force-directed-graph-physics.md`](../pygforce/force-directed-graph-physics.md);
[`PHYSICS_ALIGNMENT_PLAN.md`](PHYSICS_ALIGNMENT_PLAN.md) records how cuniform was
brought into line with it. It is a damped relaxation, not an energy minimisation:

- **Repulsion** — every node repels every other node, all pairs:

      F = k*q^2 / r^1.9

  directed away from the other node. Note the exponent is `1.9`, deliberately
  slightly softer than a physical `r^2`.
- **Spring** — every edge is a Hooke spring with one shared rest length:

      F = k*(r - l)

  directed from the node toward its neighbour. `r > l` pulls, `r < l` pushes.
- **Net force** is the plain sum of the two. There is no mass, no gravity, no
  cooling schedule and no boundary.
- **Integration** is damped, semi-implicit Euler at a fixed step, one step per
  timer tick:

      v = v*FRICTION + F*TIME_STEP
      position += v

  Velocity is updated before position, which is what keeps stiff springs stable.
- **Dragging** pins the selected node, holds the position the pointer writes and
  zeroes its velocity, so releasing the mouse does not fling it. The rest of the
  graph still feels its forces while it is held.

Each step runs in fixed passes — all repulsion, all springs, all velocities, then
all positions — so every node sees the same frozen snapshot of positions and the
result is independent of iteration order.

### Model and canvas space

Physics runs in a square model space of `600 x 600` centred on the origin, so
coordinates run roughly `-300..+300`. `translate()` maps that to the canvas with
a single uniform scale, `min(canvasW/W_0, canvasH/H_0)`, and flips the y axis so
increasing model `y` moves up the screen. The scale is uniform so a canvas whose
aspect ratio differs from the model square never stretches the layout.

### Constants

All tuning lives in [`src/K.ts`](src/K.ts):

| Constant | Value | Meaning |
| --- | --- | --- |
| `springConstant` | `0.1` | Hooke's `k` for every edge |
| `equilibriumDisplacement` | `30` | spring rest length `l`, model units |
| `nodeCharge` | `10.0` | `q` in the repulsion law |
| `scalarForceConstant` | `100.0` | Coulomb `k`; `k*q^2 = 10000` |
| `repulsionExponent` | `1.9` | repulsion falls off as `r^-1.9` |
| `timeStep` | `0.1` | integration gain, **not** seconds |
| `friction` | `0.9` | per-step velocity retained |
| `timerTickperiodMS` | `50` | one simulation step per tick |
| `minimumNodeSelectionRadius` | `15.0` | click hit radius, model units |

Keep `timeStep / (1 - friction)` near `1`: that ratio is the terminal per-step
displacement under a constant force, and it is a real stability constraint, not a
style note. With the defaults the gain is exactly `1`, a single edge settles at
`r ~= 65.46` model units (not at `l = 30` — repulsion pushes past the rest
length), and an underdamped mode decays by `sqrt(friction) ~= 0.9487` per step.

### Complexity

Repulsion is all-pairs, `O(N^2)`, and the spring pass scans the edge list once per
node, `O(N*E)`. There is no spatial subdivision and no cut-off radius. This is
fine at demo scale (`initialConditions.order` is 11) and is the first thing to
change for a large graph.

## Known limitations

- Unconnected nodes and detached components drift away indefinitely: nothing is
  centripetal, matching the reference. "Centre the graph" remains a backlog item.
- No cooling schedule and no velocity clamp, so the `r -> 0` repulsion
  singularity is guarded only against exact coincidence.
- Spring forces are not normalised by node degree, so high-degree nodes are
  pulled harder than leaves.

See `PHYSICS_ALIGNMENT_PLAN.md` §5 Phase 6 for these as deliberately-deferred,
non-reference extensions.
