/** Roving-focus arithmetic shared by the context menu and the graph wizard. */

/**
 * `index` moved by `delta` within a ring of `length`. An out-of-range index means
 * nothing is focused yet and enters from the end the movement comes from.
 */
export function advanceIndex(index: number, delta: number, length: number): number {

    if (length <= 0)
        return 0;

    if (index < 0 || index >= length)
        index = delta > 0 ? -1 : 0;

    return ((index + delta) % length + length) % length;
}
