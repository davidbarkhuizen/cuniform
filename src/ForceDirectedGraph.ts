import { Graph } from "./Graph";
import { K } from "./K";
import { Point2D } from "./Point2D";
import { Tag } from "./Tag";
import { Viewport } from "./Viewport";

export class ForceDirectedGraph {

    graph: Graph;


    constructor(graph: Graph) {
        this.graph = graph;
    }

	/** Canvas -> model for a canvas of the given size. */
	wrapReverse(xy: Point2D, canvasWidth: number, canvasHeight: number) {
		return Viewport.forCanvas(canvasWidth, canvasHeight).toModel(xy);
	};

	/** Model -> canvas for a canvas of the given size. */
	wrapTranslate(xy: Point2D, canvasWidth: number, canvasHeight: number) {
		return Viewport.forCanvas(canvasWidth, canvasHeight).toCanvas(xy);
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
				context.strokeStyle = K.colours.edgeIncident;
			else
				context.strokeStyle = K.colours.edgeDefault;
			
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
	        	context.fillStyle = K.colours.nodeSelected;
	        }
	        else
	        {
	        	context.fillStyle = K.colours.nodeDefault;
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
				context.strokeStyle = K.colours.nodeSelected;
				context.stroke();
	        }
	        
			// LABEL / TEXT
			//			
			context.font = K.label.fontFamily;
			context.fillStyle = K.colours.label;
			context.fillText(node.label, x + K.label.horizontalSpacing, y - K.label.verticalSpacing);
		};
	};

	/**
	 * Superpose one radial force onto the running (Fx, Fy) accumulator: a
	 * magnitude `m` directed along (dx, dy) toward the other endpoint, where
	 * `r` is `Math.hypot(dx, dy)`.
	 *
	 * The r == 0 guard and the unit vector exist here once, so repulsion and
	 * springs cannot disagree about direction; only the magnitude law and the
	 * direction's sign convention differ, and those stay at the call sites.
	 * `r` is passed in rather than recomputed because both callers already need
	 * it for their magnitude - recomputing it would double the cost of the
	 * O(N^2) repulsion pass.
	 */
	private static addRadial(
		Fx: number,
		Fy: number,
		dx: number,
		dy: number,
		r: number,
		magnitude: number
	) {

		if (r === 0)
			return { x : Fx, y : Fy };

		return {
			x : Fx + (magnitude * dx) / r,
			y : Fy + (magnitude * dy) / r
		};
	};

	netElectrostaticForceAtNode(tagA: Tag) {

		var F = { x : 0.0, y : 0.0 };

		for(let i = 0; i < this.graph.vertices.length; i++) {

			var tagB = this.graph.vertices[i];

			if(tagB == tagA)
				continue;

			// Away from B, so a positive magnitude pushes the pair apart.
			var deltaX = tagA.position.x - tagB.position.x;
			var deltaY = tagA.position.y - tagB.position.y;

			var r = Math.hypot(deltaX, deltaY);

			// The direction uses the true radius so the force stays exactly
			// radial; only the magnitude is evaluated at a clamped radius, which
			// bounds the r -> 0 singularity without altering the law for any
			// r >= minimumInteractionRadius.
			var r_law = Math.max(r, K.physics.minimumInteractionRadius);

			var scalar_force = K.physics.scalarForceConstant * K.physics.nodeCharge * K.physics.nodeCharge / Math.pow(r_law, K.physics.repulsionExponent);

			F = ForceDirectedGraph.addRadial(F.x, F.y, deltaX, deltaY, r, scalar_force);
		};

		return F;
	};

	netSpringForceAtNode(tag: Tag) {

		var F = { x : 0.0, y : 0.0 };

		var k = K.physics.springConstant;
		var l = K.physics.equilibriumDisplacement;

		// Walking the node's adjacency list visits each edge once per endpoint,
		// so the whole per-step spring pass is O(V + E) rather than O(V*E).
		var incident = this.graph.incidentEdges(tag);

		for(let i = 0; i < incident.length; i++) {

			var edge = incident[i];
			var other_tag = edge.v1 === tag ? edge.v2 : edge.v1;

			// Toward the neighbour, so a positive magnitude pulls the pair
			// together.
			var deltaX = other_tag.position.x - tag.position.x;
			var deltaY = other_tag.position.y - tag.position.y;

			var r = Math.hypot(deltaX, deltaY);

			// Hooke's law: k*(r - l) is positive when the spring is stretched
			// (r > l) so the node is pulled toward its neighbour, and negative
			// when compressed (r < l) so it is pushed away.
			var scalar_force = k * (r - l);

			F = ForceDirectedGraph.addRadial(F.x, F.y, deltaX, deltaY, r, scalar_force);
		};

		return F;
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
		// One viewport for the whole pass: the scale and the half-extents are
		// loop invariants, so they are computed once per tick, not per node.
		const viewport = Viewport.forCanvas(canvasWidth, canvasHeight);

		for( i = 0; i < this.graph.vertices.length; i++) {
			var node = this.graph.vertices[i];
			node.translatedPosition = viewport.toCanvas(node.position);
		}
	};

	handleNodeSelectionAttempt(canvasPos: Point2D, canvasWidth: number, canvasHeight: number) {

		var transformedPos = this.wrapReverse(canvasPos, canvasWidth, canvasHeight);

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