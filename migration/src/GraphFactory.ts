import { Graph } from "./Graph";
import { K } from "./K";
import { Point2D } from "./Point2D";
import { Tag } from "./Tag";

export class GraphFactory {

	constructXYFactory() {

		var used = Array<Point2D>();
		const genXY = () => {
			var unique = false;
			while(!unique) {
				var x = (-K.W_0 / 2.0) + (Math.random() * K.W_0);
				var y = (-K.H_0 / 2.0) + (Math.random() * K.H_0);
				unique = (used.indexOf({
					x : x,
					y : y
				}) == -1);
			}
			used.push({
				x : x,
				y : y
			});
			return {
				x : x,
				y : y
			};
		}
		return genXY;
	};

	generateGraph(order: number, maxEdgesPerVertexPerPass: number) {
		/*
		 generate a semi-random graph of size p

		 generate p vertices, with random x,y co-ords
		 for each vertex:
		 randomly add at most max_edges_to_create_per_node_per_pass new edges
		 */

		var graph = new Graph();
		var funcGenXY = this.constructXYFactory();

		for(let i = 0; i < order; i++) {
			var pos = funcGenXY();
			var tag = new Tag(pos, 'no label');
			tag.label = 'Node ' + tag.idx.toString();

            graph.addNode(tag);

            for(const v of graph.vertices) {
                if (v !== tag) {
                    graph.addEdge(tag, v);
                }
            }
		
			// if (i > 0) {
                
            //     var z = Math.floor(Math.random() * (graph.vertices.length - 1));
			// 	if (z == 0) { 
			// 		z = 1;  	
			// 	}

			// 	graph.addEdge(tag, graph.vertices[z]);
			// }
		}

		// var nodes = graph.vertices;
		// for(let i = 0; i < nodes.length; i++) {
		// 	var node = nodes[i];
		// 	var neighbourCount = Math.round(Math.random() * maxEdgesPerVertexPerPass);
		// 	for(let j = 0; j < neighbourCount; j++) {
		// 		var newEdgeAdded = false;
		// 		while(newEdgeAdded == false) {
		// 			var z = Math.floor(Math.random() * (nodes.length - 1));
		// 			if(nodes[z] != node) {
			
		// 				if (!graph.neighbours(nodes[z]).includes(node)) {
		// 					graph.addEdge(node, nodes[z]);
		// 					newEdgeAdded = true;
		// 				}
		// 			}
		// 		}
		// 	}
		// }

		return graph;
	};
};