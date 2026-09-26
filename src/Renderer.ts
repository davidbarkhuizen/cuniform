import { Graph } from "./Graph";
import { K } from "./K";
import { CameraView, isDepthCulled } from "./Projector";

// Node dot and selection-ring radii, in CSS pixels.
const NODE_RADIUS = 5;
const SELECTION_RADIUS = 10;

const CIRCLE_START_ANGLE = 0;
const CIRCLE_END_ANGLE = 2 * Math.PI;
const CIRCLE_CLOCKWISE = true;

function colourFor(active: boolean, highlight: string, base: string): string {
	return active ? highlight : base;
}

// One drawable primitive and the view depth that orders it.
interface DrawItem {
	depth: number;
	draw: () => void;
}

/**
 * Draw `graph` onto `context`: clears the backing store in device space, then
 * paints edges and nodes together, farthest-first (painter's algorithm), in CSS
 * pixels. `camera` must be the one that produced each node's cached depth.
 */
export function render(context: CanvasRenderingContext2D, graph: Graph, camera: CameraView): void {

	const selected_node = graph.selectedVertex();

	// Cleared in device space, independent of any devicePixelRatio transform the
	// caller applied for HiDPI.
	context.save();
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, context.canvas.width, context.canvas.height);
	context.restore();

	const { nearPlane, focalLength } = camera;

	// A node at or inside the near plane is not drawn and not selectable, but it
	// still exerts and feels force. An edge is skipped if either endpoint is
	// culled: there is no near-plane clipping here.
	const nodes = graph.vertices.filter(node => !isDepthCulled(node.depth, nearPlane));
	const edges = graph.edges.filter(
		edge => !isDepthCulled(edge.v1.depth, nearPlane) && !isDepthCulled(edge.v2.depth, nearPlane)
	);

	// The fade range spans everything actually drawn, so a shallow scene still
	// uses the full ramp; a flat scene has no range and draws at full opacity.
	let minDepth = Infinity;
	let maxDepth = -Infinity;

	for (const node of nodes) {
		minDepth = Math.min(minDepth, node.depth);
		maxDepth = Math.max(maxDepth, node.depth);
	}
	for (const edge of edges) {
		const depth = (edge.v1.depth + edge.v2.depth) / 2;
		minDepth = Math.min(minDepth, depth);
		maxDepth = Math.max(maxDepth, depth);
	}

	const hasRange = nodes.length > 0 && maxDepth > minDepth;

	// maxAlpha near, minAlpha far.
	const alphaFor = (depth: number): number => {
		if (!hasRange)
			return K.depthCue.maxAlpha;

		const t = (depth - minDepth) / (maxDepth - minDepth);
		return K.depthCue.maxAlpha + (K.depthCue.minAlpha - K.depthCue.maxAlpha) * t;
	};

	// Perspective size: nearer is larger, clamped at both ends.
	const radiusFor = (depth: number): number => {
		const raw = (NODE_RADIUS * focalLength) / depth;
		return Math.min(Math.max(raw, K.depthCue.minNodeRadiusPx), K.depthCue.maxNodeRadiusPx);
	};

	const circle = (x: number, y: number, radius: number) => {
		context.beginPath();
		context.arc(x, y, radius, CIRCLE_START_ANGLE, CIRCLE_END_ANGLE, CIRCLE_CLOCKWISE);
	};

	const items: DrawItem[] = [];

	for (const edge of edges) {

		const v1 = edge.v1;
		const v2 = edge.v2;

		// An edge sorts among its endpoints, not always behind or in front of them.
		const depth = (v1.depth + v2.depth) / 2;

		items.push({
			depth,
			draw: () => {
				context.globalAlpha = alphaFor(depth);
				context.strokeStyle = colourFor(
					selected_node === v1 || selected_node === v2,
					K.colours.edgeIncident,
					K.colours.edgeDefault
				);

				context.beginPath();
				context.moveTo(v1.translatedPosition.x, v1.translatedPosition.y);
				context.lineTo(v2.translatedPosition.x, v2.translatedPosition.y);
				context.stroke();
			},
		});
	}

	for (const node of nodes) {

		const x = node.translatedPosition.x;
		const y = node.translatedPosition.y;
		const depth = node.depth;
		const radius = radiusFor(depth);
		const ringRadius = (SELECTION_RADIUS * radius) / NODE_RADIUS;

		items.push({
			depth,
			draw: () => {
				context.globalAlpha = alphaFor(depth);

				context.fillStyle = colourFor(node.isSelected, K.colours.nodeSelected, K.colours.nodeDefault);

				circle(x, y, radius);
				context.fill();

				if (node.isSelected) {
					circle(x, y, ringRadius);
					context.strokeStyle = K.colours.nodeSelected;
					context.stroke();
				}

				context.fillStyle = K.colours.label;
				context.fillText(node.label, x + K.label.horizontalSpacing, y - K.label.verticalSpacing);
			},
		});
	}

	// Farthest first; sort is stable, so equal depths keep insertion order (edges
	// before nodes), preserving the old all-edges-then-nodes order when flat.
	items.sort((a, b) => b.depth - a.depth);

	// Frame constant: nothing drawn in the loop changes the font.
	context.font = K.label.fontFamily;

	for (const item of items)
		item.draw();
}
