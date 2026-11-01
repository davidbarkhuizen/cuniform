# Handover

Current state only; rewritten each session (the previous one goes to
`~/code/backups/`).

## State (2026-11-01)

- **cuniform is a viewer for indrajala-ml format-2 networks.** The
  [network visualizer workplan](workplans/network-visualizer.md) is implemented:
  PRs 2–9 merged as #172–#179, and its Status says so. `npm run ci` is green and
  CI (typecheck, tests, production build) is a required check.
- What exists:
  - a reader (`src/network/Format2.ts`) for numpy and rust files; every one of
    the ~52k format-2 files in the sibling repositories parses (`npm run census`);
  - a builder (`src/network/BuildGraph.ts`) giving one node per component (L0),
    or a component's units with top-k weight edges (L1);
  - bands clamped in the solver (invariant 10);
  - the visual grammar in the renderer;
  - a loader (file picker, drop, `?model=`), a model panel, component details,
    and expand and collapse.
- Measured on real models (`docs/performance.md`, Networks): no frame over
  16.7 ms. A fully expanded step costs at most 13.9 ms (tinyshakespeare: 1,601
  nodes, 4,676 edges).

## In flight

Nothing.

## Next steps

None is owed by the workplan. The open rows are in
[next-steps.md](next-steps.md):

- **Gated on other work:**
  - the server `ModelSource` (row 11);
  - the cross-attention and grouped-query views, once indrajala-ml writes them
    into format 2 (row 12);
  - ensembles as several stacks (row 13).
- **Ready now:** label placement for deep models at L0 (row 14). Its labels
  overlap; see [known-limitations.md](known-limitations.md#networks).
- **Unchanged from before the visualizer:** rows 1–10.

## Things a new session needs

- **Format 2 is defined in indrajala-ml:**
  `indrajala_ml/model/persistence/format2.py` (the docstring is the spec),
  `format2_json.py` (`recurrence_parameters`) and
  `indrajala_ml/model/specs/layer_specs.py` (`expand_specs`, `spec_paths`).
  Files saved before the factored state (indrajala-ml #739) hold a single
  `state_size` at the top of `recurrence`; the reader reads one as one factor.
- **Real models** are read in place from sibling repos and never copied into
  git. `test/support/models.ts` names them, and their tests skip when the repos
  are absent (as on CI).
- **Visual checks:**
  - serve `~/code` with `python3 -m http.server 8765` after `./cli build`;
  - open `cuniform/web/index.html?model=/<repo>/<path>.json`;
  - take a screenshot with `google-chrome --headless=new --screenshot=...`;
  - collect real-canvas frame times with
    `node bench/render-frame-collect.mjs '<.../bench/render-frame.html?model=...&level=0|1>'`.
- **Commands:**
  - `npm run ci` (typecheck and tests, about 2 s);
  - `npm run bench` (includes the network rows);
  - `npm run census` / `./cli census [dirs]` (about 10 min over the studies data);
  - `./build-and-run.sh` (or `bash build-and-run.sh --build-only`). Node v24.

## Machines

Development runs on pyramidon (local build, tests, headless Chrome). Nothing
here needs the runners.
