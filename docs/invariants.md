# Invariants any change must keep

The suite enforces these, so they are the contract rather than suggestions:

1. **The pure modules stay DOM-free.** `test/architecture.test.ts` pins
   `PURE_MODULES`, and every DOM-facing module is listed with the marker that
   justifies it (`simulation.worker.ts` and `render.worker.ts` for `self`,
   `PhysicsRunner.ts` for `Worker`, `RenderRunner.ts` for `getContext`,
   `UIController.ts` for `window`). The renderer is compiled against
   `RenderSurface` ([`src/render/RenderSurface.ts`](../src/render/RenderSurface.ts)), a
   structural subset of both 2D contexts and of the fake context the tests draw
   with, so `Renderer.ts` names no canvas type and stays DOM-free. A new solver
   or geometry module joins `PURE_MODULES`; only `Renderer.ts` draws.
2. **One projector per frame.** Whichever backend draws resolves one projector,
   projects the graph with it and draws with the same camera, so the renderer's
   cull boundary sees the depth values cached with that camera. In-process that
   happens on the canvas's own context; with the render worker it happens in the
   worker realm, from the camera that crossed in the frame message. Physics steps
   never resolve a projector of their own.
3. **Frozen pre-step snapshot.** Every force in a step is computed from
   positions as they were at the start of the step, so no node sees a
   half-updated neighbour. That includes the component anchor: its centroids
   accumulate from the same frozen positions before the velocity pass writes
   anything, and it only reads positions of nodes in one component.
4. **Deterministic order.** Iteration follows the `vertices`/`edges` insertion
   order, and the painter sort is an explicit `(depth descending, insertion
   index ascending)` comparator, so equal depths keep edge-before-node order and
   a layout is reproducible.
5. **Pinned-node semantics.** A dragged node keeps the position the pointer
   writes, has its velocity zeroed, is skipped by integration, and still exerts
   forces. Dragging never teleports depth.
6. **The exact 2D reduction.** With the identity orientation, `focalLength ==
   distance` and `z == 0`, projection reduces bit-exactly to the 2D viewport
   mapping.
7. **`Tag` owns its points.** The solver never aliases a `Tag.position` into
   scratch state in a way that lets a read observe a half-written step.
8. **Allocation-free steady state.** A physics step runs over pooled flat
   buffers and the draw path over reusable frame scratch. Across the render
   boundary the main thread fills a pooled position buffer and posts it by
   transfer, and the worker returns that same buffer with the `drawn` ack, so a
   steady-state frame allocates no typed array on the main thread; the depth
   write-back is an in-place loop over the returned array.

When timing a change, time it with the committed benchmark and report force
error alongside any time that moves an approximation; "it feels faster" is not
evidence, and neither is a fake-context render time presented as a real frame
cost.
