import { Edge } from "./Edge";
import { Tag } from "./Tag";
export declare class Graph {
    vertices: Array<Tag>;
    edges: Array<Edge>;
    addNode(tag: Tag): void;
    removeNode(tag: Tag): void;
    toString(): string;
    addEdge(v1: Tag, v2: Tag): void;
    neighbours(v: Tag): Tag[];
}
