import { Graph } from "./Graph";
import { K } from "./K";
import { Point2D } from "./Point2D";
import { Projector } from "./Projector";
import { Tag } from "./Tag";

/**
 * Resolve a canvas click to a node and apply it to the selection.
 *
 * One pass projects each node to canvas space and finds the nearest one inside
 * the hit radius, then the whole selection is cleared and the hit node is
 * toggled - so clicking a selected node deselects it, and clicking empty space
 * clears the selection.
 *
 * The hit radius is a screen-space constant, so "click the node" means the same
 * number of pixels at every canvas scale and camera distance.
 *
 * A culled node is skipped: it is not drawn, so a click where it would have
 * been must not select it. An exact screen tie is broken by depth, so a click
 * that lands on an overlapping pair selects the front node.
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
	projector: Projector
): boolean {

	const viewport = projector.viewport;

	// A collapsed viewport (a hidden canvas) maps every node onto the centre,
	// which would make the "nearest" pick arbitrary. Select nothing instead.
	if (viewport.w1 <= 0 || viewport.h1 <= 0)
		return false;

	// Best distance so far, seeded with the squared hit radius so only a node
	// inside it can win. Measured in canvas space, from the node's live model
	// position rather than the step-cached translatedPosition, which can lag a
	// pointer-written drag position by up to a tick.
	let best = K.ui.minimumNodeSelectionRadiusPx * K.ui.minimumNodeSelectionRadiusPx;
	let bestDepth = Infinity;
	let closest: Tag | null = null;

	for (const node of graph.vertices) {

		const projected = projector.project(node.position);

		if (projector.isCulled(projected.depth))
			continue;

		const at = viewport.toCanvas(projected.screen);
		const deltaX = at.x - canvasPos.x;
		const deltaY = at.y - canvasPos.y;
		const r2 = deltaX * deltaX + deltaY * deltaY;

		// Strictly closer wins; an exact tie is broken by depth, so the node
		// nearest the camera takes the click. The tie-break only applies once a
		// candidate exists, so a node exactly at the hit radius is still
		// outside it.
		if (r2 < best || (closest !== null && r2 === best && projected.depth < bestDepth)) {
			best = r2;
			bestDepth = projected.depth;
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
