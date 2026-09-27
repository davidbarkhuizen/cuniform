# Model, camera and rendering

## Model, camera and canvas space

Physics runs in a 3D model space: a `600 x 600 x 600` cube centred on the origin,
so coordinates run roughly `-300..+300` on every axis (`K.space.W_0`,
`K.space.H_0`, `K.space.D_0`). `Point3D` is model space and `Point2D` is canvas
space; keeping the two types distinct is the enforcement mechanism, so a model
point can only reach the canvas through the projector.

The view is a **perspective camera** ([`src/view/Projector.ts`](../src/view/Projector.ts)),
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

`Viewport` ([`src/view/Viewport.ts`](../src/view/Viewport.ts)) remains the final 2D linear
map: `toCanvas()` and `toModel()` convert projected-plane coordinates to canvas
coordinates with one uniform scale, `min(canvasW/W_0, canvasH/H_0)`, and the y
axis is flipped so increasing projected `y` moves up the screen. The scale is
uniform so a canvas whose aspect ratio differs from the model square never
stretches the layout.

Selection is the one measurement deliberately taken in canvas space rather than
model space: the hit radius is a fixed number of screen pixels, so a click means
the same target size at every canvas scale, camera distance and
`devicePixelRatio`.

## Depth cue

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
([`src/view/Projection.ts`](../src/view/Projection.ts)) caches every node's canvas position
and view depth under one projector, and `render()`
([`src/render/Renderer.ts`](../src/render/Renderer.ts)) consumes that cache. Both run in
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
preset has no edge-thinning degree filter: its benefit is real-canvas-only, so it
waits for a real-browser measurement rather than the fake-context `ops` count.

## The render worker

Where the browser has a `Worker`, the drawing runs in `dist/render.worker.js`,
owned by `RenderRunner`; the physics runs in `dist/simulation.worker.js`, owned
by `PhysicsRunner` (see [Cadence](physics.md#cadence)). Hit-testing, camera state
and input stay on the main thread, which needs the live camera and is cheap:

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

The render worker is deliberately separate from the physics worker rather than
sharing its thread: merged, a long step would stall the camera and one fault
would take out both, at the cost of one position copy per step.

**The render protocol.** Everything per-frame is a typed array; nothing per frame
is a graph object or a string. The messages are:

| Direction | Message | Payload |
| --- | --- | --- |
| main → worker | `init` | `labels: string[]`, `edges: Int32Array` (2E), `positions: Float64Array` (3N), `generation` |
| main → worker | `frame` | camera (13 numbers), `positions` (3N, transferred), `selected` index, `width`/`height`/`dpr`, `generation`, `frameId` |
| main → worker | `export` | `requestId` |
| worker → main | `ready` | — |
| worker → main | `drawn` | `frameId`, the frame's `positions` buffer returned, `depths: Float64Array` (N, transferred), `generation` |
| worker → main | `png` | `requestId`, `blob: Blob` |

At 4096 that is about 98 KB in and 33 KB out per frame, all by pointer move.
Both workers rebuild the same `Tag` graph from flat arrays through one
`buildMirrorGraph()` ([`src/graph/MirrorGraph.ts`](../src/graph/MirrorGraph.ts)), so the
physics and render mirrors cannot drift and node insertion order is the index
space both directions agree on.

If `Worker` is missing, construction throws, or a worker script fails to load,
the drawing falls back to the canvas's 2D context, and the physics to the
in-process solver. A graph swap re-initialises both workers and bumps a
generation counter, so a response computed for the replaced graph is dropped.
(`./cli run` opens `web/index.html` over `file://`, where browsers refuse to
start a worker, so the in-process fallback is what runs there; serve the
directory over HTTP to exercise the workers. A transferred canvas cannot be
transferred again, so switching a live page from the worker path to the
in-process one needs a fresh canvas element; `?render=main` at load is the
supported way.)
