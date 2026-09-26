# P1 — 3D model, perspective projection onto the 2D canvas

| | |
| --- | --- |
| **Status** | Implemented |
| **Landed** | PRs #63–#66; `main` green at 201 tests |
| **Area** | new `src/Point3D.ts`, new `src/Projector.ts`, `src/Tag.ts`, `src/GraphFactory.ts`, `src/ForceDirectedGraph.ts`, `src/Renderer.ts`, `src/Selection.ts`, `src/UIController.ts`, `src/State.ts`, `src/K.ts`, `src/Viewport.ts`, `README.md`, `test/**` |
| **Depends on** | nothing outstanding — H1 and M1–M6 are landed and `main` is green |
| **Blocks** | nothing |

## 1. Goal

Model the graph — node positions, velocities and both force kernels — in three
dimensions, then render it by projecting that 3D model through a **perspective
camera onto the 2D canvas**. The reference physics is preserved exactly; only the
space it runs in, and the way that space is viewed, change.

Out of scope is enumerated in §8.

## 2. Decisions of record

These were chosen deliberately before implementation. The plan is built around
them and they are not reopened by individual PRs.

| # | Decision | Choice |
| --- | --- | --- |
| D1 | Projection | **Perspective** |
| D2 | Camera orientation | **User orbit on middle-drag**; pan moves to **Shift+middle** |
| D3 | Node drag | **View-plane drag at the node's current depth** |
| D4 | Pan | Translates the **camera target** |
| D5 | World | **Cube, 600 × 600 × 600** |

Why these, briefly, because each has a cheaper alternative that was rejected:

- **Perspective over orthographic (D1).** Perspective is the only projection
  that gives a genuine depth read without per-node styling: nearer nodes are
  larger and move faster under orbit. The cost is a divide, a near-plane
  singularity and a depth-dependent inverse, all of which are bounded below.
- **Orbit on middle-drag (D2).** Left-drag is node selection and drag, and
  right-click is the context menu; middle-drag is the only pointer gesture whose
  current job (pan) can move to a modifier without losing a gesture entirely.
- **View-plane drag (D3).** A screen point is a ray in 3D, so dragging needs a
  policy. Unprojecting onto the plane through the node's current depth is exactly
  invertible, matches the pixel the user is pointing at, and never teleports the
  node in depth.
- **Pan the camera target (D4).** The alternative — translating every node, as
  today — writes view state into the physics model and makes a pan change the
  step the integrator subsequently takes. Panning the camera leaves the model
  untouched.
- **A 600³ cube (D5).** The direct generalisation of the current 600×600 square,
  and isotropic, so the layout has no preferred plane.

## 3. Why the change is tractable

The physics is already written in a dimension-agnostic shape. Both force kernels
are **purely radial**: the magnitude is a function of the scalar distance `r`
only, and the direction is the unit vector along the separation. There is no
2D-specific term anywhere.

`src/ForceDirectedGraph.ts` funnels every force site through two helpers:

- `addRadial(Fx, Fy, dx, dy, r, magnitude)` — superposes a direction and a
  magnitude;
- `repulsionMagnitude(r)` — depends only on `r`, and is **unchanged** in 3D.

So the kernel change is a third component and a third argument to `Math.hypot`.
Everything else follows per axis.

The genuinely new work is on the **rendering and interaction** side of the seam:
the camera, the projection, depth ordering, and the fact that the pointer → model
mapping stops being invertible. That is where the risk in this plan lives.

A second property makes the change reviewable: the 2D look is a **special case**
of the 3D pipeline. With an identity camera (`yaw = pitch = 0`), a focal length
equal to the camera distance, and `z = 0` for every node, perspective projection
reduces exactly to the current `Viewport.toCanvas` mapping (§4.3). Every PR below
can therefore be checked against today's output before 3D is switched on.

## 4. Design

### 4.1 Model space and the type boundary

`Point2D` stays exactly as it is, and keeps its meaning: **canvas space**. A new
`Point3D` (`src/Point3D.ts`, with `point3()` / `zero3()` factories in the same
factory-not-constant style as `point()` / `zero()`) becomes **model space**.

Keeping the two types distinct is not ceremony — it is the enforcement mechanism.
The rule becomes "a model point can only reach the canvas through the projector",
and the compiler finds every violation. That is worth the mechanical churn.

`Tag` moves its model state to 3D and keeps its canvas cache 2D:

```ts
position: Point3D;            // was Point2D
velocity: Point3D;            // was Point2D
translatedPosition: Point2D;  // unchanged: canvas space
depth: number = 0;            // new: view depth from the last projection, for
                              // painter ordering and hit-test tie-breaks
```

`displacement` is still the read-only alias of `velocity`. The `step()` comment
that forces are deliberately not cached on `Tag` still holds.

### 4.2 Force kernels

`addRadial` grows a `z` term; `repulsionMagnitude` is untouched.

```ts
private static addRadial(
    Fx: number, Fy: number, Fz: number,
    dx: number, dy: number, dz: number,
    r: number, magnitude: number
): Point3D {
    if (r === 0)
        return point3(Fx, Fy, Fz);

    return point3(
        Fx + (magnitude * dx) / r,
        Fy + (magnitude * dy) / r,
        Fz + (magnitude * dz) / r
    );
}
```

`Math.hypot(dx, dy)` becomes `Math.hypot(dx, dy, dz)`. `Math.hypot` is variadic,
so this is one extra argument, and it preserves the `test/forces.test.ts`
instrumentation test that counts `Math.hypot` calls per step (`C(5,2) = 10` on
five unconnected nodes). Switching to `Math.sqrt(dx*dx + dy*dy + dz*dz)` would be
faster but would break that test, so it is not part of this plan.

The rest is mechanical:

- `netElectrostaticForceAtNode`, `accumulateRepulsion`, `netSpringForceAtNode`,
  `netForceAtNode` — add a `z` accumulator and a `dz` term.
- `velocityAtTag` — `vz_new = vz_old * friction + f.z * timeStep`.
- `step()` PASS 1–3 — `Point3D[]` for the force and velocity arrays, `zero3()`
  instead of `zero()`, and `position.z` advances with the same displacement.

Two 3D-specific points:

1. **The coincident-pair tie-break.** Today, exactly coincident nodes substitute
   the unit vector `(-1, 0)` / `(1, 0)`, earlier node to `-x`. In 3D this becomes
   `(-1, 0, 0)` / `(1, 0, 0)`, and it must stay **identical** in
   `netElectrostaticForceAtNode` and `accumulateRepulsion`: the existing
   equivalence test requires the paired pass to be bitwise-equal to the per-node
   reference. Note that this biases the separation onto the `x` axis for what is
   a measure-zero event; the bias is acceptable and is documented rather than
   changed here.
2. **"Coincident" now means all three deltas are zero.** A pair agreeing in
   `(x, y)` but differing in `z` is an ordinary radial case and needs no special
   handling. Tests must not conflate the two.

Stability is unchanged. The integrator is a per-axis damped semi-implicit Euler,
so `timeStep / (1 - friction) = 1` and the single-edge `r* ≈ 65.46` equilibrium
both survive; a single edge settles at the same distance in 3D.

### 4.3 The perspective camera and projector

A new `src/Projector.ts` owns the camera and the projection, and composes the
existing `Viewport` for the final scale and y-flip. `Viewport` itself is not
rewritten: it remains the 2D linear map, and its tests stand.

```
model (Point3D)  --Projector-->  projected plane (Point2D + depth)  --Viewport-->  canvas (Point2D)
```

The projector is **pure math and DOM-free**, so `step()` can keep calling it
without importing a canvas type — `test/pipeline.test.ts` asserts the solver
names no `CanvasRenderingContext2D`, and the extended architecture guard in §6
asserts the projector is clean too.

**Camera state** (defaults in `K.camera`, live values held by the controller):

| Field | Meaning |
| --- | --- |
| `yaw`, `pitch` | orientation, radians |
| `target: Point3D` | the point the camera looks at; pan moves this (D4) |
| `distance: number` | camera → target along the view axis; wheel dollies this |
| `focalLength: number` | model units; constant |
| `nearPlane: number` | depth below which a node is culled |

**Rotation**, `R = Rx(pitch) · Ry(yaw)` applied to `p - target`:

```
cy = cos(yaw),  sy = sin(yaw),  cp = cos(pitch),  sp = sin(pitch)

dx = p.x - target.x ;  dy = p.y - target.y ;  dz = p.z - target.z

vx =  dx*cy + dz*sy
z1 = -dx*sy + dz*cy
vy =  dy*cp - z1*sp
z2 =  dy*sp + z1*cp
```

**Projection.** The camera sits at `(0, 0, -distance)` in view space, so the
depth along the view axis is `d = z2 + distance`:

```
dEff = max(d, nearPlane)                 // the perspective singularity guard

screen.x = focalLength * vx / dEff
screen.y = focalLength * vy / dEff
depth    = d                             // smaller is nearer
```

`screen` is in the projected plane's model units and is passed to
`Viewport.toCanvas` unchanged.

**Inverse, at a chosen depth** (used by drag and pan):

```
vx  = screenModel.x * d / focalLength
vy  = screenModel.y * d / focalLength
z2  = d - distance
p   = target + Rᵀ · (vx, vy, z2),      Rᵀ = Ry(-yaw) · Rx(-pitch)
```

**The near plane is the analogue of `minimumInteractionRadius`.** Perspective is
singular as `d → 0`, exactly as repulsion is singular as `r → 0`. `dEff` bounds
the blow-up for the passing side, and nodes with `d <= nearPlane` are **culled
from rendering and hit-testing only** — the camera never reaches the physics, so
a culled node still exerts and feels force. This is a documented, bounded,
non-reference extension in the same spirit as the existing repulsion guard.

**The regression anchor.** With `yaw = pitch = 0`, `focalLength = distance`, and
`z = 0`, the rotation is the identity, `z2 = 0`, `d = distance`, and
`screen = (vx, vy) = (x, y)`. The pipeline reduces **exactly** to today's
`Viewport.toCanvas`. This is asserted as an exact-equality test (§6), and it is
why PRs 1 and 2 keep generation on `z = 0` so the shipped demo is unchanged until
3D is deliberately switched on.

**Framing.** `Viewport` keeps its existing model extent `W_0 = 600`, so the
initial view (identity camera, `z = 0`) is pixel-identical to today. A 600³ cube
rotated has a projected diagonal of up to `√3 · 600 ≈ 1039`, so orbiting can push
nodes outside the viewport. That is consistent with the existing "nothing clamps
a node to the model square" stance and is correctable with the wheel dolly; it is
documented rather than auto-fit, because auto-fitting every frame would make the
scale breathe as the camera moves and would break the anchor. The wheel changes
`distance` only, clamped above `nearPlane`; `focalLength` is constant.

### 4.4 Depth-aware rendering

A bare projection still reads flat without occlusion cues, so `Renderer` gains
three things:

1. **Painter's algorithm.** Build one list of `{ depth, draw }` for edges *and*
   nodes, sort farthest-first, and draw in that order. An edge's representative
   depth is the mean of its endpoints. This deliberately replaces the current
   "all edges, then all nodes" order.
2. **Perspective node size.** `radiusPx = NODE_RADIUS * focalLength / depth`,
   clamped to `[K.depthCue.minNodeRadiusPx, K.depthCue.maxNodeRadiusPx]`. The
   selection ring scales identically.
3. **Depth fade.** Node and edge alpha ramp from `maxAlpha` at the near end to
   `minAlpha` at the far end, driven by `globalAlpha`.

Culling: a node with `depth <= nearPlane` is not drawn. An edge is skipped if
either endpoint is culled — no near-plane clipping in this plan (§8).

The architecture guard "the renderer is the only module that draws"
(`test/render.test.ts:136`) must stay true, which is another reason the projector
is pure math.

### 4.5 Interaction

**Orbit (middle-drag, D2).** `yaw += dx * K.camera.orbitRadiansPerPixel` and
`pitch += dy * …`, with `pitch` clamped to `±(π/2 − ε)` so the basis never
degenerates at the poles. Pan moves to **Shift+middle-drag**.

**Pan (Shift+middle-drag, D4).** Convert the pointer delta to projected-plane
model units through `Viewport.toModel`, unproject at the target's depth, and add
it to `target`. Node positions are never touched, so a pan cannot perturb the
simulation.

**Node drag (D3).** The left-button path keeps its current shape except for the
final mapping:

```ts
const phasePos = projector.unproject(mxy, vertex.depth);
for (const vertex of this.solver.graph.vertices)
    if (vertex.isSelected)
        vertex.position = point3(phasePos.x, phasePos.y, phasePos.z);
```

The node follows the cursor in the view plane through its existing depth, so
screen-space drag feels identical to today while depth is preserved. A culled
node falls back to `nearPlane` as its drag depth.

**Selection.** `handleNodeSelectionAttempt` takes the projector instead of the
viewport, projects each node, and keeps the 15 px screen-space radius
(`K.ui.minimumNodeSelectionRadiusPx`) — that constant is correct as-is. New: the
tie-break breaks by **depth**, so among nodes inside the hit radius the one
nearest the camera wins and a click selects the front node. Culled nodes are not
selectable.

**Camera lifetime.** The live camera belongs in `State` (or a `Camera` value
object owned by it) beside the existing button flags, so `reset()` rebuilds the
graph without losing the user's viewing angle. Mouse-only, matching the existing
handlers; `onMouseDown`/`onMouseMove`/`onMouseUp` gain `event.shiftKey` checks on
button 1. The context menu and keyboard menu path are untouched.

### 4.6 Constants

New entries in `src/K.ts`, in the file's existing explanatory style:

| Constant | Purpose |
| --- | --- |
| `space.D_0 = 600` | world depth; the world becomes a 600³ cube (D5) |
| `camera.focalLength` | projection focal length in model units |
| `camera.distance` | default camera distance; equal to `focalLength` for the 1:1 anchor |
| `camera.nearPlane` | cull threshold and perspective singularity guard |
| `camera.yaw`, `camera.pitch` | default orientation (both `0`) |
| `camera.orbitRadiansPerPixel` | orbit sensitivity |
| `camera.maxPitch` | `π/2 − ε`, the gimbal guard |
| `camera.minDistance` | dolly clamp, above `nearPlane` |
| `camera.dollyPerWheelNotch` | wheel zoom rate |
| `depthCue.minNodeRadiusPx`, `maxNodeRadiusPx` | perspective size clamp |
| `depthCue.minAlpha`, `maxAlpha` | depth fade range |

`README.md` needs updating in the same PRs: the Physics, Complexity and Known
limitations sections, plus a new projection/camera section, and the "2D" framing
in the title and opening line.

## 5. Phased delivery

Four focused PRs. Each is independently shippable, each leaves `main` green, and
each is reviewable against the one before it.

### PR 1 — 3D model space and force kernels

- `src/Point3D.ts` (new): `Point3D`, `point3()`, `zero3()`.
- `src/Tag.ts`: `position`/`velocity` → `Point3D`; add `depth`; constructor takes
  `Point3D`; `translatedPosition` stays `Point2D`.
- `src/ForceDirectedGraph.ts`: `addRadial` 3-component, `Math.hypot(x, y, z)`,
  all kernels, `velocityAtTag`, `step()` integrates `z`.
- `src/K.ts`: add `space.D_0`, but **`GraphFactory` keeps generating `z = 0`**.
- Tests: mechanical `z = 0` migration; new tests that an off-plane pair produces
  a `z` force of the radial law and that `z` integrates.
- **Acceptance:** `npm run ci` green; the rendered demo is pixel-identical;
  `test/pipeline.test.ts` order-independence and the exact synchronous update
  pass; a new assertion that a `z`-separated pair feels the unmodified radial
  law.

### PR 2 — Perspective projector and depth-sorted rendering

- `src/Projector.ts` (new): camera rotation, perspective projection with the
  `nearPlane` guard, `unproject(screenOrCanvas, depth)`, culling predicate. Pure
  math, DOM-free.
- `src/ForceDirectedGraph.ts`: `step()` gains
  `projector: Projector = Projector.forCanvas(canvasWidth, canvasHeight)`, a
  default so existing `step(w, h)` call sites keep compiling. PASS 4 caches
  `translatedPosition` **and** `depth`.
- `src/Renderer.ts`: painter's algorithm over edges and nodes, perspective node
  radius, depth fade.
- `test/support/dom.ts`: `FakeContext2D` records `globalAlpha`.
- Tests: the exact identity-camera/`z = 0` equivalence anchor; rotation rigor;
  `project`→`unproject` round trip; magnification; near-plane culling; painter
  order; radius scaling; fade.
- **Acceptance:** with the default identity camera and `z = 0` generation the
  demo is still pixel-identical; `render.test.ts` is updated deliberately, with
  the golden order change explained in the PR; the projector has no DOM
  references.

### PR 3 — Orbit, view-plane drag, camera-target pan, depth-aware selection

- `src/UIController.ts` + `src/State.ts`: live camera; middle-drag orbits,
  Shift+middle pans the camera target, wheel dollies; left-drag unprojects at the
  node's depth.
- `src/Selection.ts`: takes the projector; depth tie-break; culled nodes skipped.
- Tests: orbit sensitivity and pitch clamp; pan moves `target` and not node
  positions; drag round-trips a known screen point at depth; nearer node wins an
  equidistant screen tie.
- **Acceptance:** `npm run ci` green; `pan.test.ts` reworked around the new
  semantics with the behaviour change called out; selection radius still 15 px at
  every canvas scale.

### PR 4 — 3D initial conditions, tuning, docs, accessibility

- `src/GraphFactory.ts`: generate `z` uniformly in `[-D_0/2, D_0/2]`;
  `constructXYFactory` → `constructXYZFactory`; uniqueness key is the 3-tuple.
- `src/K.ts`: final camera and depth-cue tuning against the real demo.
- `README.md`: projection/camera section, Physics/Complexity/Known-limitations
  updates, remove the "2D" framing.
- `web/index.html`: `aria-label` mentions the 3D view and the orbit gesture.
- Tests: `graph-generation.test.ts` covers 3D uniqueness and bounds; convergence
  in 3D.
- **Acceptance:** 3D generation is on and the graph visibly has depth; the full
  suite is green; README matches the shipped controls.

## 6. Test plan

### New tests

| Area | Assertion |
| --- | --- |
| Projector | identity camera + `z = 0` equals `Viewport.toCanvas` **exactly** |
| Projector | rotation is rigid: pairwise model distances preserved |
| Projector | `unproject(project(p), depth(p)) == p` for random points and cameras |
| Projector | nearer points project farther from the centre (magnification) |
| Projector | `depth <= nearPlane` is culled; projection stays finite at the guard |
| Projector | pitch clamp keeps the basis orthonormal (no pole flip) |
| Projector | no `window` / `document` / canvas type (extend the `pipeline` guard) |
| Forces | an off-plane pair produces a `z` force obeying the same radial law |
| Forces | `z` integrates like `x` and `y`; coincident tie-break unchanged |
| Renderer | painter order is farthest-first across edges and nodes |
| Renderer | node radius scales with `1/depth` within the clamp |
| Renderer | a culled node is not drawn; `globalAlpha` follows the depth ramp |
| Selection | equidistant screen hits resolve to the nearer node |
| Selection | a culled node is not selectable; radius still 15 px at 300/600/1200 |
| UIController | middle-drag orbits; Shift+middle moves `target`, not positions |
| UIController | drag unprojects a known canvas point at the node's depth |

### Existing tests: expected impact

| Test | Impact |
| --- | --- |
| `forces.test.ts` | `pairAt` gains `z`; add `f.z` assertions; hypot-count still 10 |
| `convergence.test.ts` | single-edge `65.46` unchanged; multi-node travel re-verified |
| `integrator.test.ts` | `z` added to literals; per-axis maths unchanged |
| `robustness.test.ts` | radial guard unchanged; drag fixture gets a 3D policy |
| `pipeline.test.ts` | fixtures gain `z`; **DOM-freedom guards must pass untouched** |
| `transform.test.ts` | `Viewport` tests stand; the `step()` cache test goes via `Projector` |
| `selection.test.ts` | projector parameter; new depth tie-break cases |
| `pan.test.ts` | rewritten for orbit / Shift+middle pan / depth drag |
| `render.test.ts` | golden draw order changes deliberately; alpha recorder added |
| `graph.test.ts`, `hidpi.test.ts`, `solver.test.ts`, `selection-panel.test.ts`, `adjacency.test.ts`, `graph-generation.test.ts` | mechanical `z` updates |

Mechanical scale, measured on `main`: **46 `new Tag(...)` sites**, **71
`.position` references**, **19 `.velocity` references**, and 8 `Math.hypot(x, y)`
sites across `src/` and `test/`.

## 7. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Mechanical churn hides a behavioural regression | Keep `Point2D` for canvas so the compiler finds every site; PRs 1–2 keep generation on `z = 0` and the identity-camera exact-equality anchor proves the 2D path is unchanged |
| Perspective divide blows up near the camera | `dEff = max(d, nearPlane)` bounds it, plus culling; a `robustness.test.ts`-style bounded-nudge test pins it |
| 3D breaks convergence | Per-axis integrator and radial laws are unchanged; the analytic single-edge equilibrium is re-asserted in 3D and the multi-node travel tolerance is re-verified, not assumed |
| Depth sort cost | `O((N + E) log(N + E))` per frame, new but negligible at `order = 11`; recorded in the README Complexity section |
| Rebound gestures surprise users | Pan moves to Shift+middle and this is documented in the README and the canvas `aria-label`; the context menu is untouched |
| `Math.hypot(a, b, c)` is slower than 2-arg | Accept to preserve the call-count test; noted in the README next to the existing repulsion scaling note |
| Rotated cube overflows the default framing | Accepted and documented, consistent with "nothing clamps a node to the model cube"; the wheel dolly fits it, and auto-fit is rejected to keep the scale stable |
| Camera state leaking into the solver | `step()` takes a value object and stays DOM-free; the extended architecture guard fails the build if `Projector` grows a DOM reference |

## 8. Out of scope

- Orthographic projection as a selectable mode.
- A z-buffer, true edge clipping, or curved/subdivided edges.
- Spatial subdivision, a repulsion cut-off or Barnes–Hut; the `O(N²)` loop is
  unchanged apart from the extra component.
- A centring force or a world boundary. Detached components still drift; in 3D
  they can drift in depth, which the README should call out as an amplified
  version of the existing limitation rather than a new one.
- Pointer/touch-event orbit; the current handlers are mouse-based and stay so.
- Depth editing on drag (a wheel/modifier that moves a node along the view axis).
  D3 deliberately keeps drag depth-preserving.
- Persisting or animating the camera beyond the reset behaviour in §4.5.

## 9. Verification

1. `npm run ci` on every PR; test count rises each time.
2. `git diff main -- test/pipeline.test.ts` shows only `z` plumbing in PRs 1–2 —
   the DOM-freedom and Jacobi-order assertions are never edited.
3. Run the demo (`BROWSER=... ./cli run`) and exercise: orbit, Shift+middle pan,
   wheel dolly, select a front node behind another, drag in the view plane,
   export, reset.
4. Confirm PRs 1–2 leave the rendered demo visually identical (identity camera,
   `z = 0` generation), then confirm PR 4 makes the layout visibly 3D.
