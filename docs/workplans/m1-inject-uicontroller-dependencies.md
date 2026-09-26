# M1 — Inject `UIController`'s dependencies

| | |
| --- | --- |
| **Finding** | M1, medium — the controller is a service locator over `window` |
| **Status** | Planned |
| **Area** | `src/UIController.ts`, `src/entrypoint.ts`, `test/support/dom.ts` + four UI test files |
| **Depends on** | nothing |
| **Blocks** | M2 (both rewrite `onTimerTick`; land this first to avoid resolving the same conflict twice) |

## 1. Problem

`UIController` reaches into the global `window` for every piece of state it owns:

```ts
// src/UIController.ts:8-13
declare global {
    interface Window {
        state: State;
        fdg: ForceDirectedGraph;
    }
}
```

and then reads/writes `window.state` and `window.fdg` in sixteen places
(`:62-66, 70-86, 93-115, 127-141, 153, 232-234, 239-245, 303, 371-375`). Those
globals are installed by `initialize()` (`:371-375`).

This is a service locator. The class's real dependencies are invisible in its
signature, and the only way to test it is to replace `globalThis.window` with a
stub — which is precisely the workaround `test/support/dom.ts` exists to
provide. The solver was deliberately decoupled from the browser and a test
enforces that (`test/pipeline.test.ts:114-122`); the input layer was left
coupled, and nothing enforces *its* contract.

There is also a sequencing hazard: `initialize()` installs the globals, but
`onMouseOut`, `panTo` and `onTimerTick` all dereference them. Any path that runs
one of those handlers before `initialize()` throws `TypeError`, and no test
covers it because the fake window is pre-populated.

## 2. Evidence

```bash
grep -rn "window\.state\|window\.fdg" src/
# src/UIController.ts:62,63,64,65,70,74,76,81,93,95,99,103,109,114,127,129,135,136,140,153,193,
# 197,198,200,201,232,239,242,303,324,371,375
```

`entrypoint` is the only producer and it exposes nothing back:

```ts
// src/entrypoint.ts:80-82
uiController.initialize();
return true;
```

so `test/entrypoint.test.ts:37-39` has to assert the globals exist:
`assert.ok(dom.window.state)` / `assert.ok(dom.window.fdg)`.

## 3. Proposed change

The controller should own the state and a lazy reference to the solver, and take
a graph source it can call again on reset.

```ts
// src/UIController.ts
import { Graph } from "./Graph";

const defaultGraphSource = (): Graph =>
    new GraphFactory().generateGraph(
        K.initialConditions.order,
        K.initialConditions.branching
    );

export class UIController {

    /** Controller-owned input state; no longer a window global. */
    readonly state: State = new State();

    private solverRef: ForceDirectedGraph | null = null;

    constructor(
        body: HTMLElement,
        canvas: HTMLCanvasElement,
        context2D: CanvasRenderingContext2D,
        exportElement: HTMLElement,
        resetElement: HTMLElement,
        selectionInfoLabel: HTMLElement,
        selectionInfoList: HTMLElement,
        private readonly makeGraph: GraphSource = defaultGraphSource
    ) { /* assignments as today */ }

    /**
     * The live solver. Lazily built so handlers that run before initialize()
     * (and tests that never initialize) still have one; initialize() replaces
     * it on reset.
     */
    get solver(): ForceDirectedGraph {
        if (this.solverRef === null)
            this.solverRef = new ForceDirectedGraph(this.makeGraph());

        return this.solverRef;
    }

    initialize = () => {
        this.resizeCanvas();

        this.state.b0Down = false;
        this.state.b1Down = false;
        this.state.b2Down = false;
        this.state.lastMiddleDragPos = null;

        this.solverRef = new ForceDirectedGraph(this.makeGraph());

        this.buildContextMenu();
        this.toggleEventListeners(true);
        this.timer = setInterval(this.onTimerTick, K.physics.timerTickPeriodMS);
        this.updateSelectionInfo();
    };
}
```

Mechanical replacements inside the class: `window.state` → `this.state`,
`window.fdg` → `this.solver`. Delete the `declare global` block. `index.ts` and
`entrypoint.ts` never read the globals, so nothing else in `src/` changes.

**`entrypoint` return type.** With the globals gone, `entrypoint`'s only
observable output is its boolean, which cannot expose the controller to a caller
who wants to drive it (or to a test). Change it to return the controller:

```ts
// src/entrypoint.ts
export const entrypoint = (...): UIController | null => {
    // ... unchanged until the end
    uiController.initialize();
    return uiController;
};
```

`src/index.ts:5-11` ignores the return value, so it is a source-compatible
change for the only production caller. Every early `return false` becomes
`return null`. This is an API change and belongs in the PR description.

## 4. Tests to add / change

- `test/support/dom.ts`:
  - `newUIController(elements, { width, height, graph })` stops writing
    `windowStub.state` / `windowStub.fdg`; when `graph` is supplied it passes
    `makeGraph = () => graph`, otherwise it leaves the default.
  - Fixtures read `controller.state` and `controller.solver` instead of
    `dom.window.*`.
- `test/pan.test.ts` (fixture + 8 tests), `test/hidpi.test.ts` (3 tests),
  `test/context-menu.test.ts` (2 tests): swap `dom.window.state` →
  `controller.state` and `dom.window.fdg` → `controller.solver`.
- `test/entrypoint.test.ts`: assert on the returned controller
  (`result !== null`, `result.timer !== null`, `result.solver.graph.vertices`)
  instead of the globals; the failure tests assert `result === null`.
- **New textual guard**, matching the house style:
  `grep`-equivalent assertion that `src/` contains no `window.state` and no
  `window.fdg`, and that no `declare global` survives in `UIController.ts`.
- **New unit test** for the hazard this removes: calling `onMouseOut()`,
  `onTimerTick()` or `panTo()` on a freshly constructed controller (no
  `initialize()`) must not throw and must not require a global `window`.

## 5. Acceptance criteria

- No reference to `window.state` or `window.fdg` anywhere in `src/`.
- `declare global { interface Window … }` is gone from `UIController.ts`.
- `initialize()` / `terminate()` semantics unchanged: one interval, one listener
  set, reset still rebuilds the menu and re-registers exactly once
  (`test/context-menu.test.ts:182-195`).
- Constructing a controller and invoking any handler before `initialize()` does
  not throw.
- `npm run ci` green; test count does not fall.
- `entrypoint`'s new return type documented in the PR description; README needs
  no change (it never documented the boolean).

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Large, mechanical test churn hides a behavioural slip | The churn is a rename with no assertion changes; review it as such. Keep the physics tests untouched |
| Lazy `solver` builds an extra graph in production | It does not: `initialize()` assigns `solverRef` explicitly, so the lazy branch is only reached by tests/direct use |
| `entrypoint` callers depend on the boolean | The only production caller (`src/index.ts`) ignores it; grep for other callers before merging |
| A handler is missed and still references `window` | The textual guard plus the pre-initialize handler test catch it |
| `readonly state` breaks `terminate()` | `terminate()` never replaced `state`; reset now clears the existing object's fields instead of allocating, which is also one less allocation |

## 7. Out of scope

- Splitting input handling into a separate `InputController`.
- Changing pan, drag or selection semantics.
- Moving the solver's mapping helpers (that is M2/M3).

## 8. Verification

1. `npm run ci`.
2. `grep -rn "window\.\(state\|fdg\)" src/` returns nothing.
3. `BROWSER=... ./cli run`; run the manual interaction matrix (select, drag,
   pan, right-click menu, reset, resize), which exercises every handler that
   used to read a global.
