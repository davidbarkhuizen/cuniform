import { otherEndpoint } from "./Edge";
import { Graph } from "./Graph";
import { K } from "./K";
import { point, Point2D, zero } from "./Point2D";
import { Tag } from "./Tag";
import { Viewport } from "./Viewport";

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

export class ForceDirectedGraph {

    graph: Graph;


    constructor(graph: Graph) {
        this.graph = graph;
    }

	render(context: CanvasRenderingContext2D) {

		const selected_node = this.graph.selectedVertex();
        
		// Clear the whole backing store in device space, independent of any
		// devicePixelRatio transform the caller applied for HiDPI.
		context.save();
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, context.canvas.width, context.canvas.height);
		context.restore();

		// EDGES
		//
		for (const edge of this.graph.edges) {

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

		for (const node of this.graph.vertices) {

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
	};

	/**
	 * Superpose one radial force onto the running (Fx, Fy) accumulator: a
	 * magnitude `m` directed along (dx, dy) toward the other endpoint, where
	 * `r` is `Math.hypot(dx, dy)`.
	 *
	 * The r == 0 guard and the unit vector exist here once, so repulsion and
	 * springs cannot disagree about direction; only the magnitude law and the
	 * direction's sign convention differ, and those stay at the call sites.
	 * `r` is passed in rather than recomputed because both callers already need
	 * it for their magnitude - recomputing it would double the cost of the
	 * O(N^2) repulsion pass.
	 */
	private static addRadial(
		Fx: number,
		Fy: number,
		dx: number,
		dy: number,
		r: number,
		magnitude: number
	): Point2D {

		if (r === 0)
			return point(Fx, Fy);

		return point(
			Fx + (magnitude * dx) / r,
			Fy + (magnitude * dy) / r
		);
	};

	netElectrostaticForceAtNode(tagA: Tag): Point2D {

		var F: Point2D = zero();

		for(let i = 0; i < this.graph.vertices.length; i++) {

			var tagB = this.graph.vertices[i];

			if(tagB == tagA)
				continue;

			// Away from B, so a positive magnitude pushes the pair apart.
			var deltaX = tagA.position.x - tagB.position.x;
			var deltaY = tagA.position.y - tagB.position.y;

			var r = Math.hypot(deltaX, deltaY);

			// The direction uses the true radius so the force stays exactly
			// radial; only the magnitude is evaluated at a clamped radius, which
			// bounds the r -> 0 singularity without altering the law for any
			// r >= minimumInteractionRadius.
			var r_law = Math.max(r, K.physics.minimumInteractionRadius);

			var scalar_force = K.physics.scalarForceConstant * K.physics.nodeCharge * K.physics.nodeCharge / Math.pow(r_law, K.physics.repulsionExponent);

			F = ForceDirectedGraph.addRadial(F.x, F.y, deltaX, deltaY, r, scalar_force);
		};

		return F;
	};

	netSpringForceAtNode(tag: Tag): Point2D {

		var F: Point2D = zero();

		var k = K.physics.springConstant;
		var l = K.physics.equilibriumDisplacement;

		// Walking the node's adjacency list visits each edge once per endpoint,
		// so the whole per-step spring pass is O(V + E) rather than O(V*E).
		var incident = this.graph.incidentEdges(tag);

		for(let i = 0; i < incident.length; i++) {

			var edge = incident[i];
			var other_tag = otherEndpoint(edge, tag);

			// A self-loop has no far endpoint, so it exerts no spring force.
			if (other_tag === null)
				continue;

			// Toward the neighbour, so a positive magnitude pulls the pair
			// together.
			var deltaX = other_tag.position.x - tag.position.x;
			var deltaY = other_tag.position.y - tag.position.y;

			var r = Math.hypot(deltaX, deltaY);

			// Hooke's law: k*(r - l) is positive when the spring is stretched
			// (r > l) so the node is pulled toward its neighbour, and negative
			// when compressed (r < l) so it is pushed away.
			var scalar_force = k * (r - l);

			F = ForceDirectedGraph.addRadial(F.x, F.y, deltaX, deltaY, r, scalar_force);
		};

		return F;
	};

	netForceAtNode(tag: Tag): Point2D {

		// net Force = net Electrostatic Force + net Spring Force

		var e = tag.netElectrostaticForce;
		var s = tag.netSpringForce;

		var nX = e.x + s.x;
		var nY = e.y + s.y;

		return point(nX, nY);
	};

	/**
	 * Damped, semi-implicit Euler:
	 *
	 *   v_new = v_old * FRICTION + F_net * TIME_STEP
	 *
	 * Velocity is updated before position (see step()), which is what makes
	 * the integration symplectic and keeps stiff springs stable.
	 */
	velocityAtTag(tag: Tag): Point2D {

		var f = this.netForceAtNode(tag);

		// RECORD PREVIOUS VELOCITY
		//
		var vx_old = tag.velocity.x;
		var vy_old = tag.velocity.y;

		var friction = K.physics.friction;
		var time_step = K.physics.timeStep;

		// NEW V = (OLD V * FRICTION) + (CURRENT NET FORCE * TIME_STEP)
		//
		var vx_new = (vx_old * friction) + f.x * time_step;
		var vy_new = (vy_old * friction) + f.y * time_step;

		return point(vx_new, vy_new);
	};

	/**
	 * Advance the simulation by exactly one step. Physics only: this method
	 * reads no DOM global and does no drawing, so it can be run headlessly.
	 *
	 * `isPinned` reports nodes the user is dragging; a pinned node keeps the
	 * position written by the pointer handler and its integrated displacement
	 * is discarded. Drawing is a separate call to `render()`.
	 */
	step(
		canvasWidth: number,
		canvasHeight: number,
		isPinned: (tag: Tag) => boolean = () => false
	) {

		/*
		for each node
		calc net electrostatic force
		calc net spring force
		calc velocity
		calc displacement [== velocity]
		effect displacements
		*/

		// ------------------------------------
		// FOR EACH NODE

		// CALCULATE NET FORCE
		//
		for (const tag of this.graph.vertices) {
			tag.netElectrostaticForce = this.netElectrostaticForceAtNode(tag);
		}

		for (const tag of this.graph.vertices) {
			tag.netSpringForce = this.netSpringForceAtNode(tag);
		}

		// CALC VELOCITY
		//
		for (const tag of this.graph.vertices) {
			tag.velocity = this.velocityAtTag(tag);
		}

		// ADJUST POSITION
		//
		// Displacement is the velocity computed above, so no separate pass is
		// needed. A dragged node keeps the position the pointer handler wrote
		// and has its velocity zeroed, so releasing the mouse does not fling it.
		for (const tag of this.graph.vertices) {
			if (isPinned(tag)) {
				tag.velocity = zero();
			} 
			else {
				const displacement = tag.displacement;
				tag.position.x = tag.position.x + displacement.x;
				tag.position.y = tag.position.y + displacement.y;
			}
		}

		// TRANSLATE TO CANVAS
		//
		// One viewport for the whole pass: the scale and the half-extents are
		// loop invariants, so they are computed once per tick, not per node.
		const viewport = Viewport.forCanvas(canvasWidth, canvasHeight);

		for (const node of this.graph.vertices) {
			node.translatedPosition = viewport.toCanvas(node.position);
		}
	};

	/**
	 * Resolve a canvas click to a node and apply it to the selection.
	 *
	 * One pass finds the nearest node inside the hit radius, then the whole
	 * selection is cleared and the hit node is toggled - so clicking a selected
	 * node deselects it, and clicking empty space clears the selection.
	 *
	 * Returns whether anything changed, which the pointer handler uses to decide
	 * whether the info panel needs repainting.
	 */
	handleNodeSelectionAttempt(canvasPos: Point2D, canvasWidth: number, canvasHeight: number) {

		var model = Viewport.forCanvas(canvasWidth, canvasHeight).toModel(canvasPos);

		// Best distance so far, seeded with the squared hit radius so only a
		// node inside it can win.
		var best = K.ui.minimumNodeSelectionRadius * K.ui.minimumNodeSelectionRadius;
		var closest: Tag | null = null;

		for (const node of this.graph.vertices) {

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
		const hadSelection = this.graph.selectedVertex() !== null;
		this.graph.clearSelection();

		if (closest)
			closest.isSelected = !hitWasSelected;

		return closest !== null || hadSelection;
	};
};