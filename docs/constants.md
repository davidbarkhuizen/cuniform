# Constants

All tuning lives in [`src/core/K.ts`](../src/core/K.ts):

| Constant | Value | Meaning |
| --- | --- | --- |
| `space.W_0` / `H_0` / `D_0` | `600` | model cube extent, per axis |
| `springConstant` | `0.1` | Hooke's `k` for every edge |
| `equilibriumDisplacement` | `30` | spring rest length `l`, model units |
| `nodeCharge` | `10.0` | `q` in the repulsion law |
| `scalarForceConstant` | `100.0` | Coulomb `k`; `k*q^2 = 10000` |
| `repulsionExponent` | `1.9` | repulsion falls off as `r^-1.9` |
| `minimumInteractionRadius` | `10.0` | repulsion is evaluated at `max(r, this)`, bounding the `r -> 0` singularity |
| `componentAnchorRadius` | `150` | dead zone on a component **centroid**, model units; `W_0 / 4` |
| `componentAnchorStrength` | `0.1` | restoring pull per model unit beyond the dead zone |
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
| `renderer.emphasis.nodes` | `edgesOnTop false`, `edgeAlphaScale 0.55`, `nodeAlphaScale 1.0`, `edgeWidthPx 1.0` | default emphasis: nodes are the subject, the mesh recedes |
| `renderer.emphasis.edges` | `edgesOnTop true`, `edgeAlphaScale 1.0`, `nodeAlphaScale 1.0`, `edgeWidthPx 2.5` | edge-priority emphasis: the mesh draws over the nodes and heavier |
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

## Display emphasis

The `renderer.emphasis` preset is one entry per `Emphasis` wire value:
`edgesOnTop` is the paint order, `edgeAlphaScale`/`nodeAlphaScale` multiply the
depth-fade alpha of a class, and `edgeWidthPx` is the mesh's stroke width. The
scale is deliberately one-sided. Measured against the near-black canvas in WCAG
relative luminance:

| frame | near (alpha 1.0) | mid (0.675) | far (0.35) |
| --- | ---: | ---: | ---: |
| baseline (both scales 1.0) | 3.78 | 2.79 | 1.67 |
| node-priority, `edgeAlphaScale` 0.55 (shipped `nodes`) | **6.75** | **4.01** | 1.93 |
| edge-priority, `nodeAlphaScale` 0.70 | **1.95** | 1.62 | 1.24 |
| edge-priority, `nodeAlphaScale` 0.85 | **2.77** | 2.14 | 1.43 |

The asymmetry is the point: dimming the edges is safe, dimming the nodes is not.
The nodes are the only bright element, so fading them toward the canvas collapses
the very contrast the configuration exists to preserve. That is why both shipped
presets leave `nodeAlphaScale` at `1.0` and let paint order and edge width carry
the edge-priority read.

## Component anchor

`componentAnchorRadius` and `componentAnchorStrength` are the two tunables of the
[component anchor](physics.md), the one force that is not a pairwise kernel. They
are a translation, so they cannot change any layout's shape; they trade how
tightly a detached fragment is held against how long the layout takes to settle.

Measured headlessly on two 6-node paths seeded 500 model units apart (the
workplan's drift fixture, `test/support/physics.ts`'s `disconnectedPaths(500, 6,
2)`, via `stepPhysics()`), at 20 steps/s:

| `componentAnchorRadius` | `componentAnchorStrength` | farthest node | settle steps |
| ---: | ---: | ---: | ---: |
| `150` (shipped) | `0.1` (shipped) | 261 | 168 |
| `100` | `0.1` | 260 | 161 |
| `200` | `0.1` | 290 | 149 |
| `300` | `0.1` | 359 | 223 |
| `150` | `0.05` | 277 | 168 |
| `150` | `0.2` | 260 | 167 |
| `150` | `0.5` | 257 | 194 |

Both shipped values hold: `R0 = 150` is a quarter of the cube, and the frame at
the identity camera half-extent `W_0 / 2 = 300` still contains a fragment held at
a centroid of 150 plus the component's own radius. Strength above `0.1` buys a
few units of containment and costs settle time, so `0.1` stays.

The hold radius grows with the **component**, because the repulsion across a
disconnected boundary scales with the number of nodes on each side while the
centroid pull does not. Same fixture, `componentSpacing` chosen so the pieces
start apart, 20 000-step budget:

| components x nodes | farthest node | settle steps | nodes in the 800x600 frame |
| --- | ---: | ---: | ---: |
| 4 x 2 | 388 | 147 | — |
| 2 x 6 | 262 | 159 | 12 of 12 |
| 2 x 10 | 413 | 213 | 12 of 20 |
| 2 x 20 | 925 | 932 | 12 of 40 |
| 2 x 40 | 2071 | 3423 | 12 of 80 |

The last column projects the settled layout through the demo's default identity
camera onto an 800x600 canvas: the two 6-node components that the workplan's
drift fixture is built from are held entirely inside the frame, and larger
fragments are not. So the anchor bounds drift — it is what stops the unbounded
separation — but a very large detached fragment is still wider than the frame.
That is the dolly case, not an anchor one; see
[Known limitations](known-limitations.md).

The pass itself costs no measurable time: `npm run bench` times the same
topology with the dead zone hit (the pass skipped) against the same component
shifted outside it (the pass run), and the gap sits inside the run-to-run spread.
Across runs the deltas were `-0.07` / `+0.06`, `-0.19` / `-0.07` and
`-0.32` / `-0.28` ms at 1024 / 4096 nodes, against per-run spreads of `0.1`-`5.4`
ms; the sign is not stable, which is what "inside the noise" looks like. The pass
is `O(N + C)` over pooled buffers and allocates nothing, so the step cost stays
flat and the GC count stays at zero.

`R0` is a literal rather than `K.space.W_0 / 4`: containment and world extent are
different decisions that only happen to share a scale today.
