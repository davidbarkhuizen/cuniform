/**
 * Grow-only doubling policy for the arrays the octree and renderer pool; one home
 * so the two consumers cannot tune separately. The solver deliberately opts out
 * and reallocates at an exact capacity (ForceDirectedGraph.ensureCapacity()).
 */

export const MIN_BUFFER_CAPACITY = 64;

export type PooledArray = Int8Array | Uint8Array | Int32Array | Float64Array;

export function doublingCapacity(current: number, needed: number): number {

    let capacity = current > 0 ? current : MIN_BUFFER_CAPACITY;

    while (capacity < needed)
        capacity *= 2;

    return capacity;
}

export function growPooledArray<T extends PooledArray>(old: T, capacity: number): T {

    const next = new (old.constructor as new (length: number) => T)(capacity);

    next.set(old);

    return next;
}
