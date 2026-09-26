import { Graph } from "./Graph";
import { K } from "./K";
import { Point2D } from "./Point2D";
import { Projector } from "./Projector";
import { Tag } from "./Tag";

/**
 * Nearest node within the screen-space hit radius, or a clear on a miss; a
 * selected node is toggled off. Culled nodes are skipped and an exact tie goes
 * to the nearer one. Returns whether the selection changed.
 */
export function handleNodeSelectionAttempt(
	graph: Graph,
	canvasPos: Point2D,
	projector: Projector
): boolean {

	const viewport = projector.viewport;

	// A collapsed viewport (a hidden canvas) maps every node onto the centre,
	// which would make the "nearest" pick arbitrary; select nothing instead.
	if (viewport.w1 <= 0 || viewport.h1 <= 0)
		return false;

	// Seeded with the squared hit radius, so only a node inside it can win.
	// Measured from the live model position, which cannot lag a drag by a tick.
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

		// Strictly closer wins; an exact tie goes to the node nearer the camera.
		// The tie-break needs a candidate, so a node exactly at the radius is out.
		if (r2 < best || (closest !== null && r2 === best && projected.depth < bestDepth)) {
			best = r2;
			bestDepth = projected.depth;
			closest = node;
		}
	}

	// Captured before the clear, so the toggle still flips the hit node.
	const hitWasSelected = closest !== null && closest.isSelected;
	const hadSelection = graph.selectedVertex() !== null;
	graph.clearSelection();

	if (closest)
		closest.isSelected = !hitWasSelected;

	return closest !== null || hadSelection;
}
