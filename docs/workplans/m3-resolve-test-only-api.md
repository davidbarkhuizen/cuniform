# M3 — Resolve the test-only public API

| | |
| --- | --- |
| **Finding** | M3, medium — three public methods have no `src/` caller |
| **Status** | Planned |
| **Area** | `src/ForceDirectedGraph.ts`, `src/Graph.ts`, `src/UIController.ts`, `test/transform.test.ts`, `test/integrator.test.ts`, `test/graph.test.ts`, `test/adjacency.test.ts`, `README.md` |
| **Depends on** | M2 (overlaps on the mapping wrappers; either order works, see §5) |
| **Blocks** | nothing |

## 1. Problem

Three exported methods are called only by tests. Verified by grep across `src/`
and `test/`:

| Symbol | `src/` callers | `test/` callers | Verdict |
| --- | --- | --- | --- |
| `ForceDirectedGraph.wrapTranslate` (`:37`) | none | `test/transform.test.ts:73` | dead |
| `ForceDirectedGraph.displacementAtNode` (`:251`) | none | `test/integrator.test.ts:55,65` | dead |
| `Graph.removeNode` (`:23`) | none | `test/graph.test.ts` (5 tests), `test/adjacency.test.ts:108` | dead |

Because the tests exist, the suite reports green coverage over code the
application cannot reach. That inflates the confidence number the project relies
on as its safety net: "129 tests pass" currently includes certification of three
paths no user can trigger.

Worse, `removeNode` is load-bearing for a *second* piece of dead code:
`Graph.rebuildAdjacency` (`:115`) is private and called only from `removeNode`
(`:38`), so deleting `removeNode` without deleting it leaves an orphan.

`wrapTranslate` is additionally advertised to users:

```md
<!-- README.md:96-102 -->
`ForceDirectedGraph` exposes that mapping for a canvas size as
`wrapTranslate()` / `wrapReverse()`.
```

`wrapReverse` has three live `src/` callers, so it is not dead — but it is a
redundant wrapper around `Viewport.forCanvas(w, h).toModel(xy)`, which is exactly
what it returns. M2 proposes removing both wrappers and calling `Viewport`
directly.

## 2. Proposed change

Resolve each symbol by one of two honest rules: it has a `src/` caller, or it
carries a comment stating it is deliberately-public API. Nothing in between.

### `wrapTranslate` / `wrapReverse` — delete; callers use `Viewport`

`ForceDirectedGraph:32-39` and its `:336` call site become:

```ts
// src/ForceDirectedGraph.ts — the mapping helpers go away entirely
// src/Selection.ts (after M2)
const model = viewport.toModel(canvasPos);

// src/UIController.ts:74, 103-104
const vp = Viewport.forCanvas(this.width, this.height);
const phasePos = vp.toModel(mxy);
const now = vp.toModel(mxy);
const before = vp.toModel(last);
```

This deletes the last two non-physics members of the solver and removes a
duplicate of the mapping formula. If M2 lands first and already does this, M3
drops this bullet and only updates the test and README.

`test/transform.test.ts:69-77` ("wrapTranslate and wrapReverse are inverses…")
is deleted. Its property — the two mappings round-trip — is already covered,
better, at `test/transform.test.ts:42-56` ("toModel is the exact inverse of
toCanvas, at any canvas aspect ratio"), so no coverage is lost.

### `displacementAtNode` — delete; the real contract is `Tag.displacement`

`step` already reads the value through the getter (`src/ForceDirectedGraph.ts:307`):

```ts
const displacement = tag.displacement;
```

`displacementAtNode` is a second way to say the same thing. Delete it and rewrite
`test/integrator.test.ts:50-66` to assert the getter, which is what production
uses:

```ts
assert.deepEqual(a.displacement, { x: 0, y: 0 }, "velocity starts at zero");
// ...
assert.deepEqual(a.displacement, a.velocity);
```

The test keeps its purpose (displacement is the damped velocity, not the raw
force); only the accessor changes.

### `removeNode` — delete, with the counter-argument recorded

Recommendation: **delete**, and delete `rebuildAdjacency` with it, because the
demo never removes a node and the reconstruction logic is a maintenance cost with
no caller.

Counter-argument, which a reviewer may accept instead: `Graph` is a small
general-purpose structure and `removeNode` is a reasonable member of its API.
If that view wins, the method stays **and** the class doc comment says it is
public API with no in-tree caller, and the tests stay. Do not leave it
undocumented — that is the state this finding objects to.

Decision is a one-line change either way; §4 lists acceptance for both branches.

Deleted tests: the five `removeNode`-named tests in `test/graph.test.ts`
(`:8-65`, `:120-133`) and one in `test/adjacency.test.ts:99-113`. The
`hasEdge` half of "hasEdge and removeNode ignore edge direction" (`:120-133`)
must be **kept** — `hasEdge` is live (used by `GraphFactory:66`).

## 3. Tests to change

| Test | Change |
| --- | --- |
| `test/transform.test.ts:69-77` | delete (round-trip property retained at `:42-56`) |
| `test/integrator.test.ts:55,65` | `fdg.displacementAtNode(a)` → `a.displacement` |
| `test/graph.test.ts:8-65` | delete the four `removeNode` tests (delete branch) |
| `test/graph.test.ts:120-133` | keep `hasEdge` assertions, drop the `removeNode` half |
| `test/adjacency.test.ts:99-113` | delete (delete branch) |

**New regression guard.** Add a small test that the removed names do not
reappear as new public API, in the house textual-guard style
(`test/entrypoint.test.ts:100-110`): assert that `src/ForceDirectedGraph.ts`
contains neither `wrapTranslate` nor `displacementAtNode`, and — on the delete
branch — `src/Graph.ts` contains no `removeNode`. The guard documents *why* they
went, so a future contributor does not helpfully re-add them.

## 4. Acceptance criteria

- Every exported method in `src/` is either called from `src/` or carries an
  explicit "public API, no in-tree caller" comment. A one-off grep over the
  touched modules is the check; state the result in the PR.
- `src/` has no reference to `wrapTranslate`, `displacementAtNode`, or (delete
  branch) `removeNode` / `rebuildAdjacency`.
- README's "Model and canvas space" paragraph names `Viewport` as the mapping
  API and no longer promises `wrapTranslate()`.
- `npm run ci` green.
- **Test count falls**, and the PR description states by how much and which
  assertions were removed, per invariant 6's sanctioned exception. On the delete
  branch, expect roughly 6 fewer tests; no test is removed that covers live code.
- On the keep branch: `removeNode` and `rebuildAdjacency` are documented as
  public API with no in-tree caller, tests are retained, and test count is
  unchanged.

## 5. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Removing a method a future feature needs | `removeNode` is fully recoverable from git history, tests included; re-add with a caller |
| M2 and M3 both edit the mapping wrappers | Land M2 first; M3 then only touches the test, README and any residue. If M2 was not done, M3 does the mapping deletion itself and says so |
| A "test count must not fall" rule is violated | This is the one sanctioned exception and is stated in `docs/code-review.md` invariant 6; the PR must name the removed tests |
| The regression guard becomes stale if the API returns legitimately | The guard is a two-line assertion; changing it is a deliberate act with a reviewer |

## 6. Out of scope

- Auditing `test/`-only helpers in `test/support/` (those are scaffolding, not
  production API).
- Removing `Tag`'s cached force fields (M4) or other `Tag` members.
- Any change to `step`'s behaviour.

## 7. Verification

1. `npm run ci`.
2. `grep -rn "wrapTranslate\|displacementAtNode\|removeNode" src/` returns
   nothing (delete branch).
3. `BROWSER=... ./cli run`; selection and panning (the `wrapReverse` callers)
   behave identically.
