# cuniform

A 3D viewer for saved neural networks (indrajala-ml format 2), in TypeScript:
each layer lies in its own band, components get their own glyphs, and the
layout is force-directed and projected onto a canvas in perspective.

The simulation is deliberately decoupled from the browser:
`ForceDirectedGraph.stepPhysics()` is pure physics and touches neither `window`
nor the canvas, so the whole model can be exercised headlessly in `test/`. The
projection is split out the same way: `Projector` is pure math too, so the solver
can use it without importing a canvas type. `step()` is `stepPhysics()` plus that
projection.

cuniform is built to be embedded, and a host page's main thread is not ours: it
owns the host's own animation, layout, input and rendering. Per-frame work that
scales with the node count — physics, projection and drawing — is therefore
designed to run off that thread, leaving the main thread input, camera state and
DOM chrome. The demo is one host; the frame budget that matters belongs to
whoever embeds the component.

## Documentation

- [Setup](docs/setup.md) — install, run, build and test, and how the repository
  is laid out.
- [Visual layout and interaction](docs/visual-layout-and-interaction.md) — the
  canvas, the overlay panel and every input gesture.
- [Networks](docs/networks.md) — what cuniform reads (format 2, array networks)
  and the random-graph test fixture.
- [Physics](docs/physics.md) — the force laws, the integrator, the step cadence
  and the physics worker.
- [Model, camera and rendering](docs/model-camera-and-rendering.md) — the 3D
  model space, the perspective projector, the depth cue and the render worker.
- [Constants](docs/constants.md) — every tunable in `K.ts`, and the stability
  constraint on `timeStep` and `friction`.
- [Performance](docs/performance.md) — the measured step, frame and generation
  profiles, scaling and complexity, and the benchmark harnesses.
- [Next steps](docs/next-steps.md) — the larger pieces of work, ordered by
  payoff over risk.
- [Invariants](docs/invariants.md) — the contract every change must keep.
- [Known limitations](docs/known-limitations.md) — the deliberate divergences
  from the reference model.
