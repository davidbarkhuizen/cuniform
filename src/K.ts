export const K = {

    physics: {
        springConstant : 0.1,
        equilibriumDisplacement : 30,
        nodeCharge: 10.0,
        scalarForceConstant: 100.0,
        // Coulomb-like repulsion is k*q^2 / r^repulsionExponent. The exponent is
        // deliberately slightly softer than the physical r^2 (reference doc 4.1).
        repulsionExponent: 1.9,
        // Integration: v = v * friction + F * timeStep, then position += v.
        // Keep timeStep / (1 - friction) ~= 1 so the layout settles instead of
        // oscillating or flinging nodes off-canvas.
        timeStep: 0.1,
        friction: 0.9,
	    timerTickPeriodMS : 50,
        // Robustness guard, not part of the reference model. Repulsion is
        // singular as r -> 0, and the exact r == 0 guard only catches perfect
        // coincidence: a pair a fraction of a unit apart would otherwise be
        // flung across the world in a single step. The repulsion power law is
        // evaluated at max(r, minimumInteractionRadius), so the force is
        // bounded while the direction stays exact. Every r >= this value is
        // untouched, so the reference law is unchanged over the range the
        // reference (and the tests) actually exercise. A deliberate
        // non-reference extension.
        minimumInteractionRadius : 10.0,
    },

    ui: {
        /**
         * Click hit radius in CSS pixels, independent of canvas size and
         * devicePixelRatio. Replaces the reference model's 15.0-model-unit
         * radius: a constant screen target is what "click the node" should
         * mean, and the model-space version scaled with the viewport (10 px to
         * 50 px across realistic windows).
         */
        minimumNodeSelectionRadiusPx : 15.0,
    },

    space: {
        // Model (phase) space: a 600x600x600 cube centred on the origin, so
        // coordinates run roughly -300..+300 on every axis. The reference has
        // no boundary handling and nothing here clamps a node to this cube
        // either. D_0 is the direct generalisation of W_0/H_0: the world is
        // isotropic, so the layout has no preferred plane.
        W_0 : 600,
        H_0 : 600,
        D_0 : 600,
    },

    label: {
        verticalSpacing : 5,
        horizontalSpacing : 5,
        fontFamily : '10pt Arial',    
    },

    colours: {
        // Rendering palette, tuned for the near-black canvas. Nodes are bright
        // so they read as the foreground; edges are deliberately dimmer so a
        // dense graph does not turn into a solid mesh, and the selected node
        // and its incident edges share one high-contrast highlight colour.
        nodeDefault : '#39d98a',
        nodeSelected : '#ffd400',
        label : '#e8f4ff',
        edgeDefault : '#4b5b70',
        edgeIncident : '#ffd400',
    },

    initialConditions: {
        // Reference demo: DEMO_GRAPH_SIZE = 11, DEMO_GRAPH_BRANCHING_CONST = 2.
        order : 11,
        branching : 2
    }
};