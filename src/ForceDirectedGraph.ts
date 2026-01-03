import { Graph } from "./Graph";
import { K } from "./K";
import { Point2D } from "./Point2D";
import { Tag } from "./Tag";

const COLOUR_SELECTED = 'red';
const COLOUR_DEFAULT = 'green';

export class ForceDirectedGraph {

    graph: Graph;


    constructor(graph: Graph) {
        this.graph = graph;
    }

	translate(
        xy: Point2D, 
        w0: number, 
        h0: number, 
        w1: number, 
        h1: number
    ) {

		var x1 = (w1 / 2.0) + xy.x * (w1 / w0);
		var y1 = (h1 / 2.0) - xy.y * (h1 / h0);

		return {
			x : x1,
			y : y1
		};
	};

	reverse(xy: Point2D, w0: number, h0: number, w1: number, h1: number) {

		var x0 = (xy.x - (w1 / 2.0)) * (w0 / w1);
		var y0 = ((h1 / 2.0) - xy.y) * (h0 / h1);

		return {
			x : x0,
			y : y0
		};
	};
	
	wrapReverse(xy: Point2D, canvasWidth: number, canvasHeight: number) {
		return this.reverse(xy, K.space.W_0, K.space.H_0, canvasWidth, canvasHeight);
	};

	drawToContext(
        context: CanvasRenderingContext2D, 
        node_label_vert_spacing: number = 0
    ) {

		var selected_node = null;
		for(let i = 0; i < this.graph.vertices.length; i++)
		if(this.graph.vertices[i].isSelected) {
			selected_node = this.graph.vertices[i];
			break;
        };
        
		context.clearRect(0, 0, context.canvas.width, context.canvas.height);

		// EDGES
		//
		for (let i = 0; i < this.graph.edges.length; i++) {

			var edge = this.graph.edges[i];
			var v1 = edge.v1;
			var v2 = edge.v2;	
			
			if((selected_node == v1) || (selected_node == v2))
				context.strokeStyle = COLOUR_DEFAULT;
			else
				context.strokeStyle = COLOUR_DEFAULT;
			
			// DRAW EDGE
			//
			context.beginPath();
			context.moveTo(v1.translatedPosition.x, v1.translatedPosition.y);
			context.lineTo(v2.translatedPosition.x, v2.translatedPosition.y);
			context.stroke();
		}

		var box_side = 10;

		for (let i = 0; i < this.graph.vertices.length; i++) {

			var node = this.graph.vertices[i];
			
			const x = node.translatedPosition.x;
			const y = node.translatedPosition.y;

			// NODES
			//
	        if (node.isSelected) {
	        	context.fillStyle = COLOUR_SELECTED;
	        }
	        else
	        {
	        	context.fillStyle = COLOUR_DEFAULT;
	        }

			// Arc radius
			//
	        var radius     = 5;                    
	        
			// Starting point on circle
			//
			var startAngle = 0;
			
			// End point on circle
			//
	        var endAngle   = 2 * Math.PI;
	        
			// clockwise or anticlockwise
			//
			var clockwise  = true; 

			context.beginPath();	    
	        context.arc(x,y,radius,startAngle,endAngle, clockwise);
	        context.fill();
	        
	        if (node.isSelected) {
	        	radius = 10;
				context.beginPath();	    
				context.arc(x,y,radius,startAngle,endAngle, clockwise);
				context.strokeStyle = COLOUR_SELECTED;
				context.stroke();
	        }
	        
			// LABEL / TEXT
			//			
			context.font = K.label.fontFamily;
			context.fillText(node.label, x + K.label.horizontalSpacing, y - K.label.verticalSpacing);
		};
	};

	netElectrostaticForceAtNode(tagA: Tag) {

		var
			Fx_net = 0.0, 
			Fy_net = 0.0;

		for(let i = 0; i < this.graph.vertices.length; i++) {

			var tagB = this.graph.vertices[i];

			if(tagB == tagA)
				continue;

			var xA = tagA.position.x;
			var yA = tagA.position.y;

			var xB = tagB.position.x;
			var yB = tagB.position.y;

			var deltaX = xA - xB;
			var deltaY = yA - yB;

			var r2 = (deltaX * deltaX) + (deltaY * deltaY);

			if(r2 == 0)
				continue;

			var r = Math.sqrt(r2);

			var sin_theta = deltaY / r;
			var cos_theta = deltaX / r;

			var scalar_force = K.physics.scalarForceConstant * K.physics.nodeCharge * K.physics.nodeCharge / (r * r);

			var Fy = scalar_force * sin_theta;
			var Fx = scalar_force * cos_theta;
			
			Fy_net += Fy;
			Fx_net += Fx;
		};

		return {
			x : Fx_net,
			y : Fy_net
		}
	};

	netSpringForceAtNode(tag: Tag) {

		var Fx_net = 0;
		var Fy_net = 0;

		var x_tag = tag.position.x;
		var y_tag = tag.position.y;

		for(let i = 0; i < this.graph.edges.length; i++) {

			var edge = this.graph.edges[i];

			var edge_tag_1 = edge.v1;
			var edge_tag_2 = edge.v2;

			var other_tags = [edge_tag_1, edge_tag_2];

			if(other_tags.indexOf(tag) == -1)
				continue;

			var other_tag;
			if(other_tags[0] == tag)
				other_tag = other_tags[1];
			else
				other_tag = other_tags[0];

			var x_other = other_tag.position.x;
			var y_other = other_tag.position.y;

			var r2 = Math.pow((x_tag - x_other), 2) + Math.pow(y_tag - y_other, 2);
			var r = Math.sqrt(r2);

			if(r == 0)
				continue;

			// PHYSICS CONSTANTS
			//
			var k = K.physics.springConstant;
			var l = K.physics.equilibriumDisplacement;

			var scalar_force = -k * (l - r);

			// DISTINGUISH BETWEEN PUSH & PULL VECTORS
            //
            
            let tag_A: Tag;
            let tag_B: Tag;

			if(scalar_force < 0) {
				tag_A = tag;
				tag_B = other_tag;
			} else {
				tag_A = other_tag;
				tag_B = tag;
			}

			var deltaX = tag_A.position.x - tag_B.position.x;
			var deltaY = tag_A.position.y - tag_B.position.y;

			var sin_theta = deltaY / r;
			var cos_theta = deltaX / r;

			var Fy = scalar_force * sin_theta;
			var Fx = scalar_force * cos_theta;
			Fy_net = Fy_net + Fy;
			Fx_net = Fx_net + Fx;
		};

		return {
			x : Fx_net,
			y : Fy_net
		};
	};

	netForceAtNode(tag: Tag) {

		// net Force = net Electrostatic Force + net Spring Force

		var e = tag.netElectrostaticForce;
		var s = tag.netSpringForce;

		var nX = e.x + s.x;
		var nY = e.y + s.y;

		return {
			x : nX,
			y : nY
		};
	};

	displacementAtNode(tag: Tag) {

		// ERROR - DISPLACEMENT IS ! USING VELOCITY

		var e = tag.netElectrostaticForce;
		var s = tag.netSpringForce;
		
		const nX = e.x + s.x;
		const nY = e.y + s.y;
		
		const displacement = {x:nX, y:nY};

		return displacement

	};

	iterate(context: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) {

		/*
		for each node
		calc net electrostatic force
		calc net spring force
		calc displacement [impulse]
		effect displacements
		*/

		// ------------------------------------
		// FOR EACH NODE

		// CALCULATE NET FORCE
		//
		for (var i = 0; i < this.graph.vertices.length; i++) {
			this.graph.vertices[i].netElectrostaticForce = this.netElectrostaticForceAtNode(this.graph.vertices[i]);
		}

		var here = true;

		for( i = 0; i < this.graph.vertices.length; i++) {
			this.graph.vertices[i].netSpringForce = this.netSpringForceAtNode(this.graph.vertices[i]);
		}

		// CALC DISPLACEMENT
		//
		for(i = 0; i < this.graph.vertices.length; i++) {
			this.graph.vertices[i].displacement = this.displacementAtNode(this.graph.vertices[i]);
		}

		// ADJUST POSITION
		//
		for(i = 0; i < this.graph.vertices.length; i++) {
			var tag = this.graph.vertices[i];
			if (tag.isSelected && window.state.b0Down) {
			} 
			else {
				var displacement = tag.displacement;
				tag.position.x = tag.position.x + displacement.x;
				tag.position.y = tag.position.y + displacement.y;
			}
		}

		this.enforcePositionLimits(K.space.rightMargin, K.space.minorMargin);

		// TRANSLATE TO CANVAS
		//
		for( i = 0; i < this.graph.vertices.length; i++) {
			var node = this.graph.vertices[i];
			node.translatedPosition = this.translate(node.position, K.space.W_0, K.space.H_0, canvasWidth, canvasHeight);
		}
		// CALL RENDERING METHOD
		//
		this.drawToContext(context);
	};

	enforcePositionLimits(rightMargin: number, minorMargin: number) {
		
		for (let i = 0; i < this.graph.vertices.length; i++) {
			var node = this.graph.vertices[i];

			if (node.position.x < - ((K.space.W_0 / 2) - minorMargin))
				node.position.x = - ((K.space.W_0 / 2) - minorMargin);
			else if (node.position.x > ((K.space.W_0 / 2) - rightMargin))
				node.position.x = (K.space.W_0 / 2) - rightMargin;

			if (node.position.y < - ((K.space.H_0 / 2) - minorMargin))
				node.position.y = - ((K.space.H_0 / 2) - minorMargin);
			else if (node.position.y > ((K.space.H_0 / 2) - minorMargin))
				node.position.y = (K.space.H_0 / 2) - minorMargin;
		}		
	};

	handleNodeSelectionAttempt(canvasPos: Point2D, canvasWidth: number, canvasHeight: number) {

		var transformedPos = this.reverse(canvasPos, K.space.W_0, K.space.H_0, canvasWidth, canvasHeight);

		// calc distance from each node
		//
		var r2s = [];
		// r2 : Node
		for(let i = 0; i < this.graph.vertices.length; i++) {
			var node = this.graph.vertices[i];
			// r2 = (x - mx0)^2 + (y - my0)^2
			r2s.push(Math.pow(node.position.x - transformedPos.x, 2) + Math.pow(node.position.y - transformedPos.y, 2));
		}

		var closestNode = null;
		var closestDistance = null;

		for (let i = 0; i < r2s.length; i++) {
			if(r2s[i] < (K.ui.minimumNodeSelectionRadius * K.ui.minimumNodeSelectionRadius)) {
				if(closestNode == null) {
					closestNode = this.graph.vertices[i];
					closestDistance = r2s[i];
					continue;
				}
				else if(r2s[i] < closestDistance) {
					closestNode = this.graph.vertices[i];
					closestDistance = r2s[i];
				}
			}
		}

		var selectionChanged = false;
		
		for (let i = 0; i < this.graph.vertices.length; i++) {
			
			var node = this.graph.vertices[i];
			
			// RESET ALL OTHER NODES
			//
			if (node != closestNode) {
				if (node.isSelected == true) {
				
					node.isSelected = false;
					selectionChanged = true;
				}
			}
			
			// TOGGLE SELECTION ON TARGET NODE
			//
			else if (node == closestNode) {
				
				node.isSelected = !node.isSelected;
				selectionChanged = true;				
			}
		}
		
		return selectionChanged;
	};
};