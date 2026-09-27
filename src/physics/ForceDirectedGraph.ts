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

    // Reused every step so a steady-state step allocates nothing (docs/invariants.md).
    private capacity = 0;
    private repulsionX = new Float64Array(0);
    private repulsionY = new Float64Array(0);
    private repulsionZ = new Float64Array(0);
    private springX = new Float64Array(0);
    private springY = new Float64Array(0);
    private springZ = new Float64Array(0);

    // Component ids are 0..C-1 in vertices order (graph/Components.ts), so one slot per vertex bounds these
    // buffers.
    private componentId: Int32Array<ArrayBuffer> = new Int32Array(0);
    private labelledEdges = -1;
    private componentCount = new Int32Array(0);
    private centroidX = new Float64Array(0);
    private centroidY = new Float64Array(0);
    private centroidZ = new Float64Array(0);
    private componentAnchorX = new Float64Array(0);
    private componentAnchorY = new Float64Array(0);
    private componentAnchorZ = new Float64Array(0);

    private readonly radialScratch = new Float64Array(3);
    private readonly springScratch = new Float64Array(3);

    private readonly anchorScratch = new Float64Array(3);

    private readonly anchorDirectionScratch = new Float64Array(3);

    // Rebuilt from the pre-step positions each step; owns its pooled buffers.
    private readonly octree = new Octree();

    /** Largest distance any node travelled in the most recent step; read by the settle detector. */
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

    // Relabel only when stale. Graph is append-only, and a new edge at constant N
    // can merge components; a stale label reads undefined and turns forces into NaN.
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

		// Must agree with the paired pass's index-order tie-break.
		var selfIndex = this.graph.vertices.indexOf(tagA);
		var radial = this.radialScratch;

		for(let i = 0; i < this.graph.vertices.length; i++) {

			var tagB = this.graph.vertices[i];

			if(tagB === tagA)
				continue;

			var deltaX = tagA.position.x - tagB.position.x;
			var deltaY = tagA.position.y - tagB.position.y;
			var deltaZ = tagA.position.z - tagB.position.z;

			var r = radius(deltaX, deltaY, deltaZ);

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

	// Accumulated into the flat buffers; the pair and per-slot addition order is fixed.
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

				const deltaX = a.position.x - b.position.x;
				const deltaY = a.position.y - b.position.y;
				const deltaZ = a.position.z - b.position.z;
				const r = radius(deltaX, deltaY, deltaZ);

				// `j > i`, so `i` is the earlier index the tie-break pushes along -x.
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

				FX[j] -= scaledX;
				FY[j] -= scaledY;
				FZ[j] -= scaledZ;
			}
		}
	};

	// Exact below the crossover, Barnes-Hut above; the octree is the only approximate step.
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

	// The one implementation, so the step buffers and netSpringForceAtNode() cannot drift.
	private springForceInto(tag: Tag, out: Float64Array): void {

		var incident = this.graph.incidentEdges(tag);

		var radial = this.radialScratch;

		var sx = 0;
		var sy = 0;
		var sz = 0;

		for(let i = 0; i < incident.length; i++) {

			var edge = incident[i];
			var other_tag = otherEndpoint(edge, tag);

			if (other_tag === null)
				continue;

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
				// r !== 0 from the guard above, so no tie-break can apply.
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

	// Pass 2b: per-component anchor, folded in after the springs to match netForceAtNode()'s
	// sum order. The anyActive gate leaves all-dead-zone graphs bit-identical.
	private accumulateComponentAnchor(n: number): void {

		this.ensureComponents();

		const vertices = this.graph.vertices;
		const componentId = this.componentId;

		for (let c = 0; c < n; c++) {
			this.centroidX[c] = 0;
			this.centroidY[c] = 0;
			this.centroidZ[c] = 0;
			this.componentCount[c] = 0;
		}

		// Vertices order, matching anchorForceInto()'s accumulation rounding.
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

	/** The uniform component-anchor force on `tag`, written into `out`; reference-only. */
	anchorForceInto(tag: Tag, out: Float64Array): void {

		this.ensureComponents();

		const vertices = this.graph.vertices;
		const index = vertices.indexOf(tag);

		// Without the guard a foreign tag's label read is out of range and the force becomes NaN.
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

		// Every node of the component gets this same vector, so the anchor only translates it.
		radialComponentsInto(-cx, -cy, -cz, r, componentAnchorMagnitude(r), false, out);
	};

	// Pure: reads no cached field, so it is safe before the first step().
	netForceAtNode(tag: Tag): Point3D {


		var e = this.netElectrostaticForceAtNode(tag);
		var s = this.netSpringForceAtNode(tag);

		this.anchorForceInto(tag, this.anchorScratch);

		// Repulsion, springs, anchor: the order the step folds into the force buffers.
		var nX = e.x + s.x + this.anchorScratch[0];
		var nY = e.y + s.y + this.anchorScratch[1];
		var nZ = e.z + s.z + this.anchorScratch[2];

		return point3(nX, nY, nZ);
	};

	// Damped, semi-implicit Euler; velocity must precede position or stiff springs go unstable.
	velocityAtTag(tag: Tag, force: Point3D = this.netForceAtNode(tag)): Point3D {

		var f = force;

		return point3(
			integrateVelocity(tag.velocity.x, f.x),
			integrateVelocity(tag.velocity.y, f.y),
			integrateVelocity(tag.velocity.z, f.z)
		);
	};

	// Public only so the equivalence test and benchmark can drive the kernel; step() is the sole production
	// caller.
	accumulateRepulsion(out: Point3D[]): void {

		const n = this.graph.vertices.length;

		this.ensureCapacity(n);

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

	// One physics step, no drawing. Every force reads the frozen pre-step positions;
	// a pinned node keeps its position and loses its velocity.
	stepPhysics(isPinned: (tag: Tag) => boolean = () => false): void {

		const vertices = this.graph.vertices;
		const n = vertices.length;

		this.ensureCapacity(n);

		// Explicit loop: the architecture guard watches the typed array's bulk-fill method name.
		for (let i = 0; i < n; i++) {
			this.repulsionX[i] = 0;
			this.repulsionY[i] = 0;
			this.repulsionZ[i] = 0;
		}

		this.accumulateRepulsionPass(n);

		for (let i = 0; i < n; i++) {
			this.accumulateSpringForceInto(i);

			this.repulsionX[i] += this.springX[i];
			this.repulsionY[i] += this.springY[i];
			this.repulsionZ[i] += this.springZ[i];
		}

		// Folded in after the springs to match netForceAtNode()'s sum order.
		this.accumulateComponentAnchor(n);

		let maxDisplacement = 0;

		// Velocity before position; the first pass that writes a Tag.
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

	/** Cache canvas positions and view depth for one projector; split from stepPhysics() for the worker. */
	project(projector: Projector): void {
		projectGraph(this.graph, projector);
	};

	/** One full step: physics then projection. */
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
