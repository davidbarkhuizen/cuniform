# Plan 5 — Renderer scaling

Status: implemented · Depends on: nothing (independent of the solver plans) ·
Blocks: nothing, but required for a usable frame above ~2k nodes

## Objective

Bound per-frame work so the renderer does not become the bottleneck once the
solver can feed it larger graphs: cull labels, batch edge strokes above a
threshold, and remove per-frame allocation from the draw path.

## Why

Measured with `FakeContext2D` — which only counts JS work, so these are
**lower bounds**; a real canvas `arc` + `fill` + `fillText` is far costlier:

| N | edges | render ms (fake ctx) |
| ---: | ---: | ---: |
| 256 | 384 | 0.9 |
| 512 | 768 | 1.5 |
| 1024 | 1536 | 4.0 |
| 2048 | 3072 | 8.5 |
| 4096 | 5231 | 21.0 |

The frame currently issues about `E` `stroke()` calls, `N` `arc`+`fill()` pairs
and `N` `fillText()` calls, plus one closure allocation per draw item and a full
sort every frame. `fillText` per node is the dominant real-canvas cost and the
least defensible at scale: with thousands of nodes the labels are unreadable
anyway.

## Current behaviour

`src/Renderer.ts`:

- filters `vertices` and `edges` into two fresh arrays each frame,
- computes `minDepth`/`maxDepth` for the depth fade,
- creates `alphaFor`/`radiusFor` closures per frame,
- pushes one `{ depth, draw: () => … }` object per edge and per node, each
  closure capturing its geometry,
- sorts items by depth descending and relies on sort stability for the
  edge-before-node order at equal depth,
- sets `globalAlpha` and `strokeStyle`/`fillStyle` per item,
- calls `fillText` for every node.

## Proposed design

All thresholds live in a new `K.renderer` block. Below each threshold the
current path is kept **byte-for-byte**, so the existing render tests and the
small-graph visual output do not change; the new behaviour is opt-in by size.

```ts
renderer: {
    labelMaxNodes: 150,        // above this, label only the selection and its neighbours
    batchEdgesMinEdges: 2000,  // above this, batch edge strokes instead of per-edge paths
    edgeAlphaBuckets: 8,       // depth-fade quantization for batched strokes
}
```

### 1. Label culling (biggest real win)

- Below `labelMaxNodes`: draw every label, exactly as today.
- At or above: draw a label only for the selected node and its incident
  neighbours (the set the overlay panel already lists), matching the existing
  highlight semantics; optionally also for nodes whose perspective radius is at
  the clamp ceiling (very near).
- `fillText` count drops from `N` to `O(degree of selection)`.

### 2. Always: remove per-item closures and fix the tie-break

- Replace `{ depth, draw }` objects with parallel reusable structures: a
  `Float64Array` of depths plus an index/kind array (edges first, then nodes, as
  today). Sort an index array with an explicit comparator
  `depth descending, then insertion index ascending`.
- The explicit tie-break reproduces the current stable edge-before-node order
  deterministically, so the sort no longer depends on `Array.prototype.sort`
  stability. This is a behaviour-preserving refactor.
- Draw in a `switch (kind)` loop, reading geometry from the graph; no closure is
  allocated per item.
- Benchmark note: this removes `N + E` closures per frame without changing draw
  calls or order.

### 3. Above `batchEdgesMinEdges`: batch edge strokes

- Quantize the depth-fade alpha into `edgeAlphaBuckets` buckets and group edges
  by (style: default vs incident) × bucket. Emit one path per group and a single
  `stroke()` per group, instead of `beginPath`/`stroke` per edge.
- The painter's algorithm interleaves edges and nodes by depth. Batching edges
  breaks that interleave, so batch mode draws edges first, then depth-sorted
  nodes. That is a deliberate, documented visual divergence (edges no longer
  slip in front of nearer nodes); it only applies above the threshold.
- Incident (selected) edges are few: keep them on the individual path so the
  highlight is exact, or include them in the incident batch; the PR should pick
  one and test it.
- Below the threshold, keep the exact per-edge depth interleave.

### 4. Remove per-frame array allocation

- Compute visibility and `minDepth`/`maxDepth` in one pass over `vertices` and
  one over `edges` instead of two `filter()` calls, writing into reusable
  buffers.
- Inline `alphaFor`/`radiusFor` into the draw loop (or hoist their constants)
  rather than allocating two closures per frame.
- `graph.selectedVertex()` is O(N) and called once per frame (0.026 ms at
  N=2048); acceptable, but `render` may take the selected node as a parameter to
  avoid the scan once the signature is already changing.

### 5. Optional: skip redraw when quiescent

If the solver reports maximum per-step displacement below an epsilon and the
camera has not moved since the last frame, skip the draw entirely. This needs a
small amount of state and belongs with the settle detection in Plan 6; it is
listed here because it is the cheapest possible frame. Do not implement it in
this plan unless Plan 6 is being done.

### 6. Future, not this plan

If N grows past what batched canvas 2D can draw, the next step is an
`OffscreenCanvas`/WebGL renderer (instanced points and lines). That is a
separate design and is out of scope.

## Correctness and invariants

- **Only `Renderer.ts` draws** (invariant 1) — unchanged.
- **Small graphs are bit-identical**: every threshold defaults to off below the
  documented N/E, so `test/render.test.ts` and the flat-scene golden pass
  unchanged.
- **Determinism**: the explicit `(depth desc, insertion index asc)` tie-break
  replaces reliance on stable sort; the resulting order is identical to today's.
- **Painter order** is preserved below the batch threshold and intentionally
  relaxed above it; document the divergence in the README's depth-cue section.
- **HiDPI and CSS-pixel drawing** are untouched; the clear still happens in
  device space.

## Test plan

- Existing `test/render.test.ts` (and any render assertions in
  `test/hidpi.test.ts`) must pass unchanged — they use tiny graphs.
- New: above `labelMaxNodes`, `FakeContext2D.textLabels` contains only the
  selected node and its neighbours (and no unrelated labels).
- New: the explicit comparator reproduces the edge-before-node order for equal
  depths (assert the op sequence).
- New: in batch mode every edge is represented and stroke calls are bounded by
  `2 × edgeAlphaBuckets`, not `E`. This requires extending `FakeContext2D` to
  record `moveTo`/`lineTo` so a test can count segments; that extension is part
  of this plan (it is test-only support code).
- New: a threshold-forcing test overrides `K.renderer.batchEdgesMinEdges` to a
  small number and asserts both the batched and unbatched paths agree on which
  edges and nodes are drawn.
- Benchmark: render time at N=1024/2048/4096/8192 on the fake context, with
  `fillText` counts reported.

## Acceptance criteria

- Fake-context render at N=2048 ≤ 5 ms (from 8.5) and at N=4096 ≤ 10 ms (from
  21).
- `fillText` calls at N ≥ 150 bounded by the selection's degree, not N.
- Existing render tests green with no golden edits.
- README depth-cue section documents label culling and the batched-edge
  divergence.

## Risks and mitigations

| risk | mitigation |
| --- | --- |
| Visual regression from label culling | selection/neighbour labels always drawn; threshold in `K`, easy to raise |
| Batched edges look wrong (occlusion) | only above a high edge threshold; documented; selectable off |
| Alpha quantization causes banding | 8 buckets over a 0.35–1.0 range is visually smooth; tune in the PR |
| Sort tie-break subtly changes order | explicit comparator matches the previous stable order; assert in a test |
| `FakeContext2D` gives false confidence | treat it as a lower bound; benchmark a real browser canvas manually before claiming victory |

## Out of scope

- WebGL/`OffscreenCanvas` rendering.
- Changing the depth-fade law, node radius law, or palette.
- Moving rendering off the main thread.
- Quiescent-skip (Plan 6).
