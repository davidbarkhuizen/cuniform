# Plan 3 — Distance kernel: `Math.sqrt` instead of `Math.hypot`; review `Math.pow`

Status: proposed · Depends on: nothing (pairs with Plan 2) · Blocks: nothing

## Objective

Remove `Math.hypot(x, y, z)` from the force kernels in favour of
`Math.sqrt(x*x + y*y + z*z)`, and decide, with a measurement, whether
`Math.pow(r, 1.9)` needs any change. This is a small, self-contained change to
the innermost loop.

## Why

Measured on the flat, allocation-free repulsion pass at N=1024:

| variant | ms | relative |
| --- | ---: | ---: |
| `Math.hypot(x, y, z)` | 64.4 | 1.0× |
| `Math.sqrt(x*x + y*y + z*z)` | 29.4 | **2.2× faster** |

`Math.hypot` is variadic, handles arbitrary argument counts, and rescales to
avoid overflow/underflow, so it cannot compile to a square root plus two
multiplies. It sits in the innermost loop of the dominant cost, so it is worth
replacing.

`Math.pow` is ~3.5× a multiply, but splitting `r^1.9` into
`(C/(r*r)) * Math.pow(r, 0.1)` measured 29.42 ms → 28.62 ms at N=1024, i.e.
inside noise. It is not worth trading clarity or exactness for. Plan 1's real
reduction in `pow` calls comes from reducing the number of interactions, not
from making each one cheaper.

## Current behaviour

`Math.hypot` appears in:

- `src/ForceDirectedGraph.ts:75` — `netElectrostaticForceAtNode` (reference
  path, O(N), not the step hot loop but still tested)
- `src/ForceDirectedGraph.ts:114` — `accumulateRepulsion` (**the** hot loop)
- `src/ForceDirectedGraph.ts:159` — `netSpringForceAtNode` (O(E))
- `src/Camera.ts:23` — `normalise`-style helper for the camera up axis; **not
  hot, leave it alone**

`Math.pow` appears in `src/ForceDirectedGraph.ts:52`
(`repulsionMagnitude`) and `src/Camera.ts:117` (dolly; not hot).

## Proposed design

### A single radius helper

Introduce one private helper and use it at all three force sites, so the
definition of `r` cannot drift:

```ts
// Coordinates are bounded model-space doubles (a 600^3 cube, camera distance
// at most 8192); the overflow/underflow rescaling in Math.hypot is unnecessary.
private static radius(dx: number, dy: number, dz: number): number {
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
```

The octree from Plan 1 uses the same helper (or a flat-buffer equivalent) so
there is one definition.

### Bounds and the underflow corner

- **Overflow**: `x*x` overflows only for `|x| ≳ 1e154`. Positions live in a
  600-unit cube, drift is unclamped but astronomically far from that, and the
  camera is bounded at 8192. Document the assumption next to the helper.
- **Underflow**: if all three deltas are below ~1e-162, each square underflows
  to zero and `sqrt` returns `0`, whereas `Math.hypot` would return a tiny
  positive value. The kernels already have an explicit `r === 0` branch (the
  coincident-centre tie-break) and `repulsionMagnitude` clamps at
  `minimumInteractionRadius`, so such a pair lands in the bounded, deterministic
  coincident branch rather than dividing by zero. This is a strictly safer
  outcome than the current `dx/r` at a subnormal `r`; note it in the code
  comment and cover it with a test.

### Keep `Math.pow`

Do not change the law or approximate the exponent. If a post-Plan-1 profile
shows `pow` is dominant, revisit with a separately benchmarked proposal; a
reciprocal table or polynomial approximation is out of scope because it changes
the force values.

## Correctness and invariants

- The arithmetic result of `sqrt(dx*dx+dy*dy+dz*dz)` is identical to
  `Math.hypot(dx, dy, dz)` for every finite input in the relevant range; the
  existing tight tolerances (1e-9, 1e-12) are unaffected.
- Force direction formulas (`magnitude * dx / r`) are unchanged.
- No change to the frozen-snapshot or determinism properties.

## Test plan

- **Update the instrumentation test.** `test/forces.test.ts` currently patches
  `Math.hypot` and asserts `C(5,2) = 10` calls, to pin "one evaluation per
  unordered pair". Once `hypot` is gone that counter reads 0. Retarget the
  probe to `Math.pow`, which `repulsionMagnitude` still calls exactly once per
  pair in a springless graph. This preserves the test's actual intent.
- **Add a radius-equivalence test**: for a spread of deltas (large, small,
  mixed-sign, subnormal-adjacent), assert the helper equals `Math.hypot` within
  a relative epsilon, and that the subnormal case lands in the bounded
  coincident branch with finite output.
- Force-law tests (`test/forces.test.ts`) must pass unchanged otherwise.
- Benchmark before/after for the flat kernel.

## Acceptance criteria

- On top of Plan 2, the N=1024 repulsion pass ≤ 32 ms/step (measured 29.4 ms).
- Aligned with Plan 2, N=512 ≤ 9 ms.
- `./cli ci` green, with only the instrumentation test rewritten.
- The committed benchmark records kernel time separately from allocation so the
  `hypot` win is attributable.

## Risks and mitigations

| risk | mitigation |
| --- | --- |
| Precision or overflow regression | bounded coordinates documented; equivalence test over a wide range |
| Subnormal separation divides by zero | existing `r === 0` branch and `minimumInteractionRadius` clamp cover it; add a test |
| Silently disabling the pair-count test | retarget the probe to `Math.pow`; keep its assertion |
| Scope creep into `Math.pow` tuning | keep `pow`; require a separate measured proposal to change it |

## Out of scope

- Replacing `Math.pow` with an approximation or lookup table.
- Changing the exponent, the constants, or the integration scheme.
- The `Math.hypot` in `Camera.ts` (not hot).
