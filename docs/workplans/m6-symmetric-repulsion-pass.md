# M6 — Symmetric repulsion pass

| | |
| --- | --- |
| **Finding** | M6, medium — the repulsion pass evaluates every unordered pair twice |
| **Status** | Done in #56 |
| **Area** | `src/ForceDirectedGraph.ts`, new equivalent-accumulation test in `test/forces.test.ts` or `test/adjacency.test.ts` |
| **Depends on** | M2 (solver split), M4 (local force state) — both restructure `step` |
| **Blocks** | nothing |

## 1. Problem

`step` computes repulsion by calling `netElectrostaticForceAtNode` once per node,
and each call scans every other node:

```ts
// src/ForceDirectedGraph.ts:283-285
for (const tag of this.graph.vertices) {
    tag.netElectrostaticForce = this.netElectrostaticForceAtNode(tag);
}
```

That is `N(N−1)` ordered evaluations where `C(N,2) = N(N−1)/2` unordered pairs
exist. Force is symmetric, so half the work produces a value that is then
negated by the other half. The repulsion kernel is the O(N²) hot loop, run at
20 Hz (`K.physics.timerTickPeriodMS = 50`), and every evaluation pays a
`Math.hypot` and a `Math.pow`.

A probe on a 5-node graph confirms the duplication: one call to
`netElectrostaticForceAtNode` makes 4 `Math.hypot` calls, so a full step makes
20 where 10 would do.

The README already names this loop as the scaling limit ("Repulsion is
all-pairs, `O(N^2)` … the first thing to change for a large graph",
`README.md:127-134`). This PR halves the constant; it does not change the
complexity class.

## 2. Proposed change

Accumulate all pairs once, applying Newton's third law, while keeping the force
*kernel* shared with the existing per-node reference so the two cannot diverge.

### One home for the magnitude law

The DRY remediation deliberately consolidated the radial kernel (PR 3,
`addRadial`). A second repulsion implementation would undo that, so the law is
extracted and both paths call it:

```ts
/** k*q^2 / max(r, minimumInteractionRadius)^exponent. */
private static repulsionMagnitude(r: number): number {
    const rLaw = Math.max(r, K.physics.minimumInteractionRadius);

    return K.physics.scalarForceConstant
        * K.physics.nodeCharge * K.physics.nodeCharge
        / Math.pow(rLaw, K.physics.repulsionExponent);
}
```

`netElectrostaticForceAtNode` keeps its current shape but calls
`repulsionMagnitude(r)` instead of inlining the expression, so the reference path
(for tests and for `netForceAtNode`) is unchanged in output.

### One evaluation per unordered pair

```ts
/**
 * Accumulate all-pairs repulsion into `out`, one evaluation per unordered pair.
 * The two forces are equal and opposite, so the magnitude and the unit vector
 * are computed once and applied with opposite signs.
 *
 * Newton's third law, and the reason this halves the hot loop.
 */
private accumulateRepulsion(out: Point2D[]): void {
    const verts = this.graph.vertices;

    for (let i = 0; i < verts.length; i++) {
        const a = verts[i];

        for (let j = i + 1; j < verts.length; j++) {
            const b = verts[j];

            // Away from b for a, away from a for b: the same (dx, dy) with
            // opposite signs.
            const dx = a.position.x - b.position.x;
            const dy = a.position.y - b.position.y;
            const r = Math.hypot(dx, dy);

            // addRadial() owns the r === 0 guard, so a coincident pair
            // contributes nothing on either side — exactly as before.
            const m = ForceDirectedGraph.repulsionMagnitude(r);

            out[i] = ForceDirectedGraph.addRadial(out[i].x, out[i].y,  dx,  dy, r, m);
            out[j] = ForceDirectedGraph.addRadial(out[j].x, out[j].y, -dx, -dy, r, m);
        }
    }
}
```

and in `step` (assuming M4 landed first, so forces are step-local):

```ts
// PASS 1 — repulsion once per pair, springs once per incident edge.
const electrostatic: Point2D[] = vertices.map(() => zero());
this.accumulateRepulsion(electrostatic);

const forces: Point2D[] = vertices.map((tag, i) => {
    const s = this.netSpringForceAtNode(tag);
    const e = electrostatic[i];

    return point(e.x + s.x, e.y + s.y);
});
```

`netElectrostaticForceAtNode` and `netForceAtNode` stay public and pure for the
tests that assert on them.

### Why the results are identical, not merely close

For node `i`, the per-node reference sums contributions in increasing neighbour
index order and computes each term as
`m * (pos_i − pos_j) / r`. The paired pass reaches `i`'s contributions in the
same order (all `j < i` while the outer loop was at `j`, then `j > i`), and for
`j < i` it adds `-(m * (pos_j − pos_i) / r)`. Since IEEE negation and
multiplication are sign-symmetric, `-(m * (pos_j − pos_i))` is bitwise equal to
`m * (pos_i − pos_j)`, and the division is the same. The accumulation order and
every term are therefore bitwise identical to the reference.

That makes the equivalence test exact rather than tolerance-based, and it means
`test/pipeline.test.ts`'s `1e-12` "exactly a synchronous update" assertion must
pass without being touched. If it does not, the summation order was disturbed and
the PR is wrong — not the test.

## 3. Tests

**New — equivalence.** For a suite of graphs (random `newGraph`, the duplicate
edge / self-loop / coincident fixture from `test/forces.test.ts:80-115`, and a
single-node graph), assert the paired accumulation equals the per-node reference
for every node:

```ts
const paired = vertices.map(() => zero());
fdg.accumulateRepulsion(paired);   // exposed as an internal method for this test

vertices.forEach((tag, i) => {
    const reference = fdg.netElectrostaticForceAtNode(tag);
    assertClose(paired[i].x, reference.x, 0, `${tag.label} x`);   // difference must be exactly 0
    assertClose(paired[i].y, reference.y, 0, `${tag.label} y`);
});
```

`eps = 0` uses `assertClose`'s absolute branch, so the difference must be zero
while still tolerating `-0` vs `0`.

**New — one evaluation per pair.** A graph of `N = 5` nodes with no edges, one
`step`, counting `Math.hypot` (patch it as `test/support/physics.ts` patches
`incidentEdges` in `test/adjacency.test.ts:138-161`): exactly
`C(5,2) = 10` calls. The old path makes 20. Keep the existing spring-pass test
(`test/adjacency.test.ts:138-161`) as the `O(V + E)` guard.

**Unchanged, must stay untouched:** `test/pipeline.test.ts` (both order
independence and the exact synchronous update), `test/forces.test.ts`,
`test/convergence.test.ts`, `test/robustness.test.ts` — including the
`minimumInteractionRadius` clamp assertions, which is where a duplicated law
would show up first.

**Unchanged but watched:** `test/adjacency.test.ts:163-173` (200-node timing).
Record before/after numbers in the PR description.

## 4. Acceptance criteria

- One `repulsionMagnitude` evaluation per unordered pair per step (test above).
- Paired accumulation is exactly equal to the per-node reference on graphs
  containing duplicate edges, self-loops, coincident nodes and isolated nodes.
- `test/pipeline.test.ts` passes with **no expectation edits**; the `1e-12`
  synchronous-update assertion is the proof that Jacobi ordering survived.
- The `r → 0` clamp is unchanged: `test/robustness.test.ts` passes untouched.
- `test/adjacency.test.ts:163-173` passes; the PR records before/after timing.
- The magnitude law exists once; the per-node reference and the paired pass both
  call it.
- `npm run ci` green; test count rises.

## 5. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Accumulation order changes and nudges results | Argued bitwise-identical in §2; the equivalence test asserts a difference of exactly 0, and the pipeline `1e-12` assertion is a second, independent check |
| Two code paths diverge later (the DRY review's core concern) | One shared `repulsionMagnitude`; the equivalence test runs on the fixtures most likely to expose a divergence |
| The paired pass adds two force arrays per step | It removes half the `Math.pow`/`Math.hypot` calls; the 200-node timing test decides. If allocation dominates, accumulate springs into a parallel array too and drop `netForceAtNode` from `step` entirely |
| `addRadial` allocates a point per update | Same count as the old path (one per ordered contribution) and half the contributions, so strictly less allocation than before |
| `-0` compared against `0` | `assertClose(..., 0)` uses absolute difference, which is `0` for `0`/`-0` |
| Patching a `private static` for the test | Expose `accumulateRepulsion` as an internal method with a test-visible signature rather than casting through `any`; a package-private convention is preferable to a hole |

## 6. Out of scope

- Changing the complexity class: spatial subdivision (k-d tree, grid), a
  repulsion cut-off radius, or Barnes–Hut. That is a separate, larger change
  and the README already flags it.
- Changing the exponent, the clamp, or any constant.
- Parallelising or offloading the loop to a worker.
- Caching `Math.pow(r, 1.9)` results across steps.

## 7. Verification

1. `npm run ci`.
2. Confirm `test/pipeline.test.ts` and `test/robustness.test.ts` passed without
   edits (`git diff main -- test/pipeline.test.ts test/robustness.test.ts` empty).
3. Time 25 steps of a 200-node graph before and after; record both in the PR.
4. `BROWSER=... ./cli run`; the graph settles to the same layout at the same
   rate.
