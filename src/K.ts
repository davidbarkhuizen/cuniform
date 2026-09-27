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

        // Barnes-Hut far-field approximation (docs/performance/01). Below
        // barnesHutMinNodes the exact pairwise kernel runs, preserving demo-scale
        // behaviour bit-for-bit; above it the octree replaces the O(N^2) pass.
        // The traversal never accepts the cell that contains the body as an
        // aggregate, so no opening angle can make a node repel itself; the
        // ceiling below is a sanity clamp, not the self-exclusion mechanism.
        // (A theta-only guarantee would need theta < 1/sqrt(3) ~= 0.577, because
        // the centre of mass can sit at the opposite corner of the cell.)
        barnesHutTheta: 0.5,
        barnesHutMinNodes: 64,
        // Bucket near-coincident points instead of recursing forever.
        barnesHutMaxDepth: 28,

        // Simulation cadence (docs/performance/06). Physics still advances in
        // fixed timerTickPeriodMS steps; the scheduler accumulates real time and
        // runs at most maxStepsPerFrame of them per animation frame, discarding
        // the remainder so a slow frame cannot spiral. Stepping stops once the
        // largest node travel stays below settleEpsilon for settleFrames steps,
        // and any interaction resumes it.
        maxStepsPerFrame: 2,
        settleEpsilon: 0.01,
        settleFrames: 10,
    },

    ui: {
        /** Click hit radius in CSS pixels, independent of canvas size and devicePixelRatio. */
        minimumNodeSelectionRadiusPx : 15.0,
    },

    renderer: {
        // Label culling: at or above this node count only the selection and its
        // incident neighbours are labelled. fillText per node dominates the real
        // canvas cost and is unreadable at scale. Below the threshold every label
        // is drawn, so small-graph output is unchanged.
        labelMaxNodes: 150,
        // Above this edge count, edges are batched into one path per (style x
        // alpha bucket) instead of one path per edge. Batch mode draws all edges
        // before the depth-sorted nodes, so edges no longer interleave in front
        // of nearer nodes; that divergence is deliberate and size-gated.
        batchEdgesMinEdges: 2000,
        // Depth-fade quantization for the batched edge strokes.
        edgeAlphaBuckets: 8,
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
        // Random-graph chooser bounds. maxOrder keeps the chooser at or below the
        // exact/Barnes-Hut crossover (barnesHutMinNodes); raising it and adding
        // large-graph UX is the deferred follow-up in docs/performance/README.md.
        // minOrder is 2 because a one-node graph has no edges.
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