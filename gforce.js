var K = {
	// PHYSICS CONSTANTS
	SPRING_CONSTANT : 0.1,
	EQUILIBRIUM_DISPLACEMENT : 40,
	TIME_STEP : 0.8,
	FRICTION : 0.95,

	// DIMENSIONS OF PHASE SPACE
	W_0 : 2000,
	H_0 : 2000/1.618,

	PHASE_SPACE_LIMIT_RIGHT_MARGIN : 50,
	PHASE_SPACE_LIMIT_MINOR_MARGIN : 15,

	// VERT GAP BETWEEN NODE & LABEL
	NODE_LABEL_VERT_SPACING : 5,
	NODE_LABEL_HORIZ_SPACING : 5,
	NODE_LABEL_FONTFAMILY : '10pt Arial',

	// PERIOD OF GTK WINDOW TIMER TICK EVENT [that our handler is hooked into]
	TIMER_TICK_PERIOD : 50, // milliseconds

	MINIMUM_NODE_SELECTION_RADIUS : 50.0,

	//DEMO_GRAPH_SIZE : 11,
	DEMO_GRAPH_BRANCHING_CONST : 2,
	GENERATION_INTERVAL : 10.0 ,// seconds

	q_A: 15.0,
	q_B: 15.0,
	k: 200.0
};

var lastUsedTagIndex = 0;
function popUnusedTagIdx() {
	var idx = lastUsedTagIndex;
	lastUsedTagIndex += 1;
	return idx;
};

function Tag(xy, label) {

	this.idx = popUnusedTagIdx();
	
	this.label = label;
	
	this.position = {
		x : xy.x,
		y : xy.y
	};
	
	this.translatedPosition = {
		x : xy.x,
		y : xy.y
	};
	
	this.netElectrostaticForce = {
		x : 0,
		y : 0
	};
	
	this.netSpringForce = {
		x : 0,
		y : 0
	};
	
	this.displacement = {
		x : 0,
		y : 0
	};

	this.isSelected = false;

	this.toString = function() {
		return "Tag" + this.idx.toString();

		/*
		 s = ('%i = %s' % (this.idx, this.label)) + '\n'
		 s = s + ('(x,y) = (%f,%f)' % (this.position.x, this.position.y)) + '\n'

		 (Fx, Fy) = this.netElectrostaticForce
		 s = s + ('electro-static Fx, Fy = %f, %f' % (Fx, Fy)) + '\n'

		 (Fx, Fy) = this.netSpringForce
		 s = s + ('spring Fx, Fy = %f, %f' % (Fx, Fy)) + '\n'

		 (dx, dy) = this.displacement
		 s = s + ('displacement dx, dy = %f, %f' % (dx, dy)) + '\n'

		 return s
		 */
	};
};

// ---------------------------------------------------------------------------------------------------------

function ForceDirectedGraph(graph) {

	this.graph = graph;

	this.translate = function(xy, w0, h0, w1, h1) {

		var x1 = (w1 / 2.0) + xy.x * (w1 / w0);
		var y1 = (h1 / 2.0) - xy.y * (h1 / h0);

		return {
			x : x1,
			y : y1
		};
	};

	this.reverse = function(xy, w0, h0, w1, h1) {

		var x0 = (xy.x - (w1 / 2.0)) * (w0 / w1);
		var y0 = ((h1 / 2.0) - xy.y) * (h0 / h1);

		return {
			x : x0,
			y : y0
		};
	};
	
	this.wrapReverse = function(xy, canvasWidth, canvasHeight) {
		return this.reverse(xy, K.W_0, K.H_0, canvasWidth, canvasHeight);
	};

	this.drawToContext = function(context, node_label_vert_spacing) {

		var edge_colour = 'darkgreen', node_colour = 'darkgreen', text_colour = 'black', selected_node_colour = 'blue', edges_adj_to_selected_node_colour = 'blue';

		var selected_node = null;
		for( i = 0; i < this.graph.vertices.length; i++)
		if(this.graph.vertices[i].isSelected) {
			selected_node = this.graph.vertices[i];
			break;
		};

		context.clearRect(0, 0, canvas.width, canvas.height);

		// EDGES
		//
		for (i = 0; i < this.graph.edges.length; i++) {

			var edge = this.graph.edges[i];
			var v1 = edge.v1;
			var v2 = edge.v2;	
			
			if((selected_node == v1) | (selected_node == v2))
				context.strokeStyle = "black";
			else
				context.strokeStyle = "darkgray";
			
			// DRAW EDGE
			// context.drawLine
			// pixmap.draw_line(gc, int(i.translatedPosition.x), int(i.translatedPosition.y), int(j.translatedPosition.x), int(j.translatedPosition.y))
			context.beginPath();
			context.moveTo(v1.translatedPosition.x, v1.translatedPosition.y);
			context.lineTo(v2.translatedPosition.x, v2.translatedPosition.y);
			context.stroke();
		}

		var box_side = 10;

		for (i = 0; i < this.graph.vertices.length; i++) {

			var node = this.graph.vertices[i];
			
			x = node.translatedPosition.x;
			y = node.translatedPosition.y;

			// COLOURS = ['red', 'green', 'blue', 'purple', 'red_float', 'green_float', 'blue_float']
			//
			//gc.set_foreground(pixmap.get_colormap().alloc_color("brown"))

			// NODES
			//
			/*
			if isSelected
			gc.set_foreground(pixmap.get_colormap().alloc_color(selected_node_colour));
			else
			gc.set_foreground(pixmap.get_colormap().alloc_color(node_colour));
			*/

	        if (node.isSelected) {
	        	context.fillStyle = "black";
	        }
	        else
	        {
	        	context.fillStyle = "black";
	        }

	        var radius     = 5;                    // Arc radius
	        var startAngle = 0;                     // Starting point on circle
	        var endAngle   = 2 * Math.PI; // End point on circle
	        var clockwise  = true; // clockwise or anticlockwise

			context.beginPath();	    
	        context.arc(x,y,radius,startAngle,endAngle, clockwise);
	        context.fill();
	        
	        if (node.isSelected) {
	        	radius = 10;
				context.beginPath();	    
				context.arc(x,y,radius,startAngle,endAngle, clockwise);
				context.strokeStyle = "black";
				context.stroke();
	        }
	        
			// LABEL / TEXT
			//
			/*
			if (this.gem.display_node_labels):
			
			font = style.get_font()
			pixmap.draw_text(font, gc, x, y - node_label_vert_spacing, node.label)
			*/
			
			context.font = K.NODE_LABEL_FONTFAMILY;
			context.fillText(node.label, x + K.NODE_LABEL_HORIZ_SPACING, y - K.NODE_LABEL_VERT_SPACING);
		};
	};

	this.netElectrostaticForceAtNode = function(tagA) {

		var
			Fx_net = 0.0, 
			Fy_net = 0.0;

		for(i = 0; i < this.graph.vertices.length; i++) {

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
			var r = Math.sqrt(r2);

			if(r == 0)
				continue;

			var sin_theta = deltaY / r;
			var cos_theta = deltaX / r;

			var scalar_force = K.k * K.q_A * K.q_B / (r * r);

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

	this.netSpringForceAtNode = function(tag) {

		var Fx_net = 0;
		var Fy_net = 0;

		var x_tag = tag.position.x;
		var y_tag = tag.position.y;

		for( i = 0; i < this.graph.edges.length; i++) {

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
			var k = K.SPRING_CONSTANT;
			var l = K.EQUILIBRIUM_DISPLACEMENT;

			var scalar_force = -k * (l - r);

			// DISTINGUISH BETWEEN PUSH & PULL VECTORS
			//
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

	this.netForceAtNode = function(tag) {

		/*
		 net Force = net Electrostatic Force + net Spring Force
		 */

		var e = tag.netElectrostaticForce;
		var s = tag.netSpringForce;

		var nX = e.x + s.x;
		var nY = e.y + s.y;

		return {
			x : nX,
			y : nY
		};
	};

	this.displacementAtNode = function(tag) {

		/*
		 ERROR - DISPLACEMENT IS ! USING VELOCITY
		 */

		var e = tag.netElectrostaticForce;
		var s = tag.netSpringForce;
		
		nX = e.x + s.x;
		nY = e.y + s.y;
		
		displacement = {x:nX, y:nY};

		return displacement

	};

	this.iterate = function(context, canvasWidth, canvasHeight) {
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
			if (tag.isSelected & window.state.b0Down) {
			} 
			else {
				var displacement = tag.displacement;
				tag.position.x = tag.position.x + displacement.x;
				tag.position.y = tag.position.y + displacement.y;
			}
		}

		this.enforcePositionLimits(K.PHASE_SPACE_LIMIT_RIGHT_MARGIN, K.PHASE_SPACE_LIMIT_MINOR_MARGIN);

		// TRANSLATE TO CANVAS
		//
		for( i = 0; i < this.graph.vertices.length; i++) {
			var node = this.graph.vertices[i];
			node.translatedPosition = this.translate(node.position, K.W_0, K.H_0, canvasWidth, canvasHeight);
		}
		// CALL RENDERING METHOD
		//
		this.drawToContext(context);
	};

	this.enforcePositionLimits = function(rightMargin, minorMargin) {
		
		for (i = 0; i < this.graph.vertices.length; i++) {
			var node = this.graph.vertices[i];

			if (node.position.x < - ((K.W_0 / 2) - minorMargin))
				node.position.x = - ((K.W_0 / 2) - minorMargin);
			else if (node.position.x > ((K.W_0 / 2) - rightMargin))
				node.position.x = (K.W_0 / 2) - rightMargin;

			if (node.position.y < - ((K.H_0 / 2) - minorMargin))
				node.position.y = - ((K.H_0 / 2) - minorMargin);
			else if (node.position.y > ((K.H_0 / 2) - minorMargin))
				node.position.y = (K.H_0 / 2) - minorMargin;
		}		
	};

	this.handleNodeSelectionAttempt = function(canvasPos, canvasWidth, canvasHeight) {

		var transformedPos = this.reverse(canvasPos, K.W_0, K.H_0, canvasWidth, canvasHeight);

		// calc distance from each node
		//
		var r2s = [];
		// r2 : Node
		for( i = 0; i < this.graph.vertices.length; i++) {
			var node = this.graph.vertices[i];
			// r2 = (x - mx0)^2 + (y - my0)^2
			r2s.push(Math.pow(node.position.x - transformedPos.x, 2) + Math.pow(node.position.y - transformedPos.y, 2));
		}

		var closestNode = null;
		var closestDistance = null;

		for (i = 0; i < r2s.length; i++) {
			if(r2s[i] < (K.MINIMUM_NODE_SELECTION_RADIUS * K.MINIMUM_NODE_SELECTION_RADIUS)) {
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
		var selectedNode = null;
		
		for (i = 0; i < this.graph.vertices.length; i++) {
			
			var node = this.graph.vertices[i];
			// RESET ALL OTHER NODES
			
			if (node != closestNode) {
				if (node.isSelected == true) {
				
					node.isSelected = false;
					selectionChanged = true;
				}
			}
			
			// TOGGLE SELECTION ON TARGET NODE
			else if (node == closestNode) {
				
				node.isSelected = !node.isSelected;
				selectionChanged = true;
				
				if (node.isSelected)
					selectedNode = node;
			}
		}
		
		return selectionChanged;
	};
};

// ---------------------------------------------------------------------------------------------------------

function Graph() {

	this.vertices = [];
	this.edges = [];

	this.addNode = function(tag) {
		this.vertices.push(tag);
	};

	this.removeNode = function(tag) {
		
		// remove vertex
		//
		var vIdx = this.vertices.indexOf(tag);
		this.vertices.splice(vIdx, 1);
		
		// remove adjcant edges
		
		var toRemove = [];
		for (i = 0; i < this.edges.length; i ++)
			if ((this.edges[i].v1 == tag) | (this.edges[i].v2 == tag))
				toRemove.push(this.edges[i]); 
	
		while (toRemove.length > 0) {
			var idx = this.edges.indexOf(toRemove[0]);
			this.edges.splice(idx, 1);
			toRemove.splice(0,1);
		}	
	};

	this.toString = function() {
		return "No Rep";
	};

	this.addEdge = function(v1, v2) {
		if((this.vertices.indexOf(v1) == -1) | (this.vertices.indexOf(v2) == -1))
			throw "one of the vertices in the edge requested to add, is not actually an ";

		this.edges.push({ v1, v2});
	};

	this.neighbours = function(v) {
		
		var set = [];
		
		for (i = 0; i < this.edges.length; i++) {
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

// ---------------------------------------------------------------------------------------------------------

function GraphFactory() {

	this.constructXYFactory = function() {

		var used = [];
		genXY = function() {
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

	this.generateGraph = function(order, maxEdgesPerVertexPerPass) {
		/*
		 generate a semi-random graph of size p

		 generate p vertices, with random x,y co-ords
		 for each vertex:
		 randomly add at most max_edges_to_create_per_node_per_pass new edges
		 */

		var graph = new Graph();
		var funcGenXY = this.constructXYFactory();

		for( i = 0; i < order; i++) {
			var pos = funcGenXY();
			var tag = new Tag(pos, 'no label');
			tag.label = 'Node ' + tag.idx.toString();
			graph.addNode(tag);
		
			if (i > 0) {
				var z = Math.floor(Math.random() * (graph.vertices.length - 1));
				if (z == 0) { 
					z = 1;  	
				}

				graph.addEdge(tag, graph.vertices[z]);
			}
		}

		var nodes = graph.vertices;
		for( i = 0; i < nodes.length; i++) {
			var node = nodes[i];
			var neighbourCount = Math.round(Math.random() * maxEdgesPerVertexPerPass);
			for( j = 0; j < neighbourCount; j++) {
				var newEdgeAdded = false;
				while(newEdgeAdded == false) {
					var z = Math.floor(Math.random() * (nodes.length - 1));
					if(nodes[z] != node) {
			
						if (!graph.neighbours(nodes[z]).includes(node)) {
							graph.addEdge(node, nodes[z]);
							newEdgeAdded = true;
						}
					}
				}
			}
		}

		return graph;
	};
};