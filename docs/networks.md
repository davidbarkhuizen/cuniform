# Networks

cuniform shows one kind of thing: a saved neural network from indrajala-ml, in
its **format 2** (see the
[network visualizer workplan](workplans/network-visualizer.md)). Format 2 is
defined in indrajala-ml: `indrajala_ml/model/persistence/format2.py` (its
docstring is the specification), `format2_json.py` (the codecs) and
`indrajala_ml/model/specs/layer_specs.py` (`expand_specs`, the layer expansion
that the weight indices follow).

Only **array networks** are read: the `numpy` and `rust` implementations, which
share one weight layout. A `python` file is refused with a named error (D2).

## The reader

[`src/network/Format2.ts`](../src/network/Format2.ts) turns a file's parsed JSON
into a `NetworkModel` ([`src/network/NetworkModel.ts`](../src/network/NetworkModel.ts)).
It is pure, and it takes the JSON object, never a path or a response, so every
model source feeds it the same way. It ignores `optimizer_state` and `rng`.

- **Refusals** are `Format2Error`s that name the problem: not format 2, a
  pure-Python file, an ensemble, an unknown implementation or shape, a
  recurrence on the wrong shape, a wrong weight count, or a weight array whose
  shape disagrees with its spec (cited by the entry's path, as indrajala-ml's
  `spec_paths` writes it: `layer 2, block body 1 (attention): Wq has shape ...`).
- **Expansion** matches `expand_specs`: a residual becomes fork, body, add (the
  fork and add name each other as `partner`); branches become split, each
  branch's layers with a branch end after all but the last, and a merge if
  merged. Each entry inside branches carries its `lane`.
- **Weights** are indexed by expanded position. A window-recurrent file then
  has, per factor, the pooling's `[q]`, the cell's `[W, U, b]`, the codes' `[E]`
  if coded and the initial state's `[c]`; these become entries with a `factor`.
  A recurrence saved before the factored state (one `state_size` at the top) is
  read as one factor.
- **Shapes** are checked as the reader walks the layers: dense `W` is
  (out, in); attention `Wq`, `Wk`, `Wv` are (heads · d_k, d) and `Wo` is
  (d, heads · d_k); a state input's `P` is (d, total state); a GRU cell's `W` is
  (3s, d), plus the other factors' states with the cross term, and `U` is
  (3s, s); conv `W` is (channels, in-channels · k²).
- **Components**: an attention entry becomes one component per head (its rows
  of `Wq`, `Wk`, `Wv`, its biases and its columns of `Wo`) plus its output
  projection; every other computing entry is one component; forks, splits,
  branch ends and dropouts have none. Each component counts its units.
- **Weights are `Float32Array`s**, row-major, with min, max, mean and RMS
  computed once.
- **An unknown kind** is kept as a generic entry with its weights decoded
  unchecked, so the entries after it still read their own weights.

`npm run census` parses every format-2 file in the sibling repositories (or
the directories given after `--`) and reports what parsed, by implementation
and shape, and every failure.

## The render graph

[`src/network/BuildGraph.ts`](../src/network/BuildGraph.ts) builds the render
graph from a `NetworkModel` at the component level (L0): one node per component
(an embedding, a layer norm, each attention head, an attention output
projection, a dense layer, each recurrent part, and a `+` or `Σ` where a block
or merged branches join), with the data flow between them as edges. It is pure
and deterministic: nodes go in expanded-entry order, then component order.

The graph's `attributes` ([`src/graph/Attributes.ts`](../src/graph/Attributes.ts))
are struct-of-arrays indexed like `vertices` and `edges`:

- per node: `kind` (the glyph), `band`, `group` (the component's index in the
  builder's list) and `marks` (causal, rotary, dropout, segments, hatched,
  hollow, and the activation);
- per edge: `edgeKind` (flow, residual skip, recurrent loop, cross term, unit
  weight; a `dotted` flag on the data leaving a dropout) and a signed `weight`
  normalised to [-1, 1];
- the band table: 7 values per band (y centre, half thickness, the x and z
  footprint bounds, the family).

**Bands** are keyed by stack, layer and lane. Layers run up model y from the
input; every computing entry has its own layer, except that a block's `+` sits
in the band of the body's last layer. Branches share layer bands, each in its
own z-lane, and the layers after them start above the tallest branch. A
window-recurrent network's parts sit above the window, one lane per factor:
the pooling and initial state, then the cell, then the codes. Each factor's
state (its codes, or its cell when continuous) has a recurrent loop edge to
every state input, and with the cross term the cells are joined. Band sizes are
`K.network`'s: fixed thickness and gap, and a footprint that grows with its
members. Nodes are seeded on a grid inside their band.

Both workers' init messages carry copies of the attributes, by transfer, and
rebuild them on their mirrors (D10). Frame and step requests are unchanged, so
nothing new crosses per frame; a rebuild sends a new init through the existing
generation path.

## Model sources

[`src/app/ModelSource.ts`](../src/app/ModelSource.ts) is the seam for where a
model comes from (D3): `load(): Promise<unknown>` hands the reader parsed JSON.
Two sources exist: a file (the picker or a drop onto the canvas) and a URL
(`?model=<url>`, for development against a local static server). A server
source joins later behind the same interface; a server's view payload, format 2
without `optimizer_state` and `rng`, needs no reader change.
`UIController.openModel(source)` reads, builds and shows the model; only the
latest open lands, and a refusal leaves the previous model on screen.

Until a model is loaded the canvas is empty and the panel says
`no model loaded`; `reset` rebuilds the graph from the loaded model, which
re-seeds the layout from the band grid.

## The random-graph fixture

The physics tests and the scaling benchmark need an input that scales to
thousands of nodes and rebuilds exactly from a seed, which no real model gives
on demand. That input is
[`test/support/GraphFactory.ts`](../test/support/GraphFactory.ts), a **test and
benchmark fixture only**: the architecture test fails if any product module
imports from outside `src/`.

`generateGraph(order, branching, seed?)` builds a sparse semi-random graph on
`order` nodes, as in the reference app's `graph_manipulator.generate_graph`:
each node starts between 1 and `branching` new edges, with no self-loops and no
duplicate edges. `branching` bounds the edges a node *starts*, not its degree:
the graph is undirected, so a node also collects the edges its neighbours start.
Every draw (positions, edge counts, partners) comes from `mulberry32(seed)` in
`core/Random.ts`, so one seed rebuilds the same graph exactly. Positions fill
the `K.space` cube.

The UI fixtures (`test/support/dom.ts`) give a controller the seeded 11-node,
branching-2 graph when a test supplies none.
