# cuniform

3D force-directed graphs in TypeScript, projected onto a canvas in perspective.

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
  canvas, the overlay panel, the chooser and every input gesture.
- [Graphs](docs/graphs.md) — `GraphSpec`, random generation and the molecule
  catalog.
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
