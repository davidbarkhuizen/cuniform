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
- Near-plane culling is not edge clipping: an edge with a culled endpoint is
  dropped whole rather than clipped at the near plane.

These are deliberate divergences from the reference model rather than defects.
The `r -> 0` singularity guard, the coincident-centre tie-break, the
[component anchor](physics.md) and the near-plane guard described above are the
non-reference behaviour implemented so far.
