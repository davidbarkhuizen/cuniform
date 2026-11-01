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

Until a model is loaded the canvas is empty and the panel says
`no model loaded`; `reset` rebuilds the graph from its source, which re-seeds
the layout.

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
