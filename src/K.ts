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
    },

    ui: {
        minimumNodeSelectionRadius : 50.0,
    },

    space: {
        W_0 : 2000,
        H_0 : 2000/1.618,
    
        rightMargin : 50,
        minorMargin : 15,    
    },

    label: {
        verticalSpacing : 5,
        horizontalSpacing : 5,
        fontFamily : '10pt Arial',    
    },

    initialConditions: {
        order : 10,
        branching : 1
    }
};