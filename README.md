# cuniform

3D force-directed graphs in TypeScript, projected onto a canvas in perspective.

## Running

    ./cli install        # npm install
    ./cli run            # build, then open web/index.html in a browser

`cli` is the single entry point for common tasks; `./cli help` lists every
subcommand. With no recognised option it prints usage.

## Development

    ./cli typecheck      # tsc --noEmit over src/ and test/
    ./cli test           # compile test/ and run it under node:test
    ./cli ci             # typecheck + test
    ./cli bench          # compile and run the performance benchmark
    ./cli build          # webpack bundle only
    ./cli clean          # remove build artefacts

Except for `clean` (which removes the build directories directly) and `run`
(which goes through `build-and-run.sh`), each delegates to the matching npm
script (`npm run typecheck`, `npm test`, `npm run ci`, `npm run bench`, `npm run
start`, `npm install`). `npm run dev` rebuilds while you edit, and `BROWSER=...
./cli run` (or `bash build-and-run.sh --build-only`) controls how the demo is
launched.

`web/` holds the hand-maintained shell (`index.html`, `stylez.css`); it loads
the generated `dist/main.js`. `dist/` is build output only and is ignored by
git.

The simulation is deliberately decoupled from the browser: `ForceDirectedGraph.step()`
is pure physics and touches neither `window` nor the canvas, so the whole model can
be exercised headlessly in `test/`. The projection is split out the same way:
`Projector` is pure math too, so the solver can use it without importing a canvas
type.

## Layout

The canvas fills the viewport: it is stretched over a fixed, full-viewport
`.canvas-container`, and the backing store is re-sized when the window is
resized. Everything else lives in a single floating overlay panel in the
top-left corner, split into three sections:

- a **fixed menu** — the `cuniform` title, the current graph, `export` and
  `reset`;
- the **currently selected node** — the selection and its neighbours;
- the **camera console** — six buttons that rotate the camera about its own
  axes.

The panel's current-graph line names the loaded graph technically: the full
systematic name for a molecule, the node and edge counts for a random graph. It
is small and wraps, because a systematic name is long.

The graph **chooser** is not part of the panel: it is a modal dialog built in
`src/GraphWizard.ts` and appended to the body, layered above both the floating
panel and the context menu. The two overlays can never be open at once.

The panel is opaque and high-contrast so it stays readable over the graph, and
it can be dragged out of the way: with a mouse anywhere on the panel, or with a
touch on the grip at its top, so the panel body stays scrollable. The console is
excluded from that drag: a press that starts on a button never reaches the
panel's drag surface.

## Interaction

- **Left-click / left-drag** — selects the nearest node within the hit radius
  (listing its neighbours in the overlay panel's selected-node section) and
  drags it. A dragged node moves in the view plane through its current depth, so
  depth is preserved; a culled node drags on the near plane. An exact screen tie
  selects the node nearest the camera. A dragged node is pinned: it keeps the
  position the pointer writes and has its velocity zeroed.
- **Middle-drag** — orbits the camera around its target. The tilt is clamped just
  inside the poles so the view never flips over one.
- **Shift+middle-drag** — pans the camera target. Node positions are never
  touched, so a pan cannot perturb the simulation.
- **Wheel** — dollies the camera (zooms). The focal length is constant, so only
  the camera distance changes; it is clamped between `camera.minDistance` and
  `camera.maxDistance`.
- **Camera console** — three rows, one per camera axis, each with a clockwise
  and an anticlockwise button. A press applies one small step — one simulation
  tick's worth, 3° at the default 60°/s — and **holding turns the view
  continuously**: one more step per simulation tick, so the rotation is as
  smooth as the render and never jumps. The buttons are real buttons, so Tab
  reaches them and Enter or Space starts and stops a keyboard hold.
  Anticlockwise is the right-hand positive sense about that axis: on screen, x
  tilts the view about the horizontal, y turns it about the vertical, and z rolls
  it about the view axis. Unlike the middle-drag guard, an explicit axis rotation
  is free to carry the view through a pole.
- **Right-click** — opens a context menu with `export`, `reset` and
  `clear selection`. The native browser menu is suppressed. On macOS
  `Ctrl+click` is the same gesture.
- **Shift+F10** (or the context-menu key) — opens the same actions menu from
  the keyboard. Its entries are buttons: Tab or the arrow keys move between
  them, Enter or Space activates one, and Escape closes the menu.
- **Drag the overlay panel** — by mouse or pen, anywhere on the panel; by touch,
  by the grip at its top. The grip is the only touch drag surface, so the panel
  body stays scrollable.
- **Graph chooser** — opens on first run and on every `reset`, and it is the only
  way a new graph is created. Step one picks a **random** graph or a
  **molecule**:
  - *random* — the node count and the maximum new edges per node, validated as
    you type; `generate` is disabled while either field is out of range;
  - *molecules* — a searchable word cloud of twenty-three molecules: twenty indole
    alkaloids, chlorophylls a and b, and heme b. The chip
    is the common name; its tooltip and accessible name carry the full
    systematic name, the family, the formula and the flagship note. Typing
    filters by common name, systematic name, parent ring system, family, formula
    or a synonym, and Enter takes the first visible chip.
  - Escape (or `cancel`) dismisses a reset chooser and leaves the running graph,
    the timer, the listeners and the camera exactly as they were. The first-run
    chooser is mandatory: there is no previous graph to keep, so it has no
    cancel. Tab is trapped inside the dialog.

A completed chooser **swaps the graph in place**: the timer, the listeners, the
context menu and the camera are all left alone, so the viewing angle and zoom
survive a reset or a molecule load. `initialize()` keeps its lifecycle meaning
(attach the listeners, build the menu, start the timer) and is not used to
change content.

## Graphs

A graph is described by a `GraphSpec` ([`src/GraphSpec.ts`](src/GraphSpec.ts)),
a discriminated value the chooser produces and the controller remembers:

- `{ kind: "random", order, branching }` —
  `GraphFactory.generateGraph()`: a sparse semi-random graph on `order` nodes,
  where each node starts between 1 and `branching` new edges, with no self-loops
  and no duplicate edges. `branching` bounds the edges a node *starts*, not its
  final degree: the graph is undirected, so a node also collects the edges its
  neighbours start, and its degree can exceed `branching` — a 3-node graph with
  `branching = 1` is often a triangle. `order` is bounded by `K.chooser`
  (`2..64`: the chooser stays at or below the exact/Barnes-Hut crossover) and
  `branching` by
  `min(K.chooser.maxBranching, order - 1)` — a node cannot start more than
  `order - 1` distinct edges, so a larger value would silently start fewer edges
  than asked for.
- `{ kind: "molecule", id }` — a molecular graph from the catalog.

### The molecule catalog

[`src/Molecules.ts`](src/Molecules.ts) holds twenty-three molecules: twenty indole
alkaloids, one flagship example per structural family, plus three outside the
class — chlorophylls a and b, the two compounds of the chlorin family, and heme b,
the iron porphyrin at haemoglobin's core. The families run tryptamine,
β-carboline, ergoline, yohimban, ibogan, aspidosperman, ajmaline, sarpagan,
akuammilan, strychnan, camptothecin, bisindole, Rauwolfia, carbazole, oxindole,
pyrroloindoline, eburnane, gelsemium, pyridocarbazole and uleine; the
chlorophylls add the chlorin and heme b the porphyrin. Each row carries its
PubChem CID, its published molecular formula, its IUPAC systematic name and an
isomeric SMILES verified against that CID — except the metal-bearing entries
(chlorophylls a and b and heme b), whose connected SMILES come from the PDB
chemical component dictionary (`CLA`, `CHL` and `HEM`), because PubChem writes
their chelated metals as separate ionic components.

The SMILES string is the artifact that can be checked at the source, so the
catalog stores it rather than a hand-copied adjacency list.
[`src/Smiles.ts`](src/Smiles.ts) reads the subset the catalog needs — the
organic and aromatic subsets, bracket atoms, branches, ring closures, explicit
and directional bonds, disconnection — and rejects malformed notation with a
position-carrying `SmilesError`. A test parses all twenty-three entries and asserts
that the heavy-atom count derived from the SMILES equals the non-hydrogen count
of the formula, so a transcription error in either field fails CI rather than
silently distorting the graph.

A molecule's heavy atoms become nodes, labelled with element symbols (the
conventional skeletal reading — per-atom indices turn a 27-atom molecule into a
wall of text), and its bonds become edges. Bond order is parsed and carried but
every edge draws as one stroke; element colours and 2D depictions are out of
scope. The seed is a deterministic phyllotaxis spiral spaced at the spring rest
length, so a molecule starts near its settled shape and its first frame is
reproducible.

## Physics

The model is a 3D port of the reference implementation documented in
[`pygforce/force-directed-graph-physics.md`](https://github.com/davidbarkhuizen/pygforce/blob/master/force-directed-graph-physics.md).
Both force kernels are purely radial — the magnitude is a function of the scalar
distance `r` only, and the direction is the unit vector along the separation — so
making the space three-dimensional needs only a third component and a third
argument to `Math.hypot`. It is a damped relaxation, not an energy minimisation:

- **Repulsion** — every node repels every other node, all pairs:

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

### Model, camera and canvas space

Physics runs in a 3D model space: a `600 x 600 x 600` cube centred on the origin,
so coordinates run roughly `-300..+300` on every axis (`K.space.W_0`,
`K.space.H_0`, `K.space.D_0`). `Point3D` is model space and `Point2D` is canvas
space; keeping the two types distinct is the enforcement mechanism, so a model
point can only reach the canvas through the projector.

The view is a **perspective camera** ([`src/Projector.ts`](src/Projector.ts)),
pure math and DOM-free:

    model (Point3D) --Projector--> projected plane (Point2D + depth) --Viewport--> canvas

The camera owns a **world -> camera rotation matrix**, a target, a distance, a
focal length and a near plane. The matrix rotates `p - target` into camera space,
the camera sits at `(0, 0, -distance)`, and the projection divides by the view
depth. Storing the orientation as a matrix rather than a yaw/pitch pair is what
lets the panel's buttons rotate about the camera's own axes: a camera-frame
rotation is a left-multiplication of that matrix, which a pair of Euler angles is
not closed under. The inverse is exact at a chosen depth, which is what lets a
node drag unproject the cursor onto the plane through the node's current depth:
screen-space drag behaves as it did in 2D, and depth is never teleported.

Two properties make the change reviewable:

- **The 2D view is a special case.** With the identity orientation, `focalLength =
  distance` and `z = 0` for every node, the projection reduces exactly to the 2D
  `Viewport` mapping. The default focal length is a power of two so that
  reduction is bit-exact, and it is asserted as an exact-equality test.
- **The near plane is the analogue of `minimumInteractionRadius`.** Perspective
  is singular as `depth -> 0`, exactly as repulsion is singular as `r -> 0`. The
  divide is evaluated at `max(depth, nearPlane)`, and a node at or inside the
  near plane is **culled from rendering and hit-testing only** — the camera never
  reaches the physics, so a culled node still exerts and feels force. This is a
  documented, bounded, non-reference extension in the same spirit as the
  repulsion guard.

`Viewport` ([`src/Viewport.ts`](src/Viewport.ts)) remains the final 2D linear
map: `toCanvas()` and `toModel()` convert projected-plane coordinates to canvas
coordinates with one uniform scale, `min(canvasW/W_0, canvasH/H_0)`, and the y
axis is flipped so increasing projected `y` moves up the screen. The scale is
uniform so a canvas whose aspect ratio differs from the model square never
stretches the layout.

Selection is the one measurement deliberately taken in canvas space rather than
model space: the hit radius is a fixed number of screen pixels, so a click means
the same target size at every canvas scale, camera distance and
`devicePixelRatio`.

### Depth cue

A bare projection still reads flat without occlusion cues, so the renderer adds
three things:

- **Painter's algorithm** — one list of draw items over edges *and* nodes,
  sorted farthest-first by an explicit `(depth descending, insertion index
  ascending)` comparator, so a near node covers the edge behind it. An edge's
  representative depth is the mean of its endpoints. The explicit tie-break
  replaces reliance on `Array.prototype.sort` stability but produces the same
  "all edges, then all nodes" order at equal depth, which is why a flat scene is
  unchanged.
- **Perspective node size** — `radiusPx = NODE_RADIUS * focalLength / depth`,
  clamped to `[depthCue.minNodeRadiusPx, depthCue.maxNodeRadiusPx]`. The
  selection ring scales identically.
- **Depth fade** — node and edge alpha ramps from `depthCue.maxAlpha` at the
  nearest drawn depth to `depthCue.minAlpha` at the farthest, through
  `globalAlpha`.

A node at or inside the near plane is not drawn. An edge is skipped if either
endpoint is culled — there is no true near-plane clipping of edges.

Above the `K.renderer` size thresholds the frame switches to a cheaper, gated
path:

- **Label culling** — at or above `K.renderer.labelMaxNodes` (150) only the
  selected node and its incident neighbours are labelled. `fillText` per node
  dominates the real canvas cost and is unreadable at scale.
- **Batched edges** — at or above `K.renderer.batchEdgesMinEdges` (2000) edges
  are grouped by style and depth-fade bucket into one path and one `stroke()`
  per group, instead of one path per edge. Batch mode draws all edges before the
  depth-sorted nodes, so edges no longer slip in front of nearer nodes; that
  divergence is deliberate and applies only above the threshold.

Below every threshold the frame is unchanged, and the whole draw path runs over
reusable frame scratch, so it allocates nothing in steady state.

### Constants

All tuning lives in [`src/K.ts`](src/K.ts):

| Constant | Value | Meaning |
| --- | --- | --- |
| `space.W_0` / `H_0` / `D_0` | `600` | model cube extent, per axis |
| `springConstant` | `0.1` | Hooke's `k` for every edge |
| `equilibriumDisplacement` | `30` | spring rest length `l`, model units |
| `nodeCharge` | `10.0` | `q` in the repulsion law |
| `scalarForceConstant` | `100.0` | Coulomb `k`; `k*q^2 = 10000` |
| `repulsionExponent` | `1.9` | repulsion falls off as `r^-1.9` |
| `minimumInteractionRadius` | `10.0` | repulsion is evaluated at `max(r, this)`, bounding the `r -> 0` singularity |
| `timeStep` | `0.1` | integration gain, **not** seconds |
| `friction` | `0.9` | per-step velocity retained |
| `timerTickPeriodMS` | `50` | one simulation step per tick |
| `minimumNodeSelectionRadiusPx` | `15.0` | click hit radius, CSS pixels |
| `camera.focalLength` | `1024` | projection focal length, model units; constant |
| `camera.distance` | `1024` | default camera distance; equal to `focalLength` for the 1:1 anchor |
| `camera.nearPlane` | `50` | cull threshold and perspective singularity guard |
| `camera.rotateRadiansPerSecond` | `pi/3` | console rotation speed while a button is held |
| `camera.orbitRadiansPerPixel` | `0.01` | orbit sensitivity |
| `camera.maxPitch` | `pi/2 - 0.01` | turntable elevation guard |
| `camera.minDistance` | `128` | dolly clamp in, above `nearPlane` |
| `camera.maxDistance` | `8192` | dolly clamp out; 8× `focalLength` |
| `camera.dollyPerWheelNotch` | `1.1` | wheel zoom rate |
| `depthCue.minNodeRadiusPx` / `maxNodeRadiusPx` | `2.0` / `12.0` | perspective size clamp |
| `depthCue.minAlpha` / `maxAlpha` | `0.35` / `1.0` | depth fade range |
| `chooser.minOrder` / `maxOrder` | `2` / `64` | random-graph node-count bounds |
| `chooser.minBranching` / `maxBranching` | `1` / `8` | random-graph edges-per-node bounds; `order - 1` is the hard cap |
| `molecule.seedSpacing` | `30` | molecule seed phyllotaxis spacing; the spring rest length |
| `molecule.seedDepthJitter` | `4.5` | molecule seed depth-offset amplitude |
| `wordCloud.minTagScale` / `maxTagScale` | `0.85` / `1.35` | word-cloud chip font-size range, em |

Keep `timeStep / (1 - friction)` near `1`: that ratio is the terminal per-step
displacement under a constant force, and it is a real stability constraint, not a
style note. With the defaults the gain is exactly `1`, a single edge settles at
`r ~= 65.46` model units (not at `l = 30` — repulsion pushes past the rest
length), and an underdamped mode decays by `sqrt(friction) ~= 0.9487` per step.

### Complexity

Repulsion is Barnes-Hut above `K.physics.barnesHutMinNodes` (64) nodes: the
octree in `src/Octree.ts` approximates the far field with each cell's charge
total at its centre of mass, `O(N log N)` per step. Below the crossover the
exact all-pairs kernel still runs, so demo-scale layouts are unchanged, and the
tree never accepts the cell containing a body as an aggregate, so no opening
angle can make a node repel itself. `K.physics.barnesHutTheta` (0.5) trades
force error for speed; the committed benchmark reports the error against the
exact reference.

The radius helper in `src/Kernel.ts` uses `Math.sqrt(dx*dx + dy*dy + dz*dz)`
rather than `Math.hypot`, which is variadic and rescaled and so cannot compile
to a square root plus two multiplies.

The spring pass walks each node's incident edges from an adjacency list that
`Graph` maintains alongside its edge list, so it is `O(N + E)` rather than
`O(N*E)`, and a step runs over pooled flat buffers, so it allocates nothing in
steady state. The renderer's depth sort adds `O((N + E) log(N + E))` per frame.

The measured baseline and the six work plans for supporting larger graphs are in
[`docs/performance/`](docs/performance/README.md).

## Known limitations

- Unconnected nodes and detached components drift away indefinitely: nothing is
  centripetal, matching the reference. A centring force would keep them in view,
  but none is implemented. In 3D they can drift in depth, which is an amplified
  version of the same limitation rather than a new one.
- No cooling schedule and no velocity clamp. The `r -> 0` repulsion singularity
  is bounded by `minimumInteractionRadius`, but that still permits a single
  bounded step of up to `k*q^2 / minimumInteractionRadius^1.9` model units when
  two centres are dragged together.
- Spring forces are not normalised by node degree, so high-degree nodes are
  pulled harder than leaves.
- Spring rest lengths are uniform across every edge; distance-aware
  (Kamada–Kawai) per-pair rest lengths are not used.
- A `600^3` cube rotated has a projected diagonal of up to `sqrt(3) * 600 ~= 1039`
  model units, so orbiting can push nodes outside the viewport. Nothing clamps a
  node to the model cube either, matching the reference. The wheel dolly fits the
  view; the scale is deliberately not auto-fitted, because that would make it
  breathe as the camera moves and would break the exact 2D reduction.
- Near-plane culling is not edge clipping: an edge with a culled endpoint is
  dropped whole rather than clipped at the near plane.

These are deliberate divergences from the reference model rather than defects.
The `r -> 0` singularity guard, the coincident-centre tie-break and the
near-plane guard described above are the non-reference behaviour implemented so
far.
