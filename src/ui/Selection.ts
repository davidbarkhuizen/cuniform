import { Graph } from "../graph/Graph";
import { K } from "../core/K";
import { Point2D } from "../core/Point2D";
import { Projector } from "../view/Projector";
import { Tag } from "../graph/Tag";

/** Nearest node within the hit radius, toggled; a miss clears. Returns whether the selection changed. */
export function handleNodeSelectionAttempt(
	graph: Graph,
	canvasPos: Point2D,
	projector: Projector
): boolean {

	const viewport = projector.viewport;

	// A collapsed viewport maps every node to the centre; select nothing.
	if (viewport.w1 <= 0 || viewport.h1 <= 0)
		return false;

	// Seeded with the squared hit radius; read from the live model position, which cannot lag a drag.
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

		// Strictly closer wins; an exact tie goes to the nearer camera depth. Needs a
		// candidate, so a node exactly at the radius is out.
		if (r2 < best || (closest !== null && r2 === best && projected.depth < bestDepth)) {
			best = r2;
			bestDepth = projected.depth;
			closest = node;
		}
	}

	// Before the clear, so the toggle still flips the hit node.
	const hitWasSelected = closest !== null && closest.isSelected;
	const hadSelection = graph.selectedVertex() !== null;
	graph.clearSelection();

	if (closest)
		closest.isSelected = !hitWasSelected;

	return closest !== null || hadSelection;
}
