# P2 — Camera console: three-axis rotate buttons in the floating panel

| | |
| --- | --- |
| **Status** | Planned |
| **Landed** | — |
| **Area** | new `src/Mat3.ts`, `src/Camera.ts`, `src/Projector.ts`, `src/K.ts`, `src/UIController.ts`, `src/entrypoint.ts`, `src/index.ts`, `web/index.html`, `web/stylez.css`, `README.md`, `test/**` |
| **Depends on** | nothing outstanding — `main` is green at 201 tests |
| **Blocks** | nothing |

## 1. Goal

Add a **camera console** to the floating overlay panel: a third section holding
three pairs of buttons that rotate the camera about its own **x**, **y** and
**z** axes, clockwise and anticlockwise:

```
camera
x  ↻  ↺
y  ↻  ↺
z  ↻  ↺
```

Each click applies one fixed rotation step. The axes are the **camera's own
frame axes as the viewer sees them on screen** (x right, y up, z along the view
axis), not the fixed model axes — so a button pair always reads as "rotate the
view this way", whatever the current orientation. This is the interpretation
recorded as D1 in §2.

Out of scope is enumerated in §8.

## 2. Decisions of record

| # | Decision | Choice |
| --- | --- | --- |
| D1 | Rotation frame | **Camera/screen frame** — each pair rotates about the camera's own x, y or z axis |
| D2 | Press behaviour | **One fixed step per click**; buttons are keyboard-activatable natively |
| D3 | Camera representation | **A 3×3 rotation matrix** as the single source of truth, replacing the `yaw`/`pitch` angles |
| D4 | z pair | **Roll about the view axis** — the third degree of freedom the yaw/pitch camera did not have |
| D5 | Console placement | A **third section** in the existing floating panel, after the selected-node section |
| D6 | Wiring | **Event delegation**: one `click` listener on the console container reads `data-axis` / `data-direction` |
| D7 | Step size | `K.camera.rotateStepRadians = Math.PI / 12` (15°), tuned in the same PR that ships the buttons |

Why these, briefly, because each has a cheaper alternative that was rejected:

- **Camera frame over model frame (D1).** Rotating about the fixed model axes
  means that after a 90° turn the "x" buttons yaw the model instead of tilting
  it, which reads as the wrong control. The camera frame is what "rotate about
  x" means to a viewer looking at the screen.
- **A rotation matrix over Euler angles (D3).** This is the load-bearing
  decision, argued in §3: a camera-frame rotation is a **left-multiplication**
  of the world→camera rotation, and the yaw/pitch parameterisation is not closed
  under that operation.
- **One step per click over press-and-hold (D2).** Predictable, needs no repeat
  timer and no pointer-capture teardown, and every step is exactly testable.
  Hold-to-repeat can be added later without changing the handler contract.
- **Delegate over six listeners (D6).** `toggleEventListeners()` derives detach
  from the same lines as attach, so six per-button closures would each need a
  stable handler identity. One delegated listener on the container keeps that
  contract. A click on a button bubbles to the container and `event.target`
  carries the data attributes.

## 3. Why this needs a new camera representation

The shipped camera is two Euler angles, `R = Rx(pitch) . Ry(yaw)`
(`src/Projector.ts`), with `pitch` clamped just inside the poles. It has no
third degree of freedom, so **"rotate about z" is impossible without adding
roll** — this is the one place the feature is not additive.

The obvious minimal extension is a third Euler angle,
`R = Rz(roll) . Rx(pitch) . Ry(yaw)`. It is rejected, because the button pairs
must rotate about the camera's own axes, and an Euler triple is only closed
under left-multiplication by its **outermost** factor. Concretely, with
`M = Rz(c) . Rx(b) . Ry(a)`:

- incrementing `c` (roll) is exactly `M <- Rz(dc) . M` — a camera-frame rotation;
- incrementing `b` (pitch) is a rotation about `Rz(c) . x`, which equals the
  camera's x axis only while `roll = 0`;
- incrementing `a` (yaw) is a rotation about **world** Y, which equals the
  camera's y axis only while `pitch = 0`.

So two of the three pairs would only be camera-frame in special cases, and once
a roll had been applied the x/y pairs would tilt about a visibly wrong axis.

The minimal representation that **is** closed under camera-frame rotation is a
rotation matrix `M` (world → camera): rotating the camera about its own axis `e`
by angle `θ` is `M <- R_e(θ) . M`, for any current `M`. That is the whole
argument for D3.

The same change buys a second fix. The old `pitch` clamp exists so the yaw/pitch
basis never reaches the poles; with a full matrix there is no basis degeneracy,
so button rotation can be a free 3-DOF rotation. The clamp survives only as the
turntable guard for **middle-drag** (see §4.2), which keeps its current feel.

Rejected smaller alternative, for the record: keep `yaw`/`pitch` and add `roll`,
accepting that x/y are camera-frame only at zero roll. It is a smaller diff, but
it ships a control whose axis label is wrong in exactly the states a camera
console is for.

## 4. Design

### 4.1 `src/Mat3.ts` (new)

A tiny, pure-math, DOM-free module. A `Mat3` is a 9-number row-major tuple, so
it is a value that can be compared with `deepEqual` and needs no class
ceremony:

```ts
export type Mat3 = readonly [
    number, number, number,
    number, number, number,
    number, number, number,
];

identity(): Mat3
multiply(a: Mat3, b: Mat3): Mat3      // a . b
apply(m: Mat3, p: Point3D): Point3D   // m p
applyTranspose(m: Mat3, p: Point3D): Point3D   // m^T p
rotX(angle): Mat3; rotY(angle): Mat3; rotZ(angle): Mat3
axisAngle(x, y, z, angle): Mat3       // unit axis; Rodrigues
fromYawPitch(yaw, pitch): Mat3        // rotX(pitch) . rotY(yaw) — the old R
```

`apply` is the identity map when `m` is the identity matrix, exactly: with
`m = [1,0,0, 0,1,0, 0,0,1]` and `z = 0`, `1*x + 0*y + 0*0` is `x` bit-for-bit.
That is what preserves the exact 2D regression anchor (§6).

### 4.2 `src/Camera.ts`: matrix orientation, orbit, 3-axis rotation

```ts
export type CameraAxis = 'x' | 'y' | 'z';

export class Camera implements CameraView {
    /** World -> camera rotation. Identity is the default 1:1 view. */
    orientation: Mat3;

    // target, distance, focalLength, nearPlane: unchanged.

    /** The look direction's elevation above the world XY plane, radians. */
    get elevation(): number;

    /**
     * Middle-drag orbit. Horizontal turns about world Y; vertical tilts about
     * the camera's horizontal axis. The tilt is clamped so the camera never
     * looks along world +/-Y, which is what keeps the turntable well defined.
     */
    orbit(dxPixels, dyPixels): void;

    /**
     * Rotate the camera about one of its own axes. Free 3-DOF: no clamp, so a
     * button can carry the view through a pole.
     */
    rotateLocal(axis: CameraAxis, radians: number): void;

    dolly(notches): void;      // unchanged
    panBy(delta): void;        // unchanged
    reset(): void;             // identity orientation, origin target, default distance
}
```

`orbit` is the one subtle method. It must reproduce today's feel and today's
guard:

1. `M <- M . rotY(dx * orbitRadiansPerPixel)` — the world-Y turn, which leaves
   the elevation untouched.
2. `e = elevation(M)`; `delta = clamp(e + dy * orbitRadiansPerPixel, -maxPitch,
   maxPitch) - e`. Clamping the **applied delta** rather than the resulting
   angle is what stops a large drag from tumbling through a pole.
3. `a = normalize(viewDir x worldUp)`, a horizontal axis perpendicular to the
   view direction; `M <- M . axisAngle(a, -delta)`.

With `roll = 0` this is algebraically today's `pitch += dy * rate` clamped at
`maxPitch`, and with the default identity camera a first `orbit(dx, dy)` equals
`fromYawPitch(dx * rate, dy * rate)`. A degenerate horizontal axis (the view
exactly at a pole, reachable only through the buttons) falls back to world x,
which is still a valid tilt axis because every horizontal axis is perpendicular
to a vertical view.

`rotateLocal` is simply `M <- rotX|rotY|rotZ(radians) . M`. `reset` restores the
identity orientation, so the console's rotations do not survive a `reset` —
matching `yaw`/`pitch`/`distance` today, and unlike the graph rebuild, which the
camera deliberately survives (`initialize()` keeps `this.state.camera`).

### 4.3 `src/Projector.ts`: the same projection, matrix-backed

`CameraView` replaces its `yaw` / `pitch` fields with `orientation: Mat3`.
`defaultCameraView()` returns `identity()`. The two places that read the angles
become:

```ts
toCameraSpace(p) {
    const { orientation, target } = this.camera;
    return apply(orientation, point3(p.x - target.x, p.y - target.y, p.z - target.z));
}

unprojectScreen(screen, depth) {
    const { orientation, target, distance, focalLength } = this.camera;
    const v = point3(screen.x * depth / focalLength,
                    screen.y * depth / focalLength,
                    depth - distance);
    const world = applyTranspose(orientation, v);
    return point3(target.x + world.x, target.y + world.y, target.z + world.z);
}
```

Everything downstream — perspective divide, near-plane guard, culling, the
`unproject` wrapper, painter ordering, depth cues, selection, drag — is
untouched, because it consumes projected values, not camera angles. The module
stays pure math and DOM-free; the architecture guard in `projector.test.ts`
must keep passing unchanged.

### 4.4 `src/K.ts`

| Constant | Change |
| --- | --- |
| `camera.yaw`, `camera.pitch` | **removed** (the identity matrix is the default view) |
| `camera.rotateStepRadians` | **new**: `Math.PI / 12`, one console step |
| `camera.maxPitch` | kept; comment updated to "turntable elevation guard" |
| `camera.orbitRadiansPerPixel`, `focalLength`, `distance`, `nearPlane`, `minDistance`, `dollyPerWheelNotch` | unchanged |

### 4.5 The console: markup and CSS

`web/index.html` gains a third panel section, after `selectionSection`:

```html
<div id="cameraConsole" class="cameraSection">
    <div class="sectionHeading">camera</div>

    <div class="cameraRow">
        <span class="cameraAxisLabel" aria-hidden="true">x</span>
        <button type="button" class="cameraButton" data-axis="x" data-direction="cw"
                aria-label="rotate clockwise about the x axis"
                title="rotate clockwise about the x axis">&#8635;</button>
        <button type="button" class="cameraButton" data-axis="x" data-direction="acw"
                aria-label="rotate anticlockwise about the x axis"
                title="rotate anticlockwise about the x axis">&#8634;</button>
    </div>
    <!-- ... y and z rows ... -->
</div>
```

Six buttons, real `<button type="button">` elements, so Enter and Space
activate them with no extra key handling. `data-axis` and `data-direction` are
the machine-readable contract the delegated handler reads; the visible glyph is
decoration, and the `aria-label` / `title` carry the meaning.

`web/stylez.css` gains a bordered `.cameraSection` (matching the menu's
separator), a flex `.cameraRow`, a cyan `.cameraAxisLabel`, and a
`.cameraButton` styled after `.main_menu_option` with `cursor: pointer` and a
`:focus-visible` outline. The panel's `cursor: move` must not make the buttons
read as drag handles.

### 4.6 Wiring: `UIController`, `entrypoint`, `index.ts`

`UIController` takes one more dependency, the console container, and binds it in
the same `toggleEventListeners()` list that everything else uses — so detach is
derived from the same lines and the "a new listener survived reset()" bug the
suite already guards against cannot recur:

```ts
// in toggleEventListeners(attach)
if (this.cameraConsole) {
    bind(this.cameraConsole, "click", this.onCameraButtonClick);
    bind(this.cameraConsole, "pointerdown", this.onCameraPointerDown);
}
```

```ts
onCameraButtonClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || typeof target.getAttribute !== "function") return;

    const axis = target.getAttribute("data-axis");
    const direction = target.getAttribute("data-direction");

    if (axis !== "x" && axis !== "y" && axis !== "z") return;
    if (direction !== "cw" && direction !== "acw") return;

    // Anticlockwise is the right-hand positive sense about the axis.
    this.state.camera.rotateLocal(axis, (direction === "acw" ? 1 : -1) * K.camera.rotateStepRadians);
};

onCameraPointerDown = (event: PointerEvent) => {
    // The panel is a drag handle (DragController captures the pointer on
    // pointerdown and would retarget the click), so a press that starts on a
    // button must not reach it.
    event.stopPropagation();
};
```

`entrypoint()` resolves `cameraConsole` through the existing `required([...])`
list (the console is part of the shipped chrome, so a missing one is a startup
failure like the export link), and passes it to the controller. `src/index.ts`
passes the new ID alongside the others. The controller's `cameraConsole` field is
`HTMLElement | null` so fixtures that construct a controller directly without the
console still work.

### 4.7 Sign convention

**Anticlockwise = right-hand positive rotation about the camera axis**; clockwise
is its negation. On screen, with x right, y up and z into the screen, the z pair
therefore spins the view anticlockwise/clockwise as seen by the viewer, which is
the reading a user expects. The convention is documented in the README and
pinned by a test rather than left to the glyphs (§6).

## 5. Phased delivery

Three focused PRs. Each leaves `main` green.

### PR 1 — this work-plan

- `docs/workplans/camera-control-buttons.md` only.
- **Acceptance:** `npm run ci` green (201 tests, no source change).

### PR 2 — camera orientation as a rotation matrix, with 3-axis local rotation

- `src/Mat3.ts` (new): the tuple type and the helpers in §4.1.
- `src/Camera.ts`: `orientation` replaces `yaw`/`pitch`; `orbit` reimplemented
  as §4.2; `rotateLocal` added; `reset` restores identity.
- `src/Projector.ts`: `CameraView.orientation`; `toCameraSpace` /
  `unprojectScreen` go through `apply` / `applyTranspose`; `defaultCameraView`
  returns the identity.
- `src/K.ts`: drop `yaw`/`pitch`; add `rotateStepRadians`.
- Tests: `camera.test.ts` and `projector.test.ts` rewritten against the matrix;
  `pan.test.ts` orbit/reset assertions moved from `yaw`/`pitch` to
  orientation/elevation.
- **Acceptance:** `npm run ci` green; the identity-camera / `z = 0`
  **exact-equality** anchor passes untouched; the mouse orbit is
  behaviour-identical (the old `orbit` results are reproduced to 1e-12); no UI
  change.

### PR 3 — the camera console

- `web/index.html`, `web/stylez.css`: the third section and its styles.
- `src/UIController.ts`: the container dependency, the two delegated handlers.
- `src/entrypoint.ts`, `src/index.ts`: resolve and pass `cameraConsole`.
- `test/support/dom.ts`: `cameraConsole` in `demoElements()`; a
  `stopPropagation` flag on the pointer-event factory.
- Tests: new `test/camera-console.test.ts`; `entrypoint.test.ts` and
  `layout.test.ts` extended.
- `README.md`: the Layout and Interaction sections, and this workplan's status.
- **Acceptance:** `npm run ci` green with a higher test count; the console
  renders in the demo and each button moves the view in the labelled direction.

## 6. Test plan

### New tests

| Area | Assertion |
| --- | --- |
| `Mat3` | `apply`/`applyTranspose` invert each other; `multiply` composes; `rotX/Y/Z` are rigid |
| `Camera` | a fresh camera's orientation is the identity |
| `Camera` | `rotateLocal` about x/y/z is a camera-frame rotation, independent of the current orientation |
| `Camera` | opposite button steps cancel; `reset` restores the identity orientation |
| `Camera` | `orbit` from the identity equals `fromYawPitch(dx·rate, dy·rate)` to 1e-12 |
| `Camera` | the orbit elevation guard holds for an enormous `dy`, on both signs |
| `Projector` | identity camera + `z = 0` equals `Viewport.toCanvas` **exactly** (unchanged) |
| `Projector` | rotation stays rigid and `project`/`unproject` round-trips with a rolled orientation |
| Camera console | each of the six buttons rotates about its own axis by ±`rotateStepRadians` |
| Camera console | anticlockwise about z moves an on-screen +x point towards +y (the sign pin) |
| Camera console | a click with no/unknown data attributes is a no-op |
| Camera console | `pointerdown` stops propagation, so the panel drag never starts |
| Camera console | `terminate()` leaves zero console listeners; `initialize()` restores exactly one each |
| Layout | the panel's third section is `cameraConsole`, after the selection section, with six labelled buttons |

### Existing tests: expected impact

| Test | Impact |
| --- | --- |
| `camera.test.ts` | rewritten: orientation replaces `yaw`/`pitch`; clamp test becomes elevation |
| `projector.test.ts` | `camera()` fixture builds `fromYawPitch(...)`; identity anchor unchanged |
| `pan.test.ts` | orbit/reset assertions on orientation/elevation; drag, pan, dolly untouched |
| `entrypoint.test.ts` | `cameraConsole` joins the required-element list |
| `layout.test.ts` | new section assertions; existing menu/selection order assertions stand |
| `context-menu.test.ts` | listener-set assertions extended to the console container |
| `selection.test.ts`, `render.test.ts`, `hidpi.test.ts`, `transform.test.ts`, `pipeline.test.ts` | untouched: they consume projectors, not camera angles |

## 7. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| The matrix refactor regresses the 2D look | The identity matrix reduces bit-exactly; the exact-equality anchor is never edited, and PR 2 ships no UI change |
| Middle-drag feel changes | `orbit` is defined to reproduce today's result at `roll = 0`; a 1e-12 equivalence test pins it, and the demo is exercised manually |
| The elevation guard is lost in the refactor | `orbit` clamps the applied delta, so a large drag cannot tumble through a pole; a test drives a huge `dy` at both signs |
| Base reached exactly through the buttons makes the turntable axis degenerate | `orbit` falls back to world x when the view is vertical; button rotation is intentionally free |
| A button press is swallowed by the panel drag | `pointerdown` on the console stops propagation, so `DragController` never captures the pointer; a test asserts the call |
| Six buttons bloat the controller signature | One container dependency and delegation, not six elements and six closures |
| `data-*` typos ship a dead button | The handler ignores unknown values, but layout tests assert all six axis/direction pairs exist |
| The glyphs render inconsistently across fonts | The `aria-label`/`title` carry the meaning and the row label carries the axis; the glyph is decoration |

## 8. Out of scope

- Press-and-hold auto-repeat, inertia or animation. Every press is one step.
- Rebindable keys or a keyboard shortcut per axis. The buttons are tabbable and
  Enter/Space-activated, which is the accessibility baseline.
- A reset-orientation button. `reset` (the existing graph reset) already returns
  the camera to its default orientation in PR 2, and a `reset` context-menu
  entry stays the single action.
- Touch/pointer orbit on the canvas; the existing mouse handlers are unchanged.
- Snapping, angle read-outs, gizmos, or showing the current angles in the panel.
- Orthographic projection, or a perspective/orthographic toggle.

## 9. Verification

1. `npm run ci` on every PR; the test count rises in PRs 2 and 3.
2. `git diff main -- test/projector.test.ts` in PR 2 shows the fixture change
   only; the exact identity anchor and the DOM-freedom guard are unedited.
3. Run the demo (`BROWSER=... ./cli run`) and exercise: each of the six buttons,
   a button mid-middle-drag, the panel drag from the console area, keyboard
   activation with Tab + Enter, and a `reset` afterwards.
4. Confirm the buttons read correctly on screen: anticlockwise z spins the view
   anticlockwise, and x/y tilt about the screen axes with the graph visibly
   rotating rather than the panel.
