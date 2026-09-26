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

	// r == 0 and the unit vector live here once, so repulsion and springs cannot
	// disagree about direction. `r` is passed in because both callers already
	// need it, and recomputing it would double the O(N^2) repulsion pass.
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

	// Sole home for the magnitude law, so the per-node reference and the paired
	// accumulation in step() cannot drift apart.
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

		// Breaks the coincident tie below; the paired pass breaks it by index
		// order, so this reference must agree.
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

			// Only the magnitude is evaluated at a clamped radius, bounding the
			// r -> 0 singularity; the direction uses the true radius.
			var scalar_force = ForceDirectedGraph.repulsionMagnitude(r);

			// Coincident centres have no radial direction and would sit in a
			// permanent fixed point; tie-break by index, matching the paired pass.
			var coincident = r === 0;
			var ux = coincident ? (selfIndex < i ? -1 : 1) : deltaX;
			var uy = coincident ? 0 : deltaY;
			var uz = coincident ? 0 : deltaZ;
			var ur = coincident ? 1 : r;

			F = ForceDirectedGraph.addRadial(F.x, F.y, F.z, ux, uy, uz, ur, scalar_force);
		};

		return F;
	};

	// One evaluation per unordered pair: the forces are equal and opposite, so
	// magnitude and unit vector are computed once. Public only so the
	// equivalence test can call it; step() is the sole production caller.
	accumulateRepulsion(out: Point3D[]): void {

		const verts = this.graph.vertices;

		for (let i = 0; i < verts.length; i++) {

			const a = verts[i];

			for (let j = i + 1; j < verts.length; j++) {

				const b = verts[j];

				// Away from b for a, away from a for b: one delta, opposite signs.
				const deltaX = a.position.x - b.position.x;
				const deltaY = a.position.y - b.position.y;
				const deltaZ = a.position.z - b.position.z;
				const r = Math.hypot(deltaX, deltaY, deltaZ);

				const magnitude = ForceDirectedGraph.repulsionMagnitude(r);

				// Coincident centres have no radial direction; break the tie by
				// index (earlier node -x) so the pair separates instead of
				// sitting in a fixed point.
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

		// The adjacency walk is O(V + E), not O(V*E): each edge is visited once
		// per endpoint.
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

			// Hooke's law: positive when stretched pulls toward the neighbour,
			// negative when compressed pushes away.
			var scalar_force = k * (r - l);

			F = ForceDirectedGraph.addRadial(F.x, F.y, F.z, deltaX, deltaY, deltaZ, r, scalar_force);
		};

		return F;
	};

	// Pure: reads no cached field, so it is meaningful before the first step()
	// and can never observe a half-written tick.
	netForceAtNode(tag: Tag): Point3D {


		var e = this.netElectrostaticForceAtNode(tag);
		var s = this.netSpringForceAtNode(tag);

		var nX = e.x + s.x;
		var nY = e.y + s.y;
		var nZ = e.z + s.z;

		return point3(nX, nY, nZ);
	};

	// Damped, semi-implicit Euler. Velocity must be updated before position (see
	// step()) or stiff springs go unstable. `force` defaults to the net force at
	// the node's current position.
	velocityAtTag(tag: Tag, force: Point3D = this.netForceAtNode(tag)): Point3D {

		var f = force;

		var vx_old = tag.velocity.x;
		var vy_old = tag.velocity.y;
		var vz_old = tag.velocity.z;

		var friction = K.physics.friction;
		var time_step = K.physics.timeStep;

		var vx_new = (vx_old * friction) + f.x * time_step;
		var vy_new = (vy_old * friction) + f.y * time_step;
		var vz_new = (vz_old * friction) + f.z * time_step;

		return point3(vx_new, vy_new, vz_new);
	};

	// Advance the simulation by exactly one step. Physics only, with no drawing,
	// so it can run headlessly. A pinned node keeps the position the pointer
	// handler wrote and loses its velocity, so releasing a drag does not fling it.
	step(
		canvasWidth: number,
		canvasHeight: number,
		isPinned: (tag: Tag) => boolean = () => false,
		projector: Projector = Projector.forCanvas(canvasWidth, canvasHeight)
	) {

		const vertices = this.graph.vertices;

		// Both passes read the frozen pre-step positions, so every node sees the
		// same snapshot.
		const electrostatic: Point3D[] = vertices.map(() => zero3());
		this.accumulateRepulsion(electrostatic);

		const forces: Point3D[] = vertices.map((tag, i) => {
			const s = this.netSpringForceAtNode(tag);
			const e = electrostatic[i];

			return point3(e.x + s.x, e.y + s.y, e.z + s.z);
		});

		// The force computed above is passed in, so the O(N^2) repulsion kernel is
		// not run a second time.
		const velocities = vertices.map((tag, i) => this.velocityAtTag(tag, forces[i]));

		for (let i = 0; i < vertices.length; i++) {
			const tag = vertices[i];

			if (isPinned(tag)) {
				tag.velocity = zero3();
			}
			else {
				tag.velocity = velocities[i];

				const displacement = tag.displacement;
				tag.position.x = tag.position.x + displacement.x;
				tag.position.y = tag.position.y + displacement.y;
				tag.position.z = tag.position.z + displacement.z;
			}
		}

		// One projector for the whole pass: the camera and viewport are loop
		// invariants, so they are resolved once per tick, not per node.
		for (const node of vertices) {
			const projected = projector.project(node.position);

			node.translatedPosition = projector.viewport.toCanvas(projected.screen);
			node.depth = projected.depth;
		}
	};
};
