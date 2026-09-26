# M5 — Screen-space hit radius

| | |
| --- | --- |
| **Finding** | M5, medium — the hit radius is in model units, so clickability scales with the window |
| **Status** | Planned |
| **Area** | `src/ForceDirectedGraph.ts` (or `src/Selection.ts` after M2), `src/K.ts`, `test/selection.test.ts`, `test/transform.test.ts`, `README.md` |
| **Depends on** | M2 for the tidiest form (`Viewport` passed in); can land without it |
| **Blocks** | nothing |

## 1. Problem

The hit test maps the click to model space and compares model distances against a
constant that is also in model units:

```ts
// src/ForceDirectedGraph.ts:334-354
handleNodeSelectionAttempt(canvasPos, canvasWidth, canvasHeight) {
    var model = this.wrapReverse(canvasPos, canvasWidth, canvasHeight);

    // Best distance so far, seeded with the squared hit radius so only a
    // node inside it can win.
    var best = K.ui.minimumNodeSelectionRadius * K.ui.minimumNodeSelectionRadius;
    var closest: Tag | null = null;

    for (const node of this.graph.vertices) {
        const deltaX = node.position.x - model.x;
        const deltaY = node.position.y - model.y;
        const r2 = deltaX * deltaX + deltaY * deltaY;
        if (r2 < best) { best = r2; closest = node; }
    }
    // ...
}
```

```ts
// src/K.ts:29-33
ui: {
    // 2.5% of the model width, matching the reference's 15.0 in a
    // 600-unit world.
    minimumNodeSelectionRadius : 15.0,
},
```

The mapping applies a uniform scale of `min(canvasW / 600, canvasH / 600)`, so
15 model units becomes a *different number of screen pixels* on every viewport:

| Canvas | scale | Effective hit radius |
| --- | --- | --- |
| 400 × 400 | 0.67 | ~10 px |
| 600 × 600 | 1.00 | 15 px |
| 1000 × 1000 | 1.67 | 25 px |
| 2000 × 1200 | 2.00 | 30 px |

A click target is a property of the screen, not of the model. On a large display
nodes feel glued to the cursor; in a small window they are fiddly to select.
"Click the node" should mean the same number of pixels everywhere.

The test fixture hides this completely: `test/selection.test.ts:9-10` uses a
600 × 600 canvas over the 600 × 600 model, i.e. scale exactly 1, so model units
and pixels coincide and every assertion passes either way.

## 2. Proposed change

Make the constant a CSS-pixel value and compare in canvas space.

### `src/K.ts`

```ts
ui: {
    /**
     * Click hit radius in CSS pixels, independent of canvas size and
     * devicePixelRatio. Replaces the reference model's 15.0-model-unit radius:
     * a constant screen target is what "click the node" should mean, and the
     * model-space version scaled with the viewport (10 px..50 px across
     * realistic windows).
     */
    minimumNodeSelectionRadiusPx: 15.0,
},
```

### `src/ForceDirectedGraph.ts` (or `src/Selection.ts`)

Compare the node's canvas position against the click's canvas position. This is
the same quantity `render` draws with, needs no division, and cannot divide by a
zero scale.

```ts
handleNodeSelectionAttempt(canvasPos: Point2D, viewport: Viewport) {
    const best = K.ui.minimumNodeSelectionRadiusPx * K.ui.minimumNodeSelectionRadiusPx;
    let closest: Tag | null = null;

    for (const node of this.graph.vertices) {
        const at = viewport.toCanvas(node.position);   // node.position, not the
        const dx = at.x - canvasPos.x;                 // step-cached translatedPosition
        const dy = at.y - canvasPos.y;
        const r2 = dx * dx + dy * dy;

        if (r2 < best) { best = r2; closest = node; }
    }
    // toggle/clear tail unchanged
}
```

Notes:

- Convert from `node.position`, **not** `node.translatedPosition`. The cache is
  refreshed in `step` (every 50 ms), so it can lag a pointer-written drag
  position by up to a tick. The conversion is one multiply per node.
- If M2 has landed, this method lives in `src/Selection.ts` and already takes a
  `Viewport`; otherwise keep `(canvasWidth, canvasHeight)` and build the
  viewport internally.
- Guard a degenerate canvas: if `viewport.w1 <= 0 || viewport.h1 <= 0`, return
  `false` without selecting. `scale` is then 0 and `toCanvas` collapses every
  node onto the centre, which would otherwise make the "nearest" pick arbitrary.
- `canvasPos` is already in CSS pixels: `getMousePos` uses `clientX`/`clientY`
  and `UIController.width/height` are logical sizes, so `devicePixelRatio` is
  factored out before this point (`test/hidpi.test.ts:132-147` pins that).

### `README.md`

Update the constants table: the row currently reads
`| minimumNodeSelectionRadius | 15.0 | click hit radius, model units |`
(`README.md:119`) and must become the pixel-denominated name and unit. The
"Model and canvas space" section may note that selection is measured in screen
pixels while the model is not.

## 3. Tests

Existing tests keep working **unchanged**, because their fixture is scale 1 and
`15 px / 1 = 15 model units`:

- `test/selection.test.ts:136-145` ("the hit radius is exclusive at exactly the
  selection radius") — the boundary stays exactly exclusive at 15.
- All other `test/selection.test.ts` cases.

Rename-only updates:

- `test/selection.test.ts:84,136-137` and `test/transform.test.ts:17` use
  `K.ui.minimumNodeSelectionRadius` → `minimumNodeSelectionRadiusPx`.

**New tests — the point of the change.** For each of a few canvas sizes, a click
14 px from a node hits and 16 px misses, regardless of scale:

| Canvas | scale | 14 px click | 16 px click |
| --- | --- | --- | --- |
| 300 × 300 | 0.5 | hit | miss |
| 600 × 600 | 1.0 | hit | miss |
| 1200 × 1200 | 2.0 | hit | miss |

Build the click position from the node's mapped canvas position plus the pixel
offset, so the test states screen distance directly and cannot accidentally
re-derive it in model units. Under the old code the 300 × 300 and 1200 × 1200
cases fail (the effective radius would be 7.5 px and 30 px).

**New test — degenerate canvas.** A 0 × 0 viewport selects nothing and does not
throw.

## 4. Acceptance criteria

- The hit radius is a CSS-pixel constant; the same screen distance hit-tests
  identically at scale 0.5, 1 and 2, and under `devicePixelRatio` 1 and 2.
- Existing selection assertions (nearest wins, toggle, clear, exclusive
  boundary) are unchanged.
- A zero-size canvas is safe.
- `K` and `README.md` name and document the constant as pixels.
- `npm run ci` green; test count rises.

## 5. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Deliberate behaviour change: on a large canvas nodes become harder to hit than before (was 30-50 px) | That is the finding. 15 px is a standard minimum target; if it feels small on HiDPI it is a one-line constant change, now with a viewport-independent meaning |
| Using `translatedPosition` by mistake reintroduces a tick of lag | Specified against `node.position`; the pointer-mapping test in `hidpi.test.ts` still passes |
| Floating-point boundary at exactly 15 px | The fixture maps exactly (scale 1, integer offsets); the exclusive `<` comparison is preserved |
| Division by a zero scale if the canvas is hidden | Canvas-space comparison has no division; the explicit degenerate guard covers the collapsed mapping |

## 6. Out of scope

- Hover highlighting or a cursor change over nodes.
- Touch target sizing (mobile has no pointer path today — see L8).
- Snapping, or selecting an edge.
- Changing `minimumInteractionRadius`, which is a *physics* guard (`K.ts:17-26`)
  and must stay in model units.

## 7. Verification

1. `npm run ci`.
2. Manually select nodes at a small window and a maximised window; the same
   cursor distance should hit in both.
3. Confirm `devicePixelRatio` 2 behaviour is unchanged (`test/hidpi.test.ts`).
