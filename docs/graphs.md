# Graphs

A graph is described by a `GraphSpec`
([`src/graph/GraphSpec.ts`](../src/graph/GraphSpec.ts)), a discriminated value the chooser
produces and the controller remembers:

- `{ kind: "random", order, branching }` —
  `GraphFactory.generateGraph()`: a sparse semi-random graph on `order` nodes,
  where each node starts between 1 and `branching` new edges, with no self-loops
  and no duplicate edges. `branching` bounds the edges a node *starts*, not its
  final degree: the graph is undirected, so a node also collects the edges its
  neighbours start, and its degree can exceed `branching` — a 3-node graph with
  `branching = 1` is often a triangle. `order` is bounded by `K.chooser`
  (`2..4096`: `maxOrder` is a measured usability cap, not the old
  exact/Barnes-Hut crossover; see [Constants](constants.md)) and
  `branching` by
  `min(K.chooser.maxBranching, order - 1)` — a node cannot start more than
  `order - 1` distinct edges, so a larger value would silently start fewer edges
  than asked for.
- `{ kind: "molecule", id }` — a molecular graph from the catalog.

## The molecule catalog

[`src/graph/Molecules.ts`](../src/graph/Molecules.ts) holds twenty-three molecules: twenty
indole alkaloids, one flagship example per structural family, plus three outside
the class — chlorophylls a and b, the two compounds of the chlorin family, and
heme b, the iron porphyrin at haemoglobin's core. The families run tryptamine,
β-carboline, ergoline, yohimban, ibogan, aspidosperman, ajmaline, sarpagan,
akuammilan, strychnan, camptothecin, bisindole, Rauwolfia, carbazole, oxindole,
pyrroloindoline, eburnane, gelsemium, pyridocarbazole and uleine; the
chlorophylls add the chlorin and heme b the porphyrin. Each row carries its
PubChem CID, its published molecular formula, its IUPAC systematic name and an
isomeric SMILES verified against that CID — except the metal-bearing entries
(chlorophylls a and b and heme b), whose connected SMILES come from the PDB
chemical component dictionary (`CLA`, `CHL` and `HEM`), because PubChem writes
their chelated metals as separate ionic components.

The SMILES string is the artifact that can be checked at the source, so the
catalog stores it rather than a hand-copied adjacency list.
[`src/graph/Smiles.ts`](../src/graph/Smiles.ts) reads the subset the catalog needs — the
organic and aromatic subsets, bracket atoms, branches, ring closures, explicit
and directional bonds, disconnection — and rejects malformed notation with a
position-carrying `SmilesError`. A test parses all twenty-three entries and
asserts that the heavy-atom count derived from the SMILES equals the
non-hydrogen count of the formula, so a transcription error in either field
fails CI rather than silently distorting the graph.

A molecule's heavy atoms become nodes, labelled with element symbols (the
conventional skeletal reading — per-atom indices turn a 27-atom molecule into a
wall of text), and its bonds become edges. Bond order is parsed and carried but
every edge draws as one stroke; element colours and 2D depictions are out of
scope. The seed is a deterministic phyllotaxis spiral spaced at the spring rest
length, so a molecule starts near its settled shape and its first frame is
reproducible.
