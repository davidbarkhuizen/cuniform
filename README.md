# cuniform

2d force-directed graphs in typescript, drawn on a canvas.

## Running

    ./cli install        # npm install
    ./cli run            # build, then open dist/index.html in a browser

`cli` is the single entry point for common tasks; `./cli help` lists every
subcommand. With no recognised option it prints usage.

## Development

    ./cli typecheck      # tsc --noEmit
    ./cli test           # compile test/ and run it under node:test
    ./cli ci             # typecheck + test
    ./cli build          # webpack bundle only
    ./cli clean          # remove build artefacts

Each wraps the equivalent npm script (`npm run typecheck`, `npm test`,
`npm run ci`, `npm run start`). `npm run dev` rebuilds while you edit, and
`BROWSER=... ./cli run` (or `bash build-and-run.sh --build-only`) controls how
the demo is launched.

The simulation is deliberately decoupled from the browser: `ForceDirectedGraph.step()`
is pure physics and touches neither `window` nor the canvas, so the whole model can
be exercised headlessly in `test/`.

## Layout

The canvas fills the viewport: it is stretched over a fixed, full-viewport
`.canvas-container`, and the backing store is re-sized when the window is
resized. Everything else lives in a single floating overlay panel in the
top-left corner, split into two sections:

- a **fixed menu** — the `cuniform` title, `export` and `reset`;
- the **currently selected node** — the selection and its neighbours.

The panel is opaque and high-contrast so it stays readable over the graph, and
the whole panel can be dragged out of the way.

## Interaction

- **Left-click / left-drag** — selects the nearest node within the hit radius
  (listing its neighbours in the overlay panel's selected-node section) and
  drags it. A dragged node is pinned: it keeps the position the pointer writes
  and has its velocity zeroed.
- **Middle-drag** — pans the whole graph by the cursor delta.
- **Right-click** — opens a context menu with `export`, `reset` and
  `clear selection`. The native browser menu is suppressed.
- **Drag the overlay panel** — the panel itself is movable.

## Physics

The model is a port of the reference implementation documented in
[`pygforce/force-directed-graph-physics.md`](../pygforce/force-directed-graph-physics.md).
It is a damped relaxation, not an energy minimisation:

- **Repulsion** — every node repels every other node, all pairs:

      F = k*q^2 / r^1.9

  directed away from the other node. Note the exponent is `1.9`, deliberately
  slightly softer than a physical `r^2`.
- **Spring** — every edge is a Hooke spring with one shared rest length:

      F = k*(r - l)

  directed from the node toward its neighbour. `r > l` pulls, `r < l` pushes.
- **Net force** is the plain sum of the two. There is no mass, no gravity, no
  cooling schedule and no boundary.
- **Singularity guard** — repulsion is singular as `r -> 0`, and the exact
  `r == 0` guard only catches perfect coincidence, so the power law is evaluated
  at `max(r, minimumInteractionRadius)` instead. The force stays exactly radial
  and every `r >= minimumInteractionRadius` is untouched, so the reference law
  is unchanged; this is a documented non-reference extension.
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
| `minimumInteractionRadius` | `10.0` | repulsion is evaluated at `max(r, this)`, bounding the `r -> 0` singularity |
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

Repulsion is all-pairs, `O(N^2)`. The spring pass walks each node's incident
edges from an adjacency list that `Graph` maintains alongside its edge list, so
it is `O(N + E)` rather than `O(N*E)`. There is no spatial subdivision and no
cut-off radius, so repulsion still dominates at scale; this is fine at demo
scale (`initialConditions.order` is 11) and is the first thing to change for a
large graph.

## Known limitations

- Unconnected nodes and detached components drift away indefinitely: nothing is
  centripetal, matching the reference. "Centre the graph" remains a backlog item.
- No cooling schedule and no velocity clamp. The `r -> 0` repulsion singularity
  is bounded by `minimumInteractionRadius`, but that still permits a single
  bounded step of up to `k*q^2 / minimumInteractionRadius^1.9` model units when
  two centres are dragged together.
- Spring forces are not normalised by node degree, so high-degree nodes are
  pulled harder than leaves.
- Spring rest lengths are uniform across every edge; distance-aware
  (Kamada–Kawai) per-pair rest lengths are not used.

These are deliberate divergences from the reference model rather than defects.
Of them, only the `r -> 0` singularity guard is implemented.
