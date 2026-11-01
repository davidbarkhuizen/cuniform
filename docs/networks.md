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
