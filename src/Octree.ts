import { K } from "./K";
import { radius, repulsionMagnitude } from "./Kernel";
import { Tag } from "./Tag";

/**
 * Barnes-Hut octree over the model positions (docs/performance/01).
 *
 * The all-pairs repulsion pass is O(N^2) and 85-98% of a step at N >= 512. The
 * tree replaces the far field with a cell's charge total at its centre of mass,
 * which is the standard approximation for a long-range law; the near field stays
 * exact. It is pure geometry and arithmetic, like Projector.ts.
 *
 * Everything is structure-of-arrays: bodies and cells live in pooled
 * `Float64Array`/`Int32Array` buffers that are reused across builds, so a step
 * allocates nothing steady-state (Plan 2 owns the same pattern on the solver).
 */

// Half-extent floor for the root cube, so an all-coincident (or single-point)
// body set still has an octree to subdivide.
const MIN_HALF_EXTENT = 1e-6;

/**
 * The opening-angle ceiling the plan documents, 2/sqrt(3) ~= 1.1547.
 *
 * It is a sanity clamp only: the traversal additionally tracks which cell
 * contains the body being evaluated and never accepts that cell as an aggregate,
 * so self-exclusion does not depend on theta. A theta-only guarantee would in
 * fact need theta < 1/sqrt(3) ~= 0.577, because the centre of mass of a cell can
 * sit at the opposite corner from the body, giving s/d as low as 1/sqrt(3).
 */
export const MAX_OPENING_ANGLE = 2 / Math.sqrt(3);

export function clampOpeningAngle(theta: number): number {
    if (!Number.isFinite(theta) || theta < 0)
        return 0;

    return Math.min(theta, MAX_OPENING_ANGLE);
}

function growFloat64(old: Float64Array, capacity: number): Float64Array {
    const next = new Float64Array(capacity);
    next.set(old);
    return next;
}

function growInt32(old: Int32Array, capacity: number): Int32Array {
    const next = new Int32Array(capacity);
    next.set(old);
    return next;
}

function growInt8(old: Int8Array, capacity: number): Int8Array {
    const next = new Int8Array(capacity);
    next.set(old);
    return next;
}

function growUint8(old: Uint8Array, capacity: number): Uint8Array {
    const next = new Uint8Array(capacity);
    next.set(old);
    return next;
}

export class Octree {

    // Bodies: positions copied once per build, plus the permutation that makes
    // each leaf's bodies a contiguous slice of `bodyOrder`.
    bodyX = new Float64Array(0);
    bodyY = new Float64Array(0);
    bodyZ = new Float64Array(0);
    bodyOrder = new Int32Array(0);

    // Cells. Index 0 is the root after build(). A cell spans
    // [center - half, center + half] on each axis.
    cellCenterX = new Float64Array(0);
    cellCenterY = new Float64Array(0);
    cellCenterZ = new Float64Array(0);
    cellHalf = new Float64Array(0);
    /** Charge total, the aggregate magnitude factor (one unit charge per body). */
    cellMass = new Float64Array(0);
    cellCenterOfMassX = new Float64Array(0);
    cellCenterOfMassY = new Float64Array(0);
    cellCenterOfMassZ = new Float64Array(0);
    /** First child index, or -1 when the cell is a leaf bucket. */
    cellFirstChild = new Int32Array(0);
    cellChildCount = new Int32Array(0);
    /** Which octant of its parent each non-empty child occupies. */
    cellChildOctant = new Int8Array(0);
    /** Slice of `bodyOrder` owned by a leaf bucket. */
    cellStart = new Int32Array(0);
    cellCount = new Int32Array(0);

    /** Cells in use after the most recent build. */
    cells = 0;
    /** Bodies in the tree after the most recent build. */
    bodies = 0;

    private theta = K.physics.barnesHutTheta;

    private bodyCapacity = 0;
    private cellCapacity = 0;
    private partitionCapacity = 0;

    private bodyOctant = new Int8Array(0);
    private partition = new Int32Array(0);
    private readonly octantCount = new Int32Array(8);
    private readonly octantStart = new Int32Array(8);
    private readonly octantWrite = new Int32Array(8);

    private stackCell = new Int32Array(0);
    private stackContains = new Uint8Array(0);

    /**
     * Rebuild the tree from `vertices`. The arrays only ever grow, so a repeated
     * build at the same size reuses every buffer.
     */
    build(
        vertices: readonly Tag[],
        theta: number = K.physics.barnesHutTheta,
        maxDepth: number = K.physics.barnesHutMaxDepth
    ): void {

        const n = vertices.length;

        this.bodies = n;
        this.cells = 0;
        this.theta = clampOpeningAngle(theta);

        if (n === 0)
            return;

        this.ensureBodyCapacity(n);
        this.ensurePartitionCapacity(n);
        this.ensureStackCapacity(8 * (maxDepth + 2));

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (let i = 0; i < n; i++) {
            const position = vertices[i].position;
            const x = position.x;
            const y = position.y;
            const z = position.z;

            this.bodyX[i] = x;
            this.bodyY[i] = y;
            this.bodyZ[i] = z;
            this.bodyOrder[i] = i;

            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }

        const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);

        // Inflated by a whisker so rounding cannot leave a point just outside its
        // own root cube; the minimum covers the all-coincident case.
        const half = span > 0 ? (span / 2) * (1 + 1e-9) : MIN_HALF_EXTENT;

        const root = this.newCell(
            (minX + maxX) / 2,
            (minY + maxY) / 2,
            (minZ + maxZ) / 2,
            half,
            0,
            n
        );

        this.buildCell(root, 0, maxDepth);
    }

    /**
     * Add the approximate repulsion on every body into `outX/outY/outZ`. It adds
     * rather than assigns, matching the exact kernel's accumulate contract.
     */
    accumulateForce(outX: Float64Array, outY: Float64Array, outZ: Float64Array): void {

        const n = this.bodies;

        if (n === 0 || this.cells === 0)
            return;

        const theta = this.theta;

        const bodyX = this.bodyX;
        const bodyY = this.bodyY;
        const bodyZ = this.bodyZ;
        const order = this.bodyOrder;

        const centerX = this.cellCenterX;
        const centerY = this.cellCenterY;
        const centerZ = this.cellCenterZ;
        const half = this.cellHalf;
        const mass = this.cellMass;
        const massX = this.cellCenterOfMassX;
        const massY = this.cellCenterOfMassY;
        const massZ = this.cellCenterOfMassZ;
        const firstChild = this.cellFirstChild;
        const childCount = this.cellChildCount;
        const childOctant = this.cellChildOctant;
        const start = this.cellStart;
        const count = this.cellCount;

        const stackCell = this.stackCell;
        const stackContains = this.stackContains;

        for (let i = 0; i < n; i++) {

            const px = bodyX[i];
            const py = bodyY[i];
            const pz = bodyZ[i];

            let fx = 0;
            let fy = 0;
            let fz = 0;

            // Depth-first walk. `contains` records whether the cell on the stack
            // holds body i; such a cell must never be accepted as an aggregate.
            let stackSize = 0;
            stackCell[stackSize] = 0;
            stackContains[stackSize] = 1;
            stackSize++;

            while (stackSize > 0) {

                stackSize--;

                const cell = stackCell[stackSize];
                const contains = stackContains[stackSize];
                const first = firstChild[cell];

                // Leaf: evaluate every other body in the bucket exactly.
                if (first < 0) {

                    const sliceStart = start[cell];
                    const sliceCount = count[cell];

                    for (let k = 0; k < sliceCount; k++) {

                        const j = order[sliceStart + k];

                        if (j === i)
                            continue;

                        const dx = px - bodyX[j];
                        const dy = py - bodyY[j];
                        const dz = pz - bodyZ[j];
                        const r = radius(dx, dy, dz);

                        const magnitude = repulsionMagnitude(r);

                        // Same index tie-break as the exact kernel: the earlier
                        // body is pushed toward -x when the pair is coincident.
                        const coincident = r === 0;
                        const ux = coincident ? (i < j ? -1 : 1) : dx;
                        const uy = coincident ? 0 : dy;
                        const uz = coincident ? 0 : dz;
                        const ur = coincident ? 1 : r;

                        fx += (magnitude * ux) / ur;
                        fy += (magnitude * uy) / ur;
                        fz += (magnitude * uz) / ur;
                    }

                    continue;
                }

                const dx = px - massX[cell];
                const dy = py - massY[cell];
                const dz = pz - massZ[cell];
                const d = radius(dx, dy, dz);
                const extent = 2 * half[cell];

                // Far enough away to use the aggregate: a cell holding `mass`
                // unit charges repels with `mass` times one charge's magnitude.
                // `d === 0` makes the test false, so such a cell recurses instead.
                if (!contains && d > 0 && extent / d < theta) {

                    const magnitude = mass[cell] * repulsionMagnitude(d);

                    fx += (magnitude * dx) / d;
                    fy += (magnitude * dy) / d;
                    fz += (magnitude * dz) / d;

                    continue;
                }

                // Recurse. The child on body i's side of the split inherits
                // `contains`; the octant predicate is the one build() used.
                const octant =
                    (px >= centerX[cell] ? 1 : 0) |
                    (py >= centerY[cell] ? 2 : 0) |
                    (pz >= centerZ[cell] ? 4 : 0);

                const children = childCount[cell];

                for (let c = 0; c < children; c++) {

                    const child = first + c;

                    stackCell[stackSize] = child;
                    stackContains[stackSize] = contains === 1 && childOctant[child] === octant ? 1 : 0;
                    stackSize++;
                }
            }

            outX[i] += fx;
            outY[i] += fy;
            outZ[i] += fz;
        }
    }

    private buildCell(cell: number, depth: number, maxDepth: number): void {

        const sliceStart = this.cellStart[cell];
        const sliceCount = this.cellCount[cell];

        const cellHalf = this.cellHalf[cell];

        // The precision floor: beyond the depth cap, or once halving can no
        // longer move, keep a bucket and let traversal do exact pairwise work.
        if (sliceCount === 1 || depth >= maxDepth || !(cellHalf > 0)) {
            this.makeLeaf(cell, sliceStart, sliceCount);
            return;
        }

        const centerX = this.cellCenterX[cell];
        const centerY = this.cellCenterY[cell];
        const centerZ = this.cellCenterZ[cell];

        for (let k = 0; k < 8; k++)
            this.octantCount[k] = 0;

        const order = this.bodyOrder;
        const bodyOctant = this.bodyOctant;

        for (let k = sliceStart; k < sliceStart + sliceCount; k++) {

            const body = order[k];
            const octant =
                (this.bodyX[body] >= centerX ? 1 : 0) |
                (this.bodyY[body] >= centerY ? 2 : 0) |
                (this.bodyZ[body] >= centerZ ? 4 : 0);

            bodyOctant[body] = octant;
            this.octantCount[octant]++;
        }

        let offset = sliceStart;

        for (let k = 0; k < 8; k++) {
            this.octantStart[k] = offset;
            this.octantWrite[k] = offset;
            offset += this.octantCount[k];
        }

        const partition = this.partition;

        for (let k = sliceStart; k < sliceStart + sliceCount; k++) {
            const body = order[k];
            partition[this.octantWrite[bodyOctant[body]]++] = body;
        }

        for (let k = sliceStart; k < sliceStart + sliceCount; k++)
            order[k] = partition[k];

        // Allocate every non-empty child up front so a cell's children are
        // contiguous and traversal can walk them by offset.
        const childHalf = cellHalf / 2;
        const first = this.cells;
        let children = 0;

        for (let k = 0; k < 8; k++) {

            const occupied = this.octantCount[k];

            if (occupied === 0)
                continue;

            const child = this.newCell(
                centerX + ((k & 1) ? childHalf : -childHalf),
                centerY + ((k & 2) ? childHalf : -childHalf),
                centerZ + ((k & 4) ? childHalf : -childHalf),
                childHalf,
                this.octantStart[k],
                occupied
            );

            this.cellChildOctant[child] = k;
            children++;
        }

        this.cellFirstChild[cell] = first;
        this.cellChildCount[cell] = children;

        for (let c = 0; c < children; c++)
            this.buildCell(first + c, depth + 1, maxDepth);

        // Aggregate bottom-up: mass is the charge total, the centre of mass its
        // charge-weighted mean.
        let totalMass = 0;
        let mx = 0;
        let my = 0;
        let mz = 0;

        for (let c = 0; c < children; c++) {

            const child = first + c;
            const childMass = this.cellMass[child];

            totalMass += childMass;
            mx += childMass * this.cellCenterOfMassX[child];
            my += childMass * this.cellCenterOfMassY[child];
            mz += childMass * this.cellCenterOfMassZ[child];
        }

        this.cellMass[cell] = totalMass;
        this.cellCenterOfMassX[cell] = mx / totalMass;
        this.cellCenterOfMassY[cell] = my / totalMass;
        this.cellCenterOfMassZ[cell] = mz / totalMass;
    }

    private makeLeaf(cell: number, sliceStart: number, sliceCount: number): void {

        this.cellFirstChild[cell] = -1;
        this.cellChildCount[cell] = 0;

        let mx = 0;
        let my = 0;
        let mz = 0;

        for (let k = sliceStart; k < sliceStart + sliceCount; k++) {
            const body = this.bodyOrder[k];
            mx += this.bodyX[body];
            my += this.bodyY[body];
            mz += this.bodyZ[body];
        }

        this.cellMass[cell] = sliceCount;
        this.cellCenterOfMassX[cell] = mx / sliceCount;
        this.cellCenterOfMassY[cell] = my / sliceCount;
        this.cellCenterOfMassZ[cell] = mz / sliceCount;
    }

    private newCell(
        centerX: number,
        centerY: number,
        centerZ: number,
        half: number,
        start: number,
        count: number
    ): number {

        const cell = this.cells;

        this.cells = cell + 1;
        this.ensureCellCapacity(this.cells);

        this.cellCenterX[cell] = centerX;
        this.cellCenterY[cell] = centerY;
        this.cellCenterZ[cell] = centerZ;
        this.cellHalf[cell] = half;
        this.cellMass[cell] = 0;
        this.cellCenterOfMassX[cell] = 0;
        this.cellCenterOfMassY[cell] = 0;
        this.cellCenterOfMassZ[cell] = 0;
        this.cellFirstChild[cell] = -1;
        this.cellChildCount[cell] = 0;
        this.cellChildOctant[cell] = 0;
        this.cellStart[cell] = start;
        this.cellCount[cell] = count;

        return cell;
    }

    private ensureBodyCapacity(n: number): void {
        if (n <= this.bodyCapacity)
            return;

        let capacity = this.bodyCapacity > 0 ? this.bodyCapacity : 64;

        while (capacity < n)
            capacity *= 2;

        this.bodyCapacity = capacity;
        this.bodyX = growFloat64(this.bodyX, capacity);
        this.bodyY = growFloat64(this.bodyY, capacity);
        this.bodyZ = growFloat64(this.bodyZ, capacity);
        this.bodyOrder = growInt32(this.bodyOrder, capacity);
        this.bodyOctant = growInt8(this.bodyOctant, capacity);
    }

    private ensureCellCapacity(n: number): void {
        if (n <= this.cellCapacity)
            return;

        let capacity = this.cellCapacity > 0 ? this.cellCapacity : 64;

        while (capacity < n)
            capacity *= 2;

        this.cellCapacity = capacity;
        this.cellCenterX = growFloat64(this.cellCenterX, capacity);
        this.cellCenterY = growFloat64(this.cellCenterY, capacity);
        this.cellCenterZ = growFloat64(this.cellCenterZ, capacity);
        this.cellHalf = growFloat64(this.cellHalf, capacity);
        this.cellMass = growFloat64(this.cellMass, capacity);
        this.cellCenterOfMassX = growFloat64(this.cellCenterOfMassX, capacity);
        this.cellCenterOfMassY = growFloat64(this.cellCenterOfMassY, capacity);
        this.cellCenterOfMassZ = growFloat64(this.cellCenterOfMassZ, capacity);
        this.cellFirstChild = growInt32(this.cellFirstChild, capacity);
        this.cellChildCount = growInt32(this.cellChildCount, capacity);
        this.cellChildOctant = growInt8(this.cellChildOctant, capacity);
        this.cellStart = growInt32(this.cellStart, capacity);
        this.cellCount = growInt32(this.cellCount, capacity);
    }

    private ensurePartitionCapacity(n: number): void {
        if (n <= this.partitionCapacity)
            return;

        let capacity = this.partitionCapacity > 0 ? this.partitionCapacity : 64;

        while (capacity < n)
            capacity *= 2;

        this.partitionCapacity = capacity;
        this.partition = growInt32(this.partition, capacity);
    }

    private ensureStackCapacity(n: number): void {
        if (n <= this.stackCell.length)
            return;

        this.stackCell = growInt32(this.stackCell, n);
        this.stackContains = growUint8(this.stackContains, n);
    }
}
