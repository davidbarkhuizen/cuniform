/**
 * Roving-focus arithmetic: the context menu and the graph wizard both keep an
 * index into their focusable controls and move it by one, wrapping at the ends.
 *
 * One implementation, so the two cannot disagree about the wrap - the context
 * menu previously had no out-of-range guard at all, while the wizard did.
 */

/**
 * `index` moved by `delta` within a ring of `length` entries.
 *
 * An index outside the ring means nothing is focused yet; the ring is entered
 * from the end the movement comes from, so a forward move focuses the first
 * control and a backward move the last. A zero-length ring has nothing to focus.
 */
export function advanceIndex(index: number, delta: number, length: number): number {

    if (length <= 0)
        return 0;

    if (index < 0 || index >= length)
        index = delta > 0 ? -1 : 0;

    return ((index + delta) % length + length) % length;
}
