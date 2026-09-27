import { Tag } from "./Tag";

export interface Edge {
    v1: Tag;
    v2: Tag;
}

/** The endpoint of `edge` other than `tag`; null for a self-loop or an unknown tag. */
export function otherEndpoint(edge: Edge, tag: Tag): Tag | null {
    if (edge.v1 === edge.v2)
        return null;

    if (edge.v1 === tag)
        return edge.v2;

    if (edge.v2 === tag)
        return edge.v1;

    return null;
}
