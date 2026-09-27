# Visual layout and interaction

## Layout

The canvas fills the viewport: it is stretched over a fixed, full-viewport
`.canvas-container`, and the backing store is re-sized when the window is
resized. Everything else lives in a single floating overlay panel in the
top-left corner, split into three sections:

- a **fixed menu** — the `cuniform` title, the current graph, `export` and
  `reset`;
- the **currently selected node** — the selection and its neighbours;
- the **camera console** — six buttons that rotate the camera about its own
  axes, and two that dolly it in and out.

The panel's current-graph line names the loaded graph technically: the full
systematic name for a molecule, the node and edge counts for a random graph. It
is small and wraps, because a systematic name is long.

The graph **chooser** is not part of the panel: it is a modal dialog built in
`src/GraphWizard.ts` and appended to the body, layered above both the floating
panel and the context menu. The two overlays can never be open at once.

The panel is opaque and high-contrast so it stays readable over the graph, and
it can be dragged out of the way: with a mouse anywhere on the panel, or with a
touch on the grip at its top, so the panel body stays scrollable. The console is
excluded from that drag: a press that starts on a button never reaches the
panel's drag surface.

## Interaction

- **Left-click / left-drag** — selects the nearest node within the hit radius
  (listing its neighbours in the overlay panel's selected-node section) and
  drags it. A dragged node moves in the view plane through its current depth, so
  depth is preserved; a culled node drags on the near plane. An exact screen tie
  selects the node nearest the camera. A dragged node is pinned: it keeps the
  position the pointer writes and has its velocity zeroed.
- **Middle-drag** — orbits the camera around its target. The tilt is clamped just
  inside the poles so the view never flips over one.
- **Shift+middle-drag** — pans the camera target. Node positions are never
  touched, so a pan cannot perturb the simulation.
- **Wheel** — dollies the camera (zooms). The focal length is constant, so only
  the camera distance changes; it is clamped between `camera.minDistance` and
  `camera.maxDistance`.
- **Camera console** — three rows, one per camera axis, each with a clockwise
  and an anticlockwise button, and a fourth **zoom** row with a minus (out) and
  a plus (in). A press applies one small step — one simulation tick's worth, 3°
  of rotation at the default 60°/s, or one wheel notch of dolly — and **holding
  repeats it continuously**: one more step per simulation tick, so the motion is
  as smooth as the render and never jumps. The buttons are real buttons, so Tab
  reaches them and Enter or Space starts and stops a keyboard hold.
  Anticlockwise is the right-hand positive sense about that axis: on screen, x
  tilts the view about the horizontal, y turns it about the vertical, and z rolls
  it about the view axis. Unlike the middle-drag guard, an explicit axis rotation
  is free to carry the view through a pole. Each button draws its own icon rather
  than sharing one glyph: the ring is shown in the plane that axis turns in (tall
  for x, wide for y, round for z) and the arrowhead points the way the view
  turns. The zoom buttons share the wheel's dolly: the same clamp between
  `camera.minDistance` and `camera.maxDistance`, and the same constant focal
  length.
- **Right-click** — opens a context menu with `export`, `reset` and
  `clear selection`. The native browser menu is suppressed. On macOS
  `Ctrl+click` is the same gesture.
- **Shift+F10** (or the context-menu key) — opens the same actions menu from
  the keyboard. Its entries are buttons: Tab or the arrow keys move between
  them, Enter or Space activates one, and Escape closes the menu.
- **Drag the overlay panel** — by mouse or pen, anywhere on the panel; by touch,
  by the grip at its top. The grip is the only touch drag surface, so the panel
  body stays scrollable.
- **Graph chooser** — opens on first run and on every `reset`, and it is the only
  way a new graph is created. Step one picks a **random** graph or a
  **molecule**:
  - *random* — the node count and the maximum new edges per node, validated as
    you type; `generate` is disabled while either field is out of range, and an
    order above `K.chooser.interactiveOrder` (1024) shows a non-blocking hint
    that the layout may advance below 20 Hz;
  - *molecules* — a searchable word cloud of twenty-three molecules: twenty indole
    alkaloids, chlorophylls a and b, and heme b. The chip
    is the common name; its tooltip and accessible name carry the full
    systematic name, the family, the formula and the flagship note. Typing
    filters by common name, systematic name, parent ring system, family, formula
    or a synonym, and Enter takes the first visible chip.
  - Escape (or `cancel`) dismisses a reset chooser and leaves the running graph,
    the timer, the listeners and the camera exactly as they were. The first-run
    chooser is mandatory: there is no previous graph to keep, so it has no
    cancel. Tab is trapped inside the dialog.

A completed chooser **swaps the graph in place**: the timer, the listeners, the
context menu and the camera are all left alone, so the viewing angle and zoom
survive a reset or a molecule load. `initialize()` keeps its lifecycle meaning
(attach the listeners, build the menu, start the timer) and is not used to
change content.
