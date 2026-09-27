import { otherEndpoint } from "./Edge";
import { Graph } from "./Graph";
import { K } from "./K";
import { radius, repulsionMagnitude } from "./Kernel";
import { Octree } from "./Octree";
import { point3, Point3D, zero3 } from "./Point3D";
import { ProjectionScratch, Projector } from "./Projector";
import { Tag } from "./Tag";

export class ForceDirectedGraph {

    graph: Graph;

    // Solver-owned scratch, sized to the vertex count and reused every step, so
    // a steady-state step allocates nothing. The old object path built roughly
    // two Point3D per unordered pair plus per-node arrays: ~1M objects a step at
    // N=1024. `loadGraph` builds a fresh solver, so a graph swap starts from
    // cleanly sized buffers; ensureCapacity is the in-place-growth guard.
    private capacity = 0;
    private repulsionX = new Float64Array(0);
    private repulsionY = new Float64Array(0);
    private repulsionZ = new Float64Array(0);
    private springX = new Float64Array(0);
    private springY = new Float64Array(0);
    private springZ = new Float64Array(0);

    // Projection destination, reused per node; see Projector.projectInto().
    private readonly projected: ProjectionScratch = { screenX: 0, screenY: 0, depth: 0 };

    // The Barnes-Hut tree, rebuilt from the pre-step positions each step. It owns
    // its own pooled buffers (Plan 1), so it also allocates nothing steady-state.
    private readonly octree = new Octree();

    constructor(graph: Graph) {
        this.graph = graph;
    }

    private ensureCapacity(n: number): void {
        if (n <= this.capacity)
            return;

        this.capacity = n;
        this.repulsionX = new Float64Array(n);
        this.repulsionY = new Float64Array(n);
        this.repulsionZ = new Float64Array(n);
        this.springX = new Float64Array(n);
        this.springY = new Float64Array(n);
        this.springZ = new Float64Array(n);
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

	netElectrostaticForceAtNode(tagA: Tag): Point3D {

		var F: Point3D = zero3();

		// Breaks the coincident tie below; the paired pass breaks it by index
		// order, so this reference must agree.
		var selfIndex = this.graph.vertices.indexOf(tagA);

		for(let i = 0; i < this.graph.vertices.length; i++) {

			var tagB = this.graph.vertices[i];

			if(tagB === tagA)
				continue;

			// Away from B, so a positive magnitude pushes the pair apart.
			var deltaX = tagA.position.x - tagB.position.x;
			var deltaY = tagA.position.y - tagB.position.y;
			var deltaZ = tagA.position.z - tagB.position.z;

			var r = radius(deltaX, deltaY, deltaZ);

			// Only the magnitude is evaluated at a clamped radius, bounding the
			// r -> 0 singularity; the direction uses the true radius.
			var scalar_force = repulsionMagnitude(r);

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

	// One evaluation per unordered pair, accumulated into the flat repulsion
	// buffers. Loop order (i ascending, j ascending) and the per-slot addition
	// order are exactly the object path's, so the computed doubles are unchanged.
	private accumulateRepulsionInto(n: number): void {

		const verts = this.graph.vertices;

		const FX = this.repulsionX;
		const FY = this.repulsionY;
		const FZ = this.repulsionZ;

		for (let i = 0; i < n; i++) {

			const a = verts[i];

			for (let j = i + 1; j < n; j++) {

				const b = verts[j];

				// Away from b for a, away from a for b: one delta, opposite signs.
				const deltaX = a.position.x - b.position.x;
				const deltaY = a.position.y - b.position.y;
				const deltaZ = a.position.z - b.position.z;
				const r = radius(deltaX, deltaY, deltaZ);

				const magnitude = repulsionMagnitude(r);

				// Coincident centres have no radial direction; break the tie by
				// index (earlier node -x) so the pair separates instead of
				// sitting in a fixed point. `ur` is never 0 here, so no slot is
				// skipped: the tie-break direction is the unit -x vector.
				const coincident = r === 0;
				const ux = coincident ? -1 : deltaX;
				const uy = coincident ? 0 : deltaY;
				const uz = coincident ? 0 : deltaZ;
				const ur = coincident ? 1 : r;

				const scaledX = (magnitude * ux) / ur;
				const scaledY = (magnitude * uy) / ur;
				const scaledZ = (magnitude * uz) / ur;

				FX[i] += scaledX;
				FY[i] += scaledY;
				FZ[i] += scaledZ;

				// a - s is bit-identical to the old a + (magnitude * -u) / r.
				FX[j] -= scaledX;
				FY[j] -= scaledY;
				FZ[j] -= scaledZ;
			}
		}
	};

	// The repulsion pass: exact below the crossover, Barnes-Hut above it. The
	// exact path keeps demo-scale behaviour bit-for-bit; the octree is the only
	// approximate step, and it is rebuilt from the same frozen pre-step positions.
	// It adds into the repulsion buffers, so the caller's seed is preserved either
	// way.
	private accumulateRepulsionPass(n: number): void {

		if (n < K.physics.barnesHutMinNodes) {
			this.accumulateRepulsionInto(n);
			return;
		}

		this.octree.build(
			this.graph.vertices,
			K.physics.barnesHutTheta,
			K.physics.barnesHutMaxDepth
		);

		this.octree.accumulateForce(this.repulsionX, this.repulsionY, this.repulsionZ);
	};

	// The spring sum for one node, written into the spring buffers. The public
	// netSpringForceAtNode() stays the object-returning reference; this is the
	// step path. Contributions are added in adjacency insertion order, exactly
	// as addRadial() did, starting from zero.
	private accumulateSpringForceInto(index: number): void {

		const tag = this.graph.vertices[index];

		var k = K.physics.springConstant;
		var l = K.physics.equilibriumDisplacement;

		// The adjacency walk is O(V + E), not O(V*E): each edge is visited once
		// per endpoint.
		var incident = this.graph.incidentEdges(tag);

		var sx = 0;
		var sy = 0;
		var sz = 0;

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

			var r = radius(deltaX, deltaY, deltaZ);

			// addRadial() leaves the accumulator untouched at r === 0, so a
			// zero-length edge contributes nothing rather than dividing by zero.
			if (r === 0)
				continue;

			// Hooke's law: positive when stretched pulls toward the neighbour,
			// negative when compressed pushes away.
			var scalar_force = k * (r - l);

			sx += (scalar_force * deltaX) / r;
			sy += (scalar_force * deltaY) / r;
			sz += (scalar_force * deltaZ) / r;
		};

		this.springX[index] = sx;
		this.springY[index] = sy;
		this.springZ[index] = sz;
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

			var r = radius(deltaX, deltaY, deltaZ);

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

	// Accumulates the paired repulsion onto `out` in place, so it allocates
	// nothing per call and stays bit-for-bit the old object path's result,
	// including from a non-zero starting `out`. Public only so the equivalence
	// test and the benchmark can drive the kernel directly; step() is the sole
	// production caller.
	accumulateRepulsion(out: Point3D[]): void {

		const n = this.graph.vertices.length;

		this.ensureCapacity(n);

		// Seed the flat slots from the caller's values so the accumulation starts
		// where the object path started.
		for (let i = 0; i < n; i++) {
			this.repulsionX[i] = out[i].x;
			this.repulsionY[i] = out[i].y;
			this.repulsionZ[i] = out[i].z;
		}

		this.accumulateRepulsionPass(n);

		for (let i = 0; i < n; i++) {
			out[i].x = this.repulsionX[i];
			out[i].y = this.repulsionY[i];
			out[i].z = this.repulsionZ[i];
		}
	};

	// Advance the simulation by exactly one step. Physics only, with no drawing,
	// so it can run headlessly. A pinned node keeps the position the pointer
	// handler wrote and loses its velocity, so releasing a drag does not fling it.
	//
	// Fixed passes over solver-owned buffers: every force reads the frozen
	// pre-step positions, no node sees a half-updated neighbour, and the whole
	// step allocates nothing.
	step(
		canvasWidth: number,
		canvasHeight: number,
		isPinned: (tag: Tag) => boolean = () => false,
		projector: Projector = Projector.forCanvas(canvasWidth, canvasHeight)
	) {

		const vertices = this.graph.vertices;
		const n = vertices.length;

		this.ensureCapacity(n);

		// Explicit loop rather than the typed array's bulk-fill method: the
		// architecture guard reads source text, and that method name is also a
		// canvas drawing call it watches for.
		for (let i = 0; i < n; i++) {
			this.repulsionX[i] = 0;
			this.repulsionY[i] = 0;
			this.repulsionZ[i] = 0;
		}

		// Pass 1: repulsion, from the pre-step positions.
		this.accumulateRepulsionPass(n);

		// Pass 2: springs, still reading only pre-step positions. The spring sum
		// is formed separately and then added to the repulsion, preserving the
		// old repulsion-then-spring summation order exactly.
		for (let i = 0; i < n; i++) {
			this.accumulateSpringForceInto(i);

			this.repulsionX[i] += this.springX[i];
			this.repulsionY[i] += this.springY[i];
			this.repulsionZ[i] += this.springZ[i];
		}

		const friction = K.physics.friction;
		const timeStep = K.physics.timeStep;

		// Pass 3: velocity before position, so a stiff spring stays stable. This
		// is the first pass that may write a Tag, so no force can observe it.
		for (let i = 0; i < n; i++) {

			const tag = vertices[i];

			if (isPinned(tag)) {
				tag.velocity.x = 0;
				tag.velocity.y = 0;
				tag.velocity.z = 0;
				continue;
			}

			tag.velocity.x = (tag.velocity.x * friction) + (this.repulsionX[i] * timeStep);
			tag.velocity.y = (tag.velocity.y * friction) + (this.repulsionY[i] * timeStep);
			tag.velocity.z = (tag.velocity.z * friction) + (this.repulsionZ[i] * timeStep);

			tag.position.x = tag.position.x + tag.velocity.x;
			tag.position.y = tag.position.y + tag.velocity.y;
			tag.position.z = tag.position.z + tag.velocity.z;
		}

		// Pass 4: one projector for the whole pass: the camera and viewport are
		// loop invariants, resolved once per tick, not per node. An indexed loop,
		// like the passes above, so no array iterator is allocated.
		for (let i = 0; i < n; i++) {
			const node = vertices[i];

			projector.projectInto(node.position, this.projected);
			projector.viewport.toCanvasInto(
				this.projected.screenX,
				this.projected.screenY,
				node.translatedPosition
			);
			node.depth = this.projected.depth;
		}
	};
};
