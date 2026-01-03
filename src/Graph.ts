import { Edge } from "./Edge";
import { Tag } from "./Tag";

export class Graph {

	vertices: Array<Tag> = [];
	edges: Array<Edge> = [];

	addNode(tag: Tag) {
		this.vertices.push(tag);
	};

	removeNode(tag: Tag) {
		
		// remove vertex
		//
		var vIdx = this.vertices.indexOf(tag);
		this.vertices.splice(vIdx, 1);
		
		// remove adjcant edges
		
		var toRemove = [];
		for (let i = 0; i < this.edges.length; i ++)
			if ((this.edges[i].v1 == tag) || (this.edges[i].v2 == tag))
				toRemove.push(this.edges[i]); 
	
		while (toRemove.length > 0) {
			var idx = this.edges.indexOf(toRemove[0]);
			this.edges.splice(idx, 1);
			toRemove.splice(0,1);
		}	
	};

	toString() {
		return "No Rep";
	};

	addEdge(v1: Tag, v2: Tag) {
		if((this.vertices.indexOf(v1) == -1) || (this.vertices.indexOf(v2) == -1))
			throw "one of the vertices in the edge requested to add, is not actually an ";

		this.edges.push({ v1, v2});
	};

	neighbours(v: Tag) {
		
		var set = [];
		
		for (let i = 0; i < this.edges.length; i++) {
			var edge = this.edges[i];
			if (edge.v1 == v) {
				set.push(edge.v2);
			} else if (edge.v2 == v) {
				set.push(edge.v1);
			}
		}
		
		return set;
	};

};