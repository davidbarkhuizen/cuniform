import { otherEndpoint } from "./Edge";
import { Graph } from "./Graph";
import { K } from "./K";
import { point, Point2D, zero } from "./Point2D";
import { Tag } from "./Tag";
import { Viewport } from "./Viewport";

export class ForceDirectedGraph {

    graph: Graph;


    constructor(graph: Graph) {
        this.graph = graph;
    }

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

	/**
	 * The repulsion magnitude law, k*q^2 / max(r, minimumInteractionRadius)^exp.
	 *
	 * One home, so the per-node reference below and the paired accumulation in
	 * step() cannot drift apart.
	 */
	private static repulsionMagnitude(r: number): number {

		var r_law = Math.max(r, K.physics.minimumInteractionRadius);

		return K.physics.scalarForceConstant * K.physics.nodeCharge * K.physics.nodeCharge / Math.pow(r_law, K.physics.repulsionExponent);
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
			var scalar_force = ForceDirectedGraph.repulsionMagnitude(r);

			F = ForceDirectedGraph.addRadial(F.x, F.y, deltaX, deltaY, r, scalar_force);
		};

		return F;
	};

	/**
	 * Accumulate all-pairs repulsion into `out`, one evaluation per unordered
	 * pair. The two forces are equal and opposite, so the magnitude and the
	 * unit vector are computed once and applied with opposite signs.
	 *
	 * Newton's third law, and the reason this halves the O(N^2) hot loop.
	 *
	 * Internal: public so the equivalence test can call it, but step() is its
	 * only production caller.
	 */
	accumulateRepulsion(out: Point2D[]): void {

		const verts = this.graph.vertices;

		for (let i = 0; i < verts.length; i++) {

			const a = verts[i];

			for (let j = i + 1; j < verts.length; j++) {

				const b = verts[j];

				// Away from b for a, away from a for b: the same (dx, dy) with
				// opposite signs.
				const deltaX = a.position.x - b.position.x;
				const deltaY = a.position.y - b.position.y;
				const r = Math.hypot(deltaX, deltaY);

				// addRadial() owns the r === 0 guard, so a coincident pair
				// contributes nothing on either side - exactly as before.
				const magnitude = ForceDirectedGraph.repulsionMagnitude(r);

				out[i] = ForceDirectedGraph.addRadial(out[i].x, out[i].y, deltaX, deltaY, r, magnitude);
				out[j] = ForceDirectedGraph.addRadial(out[j].x, out[j].y, -deltaX, -deltaY, r, magnitude);
			}
		}
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

	/**
	 * Net force on `tag`, recomputed from the current positions. Pure: it reads
	 * no cached field, so it is meaningful before the first step() and can
	 * never observe a half-written tick.
	 */
	netForceAtNode(tag: Tag): Point2D {

		// net Force = net Electrostatic Force + net Spring Force

		var e = this.netElectrostaticForceAtNode(tag);
		var s = this.netSpringForceAtNode(tag);

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
	 *
	 * `force` defaults to the net force at the node's current position; step()
	 * passes the force it already computed from the frozen snapshot so the
	 * O(N^2) kernel is not recomputed.
	 */
	velocityAtTag(tag: Tag, force: Point2D = this.netForceAtNode(tag)): Point2D {

		var f = force;

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

		const vertices = this.graph.vertices;

		// PASS 1 - repulsion once per unordered pair, springs once per incident
		// edge. Both are pure functions of the frozen pre-step positions, so
		// every node sees the same snapshot. No force data is written onto a
		// Tag; the arrays below are this tick's only home for it.
		const electrostatic: Point2D[] = vertices.map(() => zero());
		this.accumulateRepulsion(electrostatic);

		const forces: Point2D[] = vertices.map((tag, i) => {
			const s = this.netSpringForceAtNode(tag);
			const e = electrostatic[i];

			return point(e.x + s.x, e.y + s.y);
		});

		// PASS 2 - velocities. The force already computed above is passed in,
		// so the O(N^2) repulsion kernel is not run a second time.
		const velocities = vertices.map((tag, i) => this.velocityAtTag(tag, forces[i]));

		// PASS 3 - positions. A dragged node keeps the position the pointer
		// handler wrote and has its velocity zeroed, so releasing the mouse
		// does not fling it.
		for (let i = 0; i < vertices.length; i++) {
			const tag = vertices[i];

			if (isPinned(tag)) {
				tag.velocity = zero();
			}
			else {
				tag.velocity = velocities[i];

				// The displacement is the damped velocity computed above.
				const displacement = tag.displacement;
				tag.position.x = tag.position.x + displacement.x;
				tag.position.y = tag.position.y + displacement.y;
			}
		}

		// PASS 4 - refresh the canvas-space cache.
		//
		// One viewport for the whole pass: the scale and the half-extents are
		// loop invariants, so they are computed once per tick, not per node.
		const viewport = Viewport.forCanvas(canvasWidth, canvasHeight);

		for (const node of vertices) {
			node.translatedPosition = viewport.toCanvas(node.position);
		}
	};
};