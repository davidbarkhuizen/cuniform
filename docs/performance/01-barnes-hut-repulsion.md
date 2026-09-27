# Plan 1 — Barnes–Hut repulsion

Status: implemented · Depends on: Plans 2 and 3 (recommended first) · Blocks:
interactive graphs above ~1k nodes

## Objective

Replace the all-pairs repulsion pass (`O(N²)`) with an approximate Barnes–Hut
octree (`O(N log N)`), keeping the documented force law and the existing
exact reference kernel. This is the single change that lets the solver scale
past a few hundred nodes; Plans 2 and 3 only move the constant factor.

## Why

Repulsion is 85–98% of every `step()` at N ≥ 512 and is cleanly quadratic:
112 ms at N=1024 versus a 50 ms tick budget, 2.08 s at N=4096. Nothing else in
the step matters by comparison (projection is 1.7 ms at N=4096).

The README already names this as the intended fix: "There is no spatial
subdivision and no cut-off radius, so repulsion still dominates at scale; this
is fine at demo scale ... and is the first thing to change for a large graph."

A cut-off radius is *not* the answer: the law is long-range, so truncating it
changes the physics rather than approximating it. Barnes–Hut approximates the
far field with a centre of mass, which is the standard, defensible trade.

## Current behaviour

`src/ForceDirectedGraph.ts`:

- `accumulateRepulsion(out)` loops `i < j` over every unordered pair, computes
  `r = Math.hypot(dx, dy, dz)`, `magnitude = CHARGE_PRODUCT /
  Math.pow(max(r, minimumInteractionRadius), 1.9)`, and accumulates the radial
  contribution into `out[i]` and `out[j]`.
- `netElectrostaticForceAtNode(tag)` computes the same law by scanning all
  vertices; it is the per-node reference and is used by tests.
- `step()` allocates an `electrostatic` array and calls `accumulateRepulsion`
  once per tick.
- The coincident-centre rule (`r === 0`) breaks the tie by index: the earlier
  node is pushed `-x`, the later `+x`.

## Proposed design

### New pure module `src/Octree.ts`

Add `src/Octree.ts` to `PURE_MODULES` in `test/architecture.test.ts`. It is pure
math and geometry, like `Projector.ts`.

Build, once per step, from the current positions:

1. Compute the axis-aligned bounding cube of all vertices. Guard the degenerate
   all-coincident case with a minimum half-extent (e.g. `1e-6`).
2. Insert each vertex. Each cell stores:
   - its centre and half-extent,
   - aggregate `mass` (number of unit charges; the law has equal `q` per node)
     and aggregate centre of mass `(mx, my, mz)` as charge-weighted sums,
   - either eight children or a leaf bucket of body indices.
3. Leaves become buckets when two bodies would occupy the same octant at the
   precision floor. Impose `K.physics.barnesHutMaxDepth` (proposed `28`) and
   keep a bucket beyond it, so exactly coincident or near-coincident points
   cannot recurse forever.

### Traversal

For each body `i`, walk the tree and accumulate force:

- **Leaf**: for every body `j != i` in the bucket, apply the exact pairwise law
  (same radial math, same `minimumInteractionRadius` clamp).
- **Internal cell**: let `d` be the distance from body `i` to the cell's centre
  of mass and `s = 2 * half` the cell size. If `s / d < θ`, apply the aggregate:
  magnitude `mass * CHARGE_PRODUCT / max(d, minimumInteractionRadius)^1.9`,
  directed away from the centre of mass. Otherwise recurse into the children.

The `mass` factor is essential: a cell holding `m` unit charges repels with
`m` times the single-charge magnitude. (An early prototype omitted this and
produced ~250% force errors.)

### Self-exclusion bound

The cell that *contains* body `i` must never be accepted as an aggregate, or
the node would repel itself. The implementation does this explicitly: the
traversal records, for each cell on its stack, whether that cell holds body
`i`, and never accepts such a cell. The child on the body's side of each split
inherits the flag, so the guarantee is exact for every opening angle and does
not depend on `theta` at all.

> Implementation note: the θ-only argument sketched below is therefore not
> relied on. It is also too loose: the centre of mass can sit at the opposite
> corner of the cell from the body, so a θ-only guarantee would need
> θ < 1/√3 ≈ 0.577. `barnesHutTheta` is still clamped to the documented
> 2/√3 ceiling as a sanity bound.

The original θ argument, kept for reference: because `i` lies inside that cell,
`d ≤ √3 · half`, so `s / d ≥ 2/√3 ≈ 1.155`.

### Exact fast path

Below a crossover size `K.physics.barnesHutMinNodes` (proposed `64`), keep the
current pairwise `accumulateRepulsion`. This:

- preserves exact demo-scale behaviour and the bitwise-equality test in
  `test/forces.test.ts`,
- avoids tree build overhead where it does not pay (the prototype showed no
  win below ~512 at θ=0.5).

### Structure of arrays

Traversal is far faster over flat `Float64Array`s than over objects. The octree
should use pooled cell arrays and a flat position buffer, following the same
pattern as Plan 2, rather than allocating a `Cell` object per node per step.
Plan 2 should land first so the buffer ownership has one home.

### Constants (`src/K.ts`)

```ts
barnesHutTheta: 0.5,        // opening angle; 0 is exact, must stay < 2/sqrt(3)
barnesHutMinNodes: 64,      // below this, use the exact pairwise kernel
barnesHutMaxDepth: 28,      // bucket near-coincident points instead of recursing
```

Default θ = 0.5: measured mean force error 0.2% and max 1.5% on random sparse
graphs, the conservative choice for a layout people look at. θ = 0.9 (the
three.js default) is faster but measured 1.1% mean / 13% max; it can be exposed
as a "performance" preset rather than the default.

## Correctness and invariants

- **The law is unchanged.** Only the far-field evaluation is approximated; the
  near field and the `minimumInteractionRadius` clamp are evaluated exactly.
  Force direction stays radial: aggregate force is along `position - centreOfMass`.
- **Frozen snapshot.** The tree is built once from pre-step positions, so
  invariant 3 in the index holds.
- **Determinism.** The bounding cube, cell assignment and child order are
  deterministic functions of the insertion order, so a given position set always
  produces the same tree and the same force.
- **Coincident centres are the hard case.** The index-order tie-break cannot be
  preserved for a body interacting with an aggregate. Decision required in the
  PR:
  - within a leaf bucket, keep the exact `r === 0` index tie-break;
  - across a body and an aggregate at `d === 0`, fall back to exact pairwise
    for that body for the step (bounded, rare, and keeps the "coincident pairs
    separate deterministically" guarantee).
  Document whatever is chosen as a non-reference extension, in the same spirit
  as the existing singularity guard.
- **Exactness tests change.** "Paired repulsion equals the per-node reference
  exactly" stays for N below the crossover and becomes a bounded-error test
  above it. The `Math.hypot` call-count instrumentation in
  `test/forces.test.ts` must be replaced (Plan 3 removes `hypot` entirely) with
  an interaction-count or tolerance check.

## Test plan

- `test/octree.test.ts` (new): tree invariants — aggregate mass equals bucket
  population, centre of mass is the charge-weighted mean, children partition the
  parent, degenerate cubes terminate.
- `test/barnes-hut.test.ts` (new): for seeded random graphs at N = 128, 512,
  1024, compare octree force to `netElectrostaticForceAtNode` sample-wise and
  assert mean relative error ≤ 1% and max ≤ 15% at θ = 0.5; assert every force
  is finite.
- Update `test/forces.test.ts` exactness/instrumentation tests as above.
- Keep `test/convergence.test.ts`, `test/layout.test.ts`, `test/pan.test.ts`
  (small N) green unchanged.
- Re-run the committed benchmark and record before/after.

## Acceptance criteria

Using the committed benchmark on this machine:

- N=1024 repulsion ≤ 30 ms/step at θ=0.5 (from 112 ms).
- N=4096 repulsion ≤ 150 ms/step at θ=0.5 and ≤ 70 ms at θ=0.9 (from 2084 ms).
- Full `step()` within the 50 ms tick budget at N=1024 at θ=0.5.
- Mean force error ≤ 1%, max ≤ 15% at θ=0.5 on the benchmark graphs.
- `./cli ci` green.

These are goals, not promises: the benchmark is the arbiter, and the PR should
record the actual table.

## Risks and mitigations

| risk | mitigation |
| --- | --- |
| Approximate forces degrade layout quality | default θ = 0.5; expose θ; benchmark layouts, not just time |
| Coincident tie-break regression | exact path within leaves, exact fallback for `d === 0`, dedicated test |
| Floating-point sum order changes break exact tests | relax those tests to tolerances above the crossover; keep exact path below it |
| Object-tree allocation negates the win | flat/pooled arrays, coordinated with Plan 2 |
| θ too large self-repels | document and validate the `θ < 2/√3` bound |

## Out of scope

- Fast Multipole Method (worse constant, unnecessary here).
- GPU/WebGL force computation.
- A cut-off radius (changes the law) or per-pair rest lengths.
- Changing the integrator, friction or time step.
