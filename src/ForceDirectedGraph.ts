import { otherEndpoint } from "./Edge";
import { Graph } from "./Graph";
import { K } from "./K";
import { point3, Point3D, zero3 } from "./Point3D";
import { Projector } from "./Projector";
import { Tag } from "./Tag";

export class ForceDirectedGraph {

    graph: Graph;


    constructor(graph: Graph) {
        this.graph = graph;
    }

	/**
	 * Superpose one radial force onto the running (Fx, Fy, Fz) accumulator: a
	 * magnitude `m` directed along (dx, dy, dz) toward the other endpoint, where
	 * `r` is `Math.hypot(dx, dy, dz)`.
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
		Fz: number,
		dx: number,
		dy: number,
		dz: number,
		r: number,
		magnitude: number
	): Point3D {

		if (r === 0)
			return point3(Fx, Fy, Fz);

		return point3(
			Fx + (magnitude * dx) / r,
			Fy + (magnitude * dy) / r,
			Fz + (magnitude * dz) / r
		);
	};

	/**
	 * The repulsion magnitude law, k*q^2 / max(r, minimumInteractionRadius)^exp.
	 *
	 * One home, so the per-node reference below and the paired accumulation in
	 * step() cannot drift apart. It depends only on the scalar radius, so the
	 * law is unchanged in 3D.
	 */
	private static repulsionMagnitude(r: number): number {

		var r_law = Math.max(r, K.physics.minimumInteractionRadius);

		var chargeProduct =
			K.physics.scalarForceConstant *
			K.physics.nodeCharge *
			K.physics.nodeCharge;

		return chargeProduct / Math.pow(r_law, K.physics.repulsionExponent);
	};

	netElectrostaticForceAtNode(tagA: Tag): Point3D {

		var F: Point3D = zero3();

		// Only used to break the exactly-coincident tie below; the paired pass
		// breaks it by index order, so this reference must agree.
		var selfIndex = this.graph.vertices.indexOf(tagA);

		for(let i = 0; i < this.graph.vertices.length; i++) {

			var tagB = this.graph.vertices[i];

			if(tagB == tagA)
				continue;

			// Away from B, so a positive magnitude pushes the pair apart.
			var deltaX = tagA.position.x - tagB.position.x;
			var deltaY = tagA.position.y - tagB.position.y;
			var deltaZ = tagA.position.z - tagB.position.z;

			var r = Math.hypot(deltaX, deltaY, deltaZ);

			// The direction uses the true radius so the force stays exactly
			// radial; only the magnitude is evaluated at a clamped radius, which
			// bounds the r -> 0 singularity without altering the law for any
			// r >= minimumInteractionRadius.
			var scalar_force = ForceDirectedGraph.repulsionMagnitude(r);

			// Exactly coincident centres have no radial direction, which would
			// leave an unconnected pair in a permanent fixed point. Break the
			// tie deterministically: the earlier node in the graph goes -x and
			// the later one +x, matching accumulateRepulsion(). A pair that
			// agrees in (x, y) but differs in z is an ordinary radial case and
			// never reaches this branch.
			var coincident = r === 0;
			var ux = coincident ? (selfIndex < i ? -1 : 1) : deltaX;
			var uy = coincident ? 0 : deltaY;
			var uz = coincident ? 0 : deltaZ;
			var ur = coincident ? 1 : r;

			F = ForceDirectedGraph.addRadial(F.x, F.y, F.z, ux, uy, uz, ur, scalar_force);
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
	accumulateRepulsion(out: Point3D[]): void {

		const verts = this.graph.vertices;

		for (let i = 0; i < verts.length; i++) {

			const a = verts[i];

			for (let j = i + 1; j < verts.length; j++) {

				const b = verts[j];

				// Away from b for a, away from a for b: the same (dx, dy, dz)
				// with opposite signs.
				const deltaX = a.position.x - b.position.x;
				const deltaY = a.position.y - b.position.y;
				const deltaZ = a.position.z - b.position.z;
				const r = Math.hypot(deltaX, deltaY, deltaZ);

				const magnitude = ForceDirectedGraph.repulsionMagnitude(r);

				// Exactly coincident centres have no radial direction. Break
				// the tie deterministically (earlier node -x, later node +x) so
				// the pair separates instead of sitting in a fixed point; the
				// substituted vector is unit length, so addRadial() needs no
				// special case.
				const coincident = r === 0;
				const ux = coincident ? -1 : deltaX;
				const uy = coincident ? 0 : deltaY;
				const uz = coincident ? 0 : deltaZ;
				const ur = coincident ? 1 : r;

				out[i] = ForceDirectedGraph.addRadial(out[i].x, out[i].y, out[i].z, ux, uy, uz, ur, magnitude);
				out[j] = ForceDirectedGraph.addRadial(out[j].x, out[j].y, out[j].z, -ux, -uy, -uz, ur, magnitude);
			}
		}
	};

	netSpringForceAtNode(tag: Tag): Point3D {

		var F: Point3D = zero3();

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
			var deltaZ = other_tag.position.z - tag.position.z;

			var r = Math.hypot(deltaX, deltaY, deltaZ);

			// Hooke's law: k*(r - l) is positive when the spring is stretched
			// (r > l) so the node is pulled toward its neighbour, and negative
			// when compressed (r < l) so it is pushed away.
			var scalar_force = k * (r - l);

			F = ForceDirectedGraph.addRadial(F.x, F.y, F.z, deltaX, deltaY, deltaZ, r, scalar_force);
		};

		return F;
	};

	/**
	 * Net force on `tag`, recomputed from the current positions. Pure: it reads
	 * no cached field, so it is meaningful before the first step() and can
	 * never observe a half-written tick.
	 */
	netForceAtNode(tag: Tag): Point3D {

		// net Force = net Electrostatic Force + net Spring Force

		var e = this.netElectrostaticForceAtNode(tag);
		var s = this.netSpringForceAtNode(tag);

		var nX = e.x + s.x;
		var nY = e.y + s.y;
		var nZ = e.z + s.z;

		return point3(nX, nY, nZ);
	};

	/**
	 * Damped, semi-implicit Euler, one axis at a time:
	 *
	 *   v_new = v_old * FRICTION + F_net * TIME_STEP
	 *
	 * Velocity is updated before position (see step()), which is what makes
	 * the integration symplectic and keeps stiff springs stable. The integrator
	 * is per-axis and the laws are radial, so z needs no new stability argument.
	 *
	 * `force` defaults to the net force at the node's current position; step()
	 * passes the force it already computed from the frozen snapshot so the
	 * O(N^2) kernel is not recomputed.
	 */
	velocityAtTag(tag: Tag, force: Point3D = this.netForceAtNode(tag)): Point3D {

		var f = force;

		// RECORD PREVIOUS VELOCITY
		//
		var vx_old = tag.velocity.x;
		var vy_old = tag.velocity.y;
		var vz_old = tag.velocity.z;

		var friction = K.physics.friction;
		var time_step = K.physics.timeStep;

		// NEW V = (OLD V * FRICTION) + (CURRENT NET FORCE * TIME_STEP)
		//
		var vx_new = (vx_old * friction) + f.x * time_step;
		var vy_new = (vy_old * friction) + f.y * time_step;
		var vz_new = (vz_old * friction) + f.z * time_step;

		return point3(vx_new, vy_new, vz_new);
	};

	/**
	 * Advance the simulation by exactly one step. Physics only: this method
	 * reads no DOM global and does no drawing, so it can be run headlessly.
	 *
	 * `isPinned` reports nodes the user is dragging; a pinned node keeps the
	 * position written by the pointer handler and its integrated displacement
	 * is discarded. Drawing is a separate call to `render()`.
	 *
	 * `projector` defaults to a fresh identity-camera projector for the canvas,
	 * so existing step(w, h) call sites keep compiling and a caller with no
	 * camera gets the old 2D mapping back exactly.
	 */
	step(
		canvasWidth: number,
		canvasHeight: number,
		isPinned: (tag: Tag) => boolean = () => false,
		projector: Projector = Projector.forCanvas(canvasWidth, canvasHeight)
	) {

		const vertices = this.graph.vertices;

		// PASS 1 - repulsion once per unordered pair, springs once per incident
		// edge. Both are pure functions of the frozen pre-step positions, so
		// every node sees the same snapshot. No force data is written onto a
		// Tag; the arrays below are this tick's only home for it.
		const electrostatic: Point3D[] = vertices.map(() => zero3());
		this.accumulateRepulsion(electrostatic);

		const forces: Point3D[] = vertices.map((tag, i) => {
			const s = this.netSpringForceAtNode(tag);
			const e = electrostatic[i];

			return point3(e.x + s.x, e.y + s.y, e.z + s.z);
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
				tag.velocity = zero3();
			}
			else {
				tag.velocity = velocities[i];

				// The displacement is the damped velocity computed above.
				const displacement = tag.displacement;
				tag.position.x = tag.position.x + displacement.x;
				tag.position.y = tag.position.y + displacement.y;
				tag.position.z = tag.position.z + displacement.z;
			}
		}

		// PASS 4 - refresh the canvas-space cache and the view depth.
		//
		// One projector for the whole pass: the camera and the viewport are
		// loop invariants, so they are resolved once per tick, not per node.
		for (const node of vertices) {
			const projected = projector.project(node.position);

			node.translatedPosition = projector.viewport.toCanvas(projected.screen);
			node.depth = projected.depth;
		}
	};
};
