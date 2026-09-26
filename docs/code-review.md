# cuniform — Code Review

A whole-repository review of `main` at `c205a22`, covering all of `src/`, all of
`test/`, the build and tooling config, and the hand-maintained demo assets.

**Snapshot.** `npm run ci` green: typecheck clean, **129 tests, 129 pass, ~0.57 s**.
`./cli build` bundles and `dist/main.js` was byte-identical to a fresh build.

The review found **one user-visible defect** and **six maintainability/correctness
risks**. Every high and medium finding was remediated; the low-severity items are
inventoried at the end as backlog and were deliberately not planned.

## Findings

| ID | Severity | Finding | Location |
| --- | --- | --- | --- |
| H1 | **High** | Export navigates to a `data:` URL, which modern browsers block | `src/UIController.ts:206-215` |
| M1 | Medium | `UIController` is a service locator over `window.state` / `window.fdg` | `src/UIController.ts` (throughout) |
| M2 | Medium | `ForceDirectedGraph` is physics + rendering + selection + mapping in one class | `src/ForceDirectedGraph.ts` |
| M3 | Medium | Three public methods have no `src/` caller; only tests keep them alive | `ForceDirectedGraph.wrapTranslate`, `ForceDirectedGraph.displacementAtNode`, `Graph.removeNode` |
| M4 | Medium | Forces are cached as mutable `Tag` fields, so a force read can be silently empty (already made one test vacuous) | `src/Tag.ts:14-19`, `src/ForceDirectedGraph.ts:206-217` |
| M5 | Medium | Hit radius is in model units, so clickability scales with the window | `src/ForceDirectedGraph.ts:340`, `src/K.ts:29-33` |
| M6 | Medium | The repulsion pass evaluates every unordered pair twice | `src/ForceDirectedGraph.ts:137-166, 284-285` |

## Invariants

These are the acceptance floor. A PR that relaxes one of them is wrong, not
merely risky. They are all enforced by existing tests except where noted.

1. **Jacobi ordering.** All forces are computed from one frozen position
   snapshot, then all velocities, then all positions. The result must stay
   independent of vertex and edge iteration order
   (`test/pipeline.test.ts:64-112`).
2. **The physics laws are untouched.** Repulsion `k·q²/r^1.9` clamped at
   `minimumInteractionRadius`, spring `k·(r − l)` with the correct sign
   (`test/forces.test.ts`, `test/robustness.test.ts`, `test/convergence.test.ts`).
3. **The solver stays DOM-free.** No `window`, `document` or canvas type in the
   physics module, enforced textually (`test/pipeline.test.ts:114-122`).
4. **No new runtime dependencies.** `dependencies` is `{}` and stays that way;
   the test harness is dependency-free by design (`test/support/dom.ts`).
5. **Every PR is green on its own.** `npm run ci` passes; ideally `./cli build`
   too, with the manual interaction matrix re-run when UI behaviour changes.
6. **Test counts do not fall**, with one sanctioned exception, exercised by M3:
   removing tests that certify dead code, with the reduction called out
   explicitly in the PR.
7. **No re-indentation.** `src/` mixes tabs and spaces within individual files;
   a repo-wide reformat would bury every real diff. Touch only the lines the
   change needs.

## Remediation outcome

All seven findings landed, each as its own focused PR, in the recommended order
(H1, M1, M3, M2, M5, M4, M6) — M1 before M2 because both rewrite
`UIController.onTimerTick`, M3 before M2 so the M2 diff stayed a pure move, and
M4 before M6 because both reshape `step()`.

| Finding | PR |
| --- | --- |
| H1 export via blob URL | [#50](https://github.com/davidbarkhuizen/cuniform/pull/50) |
| M1 inject `UIController` dependencies | [#51](https://github.com/davidbarkhuizen/cuniform/pull/51) |
| M3 resolve test-only API | [#52](https://github.com/davidbarkhuizen/cuniform/pull/52) |
| M2 split solver / render / selection | [#53](https://github.com/davidbarkhuizen/cuniform/pull/53) |
| M5 screen-space hit radius | [#54](https://github.com/davidbarkhuizen/cuniform/pull/54) |
| M4 local force state | [#55](https://github.com/davidbarkhuizen/cuniform/pull/55) |
| M6 symmetric repulsion pass | [#56](https://github.com/davidbarkhuizen/cuniform/pull/56) |

The per-finding workplans that drove this were retired once complete, matching
how the earlier DRY plan was handled. `npm run ci` is green at **138 tests**: the
suite was 129 at review time, M3's sanctioned six-test reduction (invariant 6) is
more than offset by the guards and regression tests added along the way, and every
other step raised the count.

---

## Review body

### What this is

A ~1,400-line TypeScript force-directed-graph demo: a DOM-free physics solver
(`ForceDirectedGraph.step`), a canvas renderer, a `UIController` for input, and a
hand-rolled zero-dependency test harness (129 tests) run under `node --test`.

The engineering discipline is well above average for a demo: exact-value physics
tests rather than snapshots, a Jacobi-ordering property test, a textual guard
that the solver never touches `window`/`document`, HiDPI handling, and comments
that explain *why* rather than restating the code.

### H1 — Export cannot work in Chrome/Firefox/Edge

`src/UIController.ts:206-215`

```ts
window.open(this.canvas.toDataURL('image/png'));
```

Top-frame navigation to `data:` URLs has been blocked in Chrome (since 60),
Firefox, Edge and IE, so `window.open('data:image/png;base64,…')` opens a window
that is not allowed to navigate and the image never appears. Confirmed by the
[Chrome 60 deprecation notice](https://developer.chrome.google.cn/blog/chrome-60-deprecations?skip_cache=true&hl=de)
and the canonical ["Window is not allowed to navigate Top-frame navigations to
data URLs"](https://stackoverflow.com/feeds/question/46666559#1) report.

The test gives false confidence: `test/context-menu.test.ts:154-166` replaces
`dom.window.open` with a recorder and asserts the data URL was passed — it cannot
observe the browser block.

### M1 — `UIController` is a service locator over `window`

`src/UIController.ts:8-13, 62-115, 129, 232, 239-244, 303, 371-375`

Every piece of state is read/written through `window.state` and `window.fdg`. The
solver was deliberately decoupled from the browser (and a test enforces it), but
the input layer was not, so it can only be tested by installing a fake global
`window` — exactly what `test/support/dom.ts` does. Injecting the state and a
graph source into the constructor would remove the ambient dependency and make
the controller's contract explicit.

### M2 — `ForceDirectedGraph` is four responsibilities in one class

`src/ForceDirectedGraph.ts`

Physics (`step`, `netElectrostaticForceAtNode`, `netSpringForceAtNode`,
`velocityAtTag`), rendering (`render`), hit-testing/selection
(`handleNodeSelectionAttempt`), and coordinate mapping (`wrapTranslate` /
`wrapReverse`). It works, but `render` drags `CanvasRenderingContext2D` into the
same module as the physics, and the "solver is DOM-free" invariant survives only
because a test greps the file text. A `Renderer` and a `Selection` helper (or at
least splitting `render`) would make the invariant structural instead of textual.

### M3 — Three public methods exist only to be tested

`src/ForceDirectedGraph.ts:37` (`wrapTranslate`), `:251` (`displacementAtNode`),
`src/Graph.ts:23` (`removeNode`).

Grep confirms no `src/` caller for any of them; only `test/` calls them, and
`README.md:102` documents `wrapTranslate`. Part of the 129-test green suite is
therefore certifying dead code, and the suite's confidence number overstates live
coverage.

### M4 — Forces are cached as mutable fields on `Tag`

`src/Tag.ts:14-19`, `src/ForceDirectedGraph.ts:206-217, 284-295`

`netForceAtNode` / `velocityAtTag` read `tag.netElectrostaticForce` and
`tag.netSpringForce`, which only mean something *after* `step`'s first two passes
have written them. Calling `netForceAtNode` outside `step` silently returns 0 —
which is why `test/integrator.test.ts:27-32` has to seed the fields by hand. It
also makes `Tag` a mutable simulation scratchpad rather than a data record.

**This has already produced a vacuous test.** `test/convergence.test.ts:30-46`
("at equilibrium the spring and repulsion forces balance") calls
`fdg.netForceAtNode(a)` without ever calling `step`, so it reads the
zero-initialised caches. A probe at `r = 65.46` confirms:

```
netForceAtNode BEFORE any step : {"x":0,"y":0}
true netElectrostaticForce + netSpringForce : {"x":0.0007603,"y":0}
```

The test asserts `|net.x| < 0.02` and passes against `0`, not against the real
`0.00076`. It is green for the wrong reason, and it is the exact failure mode the
temporal coupling invites: a force read that silently returns nothing. Fixing M4
turns this test back into a real assertion.

### M5 — Hit radius is in model units

`src/ForceDirectedGraph.ts:340`, `src/K.ts:29-33`

`minimumNodeSelectionRadius = 15` is compared against model-space distance. On a
600 px canvas that is 15 px; on a 2000 px display it is 50 px and nodes become
very sticky; on a 400 px window it is 10 px and they are hard to hit. Clickability
should not depend on the viewport size.

### M6 — Each node pair is repelled twice

`src/ForceDirectedGraph.ts:137-166`

`netElectrostaticForceAtNode` is called once per node and scans all others, so
`step` evaluates `N(N-1)` ordered pairs instead of `C(N,2)`. A probe measured 4
`Math.hypot` calls for a single node of a 5-node graph, i.e. 20 evaluations per
step where 10 would do. This is the O(N²) hot loop at 20 Hz, and each evaluation
also pays a `Math.pow`.

### Low-severity backlog

Not planned. Each is small; they belong in one later cleanup sweep.

| ID | Finding | Location |
| --- | --- | --- |
| L1 | `eslint` declared with no config or script; `ts-node` unused; `@types/node@25` is years ahead of the installed TypeScript 4.9.5 (masked by `skipLibCheck`) | `package.json:20-29` |
| L2 | `./cli typecheck` excludes `test/`; only `npm test` typechecks it | `tsconfig.json:19` |
| L3 | `.gitignore` uses unanchored `**.js` / `**.d.ts`, matching any future hand-written JS anywhere in the tree | `.gitignore:2-3` |
| L4 | Hand-maintained source (`index.html`, `stylez.css`) lives in the build-output directory | `dist/` |
| L5 | `getMousePos` adds `window.pageXOffset` on top of an `offsetParent` walk — correct only because the body cannot scroll | `src/UIController.ts:169-188` |
| L6 | `initialize()` is not idempotent: a second call without `terminate()` doubles intervals and listeners | `src/UIController.ts:367-384` |
| L7 | The selection panel lists neighbours in reverse of `graph.neighbours()` | `src/UIController.ts:332` |
| L8 | `DragController` only writes the panel position on `dragend`, so it snaps instead of tracking the cursor; no touch support | `src/DragController.ts:41-61` |
| L9 | No keyboard path: context-menu entries are `div`s with click handlers, the canvas has no fallback content | `src/ContextMenu.ts:41-56`, `dist/index.html:19` |
| L10 | `Tag`'s label counter is a module-global that never resets; `neighbours` dedupes with `indexOf` (O(deg²)); `src/ForceDirectedGraph.ts:160` is 145 columns; exactly coincident unconnected nodes are a permanent fixed point; `cli` lacks `set -euo pipefail` | various |

### What is good, explicitly

- The physics is faithfully tested against closed-form values
  (`test/forces.test.ts`), including the deliberate `r^-1.9` exponent and the
  equilibrium at 65.46.
- `test/pipeline.test.ts:64-112` is the standout test: it proves the update is
  synchronous/Jacobi and independent of vertex *and* edge iteration order —
  exactly the property a refactor would otherwise silently break.
- The `r → 0` singularity guard is documented as a non-reference extension and
  pinned from both sides (clamped below, untouched at and above
  `minimumInteractionRadius`).
- Zero runtime dependencies, and the fake DOM means the UI code is genuinely
  exercised without jsdom.
- The retired DRY remediation workplan (removed from the repository by the same
  change that added this review) was honest: it recorded that its own line-count
  targets were missed and why, rather than quietly deleting coverage.
