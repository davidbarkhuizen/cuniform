# cuniform — Code Review

The high and medium findings are remediated and retired. What remains is the
low-severity backlog, deliberately unplanned:

## Low-severity backlog

Not planned. Each is small; they belong in one later cleanup sweep.

| ID | Finding | Location |
| --- | --- | --- |
| L1 | `eslint` declared with no config or script; `ts-node` unused; `@types/node@25` is years ahead of the installed TypeScript 4.9.5 (masked by `skipLibCheck`) | `package.json:20-29` |
| L2 | `./cli typecheck` excludes `test/`; only `npm test` typechecks it | `tsconfig.json:19` |
| L3 | `.gitignore` uses unanchored `**.js` / `**.d.ts`, matching any future hand-written JS anywhere in the tree | `.gitignore:2,4` |
| L4 | Hand-maintained source (`index.html`, `stylez.css`) lives in the build-output directory | `dist/` |
| L5 | `getMousePos` adds `window.pageXOffset` on top of an `offsetParent` walk — correct only because the body cannot scroll | `src/UIController.ts:221-240` |
| L6 | `initialize()` is not idempotent: a second call without `terminate()` doubles intervals and listeners | `src/UIController.ts:429-449` |
| L7 | The selection panel lists neighbours in reverse of `graph.neighbours()` | `src/UIController.ts:394` |
| L8 | `DragController` only writes the panel position on `dragend`, so it snaps instead of tracking the cursor; no touch support | `src/DragController.ts:41-61` |
| L9 | No keyboard path: context-menu entries are `div`s with click handlers, the canvas has no fallback content | `src/ContextMenu.ts:41-56`, `dist/index.html:19` |
| L10 | `Tag`'s label counter is a module-global that never resets; `neighbours` dedupes with `indexOf` (O(deg²)); `src/ForceDirectedGraph.ts:57` is 132 columns; exactly coincident unconnected nodes are a permanent fixed point; `cli` lacks `set -euo pipefail` | various |
