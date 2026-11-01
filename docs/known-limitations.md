# Known limitations

- Detached components no longer drift away indefinitely: the
  [component anchor](physics.md) bounds each component's centroid. It is a pure
  translation, so it bounds drift without reshaping a layout. What it does not
  do is keep a large detached fragment inside the frame — the hold radius grows
  with the component, because repulsion across a disconnected boundary scales
  with node count while the centroid pull does not (measured: 262 units for two
  6-node components, 2071 for two 40-node ones). That is the same dolly problem a
  large connected graph has, not a second kind of unbounded growth.
- Components anchored inside the dead zone can overlap each other. Repulsion
  spreads them, but nothing packs them into a non-overlapping arrangement; a
  component-packing pass is a separate design and would build on the same
  labelling.
- No cooling schedule and no velocity clamp. The `r -> 0` repulsion singularity
  is bounded by `minimumInteractionRadius`, but that still permits a single
  bounded step of up to `k*q^2 / minimumInteractionRadius^1.9` model units when
  two centres are dragged together.
- Spring forces are not normalised by node degree, so high-degree nodes are
  pulled harder than leaves.
- Spring rest lengths are uniform across every edge; distance-aware
  (Kamada–Kawai) per-pair rest lengths are not used.
- A `600^3` cube rotated has a projected diagonal of up to `sqrt(3) * 600 ~= 1039`
  model units, so orbiting can push nodes outside the viewport. Nothing clamps a
  node to the model cube either, matching the reference. The wheel dolly fits the
  view; the scale is deliberately not auto-fitted, because that would make it
  breathe as the camera moves and would break the exact 2D reduction.
- Mouse buttons are not chorded: the canvas takes Pointer Events, which report a
  second button pressed during a drag as a move rather than a new press, so a
  middle-drag cannot start while the left button is held, and vice versa.
- Near-plane culling is not edge clipping: an edge with a culled endpoint is
  dropped whole rather than clipped at the near plane.

## Networks

- **Labels crowd a tall model at L0.** Below `K.renderer.labelMaxNodes` (150)
  every node is labelled, and a network at L0 is always below it, so the labels
  of a deep model overlap when the camera frames the whole stack. Zooming in
  separates them; a label-placement pass is not built.
- **A deep model starts small.** Band thickness and gap are fixed (D6), so a
  42-band window is tall and the initial fit frames it from far away. The wheel
  dolly brings it closer; the fit is never re-run per frame.
- **Unit-level edges fall back where the ends do not line up.** Weight edges
  between units need both ends expanded and the source's units to match the
  weight matrix's columns. A collapsed source, a dense layer after a conv (the
  flattened image) or a cross-term cell feeds each unit through the source's
  first node instead. A head's unit-level edges show the strongest of its
  query, key and value weights, not three separate fans.
- **Batched edges lose their weights' widths.** Above
  `K.renderer.batchEdgesMinEdges` edges draw in one stroke per style and depth
  bucket, so curves survive but width-by-|weight| does not.
- **Not shown yet.** Cross-attention and grouped-query attention, whose grammar
  is settled (workplan D9) but which format 2 does not yet hold; ensembles,
  refused by name (one stack per classifier is the plan); pure-Python files,
  refused by name (D2; none exist).
- **The random-graph limitations above** (anchor hold radius, overlapping
  components) apply to the test fixture; a network is connected through its data
  flow, and its bands hold it in place.

These are deliberate divergences from the reference model rather than defects.
The `r -> 0` singularity guard, the coincident-centre tie-break, the
[component anchor](physics.md) and the near-plane guard described above are the
non-reference behaviour implemented so far, with the band clamp (invariant 10).
