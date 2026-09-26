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

	const model = viewport.toModel(canvasPos);

	// Best distance so far, seeded with the squared hit radius so only a
	// node inside it can win.
	let best = K.ui.minimumNodeSelectionRadius * K.ui.minimumNodeSelectionRadius;
	let closest: Tag | null = null;

	for (const node of graph.vertices) {

		const deltaX = node.position.x - model.x;
		const deltaY = node.position.y - model.y;
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
