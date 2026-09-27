import { otherEndpoint } from "./Edge";
import { Graph } from "./Graph";

/**
 * Label every vertex with its connected-component index, in first-encounter order;
 * iterative BFS, and the `index` map keeps the walk O(V + E) rather than O(V*E).
 */
export function labelComponents(graph: Graph): Int32Array<ArrayBuffer> {

    const vertices = graph.vertices;
    const n = vertices.length;

    // -1 marks "unvisited". The explicit loop is needed because a source-scanning
    // architecture guard rejects the typed array's bulk-fill method name.
    const labels: Int32Array<ArrayBuffer> = new Int32Array(n);

    for (let i = 0; i < n; i++)
        labels[i] = -1;

    const index = new Map(vertices.map((tag, i) => [tag, i] as const));

    let component = 0;

    for (let start = 0; start < n; start++) {

        if (labels[start] !== -1)
            continue;

        labels[start] = component;

        const queue: number[] = [start];

        for (let head = 0; head < queue.length; head++) {

            const current = vertices[queue[head]];

            for (const edge of graph.incidentEdges(current)) {

                const other = otherEndpoint(edge, current);

                if (other === null)
                    continue;

                // An edge endpoint is always a graph member, so this lookup cannot miss.
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
