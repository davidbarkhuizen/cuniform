export const K = {

    physics: {
        springConstant : 0.1,
        equilibriumDisplacement : 30,
        nodeCharge: 10.0,
        scalarForceConstant: 100.0,
        // Deliberately softer than the physical r^2 (reference doc 4.1).
        repulsionExponent: 1.9,
        // Keep timeStep / (1 - friction) ~= 1, or the layout oscillates instead of settling.
        timeStep: 0.1,
        friction: 0.9,
	    timerTickPeriodMS : 50,
        // Robustness guard, not part of the reference model: the repulsion power
        // law is evaluated at max(r, minimumInteractionRadius), bounding the r -> 0 blow-up.
        minimumInteractionRadius : 10.0,
    },

    ui: {
        /** Click hit radius in CSS pixels, independent of canvas size and devicePixelRatio. */
        minimumNodeSelectionRadiusPx : 15.0,
    },

    space: {
        // Model space: a 600x600x600 cube centred on the origin. Nothing clamps a node to it.
        W_0 : 600,
        H_0 : 600,
        D_0 : 600,
    },

    camera: {
        // Perspective camera, never reaching the physics. A power of two so the identity
        // view (focalLength === distance, z = 0) reduces bit-exactly to the 2D mapping.
        focalLength : 1024,
        // Camera -> target along the view axis, equal to focalLength so the identity view
        // is 1:1 with the model extent. The wheel dollies this, never focalLength.
        distance : 1024,
        // Robustness guard, not in any reference model: the divide is evaluated at
        // max(depth, nearPlane), and nearer nodes are culled from rendering and hit-testing only.
        nearPlane : 50,
        // Orbit sensitivity, radians per CSS pixel of middle-drag.
        orbitRadiansPerPixel : 0.01,
        // Console rotation speed while a button is held, radians per second, applied per tick.
        rotateRadiansPerSecond : Math.PI / 3,
        // pi/2 - epsilon: the turntable guard keeping middle-drag off the pole, where "up" is undefined.
        maxPitch : Math.PI / 2 - 0.01,
        // Dolly clamp, above nearPlane so the target plane is never culled.
        minDistance : 128,
        // Dolly clamp out, minDistance mirrored at 8x the focal length, so zoom-out
        // stops while nodes still read as nodes rather than shrinking to the floor.
        maxDistance : 8192,
        // Wheel zoom rate: distance is multiplied by this once per notch out.
        dollyPerWheelNotch : 1.1,
    },

    depthCue: {
        // Perspective node size: radiusPx = NODE_RADIUS * focalLength / depth, clamped so a
        // near node cannot blow up and a far one cannot vanish. The selection ring scales identically.
        minNodeRadiusPx : 2.0,
        maxNodeRadiusPx : 12.0,
        // Depth fade range for nodes and edges alike: maxAlpha nearest, minAlpha farthest.
        // The far end stays above a quarter opacity to remain legible on the near-black canvas.
        minAlpha : 0.35,
        maxAlpha : 1.0,
    },

    label: {
        verticalSpacing : 5,
        horizontalSpacing : 5,
        fontFamily : '10pt Arial',    
    },

    colours: {
        // Palette for the near-black canvas: nodes bright, edges deliberately dimmer so a
        // dense graph does not read as a solid mesh.
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
    },

    chooser: {
        // Random-graph chooser bounds. maxOrder is capped because repulsion is O(N^2) per
        // tick; minOrder is 2 because a one-node graph has no edges.
        minOrder : 2,
        maxOrder : 64,
        // maxBranching is the practical cap; the hard limit is order - 1, enforced in parseRandomSpec().
        minBranching : 1,
        maxBranching : 8,
    },

    molecule: {
        // Equal to equilibriumDisplacement so seed neighbours start at the springs'
        // rest length, outside the repulsion guard. The equality is the point.
        seedSpacing : 30,
        // Depth offset amplitude for the seed: enough that the spiral is not planar,
        // small enough not to control the layout.
        seedDepthJitter : 4.5,
    },

    wordCloud: {
        // Chip font-size range in em; the catalog's heavy-atom counts are normalised onto it.
        minTagScale : 0.85,
        maxTagScale : 1.35,
    },
};