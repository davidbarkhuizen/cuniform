import { Graph } from "./Graph";
export declare class GraphFactory {
    constructXYFactory(): () => {
        x: number;
        y: number;
    };
    generateGraph(order: number, maxEdgesPerVertexPerPass: number): Graph;
}
