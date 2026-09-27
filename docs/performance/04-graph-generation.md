# Plan 4 — Graph generation

Status: proposed · Depends on: nothing · Blocks: nothing, but it is the natural
first PR because it makes large-N testing practical

## Objective

Turn `GraphFactory.generateGraph` from roughly `O(V²·E)` into `O(V + E)`, and
make `Graph.hasEdge` an O(1) membership test. Today no large graph can even be
loaded: generation takes 55 seconds at order 2048, before the solver runs.

## Why

Measured `generateGraph(order, branching=3)`:

| order | time |
| ---: | ---: |
| 256 | 83 ms |
| 512 | 1.0 s |
| 1024 | 5.4 s |
| 2048 | 55 s |

This is worse than the physics it feeds. The cause is in
`src/GraphFactory.ts` `generateGraph`: for every vertex it builds a candidate
list with

```ts
const candidates = graph.vertices.filter(v => v !== tag && !graph.hasEdge(tag, v));
```

and `Graph.hasEdge` (`src/Graph.ts`) is a linear scan over **every edge**. That
makes each edge attempt `O(V · E)`, and there are up to `V · branching`
attempts.

## Current behaviour and semantics to preserve

The generation contract, as the tests pin it:

- `order` vertices, labelled `Node 0`..`Node {order-1}`, positions unique in
  `(x, y, z)` inside the 600³ model cube.
- Each vertex **starts** `1 + floor(random() * branching)` new edges (bounded by
  `branching`), with no self-loops and no duplicate edges. It may still collect
  extra edges from its neighbours, so final degree can exceed `branching`.
- If a vertex has no possible partner, it stops (today: `candidates.length ===
  0` breaks).
- Undirected: `hasEdge(a, b) === hasEdge(b, a)`, and `hasEdge(a, a) === false`.
- `build({kind:"random", ...})` must produce exactly what `generateGraph` does
  under the same `Math.random` stream (see `test/graph-generation.test.ts`).

Note that `Graph.addEdge` deliberately does **not** reject duplicate edges (the
force tests add one twice); duplicate avoidance is generation's job, via
`hasEdge`.

## Proposed design

### 1. O(1) `hasEdge` (`src/Graph.ts`)

Maintain a neighbour index alongside the existing adjacency lists:

```ts
private neighbourSets: Map<Tag, Set<Tag>> = new Map();
```

- `addNode` seeds an empty `Set` for the tag.
- `addEdge` adds each endpoint to the other's set (a self-loop adds the tag to
  its own set once, but `hasEdge(a, a)` must still return `false`, so special
  case it there).
- `hasEdge(v1, v2)` returns `v1 !== v2 && (this.neighbourSets.get(v1)?.has(v2) ?? false)`.

Keep `adjacency` (`Map<Tag, Edge[]>`) as the insertion-ordered incident-edge
list: `neighbours()` relies on that order, and invariant 4 depends on it. The
new index is membership only, `O(E)` memory (two `Tag` references per edge),
and idempotent under the duplicate edges `addEdge` still permits.

Using `Set<Tag>` by identity, not canonical string keys, avoids per-edge string
allocation in the hottest allocation path that remains.

### 2. Linear generation (`src/GraphFactory.ts`)

Replace the candidate-array construction with rejection sampling over vertex
indices, falling back to a scan only when the graph is nearly complete:

```
for each vertex index i:
    k = 1 + floor(random() * branching)
    for attempt in 0..k-1:
        for retry in 0..MAX_REJECTION_ATTEMPTS-1:
            j = floor(random() * order)
            if j !== i and !hasEdge(i, j): addEdge; break
        else:
            // dense fallback: linear scan for any non-neighbour, O(V)
            j = first non-neighbour of i
            if none: stop this vertex
            addEdge; break
```

- For sparse graphs (`branching ≤ 8`, order large) the inner rejection succeeds
  in `O(1)` expected attempts, so the whole pass is `O(V + E)`.
- `MAX_REJECTION_ATTEMPTS` (proposed 32) bounds the expected work; the linear
  fallback keeps small, near-complete graphs correct and terminating.
- The per-vertex count is still `1..branching`, so the existing statistical
  tests keep their meaning.

`constructXYZFactory`'s string-key `Set` is already O(1) and is no longer the
bottleneck; leave it, but note in the PR that it was measured and is not on the
critical path. (Its `attempt < 1000` cap stays as a termination guarantee.)

### 3. RNG stream changes — deliberate

The new sampling draws a different number of `Math.random()` values than the
old `filter` + random-pick, so a given seed produces a different graph. That is
acceptable: the suite pins invariants, not exact seeded topologies, and the one
seed-comparison test ("build of a random spec is exactly
generateGraph(order, branching)") compares the two entry points under the same
new algorithm, so it still passes. Call this out in the PR description.

## Correctness and invariants

- Invariant 4 (deterministic insertion order): edge insertion order still
  follows the vertex sweep and the attempt order, so a seeded run is
  reproducible.
- `hasEdge` semantics (undirected, no self) are directly tested and must not
  change.
- No change to `addEdge`/`addNode` rejection rules: a foreign or duplicate
  vertex still throws as today.
- Molecule generation is untouched.

## Test plan

- Extend `test/graph-generation.test.ts`:
  - `hasEdge` is O(1)-consistent: unknown tags return false; a duplicate edge
    added twice is still reported once; self is false; after `addNode` but
    before any edge, false.
  - A dense small case (e.g. order 4, branching 3) terminates, has no
    self-loops/duplicates, and never exceeds `order * branching` edges — this
    exercises the linear fallback.
  - Same-seed determinism: two runs under `withSeededRandom` produce identical
    shapes (guards the rejection sampling).
  - Existing invariant tests (sparse, ≤ branching, no duplicates/selfs, every
    vertex joined, order vertices, unique positions, cube fill) must pass
    unchanged.
- Add a generation timing entry to the committed benchmark for orders 512–8192
  so the fix is visible and regressions are caught on demand. Do **not** put a
  wall-clock assertion in the unit suite.

## Acceptance criteria

- `generateGraph(2048, 3)` ≤ 100 ms (from 55 s); `generateGraph(4096, 3)`
  ≤ 250 ms.
- `Graph.hasEdge` is O(1) and its existing test passes unchanged.
- `./cli ci` green with only additive tests.
- The benchmark reports generation time per order.

## Risks and mitigations

| risk | mitigation |
| --- | --- |
| Changing the RNG stream alters seeded layouts | documented; tests assert invariants, and build/generate stay consistent |
| `neighbourSets` drifts out of sync with `edges` | one writer (`addEdge`) updates both; add the consistency tests above |
| Dense fallback accidentally allows a self-loop or duplicate | fallback scans with the same `hasEdge` guard; dense-case test |
| Memory grows 2E references | acceptable; O(E), same order as `adjacency` |

## Out of scope

- Raising `K.chooser.maxOrder` (deferred follow-up; see the index).
- Changing the topology distribution or the branching semantics.
- Position generation (cube fill, uniqueness) — already fine.
