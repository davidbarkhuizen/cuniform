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
git. Webpack emits separate entries for the physics worker
(`dist/simulation.worker.js`) and the render worker (`dist/render.worker.js`),
which the app constructs by URL (see [Cadence](#cadence)), and for the
real-canvas frame harness (`dist/render-frame.js`, see
[Performance](#performance)).

The simulation is deliberately decoupled from the browser: `ForceDirectedGraph.stepPhysics()`
is pure physics and touches neither `window` nor the canvas, so the whole model can
be exercised headlessly in `test/`. The projection is split out the same way:
`Projector` is pure math too, so the solver can use it without importing a canvas
type. `step()` is `stepPhysics()` plus that projection.

cuniform is built to be embedded, and a host page's main thread is not ours: it
owns the host's own animation, layout, input and rendering. Per-frame work that
scales with the node count — physics, projection and drawing — is therefore
designed to run off that thread, leaving the main thread input, camera state and
DOM chrome. The demo is one host; the frame budget that matters belongs to
whoever embeds the component.

## Layout

The canvas fills the viewport: it is stretched over a fixed, full-viewport
`.canvas-container`, and the backing store is re-sized when the window is
resized. Everything else lives in a single floating overlay panel in the
top-left corner, split into three sections:

- a **fixed menu** — the `cuniform` title, the current graph, `export` and
  `reset`;
- the **currently selected node** — the selection and its neighbours;
- the **camera console** — six buttons that rotate the camera about its own
  axes, and two that dolly it in and out.

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
  and an anticlockwise button, and a fourth **zoom** row with a minus (out) and
  a plus (in). A press applies one small step — one simulation tick's worth, 3°
  of rotation at the default 60°/s, or one wheel notch of dolly — and **holding
  repeats it continuously**: one more step per simulation tick, so the motion is
  as smooth as the render and never jumps. The buttons are real buttons, so Tab
  reaches them and Enter or Space starts and stops a keyboard hold.
  Anticlockwise is the right-hand positive sense about that axis: on screen, x
  tilts the view about the horizontal, y turns it about the vertical, and z rolls
  it about the view axis. Unlike the middle-drag guard, an explicit axis rotation
  is free to carry the view through a pole. Each button draws its own icon rather
  than sharing one glyph: the ring is shown in the plane that axis turns in (tall
  for x, wide for y, round for z) and the arrowhead points the way the view
  turns. The zoom buttons share the wheel's dolly: the same clamp between
  `camera.minDistance` and `camera.maxDistance`, and the same constant focal
  length.
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
making the space three-dimensional needs only a third component. It is a damped
relaxation, not an energy minimisation:

- **Repulsion** — every node repels every other node, all pairs below
  `barnesHutMinNodes` and approximated by the Barnes-Hut octree above it (see
  [Complexity](#complexity)):

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

### Cadence

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
`dist/simulation.worker.js`, owned by `PhysicsRunner`, and the drawing runs in
`dist/render.worker.js`, owned by `RenderRunner`. Hit-testing, camera state and
input stay on the main thread, which needs the live camera and is cheap:

- **The render worker owns the canvas.** `UIController` hands the canvas to
  `RenderRunner`, which resolves one projector, projects the graph and draws the
  frame in whichever backend is active. The worker path transfers the canvas
  with `transferControlToOffscreen()`; the in-process backend draws on the
  element's own 2D context. `?render=main` forces the in-process backend (the
  A/B control and the escape hatch); the default is the worker when the browser
  can transfer a canvas.
- **The transfer is one-way, so the worker is probed first.** The runner
  constructs the worker and waits for its `ready` message (or an error, or
  `renderer.workerReadyTimeoutMS`) *before* transferring anything. A worker that
  404s therefore costs at most the timeout, and the canvas — which never had a
  context — is claimed in process instead of being left dead.
- **One frame in flight.** A frame posts only when none is outstanding; while
  one is, the latest camera and selection are remembered and the ack posts them,
  so a slow worker cannot build a backlog. A frame carries the model positions
  one way and returns that buffer plus the frame's depths the other way, all by
  pointer move; the buffers are pooled, so a steady-state frame allocates no
  typed array on the main thread.
- **Depth write-back.** The drawer writes the frame's depths back onto the main
  thread's tags, so the drag's unprojection and the cull tie-break read the frame
  that was actually drawn. Nothing else on the main thread reads
  `Tag.translatedPosition`.
- **Export goes through the backend**: `convertToBlob` in the worker, the
  element's own `toDataURL` in process. A placeholder canvas's `toDataURL` is not
  reliable after a transfer, which is why export is not left on the element.

Positions cross the physics boundary as a transferable `Float64Array` too, and
the runner posts at most one step at a time. If `Worker` is missing, construction
throws, or a worker script fails to load, the physics falls back to the
in-process solver and the drawing to the canvas's 2D context. A graph swap
re-initialises both workers and bumps a generation counter, so a response
computed for the replaced graph is dropped. (`./cli run` opens `web/index.html`
over `file://`, where browsers refuse to start a worker, so the in-process
fallback is what runs there; serve the directory over HTTP to exercise the
workers. A transferred canvas cannot be transferred again, so switching a live
page from the worker path to the in-process one needs a fresh canvas element;
`?render=main` at load is the supported way.)

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

The pass itself is two shared functions: `projectGraph()`
([`src/Projection.ts`](src/Projection.ts)) caches every node's canvas position
and view depth under one projector, and `render()`
([`src/Renderer.ts`](src/Renderer.ts)) consumes that cache. Both run in
whichever realm draws — the main thread's in-process backend, or the render
worker — so the depth cue, the painter sort and the cull rule have one
implementation. `Tag.depth` is therefore written by the frame's drawer and is
what the drag's unprojection and the cull tie-break read; on the worker path
`Tag.translatedPosition` is stale on the main thread, because only the drawer
reads it.

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
- **Coarse preset** — at or above `K.renderer.performance.minNodes` (4096) the
  frame also collapses the depth fade to one bucket
  (`performance.edgeAlphaBuckets`) and batches node fills by colour: one path and
  one `fill()` per colour instead of one per node, so at most two fills however
  many nodes. The selection-ring stroke is dropped
  (`performance.selectionRing: false`), but the selected node keeps its selected
  fill, so selection stays visible. Only the selection and its incident
  neighbours are labelled, bounding the per-node work by the selected node's
  degree rather than by N. Batching same-colour opaque nodes unions their
  coverage instead of compositing per node; that divergence is deliberate and
  size-gated. `arc()` still runs once per node, so this is a
  call-count/state-change saving, not a rasterisation one.

Below every threshold the frame is unchanged, and the whole draw path runs over
reusable frame scratch, so it allocates nothing in steady state. The coarse
preset's degree filter for thinning edges was specified with the plan but is not
implemented: its benefit is real-canvas-only, so it waits for a real-browser
measurement rather than the fake-context `ops` count.

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
| `physics.quality` | `"auto"` | opening-angle policy: `"auto"` picks by graph size, or `"accurate"` / `"fast"` |
| `barnesHutTheta` / `barnesHutFastTheta` / `barnesHutFastMinNodes` | `0.5` / `0.9` / `2048` | accurate / fast opening angles, and the size `physics.quality` = `"auto"` switches at |
| `timeStep` | `0.1` | integration gain, **not** seconds |
| `friction` | `0.9` | per-step velocity retained |
| `timerTickPeriodMS` | `50` | one simulation step per tick |
| `maxStepsPerFrame` | `2` | physics steps a single animation frame may run |
| `settleEpsilon` | `0.01` | per-step travel below which a step is quiet |
| `settleFrames` | `10` | consecutive quiet steps before stepping stops |
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
| `renderer.performance.minNodes` | `4096` | coarse frame at or above this node count |
| `renderer.performance.edgeAlphaBuckets` / `batchNodeFills` / `selectionRing` | `1` / `true` / `false` | coarse depth-fade buckets, colour-batched fills, and the dropped selection ring |
| `renderer.workerReadyTimeoutMS` | `250` | how long the main thread waits for a render worker's `ready` before drawing in process |
| `chooser.minOrder` / `maxOrder` | `2` / `4096` | random-graph node-count bounds; `maxOrder` is the measured usability cap |
| `chooser.interactiveOrder` | `1024` | above this the chooser warns that the layout may advance below 20 Hz |
| `chooser.minBranching` / `maxBranching` | `1` / `8` | random-graph edges-per-node bounds; `order - 1` is the hard cap |
| `molecule.seedSpacing` | `30` | molecule seed phyllotaxis spacing; the spring rest length |
| `molecule.seedDepthJitter` | `4.5` | molecule seed depth-offset amplitude |
| `wordCloud.minTagScale` / `maxTagScale` | `0.85` / `1.35` | word-cloud chip font-size range, em |

Keep `timeStep / (1 - friction)` near `1`: that ratio is the terminal per-step
displacement under a constant force, and it is a real stability constraint, not a
style note. With the defaults the gain is exactly `1`, a single edge settles at
`r ~= 65.46` model units (not at `l = 30` — repulsion pushes past the rest
length), and an underdamped mode decays by `sqrt(friction) ~= 0.9487` per step.

## Performance

What a step, a frame and a generated graph cost, and what to do next. The
measurable claims live in `bench/physics.bench.ts`; run `npm run bench` (or
`./cli bench`) for numbers on the machine at hand. It is not part of `npm test` —
it takes seconds, not milliseconds, and its numbers are machine-dependent.

`bench/physics.bench.ts` draws into `FakeContext2D`, so its render column is
JavaScript work only and must not be read as a frame cost.
`bench/render-frame.html` is the real-canvas counterpart: after `./cli build`,
serve the repository over HTTP and open it to measure the main thread's per-frame
draw time (p50/p95), the frames over 16.7 ms and the long tasks, per node count
and `devicePixelRatio`. Physics is never stepped there, so a long task can only
be the draw path. See the file's header for the query parameters.

### Measured profile

Node 25, one thread, sparse graphs (average degree 3), 1280x800 canvas, at the
default `K`. Repulsion is the exact all-pairs reference below the 64-node
crossover and the octree above it, so every row below the first is approximate;
the error columns are against the exact pairwise kernel, and the renderer column
is `FakeContext2D`, so it counts JavaScript work only. The effective-theta column
is what `K.physics.quality` = `"auto"` selected: 0.5 below
`barnesHutFastMinNodes` (2048), 0.9 at or above. The renderer column reflects the
default thresholds, including the coarse preset at 4096 and above, which is why
its `ops` count collapses there. The step column was not measured at 8192, where a
step would take seconds in the harness. These are the current figures, not a
target.

| N | generate ms | step ms | repulsion ms | eff. theta | mean / max force error | render ms (`ops` / `fillText`) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 512 | 2.5 | 7.7 | 4.7 | 0.5 | 0.50% / 2.0% | 0.6 (`1280` / 0) |
| 1024 | 4.4 | 16.0 | 11.9 | 0.5 | 0.43% / 1.1% | 1.3 (`2560` / 0) |
| 2048 | 8.6 | 12.4 | 9.3 | 0.9 | 1.98% / 6.2% | 2.8 (`2056` / 0) |
| 4096 | 12.6 | 27.4 | 22.2 | 0.9 | 1.84% / 6.3% | 5.9 (`2` / 0) |
| 8192 | 32.8 | — | 54.9 | 0.9 | 1.73% / 6.3% | 17.1 (`2` / 0) |

The tick budget is `K.physics.timerTickPeriodMS` = 50 ms, i.e. 20 Hz, and
`maxStepsPerFrame` caps a frame at two steps. With the default size-based angle
the *step* fits one tick through 4096 nodes on this machine (27 ms); 2048 is
faster than 1024, because the fast angle more than pays for the extra bodies.
Above 4096 the worker keeps input alive while the layout advances slower than real
time. Rendering is cheaper than physics on the fake context at every measured
size, but the fake context charges nothing for real `arc`/`fill`/`fillText`
rasterisation, so treat that column as a lower bound and the real canvas as the
eventual ceiling. Steady-state GC is 0–2% of wall time; the projection loop is
0.65 ms at N=4096 and has not been a problem at any measured size.

#### Real-canvas frames

The renderer column above is JavaScript work only. `bench/render-frame.html`
measures the main thread instead: a real canvas at 1280x800, 300 frames per
case, physics stopped so a long task can only be the draw path, and the camera
orbiting so every frame is a real redraw. Baseline on Chrome 154 headless on
this machine, which rasterises canvas 2D on the CPU (no GPU), so the long-task
column is an upper bound: a GPU browser rasterises off the main thread and
leaves the `draw` column as the host-thread cost. `draw` is the time the main
thread spends inside the frame; `>16.7 ms` counts the frames whose draw exceeded
one 60 Hz budget.

| N | E | dpr | draw p50 ms | draw p95 ms | >16.7 ms | long tasks | worst long task ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1024 | 1536 | 1 | 2.8 | 4.6 | 0/300 | 12 | 71.0 |
| 1024 | 1536 | 2 | 2.7 | 4.3 | 0/300 | 300 | 270.0 |
| 2048 | 3072 | 1 | 4.6 | 6.6 | 0/300 | 15 | 71.0 |
| 2048 | 3072 | 2 | 4.7 | 7.1 | 2/300 | 300 | 864.0 |
| 4096 | 6144 | 1 | 8.8 | 13.2 | 6/300 | 300 | 301.0 |
| 4096 | 6144 | 2 | 9.5 | 17.5 | 19/300 | 300 | 1766.0 |
| 8192 | 12288 | 1 | 19.0 | 23.9 | 278/300 | 300 | 616.0 |

The 8192/dpr 2 case is deliberately not in the table: with CPU rasterisation one
frame there takes seconds, so a 300-frame run does not complete in a useful time
— which is itself the measurement (the draw path, not the command count, is what
scales). `performance.memory` stayed flat across every case, so there is no GC
sawtooth to report at these sizes. The numbers are reproducible within roughly
±15% run to run on the same machine; the p50 moves least.

The same page with `?render=worker`, where the main thread only fills a pooled
buffer and posts it:

| N | E | dpr | draw p50 ms | draw p95 ms | >16.7 ms | long tasks | worst long task ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1024 | 1536 | 1 | 0.00 | 0.10 | 0/300 | 0 | 0.0 |
| 1024 | 1536 | 2 | 0.00 | 0.10 | 0/300 | 0 | 0.0 |
| 2048 | 3072 | 1 | 0.00 | 0.10 | 0/300 | 0 | 0.0 |
| 2048 | 3072 | 2 | 0.00 | 0.10 | 0/300 | 0 | 0.0 |
| 4096 | 6144 | 1 | 0.00 | 0.10 | 0/300 | 0 | 0.0 |
| 4096 | 6144 | 2 | 0.00 | 0.00 | 0/300 | 0 | 0.0 |
| 8192 | 12288 | 1 | 0.00 | 0.00 | 0/300 | 1 | 60.0 |
| 8192 | 12288 | 2 | 0.00 | 0.10 | 0/300 | 1 | 50.0 |

That is the component's published budget: with the worker the main thread's
per-frame cost is the pack-and-post, independent of the node count and the
device pixel ratio (which is why 8192/dpr 2 completes here and not in process).
The drawing cost does not vanish, it moves into the worker, which is the point —
the host's frame budget is not what pays it. `?render=main` reproduces the first
table, and `test/render-worker.test.ts` pins that the two modes emit the same
draw calls for the same graph, camera and selection.

### Scaling and complexity

- **Repulsion** is Barnes-Hut above `K.physics.barnesHutMinNodes` (64) nodes:
  the octree in [`src/Octree.ts`](src/Octree.ts) approximates the far field with
  each cell's charge total at its centre of mass, `O(N log N)` per step. Below
  the crossover the exact all-pairs kernel still runs, so demo-scale layouts are
  unchanged, and the tree never accepts the cell containing a body as an
  aggregate, so no opening angle can make a node repel itself.
  `K.physics.barnesHutTheta` (0.5) trades force error for speed: at N=4096 the
  measured repulsion pass is 85 ms at theta 0.5 (0.3% mean error) and 23 ms at
  0.9 (1.8% mean), roughly the three.js default. `K.physics.quality` (default
  `"auto"`) decides between them in one place,
  [`src/Quality.ts`](src/Quality.ts): accurate below `barnesHutFastMinNodes`
  (2048), fast at or above, which is where the step stops fitting a tick at the
  accurate angle; `"accurate"` and `"fast"` force one angle regardless of size.
  A cut-off radius is deliberately *not* used: the law is long range, so
  truncating it changes the physics rather than approximating it.
- **The radius helper** in [`src/Kernel.ts`](src/Kernel.ts) uses
  `Math.sqrt(dx*dx + dy*dy + dz*dz)` rather than `Math.hypot`, which is variadic
  and rescaled and so cannot compile to a square root plus two multiplies; the
  benchmark measures about 10x on the kernel alone. `Math.pow(r, 1.9)` is kept:
  splitting the exponent measured inside noise, and it would move the force
  values.
- **Springs** walk each node's incident edges from an adjacency list `Graph`
  maintains beside its edge list, so the pass is `O(N + E)`; `hasEdge` is an O(1)
  neighbour-set lookup, which is what makes generation `O(V + E)` rather than
  rejection over a filtered candidate list.
- **Allocation**: a step runs over pooled flat buffers and the draw path over
  reusable frame scratch, so both are allocation-free in steady state.
- **The frame** adds `O((N + E) log(N + E))` for the depth sort. Above the
  `K.renderer` thresholds the draw path changes shape (label culling, batched
  edges, and above `performance.minNodes` the coarse preset's colour-batched node
  fills, see [Depth cue](#depth-cue)).

### Next steps

Ordered by roughly the ratio of payoff to risk. These are larger pieces of work,
each with its own design, and should be separate PRs.

| # | change | why, and what it touches |
| ---: | --- | --- |
| 1 | Make the octree incrementally cheaper, not asymptotically better | The remaining cost is the per-body traversal and the per-step tree rebuild. Candidate work, each measurable by itself: reuse the traversal stack explicitly instead of recursion, tune leaf capacity and `barnesHutMaxDepth` for the measured graph sizes (a shallower tree with a larger bucket is often faster than a deep one), inline the theta test and the distance computation into the traversal, and keep the body-to-cell mapping so an incremental rebuild can skip unchanged cells. `src/Octree.ts`. |
| 2 | Remove the remaining main-thread `O(N)` work | After the render worker, exactly two per-frame `O(N)` tasks are left on the main thread: the position copy and forward to the render worker (~98 KB `set()` at 4096) and the depth write-back loop the drag needs. A `MessageChannel` from the physics worker straight to the render worker removes the first (the render worker must exist before the physics worker, and both generations must agree). One simulation worker that owns physics, projection, drawing and hit-testing — so the main thread sends canvas coordinates and reads back a selection index — removes both, at the cost of serialising physics and drawing. Which one is settled when the embedding API is designed. `src/PhysicsRunner.ts`, `src/RenderRunner.ts`, `src/PhysicsProtocol.ts`, `src/RenderProtocol.ts`. |
| 3 | Physics or rendering beyond canvas 2D | The OffscreenCanvas half of this row landed as the render worker (see [Cadence](#cadence)); what remains for rendering is WebGL (instanced points and lines) rather than further batch tuning. If force computation becomes the wall, the options are a tuned native/WASM kernel, a pool of workers splitting the octree, or GPU forces. Both are separate designs with different failure modes (context loss, shader precision, determinism across devices) and neither is committed. |

### Invariants any change must keep

The suite enforces these, so they are the contract rather than suggestions:

1. **The pure modules stay DOM-free.** `test/architecture.test.ts` pins
   `PURE_MODULES`, and every DOM-facing module is listed with the marker that
   justifies it (`simulation.worker.ts` and `render.worker.ts` for `self`,
   `PhysicsRunner.ts` for `Worker`, `RenderRunner.ts` for `getContext`,
   `UIController.ts` for `window`). The renderer is compiled against
   `RenderSurface` ([`src/RenderSurface.ts`](src/RenderSurface.ts)), a structural
   subset of both 2D contexts and of the fake context the tests draw with, so
   `Renderer.ts` names no canvas type and stays DOM-free. A new solver or
   geometry module joins `PURE_MODULES`; only `Renderer.ts` draws.
2. **One projector per frame.** Whichever backend draws resolves one projector,
   projects the graph with it and draws with the same camera, so the renderer's
   cull boundary sees the depth values cached with that camera. In-process that
   happens on the canvas's own context; with the render worker it happens in the
   worker realm, from the camera that crossed in the frame message. Physics steps
   never resolve a projector of their own.
3. **Frozen pre-step snapshot.** Every force in a step is computed from
   positions as they were at the start of the step, so no node sees a
   half-updated neighbour.
4. **Deterministic order.** Iteration follows the `vertices`/`edges` insertion
   order, and the painter sort is an explicit `(depth descending, insertion
   index ascending)` comparator, so equal depths keep edge-before-node order and
   a layout is reproducible.
5. **Pinned-node semantics.** A dragged node keeps the position the pointer
   writes, has its velocity zeroed, is skipped by integration, and still exerts
   forces. Dragging never teleports depth.
6. **The exact 2D reduction.** With the identity orientation, `focalLength ==
   distance` and `z == 0`, projection reduces bit-exactly to the 2D viewport
   mapping.
7. **`Tag` owns its points.** The solver never aliases a `Tag.position` into
   scratch state in a way that lets a read observe a half-written step.
8. **Allocation-free steady state.** A physics step runs over pooled flat
   buffers and the draw path over reusable frame scratch. Across the render
   boundary the main thread fills a pooled position buffer and posts it by
   transfer, and the worker returns that same buffer with the `drawn` ack, so a
   steady-state frame allocates no typed array on the main thread; the depth
   write-back is an in-place loop over the returned array.

When timing a change, time it with the committed benchmark and report force
error alongside any time that moves an approximation; "it feels faster" is not
evidence, and neither is a fake-context render time presented as a real frame
cost.

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
