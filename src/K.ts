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
	    timerTickperiodMS : 50,
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
        // 2.5% of the model width, matching the reference's 15.0 in a
        // 600-unit world.
        minimumNodeSelectionRadius : 15.0,
    },

    space: {
        // Model (phase) space: a square 600x600 world centred on the origin, so
        // coordinates run roughly -300..+300. The reference has no boundary
        // handling and nothing here clamps a node to this square either.
        W_0 : 600,
        H_0 : 600,
    },

    label: {
        verticalSpacing : 5,
        horizontalSpacing : 5,
        fontFamily : '10pt Arial',    
    },

    initialConditions: {
        // Reference demo: DEMO_GRAPH_SIZE = 11, DEMO_GRAPH_BRANCHING_CONST = 2.
        order : 11,
        branching : 2
    }
};