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

    camera: {
        // Perspective camera (D1). The model is projected through this onto the
        // 2D canvas; the camera never reaches the physics, so panning, orbiting
        // and dollying cannot perturb the simulation.
        //
        // The regression anchor: with the identity orientation, focalLength
        // === distance and z = 0, the projection reduces exactly to the old
        // Viewport mapping. focalLength is a power of two so that reduction is
        // bit-exact rather than merely close - multiplying and dividing a
        // double by 1024 only shifts its exponent.
        focalLength : 1024,
        // Camera -> target along the view axis. Equal to focalLength so the
        // identity view is 1:1 with the 600-unit model extent. The wheel
        // dollies this; focalLength is constant.
        distance : 1024,
        // Robustness guard, not part of any reference model (there was no
        // camera). Perspective is singular as depth -> 0, so the divide is
        // evaluated at max(depth, nearPlane), and a node at depth <= nearPlane
        // is culled from rendering and hit-testing only. The camera never
        // reaches the physics, so a culled node still exerts and feels force.
        nearPlane : 50,
        // Orbit sensitivity, radians per CSS pixel of middle-drag.
        orbitRadiansPerPixel : 0.01,
        // Console rotation speed while a button is held, radians per second.
        // The controller applies one tick's worth of this per simulation tick,
        // so a held button turns the view smoothly at the render rate instead
        // of jumping a fixed angle per press.
        rotateRadiansPerSecond : Math.PI / 3,
        // pi/2 - epsilon: the turntable guard. Middle-drag never tilts the view
        // to a pole, where it has no defined upward direction. The console's
        // explicit per-axis rotations are free 3-DOF and are not bounded by it.
        maxPitch : Math.PI / 2 - 0.01,
        // Dolly clamp, above nearPlane so the target plane is never culled.
        minDistance : 128,
        // Wheel zoom rate: distance is multiplied by this once per notch out.
        dollyPerWheelNotch : 1.1,
    },

    depthCue: {
        // Perspective node size: radiusPx = NODE_RADIUS * focalLength / depth,
        // clamped to this range so a node at the near plane cannot blow up and
        // a far node cannot vanish. The selection ring scales identically.
        //
        // At the default distance a node in the 600^3 world projects at a depth
        // of roughly 724..1324, so the unclamped radius spans about 3.9..7.1px:
        // a visible size gradient, with the clamp only engaging while dollying.
        minNodeRadiusPx : 2.0,
        maxNodeRadiusPx : 12.0,
        // Depth fade range: maxAlpha at the nearest drawn depth, minAlpha at
        // the farthest. Applied to nodes and edges alike. A settled layout
        // spans a narrower depth band than the initial cube, so the far end is
        // kept above a quarter opacity to stay legible against the near-black
        // canvas while still reading as depth.
        minAlpha : 0.35,
        maxAlpha : 1.0,
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
    },

    chooser: {
        // Bounds for the random-graph branch of the chooser. `initialConditions`
        // above stays the wizard's default and the first-run placeholder; these
        // are only what the parameter form will accept.
        //
        // maxOrder is capped because repulsion is O(N^2) per 50 ms tick and
        // every node draws a label. minOrder is 2 because a graph on one node
        // has no edges and no meaningful branching.
        minOrder : 2,
        maxOrder : 64,
        // maxBranching is the practical cap; the hard limit is always order - 1,
        // enforced in parseRandomSpec().
        minBranching : 1,
        maxBranching : 8,
    },

    molecule: {
        // A molecule is seeded on a phyllotaxis spiral spaced at the spring
        // rest length (equilibriumDisplacement, above), so neighbours start
        // outside the repulsion guard and already near the separation the
        // springs want. Keeping the value equal to the rest length is the point,
        // so the two are documented together rather than derived at runtime.
        seedSpacing : 30,
        // Depth offset amplitude for the seed. Enough that the spiral is not a
        // plane, small enough that it does not control the layout.
        seedDepthJitter : 4.5,
    },
};