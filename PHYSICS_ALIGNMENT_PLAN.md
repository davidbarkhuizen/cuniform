# cuniform — Physics Alignment Workplan

Revise cuniform's simulation so its behaviour matches the reference model in
[`pygforce/force-directed-graph-physics.md`](../pygforce/force-directed-graph-physics.md)
(description of `pygforce/force_directed_graph.py` at commit `5341c83`).

Two repositories are involved:

- **Reference:** `pygforce` — Python/GTK, the documented physics.
- **Target:** `cuniform` — TypeScript/canvas, this repository, at `main` (`86d04e0`;
  `src/` is unchanged through `aef0d3d`, which only bumps transitive dependencies).

All line references were verified against the working trees, and the behavioural
claims in §3 were measured by compiling the real `src/` classes and running them
headlessly.

---

## Status: Phases 0–6 implemented

The workplan below has been executed. Every phase landed in its own focused PR,
squash-merged into `main`:

| Phase | PR | What landed |
| --- | --- | --- |
| 0 — headless harness | [#22](https://github.com/davidbarkhuizen/cuniform/pull/22) | `step()`/`render()` split, `window.state` out of the solver, `node:test` harness |
| 1–2 — integrator and force laws | [#23](https://github.com/davidbarkhuizen/cuniform/pull/23) | velocity + `friction`/`timeStep`, `r^-1.9`, correct spring sign |
| 3 — world and canvas | [#24](https://github.com/davidbarkhuizen/cuniform/pull/24) | `600x600` model, boundary clamp removed, uniform scale |
| 4 — pipeline purity | [#25](https://github.com/davidbarkhuizen/cuniform/pull/25) | order-independence and Jacobi tests |
| 5 — graph seeding | [#26](https://github.com/davidbarkhuizen/cuniform/pull/26) | sparse generation, dedup fix, reference initial conditions |
| 6 — documentation (the §8 "PR 6") | [#27](https://github.com/davidbarkhuizen/cuniform/pull/27) | README physics summary, `BUGFIX_PLAN.md` corrections |

Measured outcomes: a single edge settles at `r = 65.4563` (doc §9 predicts
`65.46`), a 10-node graph's mean per-step travel over the final 100 of 2000 ticks
is `0.0000` (was ~380), and `npm test` covers all of the acceptance criteria in
§6 with 34 tests.

Re-verified on `main` at `7f8c8f1`: `npm test` is 34/34. PRs `#28`–`#29` later
added a `cli` entry point; that is repository tooling, not part of this plan.

### Resolved open decisions (§7)

1. **World size vs canvas** — reference `600x600`, uniformly scaled. Implemented.
2. **Boundary** — the clamp was deleted, matching the reference. No centring
   force was added.
3. **Repulsion coefficients** — the reference's two knobs were kept
   (`scalarForceConstant = 100`, `nodeCharge = 10`) for traceability, plus
   `repulsionExponent`.
4. **`displacement` field** — collapsed into `velocity` via a read-only getter
   (doc §12.8's recommendation).
5. **Graph seeding** — the reference's sparse random generation was kept;
   jittered-grid seeding was not adopted.
6. **Test runner** — compiled with the existing `tsc` and run under `node:test`,
   adding no dependencies. (The pinned `ts-node@9` is incompatible with
   `typescript@4.9.5` and aborts at startup, so it is not used.)

Phase 6 extensions were intentionally **not** implemented: they are deliberate
divergences from the reference and belong in separate, clearly-labelled changes.
They remain the only outstanding part of this plan (§5 Phase 6 below).

---

## 1. Scope

**In scope** — everything that determines the physical trajectory:

1. the two force laws (repulsion, spring);
2. the integrator (velocity, damping, time step);
3. per-node physical state;
4. the ordered per-step pipeline;
5. coupling to dragging/selection;
6. model-space and canvas-space mapping;
7. the physics constants and where they live.

**Out of scope** — the reference doc's own §12 "possible improvements"
(centring force, Fruchterman–Reingold cooling, velocity clamp, denominator
softening, degree-normalised springs, Kamada–Kawai rest lengths, Barnes–Hut).
These are explicitly *not* the reference behaviour. Adding them during this
refactor would move cuniform away from the target, not toward it. They are
parked in Phase 6 as optional follow-ups.

Two pieces of cuniform engineering are *better* than the reference and should be
kept, because the reference doc itself recommends them:

- constants centralised in `src/K.ts` (doc §12.4 wants `k`, `q` and the exponent
  moved out of the hot loop into `constants.py`);
- the solver separated into a class that can be exercised without the DOM,
  once the `window.state` read is removed.

---

## 2. The reference model, restated as a buildable spec

Constants (reference `constants.py` plus the hardcoded values):

| Symbol | Value | Note |
| --- | --- | --- |
| `W_0`, `H_0` | `600`, `600` | square model space, origin at centre |
| `W_1`, `H_1` | `700`, `700` | square canvas |
| `SPRING_CONSTANT` `k` | `0.1` | every edge |
| `EQUILIBRIUM_DISPLACEMENT` `l` | `30` | every edge, model units |
| `TIME_STEP` | `0.1` | dimensionless gain, **not seconds** |
| `FRICTION` | `0.9` | per-step velocity retention |
| `TIMER_TICK_PERIOD` | `50` ms | one step per tick |
| charge `q` | `10.0` | hardcoded in Python |
| Coulomb `k` | `100.0` | hardcoded in Python; so `k·q² = 10000` |
| repulsion exponent | `1.9` | hardcoded in Python |

Per-node state: `position`, `translated_position`, `net_electrostatic_force`,
`net_spring_force`, `velocity`, `displacement`, `is_selected`, `idx`, `label`.
`displacement` is always identical to `velocity` (doc §3, §12.8).

Force laws, with `d = pos_A − pos_B`, `r = |d|`:

```
F_repel(A,B)  = (k·q² / r^1.9) · (d / r)          # away from B; 10000/r^1.9
F_spring(A,e) = k·(r − l) · ((pos_other − pos_A)/r)   # unit vector A -> other
F_net         = F_repel + F_spring
```

The spring uses `unit(A → other)` and `k(r − l)` with **no** sign gymnastics:
`r > l` pulls toward the neighbour, `r < l` pushes away, `r = l` is zero.

Integrator, per node, per tick:

```
v_new = v_old · FRICTION + F_net · TIME_STEP
x_new = x_old + v_new
```

Velocity is updated before position (semi-implicit/symplectic Euler). The step
is clamped nowhere; the model square is not enforced.

Per-step pipeline (doc §6), Jacobi-style — every node reads a frozen snapshot:

```
1. for all nodes: net_electrostatic_force = f(positions)      O(N^2)
2. for all nodes: net_spring_force        = f(positions)      O(N*E)
3. for all nodes: velocity                = v*friction + F_net*time_step
4. for all nodes: displacement            = velocity
5. for all nodes: position += displacement
       except a dragged node: velocity is zeroed and position is not advanced
6. for all nodes: translated_position     = translate(position)
```

Rendering is separate from stepping.

Resulting behaviour the doc predicts and that any port must reproduce:
a single edge settles at `r* ≈ 65.46` model units (doc §9), not at `l = 30`;
per-step decay for an underdamped mode is `√FRICTION ≈ 0.9487`; and the
terminal per-step displacement under a constant force is exactly `F` because
`TIME_STEP / (1 − FRICTION) = 1`.

---

## 3. Difference analysis

### 3.1 Summary

| # | Dimension | Reference (pygforce) | cuniform today | Severity |
| --- | --- | --- | --- | --- |
| 1 | Velocity + damping | `v = v·0.9 + F·0.1`, then `x += v` | **no velocity at all**; `x += F` | critical |
| 2 | Spring sign when compressed | pushes away (`k(r−l)` with `unit(A→other)`) | **always pulls** (sign swap cancels) | critical |
| 3 | Repulsion exponent | `r^-1.9` | `r^-2.0` | high |
| 4 | Repulsion magnitude | `10000/r^1.9` | `45000/r²` | high |
| 5 | Rest length `l` | `30` | `40` | medium |
| 6 | Model space | `600 × 600` | `2000 × 1236` (golden ratio) | medium |
| 7 | Boundary | none — nodes may leave the canvas | `enforcePositionLimits` clamps every step | high |
| 8 | Canvas mapping | fixed `700 × 700`; uniform scale | DOM-derived, non-square; axis-wise scale | medium |
| 9 | Pipeline | 6 passes incl. velocity; render separate | 4 passes; clamp inserted; render inside `iterate` | high |
| 10 | Drag pinning | zeroes the dragged node's velocity | empty `{}` branch (nothing to zero) | high (dependent on 1) |
| 11 | Graph seeding | sparse, `randint(1, branching)` edges per node | complete graph `K_n`, `branching` ignored | high |
| 12 | Tick period | `50 ms` | `50 ms` | — matches |
| 13 | `springConstant` | `0.1` | `0.1` | — matches |
| 14 | `translate`/`reverse`, y-flip, centre origin | affine, `w1/w0`, `h1/2 − y` | identical formulas | — matches |
| 15 | `r == 0` guard | `continue` (after `sqrt`) | `continue` (on `r2`) | — equivalent |
| 16 | Net force = repulsion + spring | plain sum | plain sum | — matches |

Already-matching items are listed so the implementer does not "fix" them.

### 3.2 Detail and evidence

#### 1. No velocity, no damping, no time step — the headline defect

`src/ForceDirectedGraph.ts:276-290` (`displacementAtNode`) returns the net force
directly:

```ts
const nX = e.x + s.x;
const nY = e.y + s.y;
const displacement = {x:nX, y:nY};
```

`Tag` (`src/Tag.ts:12-20`) has no `velocity` field. `K.physics` has no
`friction` and no `timeStep`. The update loop (`:325-334`) is therefore
`x += F_net`: explicit Euler with `dt = 1`, mass `1`, and zero damping. The
in-source comment `// ERROR - DISPLACEMENT IS ! USING VELOCITY` at `:278` is an
accurate description of the gap.

Measured on a 10-node graph, 500 ticks, using the real classes with the real
clamp applied: last-tick maximum node travel **230.2** model units, and mean
maximum travel over ticks 400–500 of **379.7**. It never converges — it is a
sustained oscillation, not a relaxation.

The same harness running the reference integrator on a sparse 10-node graph
reaches a last-tick maximum travel of **0.96** and a mean of **0.37** over the
final 100 ticks.

#### 2. The spring force is always attractive

`src/ForceDirectedGraph.ts:221-251`:

```ts
var scalar_force = -k * (l - r);        // == k*(r-l)
if(scalar_force < 0) { tag_A = tag;       tag_B = other_tag; }
else                 { tag_A = other_tag; tag_B = tag; }
var deltaX = tag_A.position.x - tag_B.position.x;
var Fx = scalar_force * (deltaX / r);
```

The swap flips the direction vector exactly when `scalar_force` flips sign, so
the two sign changes cancel and the result always points **toward** the
neighbour. Measured with `l = 40`, `k = 0.1`, tag at origin and neighbour at
`+x`:

| `r` | `Fx` measured | direction | reference expects |
| --- | --- | --- | --- |
| `100` | `+6.000` | toward (attraction) | `+6.000` toward ✓ |
| `40` | `0.000` | none | `0` ✓ |
| `10` | `+3.000` | **toward (attraction)** | `−2.000` **away** ✗ |

So compressed edges never push. This is a real physics divergence, not a
dead-code artefact.

> **This contradicts `BUGFIX_PLAN.md` §5.3**, which claims the swap "cancels out
> exactly" and that deleting it is behaviour-preserving, leaving
> `deltaX = x_tag - x_other`. Deleting the swap simply inverts the whole law
> (repulsion when stretched, attraction when compressed). Neither form matches
> the reference. See §4.

#### 3–4. Repulsion exponent and magnitude

`src/ForceDirectedGraph.ts:171`:

```ts
var scalar_force = K.physics.scalarForceConstant * K.physics.nodeCharge * K.physics.nodeCharge / (r * r);
```

With `scalarForceConstant = 200` and `nodeCharge = 15` that is `45000/r²`.
Measured against both formulae:

| `r` | cuniform measured | `45000/r²` | reference `10000/r^1.9` |
| --- | --- | --- | --- |
| `10` | `450.0000` | `450.0000` | `125.8925` |
| `50` | `18.0000` | `18.0000` | `5.9150` |
| `100` | `4.5000` | `4.5000` | `1.5849` |
| `300` | `0.5000` | `0.5000` | `0.1965` |

Both the exponent (`2` vs `1.9`) and the coefficient differ. Because the spring
is linear and the repulsion is a power law, the equilibrium distance is
sensitive to both: reference `r* ≈ 65.46` in a 600-unit world, cuniform
`r* ≈ 92.6` in a 2000-unit world (4.6 % of width vs the reference's 10.9 %).
The cuniform graph also collapses toward the clamp walls.

#### 5–6. Rest length and model space

`K.ts:5` has `equilibriumDisplacement = 40` (reference `30`); `K.ts:16-17` has
`W_0 = 2000`, `H_0 = 2000/1.618 ≈ 1236.06` (reference `600 × 600`). Changing the
world size without rescaling the force constants changes `r*`
non-linearly — the exponent is not scale-free — so these must be decided
together (§7).

#### 7. Boundary clamping has no counterpart in the reference

`src/ForceDirectedGraph.ts:349-364` (`enforcePositionLimits`), invoked at `:336`
inside `iterate()`:

```ts
if (node.position.x < - ((K.space.W_0 / 2) - minorMargin)) ...
else if (node.position.x > ((K.space.W_0 / 2) - rightMargin)) ...
```

Two problems relative to the reference:

- the reference has **no** boundary handling at all (doc §2, §12.1). Isolated
  nodes and detached components drift away; that is documented behaviour.
- the cuniform clamp is also asymmetric (`rightMargin = 50` vs
  `minorMargin = 15`, `K.ts:19-20`), so the right wall sits 35 units closer than
  the left. Clamping injects energy each tick and creates wall-pinned artefacts
  that the reference never exhibits.

#### 8. Canvas mapping

`reverse`/`translate` (`:18-48`) match the reference formula exactly, including
the y-flip. The difference is in the inputs: the reference feeds a square
`700 × 700` canvas, so `w1/w0 == h1/h0` and the scale is uniform. cuniform sizes
the canvas from the DOM (`UIController.initialize`, `:228-232`) and passes
`canvas.width`/`canvas.height` (`:342`), so unless the canvas happens to have
the model's aspect ratio the two axis scales differ and the drawing is
anisotropically stretched. Angles — and therefore the apparent force directions
— are distorted.

#### 9. Pipeline shape

`step()` in the reference performs six ordered passes and leaves drawing to
`render()`. cuniform's `iterate()` (`:292-347`) performs four (electrostatic,
spring, displacement, position), then inserts `enforcePositionLimits`, then
translates, then **calls `drawToContext` at `:346`**. Consequences:

- no velocity pass exists (item 1);
- the solver cannot be stepped headlessly without a canvas, which blocks the
  Phase 1 tests;
- the clamp pass is part of the physics rather than the boundary policy.

The existing ordering *is* Jacobi-style (all electrostatic, then all spring,
then all updates), which is correct and should be preserved.

#### 10. Drag pinning

`src/ForceDirectedGraph.ts:327-333`:

```ts
if (tag.isSelected && window.state.b0Down) {
}
else { ...position += displacement... }
```

The empty branch discards the integrated position, which matches the reference's
"pin". But the reference also sets `tag.velocity = (0.0, 0.0)` in that branch
(doc §7; `force_directed_graph.py:248-251`) so releasing the mouse does not fling
the node with accumulated momentum. Once a velocity exists (item 1) this branch
must zero it. The `window.state` read is also the blocker called out in
`BUGFIX_PLAN.md` §5.1.

Note: the reference also places the node centre directly at the reversed pointer
position (`graphical_event_manager.py:126-127`), with no grab offset, so
`BUGFIX_PLAN.md` §5.5 (drag jump) is faithful reference behaviour, **not** a
physics-alignment defect. And the reference gates the drag on the middle button
(`b1_down`), cuniform on the left (`b0Down`); either is a UI choice, not physics.

#### 11. Graph seeding changes the layout

`src/GraphFactory.ts:45-57` links every new node to every existing node, so
`generateGraph(10, 1)` yields a complete `K10` with 45 edges and
`maxEdgesPerVertexPerPass` is never read. Measured: `generateGraph(10,1)` → 45
edges, `generateGraph(10,5)` → 45 edges. The reference
(`graph_manipulator.py:45-76`) adds `randint(1, branching)` random edges per
node — sparse, typically 10–20 edges for 10 nodes. Because spring force is not
degree-normalised (doc §4.2), a `K10` where every node has degree 9 is a
qualitatively different system, and the doc's §9 equilibrium table no longer
describes it. Graph generation must be fixed before layout quality can be
judged. (This is `BUGFIX_PLAN.md` §3.2.)

The dedup defect (`BUGFIX_PLAN.md` §3.1, `GraphFactory.ts:16-19`) is real —
`indexOf` on a fresh object literal is always `-1` — but is currently masked:
continuous uniform sampling made all **200/200** positions unique in a 200-node
run. Low priority; fix opportunistically.

#### Minor / already-matching

- Timer period `50 ms` matches (`K.ts:8`).
- `springConstant = 0.1` matches (`K.ts:4`).
- Selection radius differs in absolute terms (`50` vs `15`) but both are
  **2.5 %** of their model width (`50/2000`, `15/600`), so the on-screen hit
  area matches. It must be rescaled if the model space changes (Phase 3).
- `Tag.xy` (`src/Tag.ts:12`) duplicates `position` and is unused; `Tag` lacks
  `velocity`. Field naming (`netSpringForce` vs `net_spring_force`) is cosmetic.
- The reference mutates the graph every 5 s in the demo
  (`graphical_event_manager.py:180-228`); cuniform does not. That is demo
  behaviour, not core physics, and is out of scope.

---

## 4. Corrections to `BUGFIX_PLAN.md`

`BUGFIX_PLAN.md` is a good defect inventory, but three of its physics
conclusions must be corrected before it is used as the basis for this
refactor.

1. **§5.3 is wrong.** It states the `tag_A`/`tag_B` swap "cancels out exactly"
   and is "equivalent to `deltaX = x_tag - x_other`", so deleting it is
   behaviour-preserving. Measured behaviour: the swap makes the spring **always
   attractive**; deleting it inverts the law. The reference form is
   `scalar = k(r − l)` with the unit vector `A → other` and no swap. Fixing this
   is a **behaviour change**, and needs its own acceptance test.
2. **§1.1's arithmetic is misleading.** It says the current update reduces to
   `r += -200·(r - 40)`; `200` is `scalarForceConstant`, the *repulsion*
   coefficient. The per-edge spring gain is `springConstant = 0.1` (up to ~0.9
   for a degree-9 node in `K10`). The instability is real — measured above — but
   the stated cause and number are not the mechanism.
3. **§1.1's proposed fix diverges from the reference.** It proposes
   `mass`, `dt`, `damping`, `maxSpeed`, `maxForce`, and pseudocode
   `v += F/mass*dt; v *= (1-damping); v = clamp; p += v*dt`. The reference has
   no mass, no speed or force clamp, and applies `TIME_STEP` **once**, inside
   the velocity update (`v = v·FRICTION + F·TIME_STEP; x += v`) — the proposed
   pseudocode applies `dt` a second time on the position update. For an
   alignment task, use `FRICTION`/`TIME_STEP`, not a damper-plus-double-dt.
   Fruchterman–Reingold temperature remains available as a Phase 6 extension.
4. **§5.5 is not a physics defect.** Direct cursor-to-node assignment matches
   the reference.
5. **§3.1 dedup** is currently masked by continuous sampling (200/200 unique).

---

## 5. Workplan

Ordered so that each phase is independently verifiable, and so that retuning
(Phase 3) happens only after the integrator (Phase 1) and force laws (Phase 2)
are correct — otherwise tuning masks bugs, as `BUGFIX_PLAN.md` itself warns.

### Phase 0 — Headless harness and baseline

| # | Change | File |
| --- | --- | --- |
| 0.1 | Make the solver runnable without a canvas: split `iterate` into `step()` (physics only) and `render()`/`drawToContext`; `step()` must not read `window.state` (see 4.2). | `src/ForceDirectedGraph.ts` |
| 0.2 | Add a headless test entry point. **Do not rely on the pinned `ts-node@9`:** it is incompatible with the pinned `typescript@4.9.5` and aborts with `Non-string value passed to ts.resolveTypeReferenceDirective`. Use `tsc` to a temp dir + `node`, or upgrade `ts-node`. | `package.json`, `test/` |
| 0.3 | Record the Phase 3 (§3) baseline numbers as a failing test fixture. | `test/physics.baseline.test.ts` |

**Acceptance:** `npm run build` (typecheck) passes; the physics tests run
headlessly with no DOM stub; the current solver is shown to fail the Phase 1
criteria.

### Phase 1 — Integrator: velocity + damped semi-implicit Euler

| # | Change | File |
| --- | --- | --- |
| 1.1 | Add `velocity: Point2D` to `Tag`. Either drop `displacement` or make it a read-only alias of `velocity` — the reference doc (§12.8) recommends collapsing them. | `src/Tag.ts` |
| 1.2 | Add `friction: 0.9` and `timeStep: 0.1` to `K.physics`. | `src/K.ts` |
| 1.3 | Replace `displacementAtNode` with `velocityAtTag`: `v = v*friction + F_net*timeStep`; displacement is that velocity. | `src/ForceDirectedGraph.ts:276-290` |
| 1.4 | Add the velocity pass between the force passes and the position pass, preserving Jacobi ordering (all forces → all velocities → all positions). | `src/ForceDirectedGraph.ts:292-347` |
| 1.5 | In the drag-pin branch, set the dragged node's velocity to zero instead of the empty `{}`. | `src/ForceDirectedGraph.ts:327-333` |
| 1.6 | Add a test asserting the stability invariant `timeStep/(1-friction) ≈ 1`. | `test/integrator.test.ts` |

**Acceptance (regression tests):**

- a single node under a constant force `F` reaches a terminal per-step
  displacement of exactly `F` (`F·dt/(1−f) = F`);
- the single-edge system settles at `r*` within 2 % of the analytic root;
- after 500 ticks on a sparse 10-node graph, the mean maximum per-step travel
  over ticks 450–500 is `< 1.0` model unit;
- linearised decay of an underdamped mode matches `√FRICTION ≈ 0.9487`.

### Phase 2 — Force laws

| # | Change | File |
| --- | --- | --- |
| 2.1 | Repulsion: add `repulsionExponent: 1.9` to `K.physics`; use `Math.pow(r, K.physics.repulsionExponent)`. | `src/K.ts`, `src/ForceDirectedGraph.ts:171` |
| 2.2 | Set the repulsion coefficient to the reference `k·q² = 100`·`10² = 10000` (either set `nodeCharge = 10`, `scalarForceConstant = 100`, or collapse to one fully-documented coefficient). | `src/K.ts` |
| 2.3 | Spring: remove the `tag_A`/`tag_B` sign swap; compute `scalar = k*(r - l)` and `unit = (other - tag)/r`, so compressed edges push. | `src/ForceDirectedGraph.ts:221-251` |
| 2.4 | Keep the exact `r == 0` guard (matches the reference). Denominator softening stays a Phase 6 option. | `src/ForceDirectedGraph.ts:163, 218` |
| 2.5 | Set `equilibriumDisplacement = 30`. | `src/K.ts:5` |

**Acceptance (regression tests):** repulsion equals `10000/r^1.9` to `1e-9` at
several radii; with `l = 30`, a neighbour at `r = 45` pulls toward it
(`Fx > 0`) and a neighbour at `r = 10` pushes away (`Fx < 0`), each with
magnitude `0.1·|r − 30|`.

### Phase 3 — World, constants, boundary

| # | Change | File |
| --- | --- | --- |
| 3.1 | Adopt the reference model space: `W_0 = H_0 = 600`. | `src/K.ts:16-17` |
| 3.2 | Remove `enforcePositionLimits` and its call, matching the reference's "no boundary handling". (If a boundary is wanted, it belongs in a separate, explicitly non-reference extension — see Phase 6 and §7.) | `src/ForceDirectedGraph.ts:336, 349-364` |
| 3.3 | Make canvas mapping uniform and centred so the physics is not anisotropically distorted: `s = min(canvasW/W_0, canvasH/H_0)`. | `src/ForceDirectedGraph.ts:18-44` |
| 3.4 | Rescale `minimumNodeSelectionRadius` to `15` to preserve the current 2.5 %-of-width hit area. | `src/K.ts:12` |
| 3.5 | Decide whether `rightMargin`/`minorMargin` are deleted with 3.2. | `src/K.ts:19-20` |

**Acceptance:** with reference constants, a two-node single edge settles at
`65.46 ± 2 %` in the running app; a 10-node sparse graph occupies a visually
sensible fraction of the canvas (the documented `r*` is 10.9 % of width); the
canvas is not stretched by changing the window's aspect ratio.

### Phase 4 — Pipeline and coupling

| # | Change | File |
| --- | --- | --- |
| 4.1 | `step()` performs the six reference passes; `render()` is called only by the UI tick. | `src/ForceDirectedGraph.ts:292-347`, `src/UIController.ts:140-142` |
| 4.2 | Remove the `window.state` read: pass a `pinned: (tag) => boolean` (or the `b0Down` flag) into `step()`. | `src/ForceDirectedGraph.ts:327`, `src/UIController.ts` |
| 4.3 | Keep the Jacobi ordering and add a permutation test proving the result is independent of `graph.vertices` order. | `test/pipeline.test.ts` |
| 4.4 | Confirm drag semantics: pointer → `position` on move, pin + zero velocity in `step()`. No grab offset is added (matches the reference). | `src/UIController.ts:44-63` |

**Acceptance:** the solver runs with no DOM at all; shuffling the vertex array
leaves one step's resulting positions bit-identical.

### Phase 5 — Graph seeding (prerequisite for judging layout)

Cross-references `BUGFIX_PLAN.md` §3.1–3.2.

| # | Change | File |
| --- | --- | --- |
| 5.1 | Implement the documented behaviour: each node gets `randint(1, branching)` random, non-duplicate, non-self edges. Rename the parameter to match. | `src/GraphFactory.ts:33-60` |
| 5.2 | Set `initialConditions` to the reference demo (`order: 11`, `branching: 2`). | `src/K.ts:29-32` |
| 5.3 | Fix position dedup by value; decide whether the constraint is worth keeping given continuous sampling. | `src/GraphFactory.ts:8-31` |

**Acceptance:** `edges.length <= order · branching`; `generateGraph(50, 2)` is
fast; all seeded positions unique (or the constraint is explicitly dropped with
a comment).

### Phase 6 — Optional extensions (explicitly *not* the reference) — ⬜ Not implemented (deliberate)

Do not fold any of these into Phase 1–5 PRs. Each is a deliberate divergence
from the reference doc and should be a separate, clearly-labelled change:

- centring / weak centripetal force (doc §12.1);
- Fruchterman–Reingold temperature or a per-step velocity/displacement clamp
  (doc §12.2);
- denominator softening `r² + ε` (doc §12.3);
- degree-normalised or per-edge-weighted springs (doc §12.5);
- Kamada–Kawai per-pair rest lengths (doc §12.6);
- `O(E)` spring accumulation and Barnes–Hut repulsion (doc §12.7).

---

## 6. Definition of done

The refactor is complete when, on a sparse graph with the reference constants:

1. `grep` finds no `window` reference inside the solver;
2. `F_repel` matches `10000/r^1.9` and `F_spring` changes sign at `r = l`;
3. the per-step update is `v = 0.9v + 0.1F`, `x += v`, with the dragged node
   pinned and its velocity zeroed;
4. a two-node edge settles at `r* ≈ 65.46`;
5. a 10-node graph converges (mean maximum per-step travel `< 1.0` over the
   final 50 of 500 ticks);
6. there is no boundary clamp and no velocity/force clamp in the physics path;
7. the model→canvas transform is uniform and centred.

Items 4 and 5 are already reproduced by a standalone model of the reference
(measured `65.46` and `0.96`), so they are known-achievable targets.

---

## 7. Open decisions for the maintainer

Decision 1 is settled; the rest remain open.

1. **World size vs canvas — DECIDED.** Adopt the reference's fixed `600 × 600`
   model space and scale it **uniformly** to the DOM-sized canvas
   (`s = min(canvasW/W_0, canvasH/H_0)`, centred). Physics is then identical to
   the reference doc while the web canvas stays responsive and undistorted.
   Phase 3.1 and 3.3 implement this; the literal `700 × 700` alternative is
   rejected.
2. **Boundary.** Match the reference by deleting the clamp (recommended for an
   alignment task), or keep a boundary but implement it as the reference doc's
   suggested centring force, clearly marked as an extension?
3. **Repulsion coefficients.** Keep the reference's two separate knobs
   (`scalarForceConstant = 100`, `nodeCharge = 10`, exponent `1.9`) for
   traceability, or collapse `k·q²` into one documented `repulsionConstant =
   10000`?
4. **`displacement` field.** Collapse it into `velocity` (doc §12.8
   recommendation) or keep both to mirror the reference field-for-field?
5. **Graph seeding.** Keep the reference's sparse random generation, or adopt
   the jittered-grid seeding floated in `BUGFIX_PLAN.md` §3.1? The former is
   required to reproduce doc §9's numbers; the latter is a genuine improvement
   but a divergence.
6. **Test runner.** Upgrade the incompatible `ts-node`/`typescript` pair, or
   keep the toolchain pinned and run compiled tests under `node --test`?

---

## 8. Suggested PR sequence

Focused PRs, per the working agreement. Each builds on up-to-date `main`.

1. **PR 1 — Phase 0.** Headless solver split + test harness. No behaviour
   change except that `step()` no longer draws.
2. **PR 2 — Phases 1–2.** Integrator and force laws, with the §6 acceptance
   tests. Highest risk; land alone and retune nothing yet.
3. **PR 3 — Phase 3.** Model space, uniform canvas mapping, boundary removal,
   selection radius.
4. **PR 4 — Phase 4.** Pipeline separation, `window.state` removal,
   order-independence test.
5. **PR 5 — Phase 5.** Sparse graph generation and constants.
6. **PR 6 —** update `BUGFIX_PLAN.md` per §4 (or fold the corrections into
   PR 2's description), and update `README.md` with the physics summary.

Phases 1 and 2 may be split if the spring-sign change is felt to deserve its
own reviewable diff; it is the only change that outright changes layout
topology, and it warrants a dedicated regression test either way.
