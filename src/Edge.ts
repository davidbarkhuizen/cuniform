import { Tag } from "./Tag";

export interface Edge {
    v1: Tag;
    v2: Tag;
}

/**
 * The endpoint of `edge` that is not `tag`, or null when `tag` is not an
 * endpoint at all or the edge is a self-loop.
 *
 * One home for the endpoint resolution, so the adjacency walk, the spring
 * kernel and the brute-force test reference cannot disagree about it.
 */
export function otherEndpoint(edge: Edge, tag: Tag): Tag | null {
    if (edge.v1 === edge.v2)
        return null;

    if (edge.v1 === tag)
        return edge.v2;

    if (edge.v2 === tag)
        return edge.v1;

    return null;
}
