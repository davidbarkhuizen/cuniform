import { Graph } from "./Graph";
import { K } from "./K";

/** Node markers are a filled dot; the selection ring is a larger stroke. */
const NODE_RADIUS = 5;
const SELECTION_RADIUS = 10;

/** A full circle, traced clockwise from angle 0 to a whole turn. */
const CIRCLE_START_ANGLE = 0;
const CIRCLE_END_ANGLE = 2 * Math.PI;
const CIRCLE_CLOCKWISE = true;

/** The highlight colour when `active`, otherwise the base colour. */
function colourFor(active: boolean, highlight: string, base: string): string {
	return active ? highlight : base;
}

/**
 * Draw `graph` onto `context`. The caller is responsible for any HiDPI
 * transform; this clears the backing store in device space and draws in CSS
 * pixels.
 *
 * A pure function, not a class: the renderer holds no state between frames, so
 * there is nothing for it to own.
 */
export function render(context: CanvasRenderingContext2D, graph: Graph): void {

	const selected_node = graph.selectedVertex();

	// Clear the whole backing store in device space, independent of any
	// devicePixelRatio transform the caller applied for HiDPI.
	context.save();
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, context.canvas.width, context.canvas.height);
	context.restore();

	// EDGES
	//
	for (const edge of graph.edges) {

		const v1 = edge.v1;
		const v2 = edge.v2;

		context.strokeStyle = colourFor(
			selected_node === v1 || selected_node === v2,
			K.colours.edgeIncident,
			K.colours.edgeDefault
		);

		// DRAW EDGE
		//
		context.beginPath();
		context.moveTo(v1.translatedPosition.x, v1.translatedPosition.y);
		context.lineTo(v2.translatedPosition.x, v2.translatedPosition.y);
		context.stroke();
	}

	// A frame constant: nothing drawn inside the loop changes the font.
	context.font = K.label.fontFamily;

	// Trace a full circle at (x, y), ready to be filled or stroked.
	const circle = (x: number, y: number, radius: number) => {
		context.beginPath();
		context.arc(x, y, radius, CIRCLE_START_ANGLE, CIRCLE_END_ANGLE, CIRCLE_CLOCKWISE);
	};

	for (const node of graph.vertices) {

		const x = node.translatedPosition.x;
		const y = node.translatedPosition.y;

		// NODES
		//
		context.fillStyle = colourFor(node.isSelected, K.colours.nodeSelected, K.colours.nodeDefault);

		circle(x, y, NODE_RADIUS);
		context.fill();

		if (node.isSelected) {
			circle(x, y, SELECTION_RADIUS);
			context.strokeStyle = K.colours.nodeSelected;
			context.stroke();
		}

		// LABEL / TEXT
		//
		context.fillStyle = K.colours.label;
		context.fillText(node.label, x + K.label.horizontalSpacing, y - K.label.verticalSpacing);
	};
}
