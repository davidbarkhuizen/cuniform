# Performance

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

## Measured profile

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

### Real-canvas frames

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

## Scaling and complexity

- **Repulsion** is Barnes-Hut above `K.physics.barnesHutMinNodes` (64) nodes:
  the octree in [`src/Octree.ts`](../src/Octree.ts) approximates the far field with
  each cell's charge total at its centre of mass, `O(N log N)` per step. Below
  the crossover the exact all-pairs kernel still runs, so demo-scale layouts are
  unchanged, and the tree never accepts the cell containing a body as an
  aggregate, so no opening angle can make a node repel itself.
  `K.physics.barnesHutTheta` (0.5) trades force error for speed: at N=4096 the
  measured repulsion pass is 85 ms at theta 0.5 (0.3% mean error) and 23 ms at
  0.9 (1.8% mean), roughly the three.js default. `K.physics.quality` (default
  `"auto"`) decides between them in one place,
  [`src/Quality.ts`](../src/Quality.ts): accurate below `barnesHutFastMinNodes`
  (2048), fast at or above, which is where the step stops fitting a tick at the
  accurate angle; `"accurate"` and `"fast"` force one angle regardless of size.
  The setting is a compile-time default read identically in both realms, so it
  must not be mutated at runtime; a user-facing control would have to cross the
  worker boundary. A cut-off radius is deliberately *not* used: the law is long
  range, so
  truncating it changes the physics rather than approximating it.
- **The radius helper** in [`src/Kernel.ts`](../src/Kernel.ts) uses
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
  fills, see [Depth cue](model-camera-and-rendering.md#depth-cue)).
