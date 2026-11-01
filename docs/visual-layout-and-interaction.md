# Visual layout and interaction

## Layout

The canvas fills the viewport: it is stretched over a fixed, full-viewport
`.canvas-container`, and the backing store is re-sized when the window is
resized. Everything else lives in a single floating overlay panel in the
top-left corner, split into five sections, read top to bottom as identity →
readings → camera → display → actions:

- a **fixed menu** — the centred `cuniform` title and the current graph;
- the **currently selected node** — the selection and its neighbours;
- the **camera console** — six buttons that rotate the camera about its own
  axes, and two that dolly it in and out;
- the **display emphasis** — two buttons that pick which of the graph's two
  elements is the subject of the frame;
- the **actions** — `export` and `reset`, at the foot of the panel.

The panel's current-graph line names the loaded model, says `no model loaded`,
or, when the last open was refused, says why (`could not open <name>: ...`,
with the reader's message) while the previous model stays on screen.

Under it are the **loader** and the **model panel**. `open model` is a label
for a visually hidden file input, so the native control's look never shows. A
file can also be dropped onto the canvas, and `?model=<url>` on the page's
address opens one from a local static server. The model panel lists the
implementation, shape, input, model width, the factors of a window-recurrent
network, the band count, and the node and edge counts at the current level.
Both elements are optional: an embedding host may leave them out.

Selecting a network's component (or one of its units) shows an `expand` (or
`collapse`) button and replaces the neighbour list with the component's
details: its kind, where it sits in the layers as written, its
units, its spec fields, and each weight array's shape with its min, max, mean
and RMS. Every string is written with `textContent`. Expanding shows the
component's units with weight edges to their strongest inputs; collapsing folds
them back and selects the component's node. The model panel's `weights per
unit` field sets how many incoming weights each unit draws (1 to 16).

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
- **Touch** — the canvas listens to Pointer Events, so mouse and pen keep the
  gestures above and touch maps to:

  | Gesture | Action |
  | --- | --- |
  | one finger down on a node, then move | select and drag the node |
  | one-finger tap on empty canvas | clear the selection |
  | one-finger drag on empty canvas | orbit |
  | two-finger pinch | dolly (the wheel's clamp, by the ratio of finger spread) |
  | two-finger drag | pan (the fingers' centroid) |
  | long press (`K.ui.longPressMS`, 500 ms) without moving | open the actions menu |

  A touch that moves less than `K.ui.touchSlopPx` (10 px) is a tap or a long
  press. A second finger cancels a one-finger gesture and starts a pinch, and
  after a pinch the remaining finger does nothing until every finger lifts. The
  canvas sets `touch-action: none`, so the page never scrolls or zooms under a
  gesture; the panel keeps its own touch scrolling.
- **Shift+F10** (or the context-menu key) — opens the same actions menu from
  the keyboard. Its entries are buttons: Tab or the arrow keys move between
  them, Enter or Space activates one, and Escape closes the menu.
- **Display emphasis** — two buttons, `nodes` (the default) and `edges`, in a
  labelled group. `nodes` draws the vertices over the mesh; `edges` draws the
  mesh over the vertices and 2.5 px heavier. It is a **frame** property, not a
  selection one: global, unpersisted (a reload starts at `nodes`), and it changes
  only what the drawer produces — never the graph, the physics, the camera, the
  selection or the hit-test. Switching it redraws; it never wakes a settled
  layout. The selected button carries `aria-pressed="true"`, and — because the
  panel is a drag surface and these are real buttons — a press on one never
  starts a drag. See
  [Display emphasis](model-camera-and-rendering.md#display-emphasis).
- **Drag the overlay panel** — by mouse or pen, anywhere on the panel; by touch,
  by the grip at its top. The grip is the only touch drag surface, so the panel
  body stays scrollable.
- **Reset** — rebuilds the graph from the loaded model (or the graph source,
  before one) and re-seeds the layout from the band grid. The
  graph is **swapped in place**: the timer, the listeners, the context menu and
  the camera are all left alone, so the viewing angle and zoom survive a reset.
  `initialize()` keeps its lifecycle meaning (attach the listeners, build the
  menu, start the timer) and is not used to change content.
