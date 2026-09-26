import { Graph } from "./Graph";
import { K } from "./K";
import { Point2D } from "./Point2D";
import { Tag } from "./Tag";

const COLOUR_SELECTED = 'red';
const COLOUR_DEFAULT = 'green';
/** Edges incident to the selected node are highlighted in this colour. */
const COLOUR_EDGE_INCIDENT = 'red';

export class ForceDirectedGraph {

    graph: Graph;


    constructor(graph: Graph) {
        this.graph = graph;
    }

	/**
	 * Model -> canvas. The scale is uniform on both axes,
	 * min(w1/w0, h1/h0), so the layout is never stretched anisotropically when
	 * the canvas aspect ratio differs from the model square. The y axis is
	 * flipped so increasing model y moves up the canvas.
	 */
	translate(
        xy: Point2D, 
        w0: number, 
        h0: number, 
        w1: number, 
        h1: number
    ) {

		var scale = Math.min(w1 / w0, h1 / h0);

		var x1 = (w1 / 2.0) + xy.x * scale;
		var y1 = (h1 / 2.0) - xy.y * scale;

		return {
			x : x1,
			y : y1
		};
	};

	/** Exact inverse of translate(): canvas -> model. */
	reverse(xy: Point2D, w0: number, h0: number, w1: number, h1: number) {

		var scale = Math.min(w1 / w0, h1 / h0);

		var x0 = (xy.x - (w1 / 2.0)) / scale;
		var y0 = ((h1 / 2.0) - xy.y) / scale;

		return {
			x : x0,
			y : y0
		};
	};
	
	wrapReverse(xy: Point2D, canvasWidth: number, canvasHeight: number) {
		return this.reverse(xy, K.space.W_0, K.space.H_0, canvasWidth, canvasHeight);
	};

	render(context: CanvasRenderingContext2D) {

		var selected_node: Tag | null = null;
		for(let i = 0; i < this.graph.vertices.length; i++)
		if(this.graph.vertices[i].isSelected) {
			selected_node = this.graph.vertices[i];
			break;
        };
        
		// Clear the whole backing store in device space, independent of any
		// devicePixelRatio transform the caller applied for HiDPI.
		context.save();
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, context.canvas.width, context.canvas.height);
		context.restore();

		// EDGES
		//
		for (let i = 0; i < this.graph.edges.length; i++) {

			var edge = this.graph.edges[i];
			var v1 = edge.v1;
			var v2 = edge.v2;	
			
			if((selected_node === v1) || (selected_node === v2))
				context.strokeStyle = COLOUR_EDGE_INCIDENT;
			else
				context.strokeStyle = COLOUR_DEFAULT;
			
			// DRAW EDGE
			//
			context.beginPath();
			context.moveTo(v1.translatedPosition.x, v1.translatedPosition.y);
			context.lineTo(v2.translatedPosition.x, v2.translatedPosition.y);
			context.stroke();
		}

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

			// The direction uses the true radius so the force stays exactly
			// radial; only the magnitude is evaluated at a clamped radius, which
			// bounds the r -> 0 singularity without altering the law for any
			// r >= minimumInteractionRadius.
			var r_law = Math.max(r, K.physics.minimumInteractionRadius);

			var sin_theta = deltaY / r;
			var cos_theta = deltaX / r;

			var scalar_force = K.physics.scalarForceConstant * K.physics.nodeCharge * K.physics.nodeCharge / Math.pow(r_law, K.physics.repulsionExponent);

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

		// Walking the node's adjacency list visits each edge once per endpoint,
		// so the whole per-step spring pass is O(V + E) rather than O(V*E).
		var incident = this.graph.incidentEdges(tag);

		for(let i = 0; i < incident.length; i++) {

			var edge = incident[i];
			var other_tag = edge.v1 === tag ? edge.v2 : edge.v1;

			var x_other = other_tag.position.x;
			var y_other = other_tag.position.y;

			var r2 = Math.pow((x_other - x_tag), 2) + Math.pow(y_other - y_tag, 2);
			var r = Math.sqrt(r2);

			if(r == 0)
				continue;

			// PHYSICS CONSTANTS
			//
			var k = K.physics.springConstant;
			var l = K.physics.equilibriumDisplacement;

			// Hooke's law: k*(r - l) is positive when the spring is stretched
			// (r > l) so the node is pulled toward its neighbour, and negative
			// when compressed (r < l) so it is pushed away.
			var scalar_force = k * (r - l);

			// Unit vector pointing from this node toward the neighbour.
			var cos_theta = (x_other - x_tag) / r;
			var sin_theta = (y_other - y_tag) / r;

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

	/**
	 * Damped, semi-implicit Euler:
	 *
	 *   v_new = v_old * FRICTION + F_net * TIME_STEP
	 *
	 * Velocity is updated before position (see step()), which is what makes
	 * the integration symplectic and keeps stiff springs stable.
	 */
	velocityAtTag(tag: Tag) {

		var f = this.netForceAtNode(tag);

		// RECORD PREVIOUS VELOCITY
		//
		var vx_old = tag.velocity.x;
		var vy_old = tag.velocity.y;

		var friction = K.physics.friction;
		var time_step = K.physics.timeStep;

		// NEW V = (OLD V * FRICTION) + (CURRENT NET FORCE * TIME_STEP)
		//
		var vx_new = (vx_old * friction) + f.x * time_step;
		var vy_new = (vy_old * friction) + f.y * time_step;

		return {
			x : vx_new,
			y : vy_new
		};
	};

	/**
	 * Per-step displacement. velocityAtTag() has already applied FRICTION and
	 * TIME_STEP, so this is just the node's current velocity (see Tag.displacement).
	 */
	displacementAtNode(tag: Tag) {
		return tag.velocity;
	};

	/**
	 * Advance the simulation by exactly one step. Physics only: this method
	 * reads no DOM global and does no drawing, so it can be run headlessly.
	 *
	 * `isPinned` reports nodes the user is dragging; a pinned node keeps the
	 * position written by the pointer handler and its integrated displacement
	 * is discarded. Drawing is a separate call to `render()`.
	 */
	step(
		canvasWidth: number,
		canvasHeight: number,
		isPinned: (tag: Tag) => boolean = () => false
	) {

		/*
		for each node
		calc net electrostatic force
		calc net spring force
		calc velocity
		calc displacement [== velocity]
		effect displacements
		*/

		// ------------------------------------
		// FOR EACH NODE

		// CALCULATE NET FORCE
		//
		for (var i = 0; i < this.graph.vertices.length; i++) {
			this.graph.vertices[i].netElectrostaticForce = this.netElectrostaticForceAtNode(this.graph.vertices[i]);
		}

		for( i = 0; i < this.graph.vertices.length; i++) {
			this.graph.vertices[i].netSpringForce = this.netSpringForceAtNode(this.graph.vertices[i]);
		}

		// CALC VELOCITY
		//
		for(i = 0; i < this.graph.vertices.length; i++) {
			this.graph.vertices[i].velocity = this.velocityAtTag(this.graph.vertices[i]);
		}

		// ADJUST POSITION
		//
		// Displacement is the velocity computed above, so no separate pass is
		// needed. A dragged node keeps the position the pointer handler wrote
		// and has its velocity zeroed, so releasing the mouse does not fling it.
		for(i = 0; i < this.graph.vertices.length; i++) {
			var tag = this.graph.vertices[i];
			if (isPinned(tag)) {
				tag.velocity = { x : 0, y : 0 };
			} 
			else {
				var displacement = tag.displacement;
				tag.position.x = tag.position.x + displacement.x;
				tag.position.y = tag.position.y + displacement.y;
			}
		}

		// TRANSLATE TO CANVAS
		//
		for( i = 0; i < this.graph.vertices.length; i++) {
			var node = this.graph.vertices[i];
			node.translatedPosition = this.translate(node.position, K.space.W_0, K.space.H_0, canvasWidth, canvasHeight);
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

		var closestNode: Tag | null = null;
		var closestDistance: number | null = null;

		for (let i = 0; i < r2s.length; i++) {
			if(r2s[i] < (K.ui.minimumNodeSelectionRadius * K.ui.minimumNodeSelectionRadius)) {
				if(closestNode == null) {
					closestNode = this.graph.vertices[i];
					closestDistance = r2s[i];
					continue;
				}
				else if(closestDistance == null || r2s[i] < closestDistance) {
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