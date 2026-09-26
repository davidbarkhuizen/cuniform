# M4 — Local force state instead of mutable `Tag` caches

| | |
| --- | --- |
| **Finding** | M4, medium — forces are cached as mutable `Tag` fields |
| **Status** | Done in #55 |
| **Area** | `src/Tag.ts`, `src/ForceDirectedGraph.ts`, `test/integrator.test.ts`, `test/forces.test.ts`, `test/graph.test.ts`, `test/convergence.test.ts` |
| **Depends on** | M2 (solver split) — recommended, not required |
| **Blocks** | M6 (both restructure `step`) |

## 1. Problem

`netForceAtNode` reads two fields that only `step` writes:

```ts
// src/ForceDirectedGraph.ts:206-217
netForceAtNode(tag: Tag): Point2D {
    var e = tag.netElectrostaticForce;   // written by step(), pass 1
    var s = tag.netSpringForce;          // written by step(), pass 2
    var nX = e.x + s.x;
    var nY = e.y + s.y;
    return point(nX, nY);
};
```

`step` fills them in two passes before the velocity pass:

```ts
// src/ForceDirectedGraph.ts:283-295
for (const tag of this.graph.vertices) {
    tag.netElectrostaticForce = this.netElectrostaticForceAtNode(tag);
}
for (const tag of this.graph.vertices) {
    tag.netSpringForce = this.netSpringForceAtNode(tag);
}
for (const tag of this.graph.vertices) {
    tag.velocity = this.velocityAtTag(tag);
}
```

The fields default to `zero()` (`src/Tag.ts:28-29`). So `netForceAtNode` is a
*correct* function only in the interval between pass 2 and the end of the tick.
Outside that window it returns `{0, 0}` and says nothing about it. The type
system cannot express the precondition, and `Tag` becomes a mutable simulation
scratchpad rather than a data record.

## 2. Evidence

**It has already produced a vacuous test.**
`test/convergence.test.ts:30-46` ("at equilibrium the spring and repulsion
forces balance") never calls `step`:

```ts
const fdg = new ForceDirectedGraph(graph);

const repel = fdg.netElectrostaticForceAtNode(a);
const spring = fdg.netSpringForceAtNode(a);
const net = fdg.netForceAtNode(a);          // reads zeroed caches

assertClose(net.x, 0, 0.02, `net radial force at r* was ${net.x}`);
```

A probe at `r = 65.46`:

```
netForceAtNode BEFORE any step : {"x":0,"y":0}
netElectrostaticForceAtNode    : {"x":-3.5452396527708068,"y":0}
netSpringForceAtNode           : {"x":3.5459999999999994,"y":0}
true e+s                       : {"x":0.0007603472291926039,"y":0}
```

The assertion passes against `0` rather than the real `0.00076`. The two forces
do balance — but the test is not what demonstrates it, and would stay green if
the physics broke.

**Tests work around the coupling by seeding fields.**
`test/integrator.test.ts` sets `a.netElectrostaticForce` / `a.netSpringForce`
directly at `:27-28, 41-42, 52-53, 70-71`, and
`test/forces.test.ts:74-75` does the same — three tests arranging internal state
that production only ever reaches through `step`.

## 3. Proposed change

Delete the two force fields, make `netForceAtNode` pure, and keep the genuinely
persistent state (`velocity`) on `Tag`.

### `src/Tag.ts`

```ts
export class Tag {
    idx: number;
    label: string;
    position: Point2D;
    translatedPosition: Point2D;
    /** Retained: velocity carries across steps and is pinned to zero on drag. */
    velocity: Point2D;
    isSelected: boolean = false;

    constructor(xy: Point2D, label: string) {
        this.idx = popUnusedTagIdx();
        this.label = label;
        this.position = point(xy.x, xy.y);
        this.translatedPosition = point(xy.x, xy.y);
        this.velocity = zero();
    }

    get displacement(): Point2D {
        return this.velocity;
    }
}
```

### `src/ForceDirectedGraph.ts`

```ts
/**
 * Net force on `tag`, recomputed from the current positions. Pure: it reads no
 * cached field, so it is meaningful before the first step() and can never
 * observe a half-written tick.
 */
netForceAtNode(tag: Tag): Point2D {
    const e = this.netElectrostaticForceAtNode(tag);
    const s = this.netSpringForceAtNode(tag);

    return point(e.x + s.x, e.y + s.y);
}

/**
 * Damped, semi-implicit Euler. `force` defaults to the net force at the node's
 * current position; step() passes the force it already computed from the frozen
 * snapshot so the O(N^2) kernel is not recomputed.
 */
velocityAtTag(tag: Tag, force: Point2D = this.netForceAtNode(tag)): Point2D {
    const friction = K.physics.friction;
    const timeStep = K.physics.timeStep;

    return point(
        tag.velocity.x * friction + force.x * timeStep,
        tag.velocity.y * friction + force.y * timeStep
    );
}

step(canvasWidth, canvasHeight, isPinned = () => false) {
    const vertices = this.graph.vertices;

    // PASS 1 — forces are a pure function of the frozen pre-step positions.
    // The two kernels were previously cached in two separate loops; merging
    // them is safe (and still Jacobi) because positions do not change here.
    const forces = vertices.map(tag => this.netForceAtNode(tag));

    // PASS 2 — velocities.
    const velocities = vertices.map((tag, i) => this.velocityAtTag(tag, forces[i]));

    // PASS 3 — positions. A pinned node holds the pointer's position and is
    // bled off; no force data is written anywhere.
    for (let i = 0; i < vertices.length; i++) {
        const tag = vertices[i];

        if (isPinned(tag)) {
            tag.velocity = zero();
        } else {
            tag.velocity = velocities[i];
            tag.position.x += tag.velocity.x;
            tag.position.y += tag.velocity.y;
        }
    }

    // PASS 4 — refresh the canvas-space cache.
    const viewport = Viewport.forCanvas(canvasWidth, canvasHeight);

    for (const node of vertices)
        node.translatedPosition = viewport.toCanvas(node.position);
}
```

Jacobi ordering is preserved: pass 1 reads only positions, pass 2 reads only a
node's own velocity plus the force already computed, pass 3 writes positions.
`test/pipeline.test.ts:64-112` is the guard and must pass untouched.

## 4. Tests to change

| Test | Change |
| --- | --- |
| `test/forces.test.ts:72-78` | "net force is the sum of the two cached contributions" → "…of the two force kernels". Seed nothing; compute `e`/`s` from the two kernel methods and assert `netForceAtNode` equals their sum. |
| `test/integrator.test.ts:23-37` | Drop the seeded fields; call `fdg.velocityAtTag(a, { x: F, y: 0 })` — the test is about the formula, so pass the force explicitly. |
| `test/integrator.test.ts:39-48` | Pass `{ x: 0, y: 0 }` explicitly so the test states its own precondition instead of relying on an unset field. |
| `test/integrator.test.ts:50-66` | Pass `{ x: 7, y: 0 }` to `velocityAtTag`; the `displacement` getter assertions are unchanged (accessor renamed in M3). |
| `test/integrator.test.ts:68-80` | Unchanged: a lone node has no forces, and `step` now reaches the same zero by the pure path. |
| `test/graph.test.ts:149` | Delete the `notStrictEqual(a.netElectrostaticForce, a.netSpringForce)` assertion — the fields are gone. The test's aliasing purpose is carried by the `velocity` assertions above it. |

**New tests.**

- "`netForceAtNode` is meaningful before the first `step()`": build a two-node
  pair, call `netForceAtNode` with no prior `step`, assert it equals the kernel
  sum **and is non-zero**. This is the direct regression test for the vacuous
  case.
- "`step()` writes no force data onto `Tag`": after a step, assert
  `'netElectrostaticForce' in tag === false` and likewise for `netSpringForce`.
  Documents the intent now that the fields are gone.
- **De-vacuum `test/convergence.test.ts:30-46`.** The existing assertion becomes
  real automatically, but add guards so it cannot silently go vacuous again:

  ```ts
  assert.ok(Math.abs(repel.x) > 1, "the individual forces must be non-trivial");
  assert.ok(Math.abs(spring.x) > 1, "the individual forces must be non-trivial");
  assertClose(net.x, 0, 0.02, `net radial force at r* was ${net.x}`);
  ```

## 5. Acceptance criteria

- `Tag` declares no force field; `src/` never assigns force data to a `Tag`.
- `netForceAtNode` returns the true force before any `step()` has run.
- `step()` remains a synchronous Jacobi update: `test/pipeline.test.ts` passes
  with **no expectation edits**.
- All physics tests (`forces`, `robustness`, `convergence`, `integrator`,
  `solver`) pass; `convergence`'s balance test is non-vacuous.
- `test/adjacency.test.ts:163-173` (200-node performance) still passes; if the
  extra per-node allocations cost more than the budget, fall back to keeping
  `e`/`s` in step-local variables and passing the sum to `velocityAtTag` rather
  than allocating three points per node.
- `npm run ci` green; test count does not fall (it rises).

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Extra allocation per node per step (`netForceAtNode` now builds `e`, `s` and the sum) | The kernels dominate; the existing 200-node timing test catches a regression. Fallback noted in §5 |
| Rewriting seeded tests changes what they assert | Keep the formula and the expected numbers identical; only the force *source* changes from a field to a parameter |
| The optional `force` parameter makes `velocityAtTag` ambiguous | It defaults to the pure force, so the no-argument call is still correct — it is just no longer the hot path |
| `step` merging the two force loops changes floating-point results | It does not: the same kernels run on the same frozen positions, and the additions happen in the same order per node. Verified by the exact `1e-12` pipeline assertion |
| Removing `Tag` fields breaks fixtures not listed here | Compiler-enforced — `strict` + `noUnusedLocals` fails the build at every stale reference |

## 7. Out of scope

- Halving the repulsion kernel's work (M6). This PR keeps the per-node kernel
  calls; M6 changes how they are accumulated.
- Changing friction, time step, or the integration scheme.
- Moving `translatedPosition` into the renderer (M2 follow-up).

## 8. Verification

1. `npm run ci`.
2. Probe: a pre-step `netForceAtNode` on a two-node pair returns non-zero.
3. Confirm `test/convergence.test.ts` fails if the spring/repulsion constants
   are perturbed (i.e. it is no longer vacuous) — try a scratch edit locally,
   do not commit it.
4. `BROWSER=... ./cli run`; the layout settles to the same equilibrium.
