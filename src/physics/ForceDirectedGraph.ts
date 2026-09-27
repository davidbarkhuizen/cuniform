import { otherEndpoint } from "../graph/Edge";
import { Graph } from "../graph/Graph";
import { labelComponents } from "../graph/Components";
import { K } from "../core/K";
import { componentAnchorMagnitude, integrateVelocity, radialComponentsInto, radius, repulsionMagnitude, springMagnitude } from "./Kernel";
import { Octree } from "./Octree";
import { point3, Point3D, zero3 } from "../core/Point3D";
import { projectGraph } from "../view/Projection";
import { Projector } from "../view/Projector";
import { openingAngleFor } from "./Quality";
import { Tag } from "../graph/Tag";

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

    // Connected-component labelling and the per-component anchor scratch, in the
    // same pooled style as the force buffers above: one label per vertex, one
    // centroid accumulator per component, and one uniform force vector per
    // component. Component ids are assigned 0..C-1 in vertices order
    // (graph/Components.ts), so the buffers hold at most one entry per vertex.
    // The labelling is cached across steps because topology changes far less
    // often than positions; `labelledEdges` is the staleness sentinel (see
    // ensureComponents()).
    private componentId: Int32Array<ArrayBuffer> = new Int32Array(0);
    private labelledEdges = -1;
    private componentCount = new Int32Array(0);
    private centroidX = new Float64Array(0);
    private centroidY = new Float64Array(0);
    private centroidZ = new Float64Array(0);
    private componentAnchorX = new Float64Array(0);
    private componentAnchorY = new Float64Array(0);
    private componentAnchorZ = new Float64Array(0);

    // Projection destination, reused per node; see Projector.projectInto().
    // The projection pass itself lives in Projection.ts, so a render backend can
    // run it without the solver.

    // Radial-component scratch for Kernel.radialComponentsInto(), and the
    // destination for one node's spring sum. Reused, so the force passes below
    // allocate nothing steady-state.
    private readonly radialScratch = new Float64Array(3);
    private readonly springScratch = new Float64Array(3);

    // Reference-only destination for anchorForceInto(), which is not on the step
    // path; the step pass writes the pooled per-component buffers instead.
    private readonly anchorScratch = new Float64Array(3);

    // Where one component's anchor vector lands before the step pass scatters it
    // into the pooled per-component buffers. Both anchor paths get their vector
    // from Kernel.radialComponentsInto(), so the direction has one home.
    private readonly anchorDirectionScratch = new Float64Array(3);

    // The Barnes-Hut tree, rebuilt from the pre-step positions each step. It owns
    // its own pooled buffers, so it also allocates nothing steady-state.
    private readonly octree = new Octree();

    /**
     * The largest distance any node travelled during the most recent step
     * (equivalently, the largest speed; pinned nodes count as zero). The settle
     * detector reads it to stop stepping once the layout is quiet.
     */
    lastMaxDisplacement = 0;

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

        // Sized in the same growth path: a component holds at most n vertices,
        // so one slot per vertex is a bound on both the labels and the
        // centroids. Resizing drops the cached labelling, so the next
        // ensureComponents() relabels (labelledEdges = -1 marks it stale).
        this.componentId = new Int32Array(n);
        this.componentCount = new Int32Array(n);
        this.centroidX = new Float64Array(n);
        this.centroidY = new Float64Array(n);
        this.centroidZ = new Float64Array(n);
        this.componentAnchorX = new Float64Array(n);
        this.componentAnchorY = new Float64Array(n);
        this.componentAnchorZ = new Float64Array(n);
        this.labelledEdges = -1;
    }

    // Relabel only when the cached labelling is stale. `Graph` is append-only -
    // addNode/addEdge and no removal - so staleness is two monotonic counts,
    // checked in O(1). The edge count is load-bearing as well as the vertex
    // count: a new edge at constant N merges two components, and a stale label
    // array is a correctness hazard, not just a stale result, because an
    // out-of-range read of a typed array yields undefined and turns every
    // arithmetic result into NaN.
    private ensureComponents(): void {

        const n = this.graph.vertices.length;

        if (this.componentId.length === n && this.labelledEdges === this.graph.edges.length)
            return;

        this.ensureCapacity(n);

        this.componentId = labelComponents(this.graph);
        this.labelledEdges = this.graph.edges.length;
    }

	netElectrostaticForceAtNode(tagA: Tag): Point3D {

		var F: Point3D = zero3();

		// Breaks the coincident tie below; the paired pass breaks it by index
		// order, so this reference must agree.
		var selfIndex = this.graph.vertices.indexOf(tagA);
		var radial = this.radialScratch;

		for(let i = 0; i < this.graph.vertices.length; i++) {

			var tagB = this.graph.vertices[i];

			if(tagB === tagA)
				continue;

			// Away from B, so a positive magnitude pushes the pair apart.
			var deltaX = tagA.position.x - tagB.position.x;
			var deltaY = tagA.position.y - tagB.position.y;
			var deltaZ = tagA.position.z - tagB.position.z;

			var r = radius(deltaX, deltaY, deltaZ);

			// The direction, the clamp and the coincident tie-break all come from
			// the kernel, so this reference and the paired pass cannot disagree.
			radialComponentsInto(
				deltaX,
				deltaY,
				deltaZ,
				r,
				repulsionMagnitude(r),
				selfIndex < i,
				radial
			);

			F = point3(
				F.x + radial[0],
				F.y + radial[1],
				F.z + radial[2]
			);
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
		const radial = this.radialScratch;

		for (let i = 0; i < n; i++) {

			const a = verts[i];

			for (let j = i + 1; j < n; j++) {

				const b = verts[j];

				// Away from b for a, away from a for b: one delta, opposite signs.
				const deltaX = a.position.x - b.position.x;
				const deltaY = a.position.y - b.position.y;
				const deltaZ = a.position.z - b.position.z;
				const r = radius(deltaX, deltaY, deltaZ);

				// Direction, clamp and the coincident tie-break are the kernel's.
				// `j > i` throughout, so `i` is the earlier index the tie-break
				// pushes along -x.
				radialComponentsInto(
					deltaX,
					deltaY,
					deltaZ,
					r,
					repulsionMagnitude(r),
					i < j,
					radial
				);

				const scaledX = radial[0];
				const scaledY = radial[1];
				const scaledZ = radial[2];

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
	// way. The opening angle comes from Quality.openingAngleFor(), the one place
	// the size/quality policy is decided; the tree clamps it.
	private accumulateRepulsionPass(n: number): void {

		if (n < K.physics.barnesHutMinNodes) {
			this.accumulateRepulsionInto(n);
			return;
		}

		this.octree.build(
			this.graph.vertices,
			openingAngleFor(n, K.physics.quality),
			K.physics.barnesHutMaxDepth
		);

		this.octree.accumulateForce(this.repulsionX, this.repulsionY, this.repulsionZ);
	};

	// The spring sum for one node, written into `out`. The one implementation:
	// `accumulateSpringForceInto()` writes it into the step buffers and
	// `netSpringForceAtNode()` returns it as a Point3D, so the Hooke law and the
	// adjacency walk cannot drift. Contributions are added in adjacency
	// insertion order, starting from zero, which is what keeps the step path
	// bit-for-bit the object path's result.
	private springForceInto(tag: Tag, out: Float64Array): void {

		// The adjacency walk is O(V + E), not O(V*E): each edge is visited once
		// per endpoint.
		var incident = this.graph.incidentEdges(tag);

		var radial = this.radialScratch;

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

			// A zero-length edge has no direction and so no spring force.
			if (r === 0)
				continue;

			radialComponentsInto(
				deltaX,
				deltaY,
				deltaZ,
				r,
				springMagnitude(r),
				// r !== 0 is guaranteed by the guard above, so the coincident
				// tie-break this flag selects cannot apply.
				false,
				radial
			);

			sx += radial[0];
			sy += radial[1];
			sz += radial[2];
		};

		out[0] = sx;
		out[1] = sy;
		out[2] = sz;
	};

	private accumulateSpringForceInto(index: number): void {

		this.springForceInto(this.graph.vertices[index], this.springScratch);

		this.springX[index] = this.springScratch[0];
		this.springY[index] = this.springScratch[1];
		this.springZ[index] = this.springScratch[2];
	};

	// Pass 2b: the per-component anchor, accumulated onto the force buffers the
	// caller already holds - after repulsion and springs, so the buffer's value is
	// the same three-term sum netForceAtNode() returns. O(N + C), allocation-free,
	// and it evaluates no Math.pow, so it leaves the pairwise-repulsion cost and
	// the pow pair counter untouched. The force buffers are only written when some
	// component is outside the dead zone: the `anyActive` gate is what makes "a
	// graph whose component centroids are all inside the dead zone steps
	// bit-for-bit as before" a structural property rather than an argument about
	// x + 0 === x.
	private accumulateComponentAnchor(n: number): void {

		this.ensureComponents();

		const vertices = this.graph.vertices;
		const componentId = this.componentId;

		// Centroid accumulators start at zero; a component's slot is written and
		// divided before it is read.
		for (let c = 0; c < n; c++) {
			this.centroidX[c] = 0;
			this.centroidY[c] = 0;
			this.centroidZ[c] = 0;
			this.componentCount[c] = 0;
		}

		// In vertices order: the same order (and so the same rounding) as
		// anchorForceInto()'s reference walk. Every slot is a real component, so
		// its count ends positive and the divide below is never by zero.
		for (let i = 0; i < n; i++) {
			const c = componentId[i];
			const position = vertices[i].position;

			this.centroidX[c] += position.x;
			this.centroidY[c] += position.y;
			this.centroidZ[c] += position.z;
			this.componentCount[c]++;
		}

		const anchorRadius = K.physics.componentAnchorRadius;

		let anyActive = false;

		for (let c = 0; c < n; c++) {

			const count = this.componentCount[c];

			if (count === 0)
				continue;

			const cx = this.centroidX[c] / count;
			const cy = this.centroidY[c] / count;
			const cz = this.centroidZ[c] / count;

			const r = radius(cx, cy, cz);

			if (r === 0) {
				this.componentAnchorX[c] = 0;
				this.componentAnchorY[c] = 0;
				this.componentAnchorZ[c] = 0;
				continue;
			}

			if (r > anchorRadius)
				anyActive = true;

			// The kernel owns the radial direction, so the anchor cannot spell it
			// differently from the pairwise laws. The pull is toward the origin,
			// hence the negated centroid.
			radialComponentsInto(
				-cx,
				-cy,
				-cz,
				r,
				componentAnchorMagnitude(r),
				false,
				this.anchorDirectionScratch
			);

			this.componentAnchorX[c] = this.anchorDirectionScratch[0];
			this.componentAnchorY[c] = this.anchorDirectionScratch[1];
			this.componentAnchorZ[c] = this.anchorDirectionScratch[2];
		}

		if (!anyActive)
			return;

		for (let i = 0; i < n; i++) {
			const c = componentId[i];

			this.repulsionX[i] += this.componentAnchorX[c];
			this.repulsionY[i] += this.componentAnchorY[c];
			this.repulsionZ[i] += this.componentAnchorZ[c];
		}
	};

	netSpringForceAtNode(tag: Tag): Point3D {

		this.springForceInto(tag, this.springScratch);

		return point3(this.springScratch[0], this.springScratch[1], this.springScratch[2]);
	};

	/**
	 * The uniform component-anchor force on `tag`, written into `out`.
	 *
	 * The tag's component centroid is recomputed on demand with an O(N) walk in
	 * `vertices` order, because the anchor has one magnitude per component, not
	 * one per node. Reference-only: the step path never calls this, so the O(N)
	 * cost is irrelevant; its contract is that it returns exactly the vector the
	 * step pass adds, which keeps velocityAtTag()'s default force consistent with
	 * the velocity the step writes (see netForceAtNode()).
	 *
	 * Public because it is part of the object-returning reference surface: the
	 * anchor tests assert uniformity (every member of a component gets this same
	 * vector) and the three-term decomposition of netForceAtNode().
	 */
	anchorForceInto(tag: Tag, out: Float64Array): void {

		this.ensureComponents();

		const vertices = this.graph.vertices;
		const index = vertices.indexOf(tag);

		// Total, like the rest of the reference surface: a tag that is not in this
		// graph belongs to no component, so it feels no anchor. Without the guard
		// the label lookup would be out of range and the whole force would become
		// NaN rather than the zero the pairwise references return for a foreign tag.
		if (index === -1) {
			out[0] = 0;
			out[1] = 0;
			out[2] = 0;
			return;
		}

		const component = this.componentId[index];

		let cx = 0;
		let cy = 0;
		let cz = 0;
		let count = 0;

		// Summed in vertices order, over exactly the members of `tag`'s component,
		// so the rounding matches the step pass's accumulation.
		for (let i = 0; i < vertices.length; i++) {

			if (this.componentId[i] !== component)
				continue;

			const position = vertices[i].position;

			cx += position.x;
			cy += position.y;
			cz += position.z;
			count++;
		}

		cx /= count;
		cy /= count;
		cz /= count;

		const r = radius(cx, cy, cz);

		if (r === 0) {
			out[0] = 0;
			out[1] = 0;
			out[2] = 0;
			return;
		}

		// A zero centroid radius has no direction, and the magnitude is zero there
		// for any dead zone, so the explicit branch above is about the direction
		// only. Every node of the component gets this same vector, which is what
		// makes the anchor a pure translation of the component. The kernel writes
		// it, so the reference returns exactly the vector step() adds.
		radialComponentsInto(-cx, -cy, -cz, r, componentAnchorMagnitude(r), false, out);
	};

	// Pure: reads no cached field, so it is meaningful before the first step()
	// and can never observe a half-written tick.
	netForceAtNode(tag: Tag): Point3D {


		var e = this.netElectrostaticForceAtNode(tag);
		var s = this.netSpringForceAtNode(tag);

		this.anchorForceInto(tag, this.anchorScratch);

		// Three terms, in the order the step pass folds them into the force
		// buffers: repulsion, then springs, then the anchor. Keeping the same
		// order is what lets velocityAtTag()'s default force agree with the
		// velocity the step writes bit-for-bit.
		var nX = e.x + s.x + this.anchorScratch[0];
		var nY = e.y + s.y + this.anchorScratch[1];
		var nZ = e.z + s.z + this.anchorScratch[2];

		return point3(nX, nY, nZ);
	};

	// Damped, semi-implicit Euler. Velocity must be updated before position (see
	// step()) or stiff springs go unstable. `force` defaults to the net force at
	// the node's current position. The update law is Kernel's, so this reference
	// and the step path cannot drift.
	velocityAtTag(tag: Tag, force: Point3D = this.netForceAtNode(tag)): Point3D {

		var f = force;

		return point3(
			integrateVelocity(tag.velocity.x, f.x),
			integrateVelocity(tag.velocity.y, f.y),
			integrateVelocity(tag.velocity.z, f.z)
		);
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
	stepPhysics(isPinned: (tag: Tag) => boolean = () => false): void {

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

		// Pass 2b: the component anchor, from the same frozen pre-step positions.
		// One uniform vector per connected component is added to every member, so
		// the force can only translate a component and cannot deform it.
		//
		// Folded in after the springs so the buffer holds (repulsion + spring) and
		// then + anchor, which is exactly the order netForceAtNode() sums in.
		// Adding it before the spring instead would differ in the last bits, and
		// that is the one place velocityAtTag()'s default force could disagree
		// with the velocity the step writes.
		this.accumulateComponentAnchor(n);

		// The displacement the settle detector reads: position advances by the
		// velocity, so the largest speed is the largest travel this step.
		let maxDisplacement = 0;

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

			tag.velocity.x = integrateVelocity(tag.velocity.x, this.repulsionX[i]);
			tag.velocity.y = integrateVelocity(tag.velocity.y, this.repulsionY[i]);
			tag.velocity.z = integrateVelocity(tag.velocity.z, this.repulsionZ[i]);

			const travel = radius(tag.velocity.x, tag.velocity.y, tag.velocity.z);

			if (travel > maxDisplacement)
				maxDisplacement = travel;

			tag.position.x = tag.position.x + tag.velocity.x;
			tag.position.y = tag.position.y + tag.velocity.y;
			tag.position.z = tag.position.z + tag.velocity.z;
		}

		this.lastMaxDisplacement = maxDisplacement;
	};

	/**
	 * Cache each node's canvas position and view depth for one projector. Split
	 * from stepPhysics() so the worker can advance the physics while the
	 * main thread keeps projecting with its own camera.
	 */
	project(projector: Projector): void {
		projectGraph(this.graph, projector);
	};

	/** One full step: physics then projection, as the legacy tick caller expects. */
	step(
		canvasWidth: number,
		canvasHeight: number,
		isPinned: (tag: Tag) => boolean = () => false,
		projector: Projector = Projector.forCanvas(canvasWidth, canvasHeight)
	): void {

		this.stepPhysics(isPinned);
		this.project(projector);
	};
};
