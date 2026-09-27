/**
 * The growable-buffer policy for the pooled typed arrays the solver, the octree
 * and the renderer reuse across steps and frames.
 *
 * A buffer only ever grows, and every growth doubles from MIN_BUFFER_CAPACITY, so
 * repeated passes amortise reallocation and a steady-state pass allocates
 * nothing. One home for the policy, so those three consumers cannot tune their
 * growth separately.
 */

/** The seed capacity a zero-length buffer grows to first. */
export const MIN_BUFFER_CAPACITY = 64;

/** Any of the typed arrays this project pools. */
export type PooledArray = Int8Array | Uint8Array | Int32Array | Float64Array;

/**
 * The capacity to grow `current` to so that it holds `needed` elements: start at
 * MIN_BUFFER_CAPACITY (or keep a larger `current`) and double until it fits.
 */
export function doublingCapacity(current: number, needed: number): number {

    let capacity = current > 0 ? current : MIN_BUFFER_CAPACITY;

    while (capacity < needed)
        capacity *= 2;

    return capacity;
}

/**
 * `old` reallocated at `capacity`, with its contents preserved. The array kind
 * follows `old`, so one function serves every pooled type.
 */
export function growPooledArray<T extends PooledArray>(old: T, capacity: number): T {

    const next = new (old.constructor as new (length: number) => T)(capacity);

    next.set(old);

    return next;
}
