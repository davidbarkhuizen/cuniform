export type QualitySetting = "auto" | "accurate" | "fast";

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

        // Barnes-Hut far-field approximation (README, "Performance"). Below
        // barnesHutMinNodes the exact pairwise kernel runs, preserving demo-scale
        // behaviour bit-for-bit; above it the octree replaces the O(N^2) pass.
        // The traversal never accepts the cell that contains the body as an
        // aggregate, so no opening angle can make a node repel itself; the
        // ceiling below is a sanity clamp, not the self-exclusion mechanism.
        // (A theta-only guarantee would need theta < 1/sqrt(3) ~= 0.577, because
        // the centre of mass can sit at the opposite corner of the cell.)
        //
        // Which opening angle the solver uses. "auto" picks by graph size
        // (Quality.openingAngleFor), so the default is accurate exactly where the
        // eye can tell and fast where it cannot. This is a compile-time default
        // and must not be mutated at runtime: the main-thread solver and the
        // worker realm each build their own solver from the same literal, which
        // is what keeps the two backends identical. A user-facing control would
        // need a quality field on the worker protocol; that is a separate item.
        quality: "auto" as QualitySetting,
        // Accurate angle (README profile: 0.3-0.5% mean error).
        barnesHutTheta: 0.5,
        // Fast angle (README profile: 1.8% mean error at 4096, ~3.7x faster).
        barnesHutFastTheta: 0.9,
        // At or above this order, "auto" uses the fast angle. 2048 is the first
        // measured row where the step no longer fits one 50 ms tick, i.e. where
        // the speed/quality trade tips.
        barnesHutFastMinNodes: 2048,
        barnesHutMinNodes: 64,
        // Bucket near-coincident points instead of recursing forever.
        barnesHutMaxDepth: 28,

        // Simulation cadence (README, "Cadence"). Physics still advances in
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
        // How long the main thread waits for a render worker's `ready` before
        // giving up on it and drawing in process. An order of magnitude above a
        // same-origin script load, below perceptible first-paint latency, and the
        // bound on how long a failed worker delays the first frame. The canvas is
        // only transferred once `ready` arrives, so a worker that misses this is
        // never given control of it.
        workerReadyTimeoutMS: 250,
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

        // Coarse large-graph preset (README, "Depth cue"). At or above
        // minNodes the frame switches to a cheaper path: one depth-fade bucket,
        // node fills batched by colour, and no selection-ring stroke. Below it
        // every frame is byte-for-byte the small-graph one, so only a frame at
        // or above this size can differ. The threshold is on vertices.length and
        // is independent of labelMaxNodes/batchEdgesMinEdges; lining it up with
        // the chooser's measured cap is a coincidence of the profile, not a
        // coupling to encode.
        performance: {
            // At or above this many vertices the coarse path runs.
            minNodes: 4096,
            // Collapse the depth fade to a single bucket, so the batched edge
            // groups and the batched node fills collapse to one alpha each.
            edgeAlphaBuckets: 1,
            // One beginPath/fill per node colour instead of one fill per node.
            // Batching same-colour opaque nodes unions their coverage instead of
            // compositing them per node; that divergence is deliberate and
            // size-gated.
            batchNodeFills: true,
            // The selected node keeps its selected fill; the ring stroke is
            // dropped. There is no hover feature, so nothing else is skipped.
            selectionRing: false,
        },
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
        // Random-graph chooser bounds. maxOrder is a measured usability cap, not
        // the old exact/Barnes-Hut crossover: with the octree repulsion the step
        // cost stays inside the usable band up to the largest node count in
        // bench/physics.bench.ts's STEP_CASES (4096 steps at ~10 Hz on the
        // committed profile), and the worker keeps input alive while the layout
        // advances. 8192 is deliberately not advertised: its step is unmeasured
        // and its repulsion pass alone is ~265 ms.
        // minOrder is 2 because a one-node graph has no edges.
        minOrder : 2,
        maxOrder : 4096,
        // The largest measured size that still steps within a single 50 ms tick
        // (1024 at 17.1 ms / 2048 at 38.3 ms on the committed profile). Above it
        // the wizard shows a non-blocking hint; it never disables generate.
        interactiveOrder : 1024,
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