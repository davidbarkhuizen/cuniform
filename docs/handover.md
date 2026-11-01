# Handover

Current state only; rewritten each session (the previous one goes to
`~/code/backups/`).

## State (2026-11-01)

- `main` at 03bf8a7, green: `npm run ci` passes 610 tests; CI (typecheck, tests,
  production build) is a required check.
- The 2026-11-01 audit remediation is done (PRs #153–#169).
- **New direction:** cuniform becomes a viewer for indrajala-ml format-2 neural
  networks only. The plan is
  [workplans/network-visualizer.md](workplans/network-visualizer.md), with
  decisions D1–D12 settled. PR 1, the plan itself, merged as #170. Nothing else
  is built yet.

## In flight

Nothing.

## Next steps

Execute the workplan from **PR 2**, in its §5 order, one branch and PR per row.
Squash-merge each on green, sync `main` and delete the branch. Then:

1. **PR 2 — drop the other graph types (D1).** Remove `src/graph/Smiles.ts`,
   `Molecules.ts`, `src/ui/GraphWizard.ts`, the chooser, `GraphSpec`'s random
   and molecule kinds, and their tests (`smiles`, `molecules`, `graph-wizard`,
   `graph-chooser`, `graph-spec`, `test/support/catalog.ts`). Move
   `GraphFactory` to `test/support/`; `bench/physics.bench.ts` and
   `test/support/physics.ts` import it. `UIController.ts` and
   `test/architecture.test.ts` reference these modules too.
2. PRs 3–9 as the workplan lists them.

## Things a new session needs

- **Format 2 is defined in indrajala-ml:**
  `indrajala_ml/model/persistence/format2.py` (its docstring is the spec),
  `format2_json.py` (codecs; `recurrence_parameters` gives the window-recurrent
  weight order), and `indrajala_ml/model/specs/layer_specs.py`
  (`expand_specs`, the expansion the weight indices follow).
- **Array networks only (D2):** numpy and rust share one weight layout. The
  census found 0 pure-Python files among 1385.
- **Real files for the integration test.** They are read in place from sibling
  repos and never copied into git:
  - `../indrajala-models/addition/2026-10-11-sweep/models/*/network.json`
    (small sequence models);
  - `../indrajala-ml/data/generation/tinyshakespeare-2layer-rotary-e10-s0.json`
    (7.5 MB; d=64, 4 heads, rotary; the G7 scale case);
  - `../indrajala-studies/data/window-recurrent/division-probe-2b/seed4-certified-step-10.network.json`
    (window-recurrent, state inputs, 2 coded factors);
  - `../indrajala-studies/data/window-recurrent/window-branches/b2/move-to-front-5/seed0/step-23.network.json`
    (branches).
- **Not yet in format 2:** cross-attention and grouped-query attention (D9).
  Their grammar is planned and their code waits for indrajala-ml.
- **Model source (D3):** a local file now; the server source comes later behind
  the same interface.
- **Commands:** `npm run ci` (typecheck and tests), `npm run bench`, and
  `./build-and-run.sh` (`--build-only` to skip the browser). Node v24.

## Machines

Development runs on pyramidon (local: build, tests, browser). The suite takes
about 2 s, and nothing here needs the runners.
