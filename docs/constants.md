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
