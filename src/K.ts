export const K = {

    physics: {
        springConstant : 0.1,
        equilibriumDisplacement : 40,
        nodeCharge: 15.0,
        scalarForceConstant: 200.0,
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
        order : 17,
        branching : 1
    }
};