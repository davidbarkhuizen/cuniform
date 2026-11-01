# Network visualizer — indrajala-ml format-2 models in banded 3D

| | |
| --- | --- |
| **Status** | Implemented (2026-11-01): PRs 2–9 merged as #172–#179; the server source, D9's views and ensembles wait on other work (`docs/next-steps.md` rows 11–13) |
| **Area** | `src/graph/*`, `src/physics/ForceDirectedGraph.ts`, `src/physics/PhysicsProtocol.ts`, `src/graph/MirrorGraph.ts`, `src/render/Renderer.ts`, `src/render/RenderProtocol.ts`, `src/app/UIController.ts`, `src/ui/*`, `src/core/K.ts`, new `src/network/*`, `web/index.html`, `test/*`, `bench/*`, docs |
| **Depends on** | `main` green at 304fb65; indrajala-ml format 2 as documented in `indrajala_ml/model/persistence/format2.py` (`expand_specs` in `indrajala_ml/model/specs/layer_specs.py`) |
| **Blocks** | the server-backed model source (D3), and cross-attention / grouped-query views (D9), which wait on indrajala-ml |
| **Evidence** | a codebase audit on 2026-11-01 (§2), and a census of every format-2 file in `indrajala-models`, `indrajala-studies/data` and `indrajala-ml/data`: 1106 rust `window_recurrent`, 277 rust `sequence`, 2 numpy `sequence`, **0 pure-Python** |

## 1. Goal

cuniform becomes a viewer for one thing: saved neural networks from
indrajala-ml (format 2). The goal has three parts:

1. **Layers in bands.** Every node of a layer lies inside that layer's band, and
   each layer has its own band. This is an invariant the suite checks, not a
   tendency of the layout.
2. **Non-neuron components get their own visual grammar.** Attention heads,
   layer norms, embeddings, residual connections and the recurrent parts each
   look different. Variants of one family differ visibly too: causal or not,
   rotary or not, head count, and, when indrajala-ml has them, self- against
   cross-attention and grouped-query attention.
3. **Keep what works.** Dynamic rendering, the physics and render workers, free
   3D rotation, determinism and an allocation-free steady state all stay.

The model will eventually come from a server call. This plan ignores the server
and keeps a seam for it (D3).

## 2. Audit findings this plan answers

| # | finding | where |
| --- | --- | --- |
| G1 | A node is a label and a position. An edge is two endpoints: no weight, kind or direction | `src/graph/Tag.ts`, `src/graph/Edge.ts` |
| G2 | The graph is flat (no layers, modules or hierarchy) and append-only, so collapse means rebuild | `src/graph/Graph.ts`, `GraphShape` |
| G3 | The worker wire carries labels, positions and edge index pairs only | `PhysicsProtocol.ts`, `MirrorGraph.ts`, `RenderProtocol.ts` |
| G4 | The renderer draws one shape (circle), two node colours and straight edges of one style | `src/render/Renderer.ts` |
| G5 | Physics is isotropic: uniform spring rest length, all-pairs repulsion, no axis constraint | `src/physics/Kernel.ts`, `ForceDirectedGraph.stepPhysics` |
| G6 | There is no format-2 reader, and `GraphSpec` knows only `random` and `molecule` | `src/graph/GraphSpec.ts` |
| G7 | Edges, not nodes, limit scale. At unit level the tinyshakespeare model (d=64, FFN 256, 4 heads, 2 blocks) is ~1.5k nodes but ~106k weight edges, against `batchEdgesMinEdges` = 2000. Complete bipartite springs also pull a band's nodes to its centre | `K.renderer` |

What carries over unchanged: the free-orientation camera (`Camera.ts`, an
orientation matrix with orbit, console rotation and dolly), both workers with
their watchdogs and fallbacks, the depth cue and painter sort, the pinning rule
in `stepPhysics`, and the component anchor's label -> centroid -> force pattern.

## 3. Decisions of record

Each decision lists its options with pros and cons; the chosen one is marked.

### D1. Scope: networks only. Settled: (a)

- **(a) Chosen.** Remove random and molecule graphs from the product: `Smiles.ts`,
  `Molecules.ts`, the chooser and `GraphWizard.ts`, `GraphSpec`'s two kinds, and
  their tests and docs. Keep a seeded random-graph generator, moved to
  `test/support/` and imported by `bench/`, as a **test and benchmark fixture
  only**. Pros: one purpose and less code; the physics tests and the 4096-node
  benchmark keep a scalable, reproducible input. Cons: the fixture stays in the
  repository.
- (b) Delete the generator too. Pros: the least code. Cons: the scaling
  benchmark and the Barnes-Hut and convergence tests lose their input. Real
  models top out at a few thousand units, so no model reproduces the 4096-node
  regime on demand.
- (c) Keep the other graph types behind a flag. Pros: nothing is lost. Cons:
  two products in one codebase, against the stated focus.

### D2. Implementations: array networks only. Settled: (a)

- **(a) Chosen.** Read `numpy` and `rust` files, which share one weight layout
  (one entry per expanded layer: `[W, b]`, `[Wq, bq, ..., Wo, bo]` and so on).
  Refuse `python` with a named error. Pros: one weight decoder; it covers every
  saved file (census: 0 pure-Python); the structure reader stays
  implementation-independent, so (b) stays cheap to add later. Cons: a future
  pure-Python file shows an error instead of a picture.
- (b) Read structure only for pure-Python files, with no weights. Pros: every
  file opens. Cons: a second rendering mode (no weight edges or stats) for files
  that do not exist.
- (c) Decode pure Python's per-node layout as well. Pros: complete. Cons: a
  second decoder with its own tests, for zero files.

### D3. Model source: a seam now, a file today, a server later. Settled: (a)

- **(a) Chosen.** A `ModelSource` interface (`load(): Promise<unknown>`) with
  two implementations now: a file picker or drag-drop, and a `?model=<url>` fetch
  for development against a local static server. The reader (D4) takes the
  parsed JSON object, never a path or a `Response`. The server source later
  implements the same interface, and the server sends a **view payload**: format
  2 without `optimizer_state` and `rng`. The reader already ignores both, so
  that payload needs no reader change. Pros: the server lands without touching
  the reader or the graph. Cons: an interface with two small implementations
  ahead of the third.
- (b) A hard-coded fetch. Pros: the least code. Cons: rework when the server
  arrives, and no way to open a local file.

### D4. Data model: factored, not flat. Settled: (b)

- (a) Add `kind`, `band` and `weight` fields to `Tag` and `Edge`. Pros: small.
  Cons: model semantics leak into the physics and render substrate, the per-tag
  objects grow, and collapse/expand has nowhere to keep the hierarchy.
- **(b) Chosen.** Two layers of representation.
  - **`NetworkModel`** (new, pure, in `src/network/`): the parsed tree.
    Stacks hold expanded layer entries; entries hold components (for example, an
    attention entry's heads and its output projection); components hold units.
    Each node in the tree carries its spec fields and a view of its weights.
    Every node has a stable id, a path such as `s0/L3/head1`.
  - **The render graph**: the existing `Graph`, built from a `NetworkModel` at
    a level of detail (D7), plus struct-of-arrays attributes indexed like
    `vertices` and `edges`. Per node: `kind: Uint8Array`, `band: Int32Array`
    (a band index into a band table), `group: Int32Array` (the component's
    index). Per edge: `edgeKind: Uint8Array`, `weight: Float32Array`.

  Pros: the physics and renderer see flat typed arrays, which already suit the
  workers; the hierarchy lives in one pure place; stable ids carry positions
  across rebuilds. Cons: the attribute arrays must be kept consistent with the
  graph, which the builder owns and the suite checks.

### D5. Bands: a hard clamp after each step. Settled: (a)

The band table: each band has `axisCentre`, `halfThickness` and a footprint
(a rectangle in the two in-band axes). A band is identified by
`(stack, layer, lane)`:

- **Layers run along model y**, input at the bottom.
- **Stacks are offset along x.** This reserves room for an encoder beside a
  decoder (D9).
- **Lanes subdivide the footprint along z** for `branches` (D8).

Options:

- **(a) Chosen.** After integration, each node's y is clamped into its band's
  `[centre - halfThickness, centre + halfThickness]`, and x and z into its
  footprint. A clamped axis's velocity is zeroed. This is the per-axis analogue
  of the pinning rule in `stepPhysics`. Pros: the invariant always holds and is
  checkable; O(N) with no allocation; deterministic. Cons: it must run
  identically in-process and in the physics worker, so the band data must reach
  the worker at init (D10).
- (b) A soft band force, like the component anchor, with zero pull inside the
  band. Pros: reuses the kernel's existing pattern. Cons: no guarantee.
  `known-limitations.md` measures the anchor's hold radius growing with
  component size (262 units for 6 nodes, 2071 for 40); a 256-wide FFN band would
  leak the same way.
- (c) Fix each node's y at its band centre; physics moves x and z only. Pros:
  the simplest. Cons: bands become flat planes with no thickness, and depth
  ordering within a layer is lost.

The clamp keeps inter-band repulsion acting only within the band plane, which is
what spreads a layer. A new item in `docs/invariants.md` states that every node
lies in its band's box after every step, including pinned nodes: a drag is
clamped to the band too.

### D6. Band height and initial view. Settled: (a)

- **(a) Chosen.** Band height and gap are constants in `K.network`, and the
  band count fixes the model's y-extent. On load only, the camera's initial
  distance is set so the model's bounding box fits the viewport. It is never
  re-fitted per frame, which keeps the "no breathing" decision in
  `known-limitations.md`. The initial orientation is a slight yaw and pitch, so
  bands read as slabs and not lines. Pros: predictable; a deep model is tall
  rather than squashed. Cons: very deep models start small, and the wheel dolly
  fixes that.
- (b) Fit the band spacing to the cube `K.space`. Pros: every model has the
  same height. Cons: a 13-band window and a 4-band model look alike, and band
  spacing stops meaning anything.

### D7. Level of detail: collapse and expand, by rebuild. Settled: (a)

Two levels:

- **L0, the component level (the default).** One node per component: an
  embedding, a layer norm, each attention head, an attention output projection,
  a dense layer, each recurrent part. Edges are the data flow between them.
- **L1, the unit level (expanded per component on select).** One node per unit:
  a feature, a neuron, or a head's query, key and value features. Weight edges
  are the top `K.network.edgesPerUnit` incoming weights by |w| (default 4,
  adjustable in the panel), with a per-band cap.

Options:

- **(a) Chosen.** Expanding or collapsing rebuilds the render graph from the
  `NetworkModel` and re-initialises both workers through the existing generation
  path. Nodes whose stable id survives keep their positions. New units are
  seeded on a grid inside their component's footprint, centred on the collapsed
  node's last position. Pros: `Graph` stays append-only, and the mirrors,
  protocols and shape tracking are untouched; a rebuild is O(N + E) at a few
  thousand nodes. Cons: one re-init per toggle, about the cost of a graph load.
- (b) Give `Graph` removal. Pros: no re-init. Cons: it reopens the shape
  tracking, both mirrors, the component labelling and the solver's buffers
  (all of which assume growth), for a toggle a human makes a few times a minute.

Springs act only on displayed edges. With D5 and top-k edges, a fully expanded
dense layer no longer collapses to its centroid. That is the answer to G7, to be
checked on real models in PR 9.

### D8. Visual grammar. Settled

Each format-2 entry maps as follows. A "mark" is a small overlay drawn on a
glyph.

| format-2 entry | band | L0 glyph | marks and notes |
| --- | --- | --- | --- |
| `embedding` | own band | square | vocabulary and size in the label; segments mark |
| `position` | own band | square, outlined | rotary positions are a mark on attention, not a band |
| `patches` | own band | grid square | |
| `state_input` | own band | inverted triangle | receives the recurrent loop edge |
| `dense` (hidden) | own band | circle | activation as a mark (relu, linear, gelu, ...) |
| `dense` (output) | own band | double circle | softmax or loss mark |
| `layer_norm`, `batch_norm` | own band, thin | bar (wide, flat rectangle) | batch-norm hatched |
| `attention` | own band | one hexagon per head, plus a circle for `Wo` | **causal**: triangle mark; **rotary**: ring mark; **dropout > 0**: dotted outline; heads: the hexagon count; `key_size` in the label |
| `conv`, `pool` | own band | rounded square, pool hollow | kernel size in the label |
| `token_mean` | own band, thin | bar, hollow | |
| `dropout` | none | — | a dotted style on the edges leaving the band before it |
| `residual` (fork, add) | none | — | a **curved skip edge** from the fork's source band to the add's band, bypassing the body; the add is a small "+" glyph at the join |
| `branches` (split, branch, merge) | lanes | — | each branch takes a z-lane inside the same layer bands; merged branches join at a "Σ" glyph; `reads` draws factor g's pooling edge from lane `reads[g]` |
| recurrence, per factor | own bands above the window | pooling: hexagon with a query dot; GRU cell: rounded square with a "↻" mark; codes: grid of `count` dots; initial state: hollow square | a **recurrent loop edge** from each cell back to every `state_input` band; `cross` draws edges between the factors' cells; a continuous factor has no codes glyph |
| unknown kind | own band | generic diamond | the panel lists it as unsupported. Weight alignment survives, because `weights` has one entry per expanded entry |

**Colour encodes family**: input (embedding, position, patches), normalisation,
attention, feed-forward, output and recurrence. The palette goes in `K.colours`,
checked for contrast on the near-black canvas as the emphasis presets were.
**Shape encodes kind. Marks encode variants.** These three channels vary
independently, so a variant never needs a new colour.

### D9. Cross-attention and grouped-query attention: grammar now, code when format 2 has them. Settled: (a)

The cross-attention workplan (indrajala-ml, D2, D3) settles on two stacks
(`EncoderDecoderNetwork(encoder, decoder)`) and on
`CrossAttention(heads, key_size, key_value_heads)`. Grouped-query attention is
planned alongside it. Neither is in format 2 yet.

- **(a) Chosen.** Fix the grammar now and build it when the format lands:
  - **Stacks** sit side by side along x (D5).
  - **Cross-attention** uses the attention hexagon with a split fill. Its key
    and value edges come **horizontally from the encoder stack's last band**,
    while self-attention's edges stay within its own stack. The difference
    lives in the topology, not only in colour.
  - **Grouped-query attention** draws `key_value_heads` K/V sub-glyphs, each
    fanning into its group of query hexagons.

  `NetworkModel` has a stacks list from day one, so the reader adds a second
  stack without a schema change. Pros: no speculative parsing of a format that
  does not exist; the layout already has room. Cons: the visual grammar for
  these two is untested until then.
- (b) Implement now against the workplan's text. Pros: ready on day one. Cons:
  guesses at JSON field names that indrajala-ml has not written.

### D10. Wire: static attributes at init, nothing new per frame. Settled

Both workers' `InitRequest`s gain the D4 attribute arrays and the band table
(`Float64Array`, 7 values per band: y-centre, half-thickness, and the x/z
footprint bounds), sent by transfer. `FrameRequest` and `StepRequest` are
unchanged, so the per-frame main-thread cost and the allocation-free steady
state hold. The attributes change only on a rebuild, which already sends a new
init.

### D11. Renderer additions. Settled

- **Glyphs**: a per-kind path function, called from the node draw.
- **Per-node colour from `kind`**: in the coarse path, batching becomes one fill
  per (kind, colour) and not just per colour.
- **Marks**: drawn after the glyph in the same item.
- **Curved edges**: a quadratic Bézier with the control point projected from
  model space (a residual arcs out along +x of its stack), so curves rotate
  with the scene.
- **Edge width and alpha from |weight|**, and edge hue from the sign at L1.
- **Band outlines**: a third item kind (four projected corner lines and a
  translucent fill), sorted by depth with the others. Band items rank below
  nodes and edges in both emphasis modes.

`Renderer.ts` stays the only drawing module, and `RenderSurface` gains only
`quadraticCurveTo` (and `setLineDash` for dropout), which both 2D contexts and
the test fake implement.

### D12. UI. Settled

- **The chooser is replaced by a loader**: a file picker, drag-drop onto the
  canvas, and `?model=`.
- **A model panel** shows implementation, shape, input, model width, band count,
  and node and edge counts at the current level.
- **Selecting a component** shows its spec fields and weight statistics (shape,
  min, max, mean, RMS, computed once in the reader), plus expand and collapse.
- **The emphasis buttons, camera console, touch and context menu stay**, and
  "reset layout" re-seeds from the band grid.

## 4. Design notes

### 4.1 Reader (`src/network/Format2.ts`, pure)

- Validate `format === 2`, `implementation in {numpy, rust}` (D2) and `shape`
  in `{sequence, multiclass, single_output, window_recurrent}`. Refuse
  `ensemble` for now with a named error. Its `classifiers` are format-2 files,
  so a later version can show one stack per classifier.
- **Expand** the layers exactly as `expand_specs` does: residual -> fork, body,
  add; branches -> split, each branch with `branch` after all but the last, then
  merge if merged.
- **Index weights** by expanded index. A window-recurrent file then has, per
  factor, `[q]`, `[W, U, b]`, `[E]` if coded, then `[c]`
  (`recurrence_parameters`).
- Check each entry's array shapes against the spec (for example, attention's
  `Wq` against `d`, `heads` and `key_size`; PR 3 pins each kind's orientation
  from indrajala-ml's numpy layers). A mismatch is a named error that cites the
  entry's path.
- Keep weights as one `Float32Array` per parameter, which halves the JSON's
  memory. Compute the statistics here.

### 4.2 Builder (`src/network/BuildGraph.ts`, pure)

`buildGraph(model, expanded: Set<id>) -> { graph, attributes, bands, ids }`.
Band assignment follows D8's table. The builder is deterministic: insertion
order is the expanded-layer order, then component order, then unit order. That
keeps invariant 4 (deterministic order) meaningful.

### 4.3 Solver

`stepPhysics` takes the band table and the band array. After the
velocity-and-position pass, one loop clamps and zeroes velocity per axis. The
Barnes-Hut and exact paths are unchanged. The component anchor stays as it is,
since a network's render graph is connected through its data-flow edges.

## 5. Phased delivery

Each PR is one branch, squash-merged with `main` green, in this order.

| PR | content | done when |
| --- | --- | --- |
| 1 | this workplan | merged |
| 2 | **Drop the other graph types (D1).** Remove `Smiles`, `Molecules`, `GraphWizard`, the chooser, `GraphSpec`'s kinds and their tests; move the generator to `test/support/`; rewrite `docs/graphs.md` as `docs/networks.md`, plus the README pitch | suite and bench green; no product import of the generator (architecture test) |
| 3 | **Reader (D2, D4, §4.1).** `NetworkModel`, expansion, weight indexing, shape checks, statistics | unit tests on hand-built minimal format-2 objects (no model data committed); an integration test reads real files from the sibling repos when present (`../indrajala-models`, `../indrajala-studies/data`) and skips otherwise; every file in the census parses |
| 4 | **Builder and wire (D4, D7 L0 only, D10).** Attribute arrays and band table on both inits | mirrors round-trip the attributes; a rebuild re-inits both workers |
| 5 | **Band clamp (D5, D6).** Solver, both paths, drag included; new invariant; initial fit | invariant test after N steps on real models, in-process and in the worker engine; bit-equal paths |
| 6 | **Renderer (D8, D11).** Glyphs, marks, family colours, curved residual and loop edges, band outlines | fake-context tests per glyph and mark; contrast check of the palette; frame benchmark unchanged within noise on the L0 graph |
| 7 | **UI (D3, D12).** `ModelSource` (file, drag-drop, `?model=`), model panel, selection details | entrypoint tests with the file source; `textContent` everywhere |
| 8 | **Expand and collapse (D7 L1).** Unit level, top-k weight edges, stable-id position carry-over | expanding every component of the tinyshakespeare model stays within the 4096-node regime; positions survive a toggle |
| 9 | **Measure and document.** Step and frame times on real models at L0 and fully expanded; `performance.md`, `model-camera-and-rendering.md`, `known-limitations.md`, `next-steps.md` | numbers recorded; this workplan's Status set to Implemented |

Later, gated on other work:

- the server `ModelSource`, with a view payload stripped server-side (D3);
- the cross-attention and grouped-query views, once format 2 has them (D9);
- ensembles as several stacks (§4.1);
- `next-steps.md` row 5 (component packing), which mostly goes away under bands.
