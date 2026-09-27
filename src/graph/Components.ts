import { otherEndpoint } from "./Edge";
import { Graph } from "./Graph";

/**
 * Label every vertex with the index of its connected component, assigning
 * component numbers in order of first vertex encounter, so the labelling is a
 * deterministic function of `vertices`/`edges` insertion order alone.
 *
 * Iterative BFS over `incidentEdges`, not recursion: a long path must not grow
 * the stack. Self-loops contribute no neighbour (`otherEndpoint` returns null),
 * and a duplicate edge only revisits a vertex that is already labelled, so
 * neither changes the partition.
 *
 * `index` is the vertex -> index map the BFS needs to turn a neighbour into a
 * labelled slot. Building it once keeps the walk O(V + E) rather than O(V*E)
 * from an `indexOf` per edge, which matters at the thousands of nodes the
 * chooser allows.
 *
 * Topology, not physics: the caller decides what a label means. The physics
 * solver reads it to anchor each component as a rigid translation, and a future
 * component-packing pass would read the same partition.
 */
export function labelComponents(graph: Graph): Int32Array<ArrayBuffer> {

    const vertices = graph.vertices;
    const n = vertices.length;

    // -1 is "unvisited" rather than a valid label, so the first component starts
    // at 0 and a completed labelling is -1-free by construction. Filled with an
    // explicit loop rather than the typed array's bulk-fill method: the
    // architecture guard reads source text, and that method name is also a
    // canvas drawing call it watches for.
    const labels: Int32Array<ArrayBuffer> = new Int32Array(n);

    for (let i = 0; i < n; i++)
        labels[i] = -1;

    const index = new Map(vertices.map((tag, i) => [tag, i] as const));

    let component = 0;

    for (let start = 0; start < n; start++) {

        if (labels[start] !== -1)
            continue;

        labels[start] = component;

        // The frontier is an explicit array, not the call stack: a long path is
        // a realistic graph and must not overflow the stack. A vertex is
        // labelled before it enters the queue, so a slot is never read unset.
        const queue: number[] = [start];

        for (let head = 0; head < queue.length; head++) {

            const current = vertices[queue[head]];

            for (const edge of graph.incidentEdges(current)) {

                // Self-loops have no far endpoint and so add no neighbour.
                const other = otherEndpoint(edge, current);

                if (other === null)
                    continue;

                // An edge endpoint is always a graph member: addEdge rejects a
                // foreign tag, so this lookup cannot miss.
                const neighbour = index.get(other)!;

                if (labels[neighbour] !== -1)
                    continue;

                labels[neighbour] = component;
                queue.push(neighbour);
            }
        }

        component++;
    }

    return labels;
}
