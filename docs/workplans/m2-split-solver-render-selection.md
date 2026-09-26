# M2 — Split solver, renderer and selection

| | |
| --- | --- |
| **Finding** | M2, medium — `ForceDirectedGraph` is four responsibilities in one class |
| **Status** | Done in #53 |
| **Area** | new `src/Renderer.ts`, new `src/Selection.ts`, `src/ForceDirectedGraph.ts`, `src/UIController.ts`, `test/render.test.ts`, `test/selection.test.ts`, `test/pipeline.test.ts` |
| **Depends on** | M1 (both rewrite `UIController.onTimerTick`) |
| **Blocks** | M4, M6 (both reshape `step`; a smaller solver file makes them reviewable) |

## 1. Problem

`ForceDirectedGraph` (367 lines) holds four unrelated responsibilities:

| Responsibility | Members | Touches the DOM? |
| --- | --- | --- |
| Physics | `step`, `netElectrostaticForceAtNode`, `netSpringForceAtNode`, `netForceAtNode`, `velocityAtTag`, `displacementAtNode`, `addRadial` | no |
| Rendering | `render`, `colourFor`, `NODE_RADIUS`, `SELECTION_RADIUS`, the circle helper | **yes** (`CanvasRenderingContext2D`) |
| Hit-testing / selection | `handleNodeSelectionAttempt` | no |
| Coordinate mapping | `wrapTranslate`, `wrapReverse` | no |

The "the solver is DOM-free" invariant is real and valuable, but it is enforced
only by grepping the file's text:

```ts
// test/pipeline.test.ts:114-122
test("the solver source has no browser coupling", () => {
    const source = readSource("ForceDirectedGraph.ts");
    assert.ok(!/\bwindow\b/.test(source), "solver must not reference window");
    assert.ok(!/\bdocument\b/.test(source), "solver must not reference document");

    const canvasTypeUses = source.split("CanvasRenderingContext2D").length - 1;
    assert.equal(canvasTypeUses, 1, "the only canvas type should be render()'s parameter");
});
```

A file-level grep is a proxy for a module boundary. Splitting `render` out turns
the proxy into a structural fact: the physics module would no longer *be able* to
reference a canvas type. It also makes each concern independently testable and
shrinks the file that M4 and M6 have to edit.

## 2. Proposed shape

```
src/ForceDirectedGraph.ts   physics only — step(), the two force kernels, the
                            integrator, addRadial(); no canvas type, no drawing
src/Renderer.ts             render(context, graph) and the draw constants
src/Selection.ts            handleNodeSelectionAttempt(graph, canvasPos, viewport)
src/Viewport.ts             already owns model <-> canvas; the sole mapping home
```

### `src/Renderer.ts`

A pure function, not a class: the renderer holds no state between frames, so
there is nothing to own. Everything currently between
`ForceDirectedGraph.render`'s braces moves over verbatim, with
`this.graph` becoming the `graph` parameter.

```ts
import { Graph } from "./Graph";
import { K } from "./K";

const NODE_RADIUS = 5;
const SELECTION_RADIUS = 10;
const CIRCLE_START_ANGLE = 0;
const CIRCLE_END_ANGLE = 2 * Math.PI;
const CIRCLE_CLOCKWISE = true;

function colourFor(active: boolean, highlight: string, base: string): string {
    return active ? highlight : base;
}

/**
 * Draw `graph` onto `context`. The caller is responsible for any HiDPI
 * transform; this clears the backing store in device space and draws in CSS
 * pixels.
 */
export function render(context: CanvasRenderingContext2D, graph: Graph): void {
    /* body moved from ForceDirectedGraph.render, unchanged */
}
```

### `src/Selection.ts`

`handleNodeSelectionAttempt` is DOM-free already; it moves to its own module
taking the graph explicitly. It should take a `Viewport` rather than
`(canvasWidth, canvasHeight)` so that M5 (screen-space hit radius) becomes a
local change instead of a second signature change.

```ts
import { Graph } from "./Graph";
import { Point2D } from "./Point2D";
import { Viewport } from "./Viewport";

/** Returns whether the selection changed, as today. */
export function handleNodeSelectionAttempt(
    graph: Graph,
    canvasPos: Point2D,
    viewport: Viewport
): boolean { /* body moved, this.graph -> graph, wrapReverse -> viewport.toModel */ }
```

### `src/ForceDirectedGraph.ts`

Keeps `step` and the force/integration kernels unchanged. Its mapping helpers are
thin wrappers over `Viewport.forCanvas(w, h)` and are deleted here or in M3:

```ts
// both are exactly Viewport.forCanvas(w, h).toModel/toCanvas(xy)
wrapReverse(xy, canvasWidth, canvasHeight) { ... }
wrapTranslate(xy, canvasWidth, canvasHeight) { ... }
```

`wrapReverse` has three `src/` callers (`ForceDirectedGraph.handleNodeSelectionAttempt`,
`UIController:74,103-104`); `wrapTranslate` has none (M3). Recommendation: delete
both and let callers use `Viewport.forCanvas(w, h)` directly, which removes the
last non-physics member from the solver. Do that in whichever of M2/M3 lands
second, and cross-reference both PRs.

### `src/UIController.ts`

Two call sites:

```ts
// onTimerTick
this.solver.step(
    this.width,
    this.height,
    tag => tag.isSelected && this.state.b0Down
);
render(this.context2D, this.solver.graph);

// onMouseDown, button 0
const selectionChanged = handleNodeSelectionAttempt(
    this.solver.graph,
    mxy,
    Viewport.forCanvas(this.width, this.height)
);
```

Note `step` takes `(canvasWidth, canvasHeight)` purely so it can refresh
`translatedPosition`. Once `render` is separate, that refresh is the only reason
the solver needs the canvas size at all. Leave it for this PR; a follow-up could
move the `translatedPosition` cache into the renderer and make `step()` take no
sizes. Call that out in the PR description but do not do it here.

## 3. Tests to move (not rewrite)

The point is to relocate suites, not to re-baseline expectations. The
`FakeContext2D` recorders (`test/support/dom.ts:114-160`) make output equivalence
mechanically checkable.

| Test | Change |
| --- | --- |
| `test/render.test.ts` | Call `render(context, graph)` instead of `fdg.render(context)`. Assertions on `strokes`/`fills`/`texts`/`clears` unchanged. |
| `test/render.test.ts:106-110` ("render takes no optional label-spacing parameter") | The old `render.length === 1` guard targeted a removed second parameter. Re-express it against the new signature: `render.length === 2`, and label spacing still lives only in `K.label`. |
| `test/selection.test.ts` (11 tests) | Build `Viewport.forCanvas(W, H)` once and pass it; behaviour and expectations unchanged. |
| `test/hidpi.test.ts:149-162` | `render(context, graph)`; the device-space `clearRect` assertion is unchanged. |
| `test/pipeline.test.ts:114-122` | Strengthen: `CanvasRenderingContext2D` appears **zero** times in `ForceDirectedGraph.ts`, exactly once in `Renderer.ts`. |
| `test/transform.test.ts:69-77` | Deleted with `wrapTranslate` (see M3). |

**New test — output equivalence.** Capture the full recorder state for a fixture
graph before the refactor and assert the extracted `render` reproduces it
identically (all four arrays, in order). A golden capture committed as the
expected value is acceptable here because the recorders already reduce drawing to
comparable primitives.

## 4. Acceptance criteria

- `src/ForceDirectedGraph.ts` contains no `CanvasRenderingContext2D`, no drawing
  call, and no `graph`-shaped drawing logic — guard updated to zero.
- `Renderer.ts` is the only module in `src/` that names a canvas type.
- The solver remains free of `window`/`document`; the existing guard still passes.
- `step` and both force kernels are byte-for-byte behaviourally unchanged:
  `test/pipeline.test.ts`, `test/forces.test.ts`, `test/convergence.test.ts`,
  `test/robustness.test.ts`, `test/integrator.test.ts`, `test/solver.test.ts`
  pass with no expectation edits.
- `npm run ci` green; test count does not fall.
- `./cli build` bundles and the manual interaction matrix passes (rendering is
  the easiest thing to break silently here).

## 5. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A drawing nuance is lost in the move | Golden-output equivalence test plus the existing colour assertions; visual check in the browser |
| `render.length` guard silently stops guarding | Re-express it explicitly, do not delete it |
| Circular imports (`Renderer` ↔ `ForceDirectedGraph`) | `Renderer` and `Selection` import `Graph`/`K`/`Viewport` only — never the solver. Enforced by review and by the fact the solver no longer exports draw state |
| The diff is large and mixes a move with edits | Keep it a move: no re-indentation, no renaming, no colour/angle changes in the same PR (invariant 7) |
| `translatedPosition` staleness changes | Unchanged: `step` still refreshes it; only the draw call moves |

## 6. Out of scope

- Making `step()` size-free (noted above as a follow-up).
- Draw-order, colour, line-width or label-culling changes.
- Renderer batching, offscreen canvas, or dirty-region redraw.
- Changing `step`'s passes (M4/M6).

## 7. Verification

1. `npm run ci`.
2. `grep -n "CanvasRenderingContext2D" src/*.ts` shows exactly one file.
3. `BROWSER=... ./cli run`; confirm nodes, edges, selection ring, labels and
   HiDPI sharpness are visually identical to `main`.
