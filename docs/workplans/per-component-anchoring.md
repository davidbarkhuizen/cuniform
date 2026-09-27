# Per-component uniform anchoring — bound detached components without distorting a layout

| | |
| --- | --- |
| **Status** | Planned |
| **Area** | new `src/graph/Components.ts`, `src/physics/Kernel.ts`, `src/physics/ForceDirectedGraph.ts`, `src/core/K.ts`, `test/architecture.test.ts`, `test/components.test.ts` (new), `test/anchor.test.ts` (new), `test/support/physics.ts`, `test/physics-runner.test.ts`, `docs/physics.md`, `docs/constants.md`, `docs/invariants.md`, `docs/known-limitations.md`, `docs/next-steps.md` |
| **Depends on** | nothing outstanding — `main` is green at d9c9c1d |
| **Blocks** | nothing; component packing (§8) would build on it |
| **Evidence** | headless experiment on `main`: two 6-node components at x = ±250 separate 500 → 2005 model units in 10 000 steps while the whole-graph centroid stays exactly at the origin; a global per-node pull strong enough to contain them shrinks a connected 30-node path's mean edge length from 92.3 to 51.2 (**−45%**) |

## 1. Goal

Give every **connected component** a bounded home, so a detached fragment cannot
drift out of the viewport, while leaving every connected layout — and every
number the reference model pins — **exactly** as it is. The mechanism is a
gentle pull toward the model origin applied **uniformly to all nodes of a
component**, based on the component's centroid, with a dead zone.

Because the force vector is identical for every node in the component, it can
only **translate** that component. It adds no differential compression, so every
pairwise distance inside a component — and therefore the analytic single-edge
equilibrium at `r* ~= 65.46`, the force-balance identity and every settled
layout the suite pins — is preserved bit-for-bit, not approximately.

The anchor is also **structurally a no-op** whenever every component centroid is
inside the dead zone, which is the common case: the generator seeds every node
inside the cube, and the whole-graph centroid measured 43–82 model units over
200-trial samples. It engages only where the model has no other answer — a
component whose centroid has been pushed past the dead zone by inter-component
repulsion and has nothing to pull it back.

Out of scope is enumerated in §8.

## 2. Problem, and the evidence for this shape

`docs/known-limitations.md` records it: *"Unconnected nodes and detached
components drift away indefinitely: nothing is centripetal, matching the
reference."* Two components that share no edge still repel each other, and
because there is no boundary and no external force, that repulsion has no
equilibrium — the pair separates without bound (roughly `t^0.34`, since the
repulsion falls off as `r^-1.9`).

Measured on `main`, two 6-node paths seeded at x = ±250 (20 steps/s at the
50 ms tick):

| step | separation | max ‖p‖ |
| ---: | ---: | ---: |
| 0 | 500 | 414 |
| 500 | 831 | 606 |
| 1000 | 994 | 688 |
| 2000 | 1211 | 797 |
| 5000 | 1604 | 994 |
| 10 000 | 2005 | 1195 |

The **whole-graph centroid never moved** — it stayed exactly at `0.0000`. Pairwise
forces conserve momentum, and friction only decays the centre-of-mass velocity.
The defect is **unbounded extent, not translation**. That distinction decides the
design:

- **Translation-only recentring does not help.** A d3 `forceCenter`-style
  recentre left the separation at 1604 and max ‖p‖ at 994, because there was
  nothing to recentre. It is the wrong tool for this job even though "keep the
  graph centred" sounds like the requirement.
- **A per-node centripetal force helps the fragments but distorts everything
  else.** The effect scales with graph size, not with disconnection, so there is
  no `(k, R0)` that contains a fragment and leaves a connected graph alone. On a
  connected 30-node path the pull is brutal:

  | field | mean edge | bbox | settle steps |
  | --- | ---: | ---: | ---: |
  | baseline | 92.3 | 1339 | 1665 |
  | linear `-k·p`, k = 0.005 | 51.2 (−45%) | 742 | 341 |
  | linear `-k·p`, k = 0.01 | 41.9 (−55%) | 607 | 180 |
  | dead-zoned leash `-k·max(0,‖p‖−R0)·p̂`, k=0.5 R0=300 | 110.1 (+19%) | 337 | 7045 (4.2× slower) |

  It also moves the reference equilibrium: a linear global pull at k = 0.005
  takes the single edge's `r*` from 65.46 to 64.71 (−1.1%), and k = 0.01 to 63.96
  (−2.3%), which `test/convergence.test.ts` and `test/robustness.test.ts` pin at
  a 1.0 tolerance. The constant-magnitude form is worse: a lone node never
  settles at all (2830 origin crossings in 20 000 steps — a limit cycle), which
  defeats the settle detector.

  Every one of those numbers is fixed by the **uniform-per-component** form. A
  30-node path's centroid is at the origin, so its anchor is exactly zero: mean
  edge 92.33, bbox 1338.85, settle 1665 — byte-identical to baseline. An
  off-centre single edge is translated to the origin with `r*` unchanged to
  0.00%; a symmetric one is untouched.

**Disconnected components are common enough to matter.** Over 200 trials per
cell, `GraphFactory.generateGraph` (which gives every vertex at least one edge,
so it never produces an isolated node) splits into more than one component:

| branching | order 12 | order 20 | order 40 |
| --- | --- | --- | --- |
| 1 | 23/200 | 43/200 (max 3) | 72/200 (max 3) |
| 2 | 2/200 | 0/200 | 0/200 |
| 3–4 | 0/200 | 0/200 | 0/200 |

So the fix is for the `minBranching` end of the chooser, and it must not disturb
the common connected case that the reference model describes.

## 3. Decisions of record

Chosen deliberately before implementation. The plan is built around them and
individual PRs do not reopen them.

| # | Decision | Choice |
| --- | --- | --- |
| D1 | Force granularity | **One vector per connected component**, applied identically to every node in it |
| D2 | Anchor point | The **model origin**, never the camera target |
| D3 | Dead zone | Measured on the **component centroid**, so a component inside it is untouched |
| D4 | Reference API | `netForceAtNode()` **includes** the anchor, so the reference and the step path have one home |
| D5 | Labelling | A pure `graph/Components.ts` utility, computed once per solver |
| D6 | Law and tunables | The law in `physics/Kernel.ts`, the two constants in `core/K.ts` |
| D7 | Largest component | **No exemption** — every component is anchored; it is a translation, so nothing is distorted |
| D8 | Worker boundary | **No protocol change**; the worker labels the mirror graph it already builds |

Why each, briefly, because each has an alternative that was rejected:

- **Per component, uniform (D1).** A per-node force is a function of node
  position, so it is different at opposite ends of a component and therefore
  compresses it (§2). A uniform vector is the only form that bounds a fragment
  *and* provably preserves intra-component geometry — which is what keeps the
  reference numbers, and the suite that pins them, intact.
- **The model origin (D2).** The live camera target moves with pan, and
  invariant 2 keeps the projector out of the solver. The origin is the only
  anchor the physics can name. The default camera looks at it, and
  `Camera.reset()` returns to it.
- **The centroid, not the node (D3).** Anchoring each node past a radius is the
  global leash that distorts large connected graphs (§2). Anchoring the centroid
  keys the dead zone to the quantity the force is actually restoring, and leaves
  a large connected graph alone no matter how large it is.
- **`netForceAtNode()` includes it (D4).** The module's contract is that the
  object-returning reference and the step path cannot drift
  (`test/forces.test.ts`, `test/integrator.test.ts`). Leaving the anchor out
  would make `velocityAtTag()`'s default force disagree with the velocity the
  step writes.
- **A pure graph utility (D5).** Component membership is topology, not physics,
  and a future component-packing pass (§8) wants the same labelling. Keeping it
  in `graph/` also puts it under the package-dependency guard.
- **Kernel plus `K` (D6).** Matches `repulsionMagnitude` / `springMagnitude` and
  the `K.physics` table, so the worker realm and the main thread read one
  literal.
- **No exemption (D7).** Exempting a "main" component would re-introduce the
  drift it exists to stop when that component's centroid wanders, and it buys
  nothing: the force is a translation, so anchoring the largest component cannot
  distort it.
- **No protocol change (D8).** `PhysicsWorkerEngine.build()` already rebuilds a
  `Tag` graph from the wire edge list (`buildMirrorGraph`), preserving topology
  and insertion order, and constructs a `ForceDirectedGraph` from it. If the
  labelling is deterministic — it is (§4.5) — the two realms label identically.

## 4. Design

### 4.1 The law

A new companion to the two existing magnitudes in `src/physics/Kernel.ts`:

```ts
/**
 * The component-anchor magnitude for a component whose centroid is `r` model
 * units from the origin: k * max(0, r - componentAnchorRadius).
 *
 * Zero inside the dead zone, so a component that is already home feels nothing
 * and the reference layout is untouched. Beyond it, a linear restoring pull.
 * The single home for the law: the solver's step pass and its object-returning
 * reference both call it, so they cannot drift.
 */
export function componentAnchorMagnitude(r: number): number {
    return K.physics.componentAnchorStrength * Math.max(0, r - K.physics.componentAnchorRadius);
}
```

The force on every node of component `c` is the same vector:

```
C   = component centroid (cx, cy, cz)
Rc  = ‖C‖
F_c = Rc === 0 ? (0, 0, 0) : componentAnchorMagnitude(Rc) * (-C / Rc)
```

- `Rc === 0` is an explicit branch rather than a division guarded by `max`; the
  magnitude is zero there for any `R0 >= 0`, so the branch is for the direction,
  not the force.
- It uses no `Math.pow` and no allocation, so the existing "one step evaluates
  repulsion once per unordered pair" `Math.pow` counter in `test/forces.test.ts`
  is unaffected.
- The line is deliberately proportional beyond the dead zone, not a constant
  magnitude. A constant magnitude has no root at the origin and limit-cycles a
  lone node (§2).

### 4.2 Component labelling

New pure module `src/graph/Components.ts`:

```ts
/**
 * Label every vertex with the index of its connected component, assigning
 * component numbers in order of first vertex encounter, so the labelling is a
 * deterministic function of `vertices`/`edges` insertion order alone.
 *
 * Iterative BFS over `incidentEdges`, not recursion: a long path must not grow
 * the stack. Self-loops contribute no neighbour (`otherEndpoint` returns null).
 */
export function labelComponents(graph: Graph): Int32Array;
```

Properties the implementation and its tests must hold:

- **Deterministic.** Two graphs with the same vertices in the same order and the
  same edges in the same order label identically — which is exactly the
  relationship between the main thread's graph and the worker's mirror.
- **O(V + E)**, allocating one `Int32Array(V)`. Called once per solver, not per
  step.
- **Total.** Empty graph → empty array; an edgeless vertex is its own component;
  self-loops and duplicate edges change nothing.
- **Purity.** No browser global, so it joins `PURE_MODULES` in
  `test/architecture.test.ts` (§6).

### 4.3 Solver state and the step pass

`ForceDirectedGraph` owns the labelling and the per-component scratch, in the
same pooled-buffer style as the repulsion buffers (`ensureCapacity`):

```ts
private componentId = new Int32Array(0);   // one label per vertex
private componentCount = 0;
private centroidX = new Float64Array(0);   // one per component
private centroidY = new Float64Array(0);
private centroidZ = new Float64Array(0);
private componentAnchorX = new Float64Array(0);  // the uniform vector per component
private componentAnchorY = new Float64Array(0);
private componentAnchorZ = new Float64Array(0);

// Reference-only scratch for `anchorForceInto()`, which is not on the step path.
private readonly anchorScratch = new Float64Array(3);
```

An `ensureComponents()` called at the top of `stepPhysics()` (and by
`netForceAtNode()`) relabels when the cached labelling is stale. `Graph` is
append-only — it has `addNode`/`addEdge` and no removal — so staleness is two
monotonic counts, checked in O(1):

```ts
private labelledEdges = -1;

// inside ensureComponents(), with n = graph.vertices.length
if (this.componentId.length === n && this.labelledEdges === this.graph.edges.length)
    return;
```

Checking the edge count as well as the vertex count is load-bearing:
`test/solver.test.ts` grows a graph in place through the same solver instance
("the solver grows its buffers when the graph gains vertices in place"), and a
new edge at constant `N` merges two components. A stale label array is also a
correctness hazard, not just a stale result: `componentId` is a typed array, so
an out-of-range read yields `undefined` and every arithmetic result becomes
`NaN`.

The component scratch is sized to the vertex count in the same growth path as
`ensureCapacity`, so a steady-state step allocates nothing (invariant 8). A
relabel is the only allocation, and only when topology changed.

The step gains one pass, after the springs are folded into the force buffers and
before the velocity pass, so it reads only the frozen pre-step positions
(invariant 3):

```
Pass 2b: component anchor, from the pre-step positions.
  1. zero the component centroid accumulators
  2. accumulate each vertex's position into its component, in vertices order
  3. divide by the component's vertex count
  4. for each component: Rc = radius(cx, cy, cz); mag = componentAnchorMagnitude(Rc);
     write mag * (-C / Rc) into that component's anchor slot (zero when Rc === 0)
  5. anyActive = whether any component's Rc > componentAnchorRadius
  6. if anyActive, add each vertex's component anchor vector into the force buffers
```

The `anyActive` gate is deliberate and load-bearing: when no component is
outside the dead zone the force buffers are **not touched at all**, so
"connected layouts are bit-for-bit unchanged" is a structural property rather
than an argument about `x + 0 === x`.

The pass is O(N + C) with no allocation. It must not write a `Tag` (invariant 8
and `test/forces.test.ts` "step() writes no force data onto a Tag").

### 4.4 The reference API

`netForceAtNode()` becomes the three-term sum, in the step pass's order
(`(repulsion + spring) + anchor`):

```ts
netForceAtNode(tag: Tag): Point3D {
    const e = this.netElectrostaticForceAtNode(tag);
    const s = this.netSpringForceAtNode(tag);
    this.anchorForceInto(tag, this.anchorScratch);

    return point3(e.x + s.x + this.anchorScratch[0], ...);
}
```

`anchorForceInto(tag, out)` computes the tag's component centroid on demand (an
O(N) walk in `vertices` order) and writes the uniform vector. It is
**reference-only** — the step path never calls it — so its O(N) cost is
irrelevant; its contract is that it returns exactly what the step pass adds.
`velocityAtTag()`'s default argument then stays consistent with the integrated
velocity, which is the point of D4.

`accumulateRepulsion(out)` is **unchanged**: it is the pairwise repulsion kernel
and the benchmark and equivalence test drive it directly. The anchor is not
repulsion.

### 4.5 Determinism and the two realms

The bit-identical guarantee in `test/physics-runner.test.ts` is the sharpest
constraint in this plan. It holds because:

1. Both realms label the same topology in the same order (§4.2).
2. Centroids accumulate in `vertices` index order and divide by an integer
   count, so the sum's rounding is identical.
3. `componentAnchorMagnitude` is the same shared function on both sides.
4. The pass runs at the same point in the step, reading the same pre-step
   positions.

`test/physics-runner.test.ts` gains a **deterministically disconnected** fixture
(§6) and keeps its exact-equality assertions; a component anchor that is
computed in a different order on one side fails loudly.

### 4.6 Pinning, drag and settle

- A pinned node is skipped by the velocity pass, so it is not translated by the
  anchor, but its position still contributes to its component's centroid. A drag
  that pulls one node far out therefore pulls the *rest* of its component toward
  the origin, never toward the pointer. That matches the existing external-force
  semantics and needs one containment test, not a code path.
- The dead zone is what lets the layout settle. Beyond it, the proportional pull
  is a damped restoring force (the same shape as a spring), so `lastMaxDisplacement`
  falls below `settleEpsilon` and `trackSettle()` stops stepping. This is the
  property the constant-magnitude form lacked.
- The anchor cannot destabilise the `r -> 0` guard or the coincident tie-break:
  it never divides by a separation, only by a centroid radius with an explicit
  zero branch.

### 4.7 Constants

Two entries in `K.physics`, in the file's explanatory style:

| Constant | Starting value | Meaning |
| --- | --- | --- |
| `componentAnchorRadius` | `150` | Dead zone on a component *centroid*, model units. `W_0 / 4`. |
| `componentAnchorStrength` | `0.1` | Restoring pull per model unit beyond the dead zone |

Why `150`: the visible half-extent at the identity camera is `W_0 / 2 = 300`,
and a held component's farthest node is roughly `R0` plus the component's own
radius, so a dead zone at a quarter of the cube keeps a small fragment inside
the frame while still being far outside the seed centroid range (43–82). The
pair is a **starting point, not a claim**: PR 2 tunes it against the demo and
records the measured hold radius, settle time and step cost beside the values,
the way `docs/performance.md` records the other tuned numbers.

`docs/constants.md` gains the two rows.

The activation test is strict (`Rc > R0`), so a fixture whose centroid lands
exactly on the dead zone stays inactive — `pairAt(300)` has its centroid at
exactly 150. Keep the default clear of any pinned fixture centroid rather than
sitting on one; `pairAt(300)` is the closest in the current suite.

### 4.8 Why not the alternatives

| Alternative | Why it is not the design |
| --- | --- |
| Translation-only recentring | §2: the centre of mass is already conserved; separation stayed 1604. Solves centring, not containment. |
| Global per-node centripetal pull | §2: distorts connected graphs (−45% mean edge at 30 nodes) and moves `r*`. |
| Dead-zoned global leash | Preserves the reference inside `R0` but still compresses any connected graph larger than `R0` (+19% mean edge, 4.2× settle) — a stopgap, not a design. |
| Constant-magnitude pull | Limit-cycles a lone node; the settle detector never fires. |
| Hard boundary / reflect | Non-physical, causes sticking and depth artefacts, and does not preserve internal geometry. |
| Component packing / grid | A real improvement for overlap (§8), but a separate, larger design. It composes with this anchor rather than replacing it. |
| Camera auto-fit | Frames any extent but cannot bound growth (the scale tends to zero), and `docs/known-limitations.md` already rejects auto-fit scale deliberately. |

## 5. Phased delivery

Two focused PRs. Each leaves `main` green and is reviewable against the one
before it.

### PR 1 — the anchor force and its labelling

- `src/graph/Components.ts` (new): `labelComponents`.
- `test/architecture.test.ts`: add `graph/Components.ts` to `PURE_MODULES`.
- `src/physics/Kernel.ts`: `componentAnchorMagnitude`, beside the other two laws.
- `src/core/K.ts`: `componentAnchorRadius` / `componentAnchorStrength`, with the
  rationale comment.
- `src/physics/ForceDirectedGraph.ts`: the per-component buffers, the
  `ensureComponents` guard, the centroid + `anyActive` + apply pass in
  `stepPhysics()`, and `anchorForceInto()` folded into `netForceAtNode()`.
- `test/components.test.ts` (new) and `test/anchor.test.ts` (new); a
  disconnected fixture in `test/support/physics.ts`; the disconnected parity case
  in `test/physics-runner.test.ts`.
- **Acceptance:** `npm run ci` green; **no existing test assertion changes**.
  Every fixture behind an exact-valued assertion has its component centroid
  inside the dead zone, so the `anyActive` gate skips the pass for it; the
  cross-backend and quality-equivalence fixtures compare two solvers that
  receive the same anchor. If an assertion does move, that fixture's centroid
  crossed the dead zone: explain it or retune the default, never silently
  re-baseline. The new tests cover containment,
  translation-without-distortion, the lone node and worker parity.

### PR 2 — documentation and tuning

- `docs/physics.md`: a "Component anchor" bullet in the force list and a sentence
  in the cadence/settle paragraph, stating that it is a documented non-reference
  extension, that it is zero inside the dead zone, and that it translates rather
  than deforms.
- `docs/constants.md`: the two rows and the tuning note.
- `docs/invariants.md`: extend invariant 3 to name the anchor pass among the
  frozen-snapshot readers.
- `docs/known-limitations.md`: replace the drift bullet with what remains —
  components are bounded but may overlap; a connected graph larger than the view
  is still a dolly problem, not an anchor one.
- `docs/next-steps.md`: mark the workplan row implemented and point at the
  landed code, the way retired workplans were folded in.
- Tune `componentAnchorRadius` / `componentAnchorStrength` against the demo and
  record the measured numbers; `npm run bench` to confirm the step cost is flat.
- **Acceptance:** the demo holds a detached component in frame and settles; the
  docs match the shipped constants and the tests; the workplan's Status becomes
  Implemented.

## 6. Test plan

### New tests

| Area | Assertion |
| --- | --- |
| `Components` | Empty graph, single vertex, edgeless vertices, one edge, a chain, a cycle, a self-loop and duplicate edges each label as expected |
| `Components` | Component numbers are assigned in first-vertex order and are a function of insertion order (two runs agree) |
| `Components` | A graph and a mirror rebuilt from `packMirror` label identically |
| `Components` | Labels are `-1`-free and complete for a seeded sparse graph |
| `Components` / solver | Vertices added in place, and an edge that merges two components in place, are relabelled on the next step (the `test/solver.test.ts` growth path) |
| Anchor | A single edge at ±200 (centroid at origin) has `anchorForceInto` exactly `(0,0,0)` and settles at `r* ~= 65.46` unchanged |
| Anchor | Every node of a component receives the **same** anchor vector (uniformity, asserted directly) |
| Anchor | An off-centre single edge (400, 600) is translated until its centroid is inside the dead zone while its internal `r*` is unchanged |
| Anchor | Two 6-node components seeded at ±250 stay bounded (max ‖p‖ below a pin) and settle within a step budget |
| Anchor | A lone node past `R0` settles inside the dead zone and `lastMaxDisplacement` falls below `settleEpsilon` (no limit cycle) |
| Anchor | `netForceAtNode` equals `electro + spring + anchor` and the step path's velocity matches `velocityAtTag`'s default |
| Anchor | The anchor is zero, not merely small, for every fixture whose centroid is inside `R0` |
| Runner | The worker and in-process backends are bit-identical on a deterministically disconnected graph |
| Physics | The `Math.pow` pair counter is still exactly `C(N,2)` with the anchor active |

### Existing tests: expected impact

| Test | Impact |
| --- | --- |
| `architecture.test.ts` | One added line: `graph/Components.ts` in `PURE_MODULES` |
| `forces.test.ts` | None expected: `pairAt` fixtures have centroids inside `R0`, and the anchor uses no `Math.pow` |
| `convergence.test.ts` | None: the ±200 pair's centroid is at the origin |
| `robustness.test.ts` | None: both fixtures' centroids are inside `R0` |
| `integrator.test.ts` | None expected: `velocityAtTag`'s default now agrees with the step exactly |
| `physics-runner.test.ts` | One added disconnected fixture alongside the existing exact-equality assertions |
| `solver.test.ts` | One added case: an edge merged in place is relabelled on the next step |
| `pipeline.test.ts`, `kernel.test.ts` | None |
| `physics.bench.ts` | None: `accumulateRepulsion` is unchanged |

The acceptance bar for PR 1 is that the **only** diff in an existing test file is
the `PURE_MODULES` line plus the new parity fixture. Anything else is a signal
that a fixture's centroid crossed the dead zone and must be explained, not
silently re-baselined.

## 7. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| The anchor quietly compresses a layout | Uniformity is asserted directly (every node in a component gets the same vector), and the reference-preservation tests compare settled layouts byte-for-byte |
| A fixture's centroid crosses `R0` and a pinned number moves | The `anyActive` gate plus the "only the `PURE_MODULES` line changes" acceptance bar make any such move visible |
| Worker and main thread disagree | Deterministic labelling, a shared law, `vertices`-order centroids, and an exact-equality parity test on a disconnected fixture |
| `R0` too small and a legitimate ensemble is pulled hard | Default `R0` is ~2× the observed seed-centroid range and a quarter of the cube; PR 2 records the measured hold radius. It is a translation even when active, so the worst case is position, never shape |
| Components overlap inside the dead zone | Accepted and documented; inter-component repulsion spreads them; non-overlapping packing is a separate design (§8) |
| Settle detector never fires | The proportional line has a root at the origin; a lone-node settle test pins it |
| Per-step cost grows | O(N + C), no allocation, no `Math.pow`; `npm run bench` compares before/after |
| The force leaks into the pairwise reference | `accumulateRepulsion` is untouched and the pairwise-equivalence test still drives it; the anchor is added only in `stepPhysics` and `netForceAtNode` |
| Drag fights the anchor | Pinning skips the anchor for the pinned node by construction; a containment test covers a pinned drag in a two-component graph |
| Semantics drift from the reference silently | `docs/physics.md`, `docs/constants.md` and `docs/known-limitations.md` name it as a second documented non-reference extension, beside `minimumInteractionRadius` |

## 8. Out of scope

- **Component packing.** Anchoring bounds components but does not stop them
  overlapping inside the dead zone. A grid/ring packing pass is a real follow-up
  and would consume `labelComponents`; it is not this plan.
- **Anchoring to the camera target.** Physics never resolves a projector
  (invariant 2), so the anchor is the model origin. Following the panned target
  would be a boundary change, not an anchor change.
- **Auto-fit scale or translation of the camera.** Rejected in
  `docs/known-limitations.md` for the 2D reduction and the breathing scale.
- **Per-node gravity, a velocity clamp, or a hard world boundary.** §4.8.
- **Changing the pairwise repulsion or spring laws.** They stay the reference.
- **A user-facing control for `R0`/strength.** The compile-time literal keeps the
  two realms identical; a runtime control needs a worker-protocol field, which is
  the same separate item `K.physics.quality` already notes.

## 9. Verification

1. `npm run ci` green on both PRs; the test count rises in each.
2. `git diff main -- test/` in PR 1 shows only the `PURE_MODULES` line and the
   new tests plus the disconnected fixture. No existing assertion is edited.
3. PR 1: new tests assert that a two-component graph's max ‖p‖ is bounded and
   its `lastMaxDisplacement` goes quiet, and that an off-origin connected path is
   translated by the anchor with every edge length unchanged.
4. PR 2: run the demo with a `branching = 1` graph at a few hundred nodes, watch
   a detached component stay in frame and the layout settle, and orbit/dolly/pan
   to confirm the anchor does not fight the camera.
5. `npm run bench` before and after PR 1 to confirm the per-step cost is flat.
6. After merge, retire the workplan the way #134 retired the others: fold what is
   durable into `docs/physics.md` and `docs/constants.md`, set the Status to
   Implemented, and drop the `docs/next-steps.md` row.

## 10. Open questions to settle during PR 1

- **`R0` as a literal or `K.space.W_0 / 4`?** The plan proposes a literal with
  the derivation in the comment, because containment and world extent are
  different decisions that only happen to share a scale today. Deriving it would
  keep them in step if the cube changes.
- **Does the largest component ever need its own, smaller dead zone?** It does
  not today: a connected graph's centroid sits near the origin. If a future
  layout centres a large graph off-origin, the anchor would translate it home —
  which is the desired behaviour, so no exemption (D7).
- **Should the anchor be skipped entirely above some graph size** where the dolly
  is the only workable framing? No: the force is a translation and vanishes when
  centroids are inside `R0`, so size alone is not a reason to disable it.
- **Naming.** `componentAnchorRadius` / `componentAnchorStrength` /
  `componentAnchorMagnitude` / `labelComponents` are the proposed names; the
  `anchor` prefix keeps them greppable and distinct from the pairwise kernels.
