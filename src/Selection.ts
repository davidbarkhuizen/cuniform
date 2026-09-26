import { Graph } from "./Graph";
import { K } from "./K";
import { Point2D } from "./Point2D";
import { Tag } from "./Tag";
import { Viewport } from "./Viewport";

/**
 * Resolve a canvas click to a node and apply it to the selection.
 *
 * One pass finds the nearest node inside the hit radius, then the whole
 * selection is cleared and the hit node is toggled - so clicking a selected
 * node deselects it, and clicking empty space clears the selection.
 *
 * The hit radius is a screen-space constant, so "click the node" means the same
 * number of pixels at every canvas scale.
 *
 * Returns whether anything changed, which the pointer handler uses to decide
 * whether the info panel needs repainting.
 *
 * DOM-free, and a function rather than a method so the solver module no longer
 * has to carry hit-testing it never uses.
 */
export function handleNodeSelectionAttempt(
	graph: Graph,
	canvasPos: Point2D,
	viewport: Viewport
): boolean {

	// A collapsed viewport (a hidden canvas) maps every node onto the centre,
	// which would make the "nearest" pick arbitrary. Select nothing instead.
	if (viewport.w1 <= 0 || viewport.h1 <= 0)
		return false;

	// Best distance so far, seeded with the squared hit radius so only a node
	// inside it can win. Measured in canvas space, from node.position rather
	// than the step-cached translatedPosition, which can lag a pointer-written
	// drag position by up to a tick.
	let best = K.ui.minimumNodeSelectionRadiusPx * K.ui.minimumNodeSelectionRadiusPx;
	let closest: Tag | null = null;

	for (const node of graph.vertices) {

		const at = viewport.toCanvas(node.position);
		const deltaX = at.x - canvasPos.x;
		const deltaY = at.y - canvasPos.y;
		const r2 = deltaX * deltaX + deltaY * deltaY;

		// Strictly closer, so the first of two equidistant nodes wins.
		if (r2 < best) {
			best = r2;
			closest = node;
		}
	}

	// Capture the hit node's state before the clear, so the toggle still
	// flips it: clearing first would always leave it unselected.
	const hitWasSelected = closest !== null && closest.isSelected;
	const hadSelection = graph.selectedVertex() !== null;
	graph.clearSelection();

	if (closest)
		closest.isSelected = !hitWasSelected;

	return closest !== null || hadSelection;
}
