import { doublingCapacity, growPooledArray } from "./Growth";
import { K } from "./K";
import { radialComponentsInto, radius, repulsionMagnitude } from "./Kernel";
import { Tag } from "./Tag";

/**
 * Barnes-Hut octree over the model positions (docs/performance.md).
 *
 * The all-pairs repulsion pass is O(N^2) and was 85-98% of a step at N >= 512. The
 * tree replaces the far field with a cell's charge total at its centre of mass,
 * which is the standard approximation for a long-range law; the near field stays
 * exact. It is pure geometry and arithmetic, like Projector.ts.
 *
 * Everything is structure-of-arrays: bodies and cells live in pooled
 * `Float64Array`/`Int32Array` buffers that are reused across builds, so a step
 * allocates nothing steady-state.
 */

// Half-extent floor for the root cube, so an all-coincident (or single-point)
// body set still has an octree to subdivide.
const MIN_HALF_EXTENT = 1e-6;

/**
 * The opening-angle ceiling docs/performance.md documents,
 * 2/sqrt(3) ~= 1.1547.
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

/**
 * Which octant of a cell centred at `(cx, cy, cz)` holds `(x, y, z)`: bit 0 is
 * +x, bit 1 is +y, bit 2 is +z.
 *
 * One home for the predicate, so the partition in `buildCell()` and the
 * `contains` chain in `accumulateForce()` cannot disagree about which child owns
 * a body - the disagreement that would let a body accept its own containing cell
 * as an aggregate.
 */
function octantOf(x: number, y: number, z: number, cx: number, cy: number, cz: number): number {
    return (x >= cx ? 1 : 0) | (y >= cy ? 2 : 0) | (z >= cz ? 4 : 0);
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

    // Radial-component scratch for Kernel.radialComponentsInto(), so the leaf
    // pass allocates nothing steady-state.
    private readonly radialScratch = new Float64Array(3);

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
        const radial = this.radialScratch;

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

                        // Direction, clamp and the coincident tie-break are the
                        // kernel's, so a leaf agrees with the exact kernel about
                        // which of a coincident pair is pushed along -x.
                        radialComponentsInto(
                            dx,
                            dy,
                            dz,
                            r,
                            repulsionMagnitude(r),
                            i < j,
                            radial
                        );

                        fx += radial[0];
                        fy += radial[1];
                        fz += radial[2];
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
                // `contains`, and the octant comes from the one predicate.
                const octant = octantOf(px, py, pz, centerX[cell], centerY[cell], centerZ[cell]);

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
            const octant = octantOf(this.bodyX[body], this.bodyY[body], this.bodyZ[body], centerX, centerY, centerZ);

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

        const capacity = doublingCapacity(this.bodyCapacity, n);

        this.bodyCapacity = capacity;
        this.bodyX = growPooledArray(this.bodyX, capacity);
        this.bodyY = growPooledArray(this.bodyY, capacity);
        this.bodyZ = growPooledArray(this.bodyZ, capacity);
        this.bodyOrder = growPooledArray(this.bodyOrder, capacity);
        this.bodyOctant = growPooledArray(this.bodyOctant, capacity);
    }

    private ensureCellCapacity(n: number): void {
        if (n <= this.cellCapacity)
            return;

        const capacity = doublingCapacity(this.cellCapacity, n);

        this.cellCapacity = capacity;
        this.cellCenterX = growPooledArray(this.cellCenterX, capacity);
        this.cellCenterY = growPooledArray(this.cellCenterY, capacity);
        this.cellCenterZ = growPooledArray(this.cellCenterZ, capacity);
        this.cellHalf = growPooledArray(this.cellHalf, capacity);
        this.cellMass = growPooledArray(this.cellMass, capacity);
        this.cellCenterOfMassX = growPooledArray(this.cellCenterOfMassX, capacity);
        this.cellCenterOfMassY = growPooledArray(this.cellCenterOfMassY, capacity);
        this.cellCenterOfMassZ = growPooledArray(this.cellCenterOfMassZ, capacity);
        this.cellFirstChild = growPooledArray(this.cellFirstChild, capacity);
        this.cellChildCount = growPooledArray(this.cellChildCount, capacity);
        this.cellChildOctant = growPooledArray(this.cellChildOctant, capacity);
        this.cellStart = growPooledArray(this.cellStart, capacity);
        this.cellCount = growPooledArray(this.cellCount, capacity);
    }

    private ensurePartitionCapacity(n: number): void {
        if (n <= this.partitionCapacity)
            return;

        const capacity = doublingCapacity(this.partitionCapacity, n);

        this.partitionCapacity = capacity;
        this.partition = growPooledArray(this.partition, capacity);
    }

    private ensureStackCapacity(n: number): void {
        if (n <= this.stackCell.length)
            return;

        this.stackCell = growPooledArray(this.stackCell, n);
        this.stackContains = growPooledArray(this.stackContains, n);
    }
}
