import { Emphasis } from "./Emphasis";

export type QualitySetting = "auto" | "accurate" | "fast";

// Selected node fill and incident edges share this colour by design;
// web/stylez.css mirrors it as --highlight.
const SELECTION_COLOUR = '#ffd400';

// Spring rest length; molecule.seedSpacing derives from it so seeded neighbours
// start outside the repulsion guard.
const EQUILIBRIUM_DISPLACEMENT = 30;

export const K = {

    physics: {
        springConstant : 0.1,
        equilibriumDisplacement : EQUILIBRIUM_DISPLACEMENT,
        nodeCharge: 10.0,
        scalarForceConstant: 100.0,
        // Deliberately softer than the physical r^2 (reference doc 4.1).
        repulsionExponent: 1.9,
        // Keep timeStep / (1 - friction) ~= 1, or the layout oscillates instead of settling.
        timeStep: 0.1,
        friction: 0.9,
	    timerTickPeriodMS : 50,
        // Guard, not in the reference model: bounds the r -> 0 repulsion blow-up.
        minimumInteractionRadius : 10.0,

        // Not in the reference model (docs/physics.md): disconnected components
        // repel with no equilibrium, so each component is translated -- never
        // distorted -- toward the origin. The radius is a literal, not derived from
        // K.space.W_0; tuning is in docs/constants.md.
        componentAnchorRadius: 150.0,
        componentAnchorStrength: 0.1,

        // Barnes-Hut far-field approximation (docs/performance.md). The body's own
        // cell is never an aggregate, so no opening angle can self-repel; the depth
        // ceiling is a separate sanity clamp.
        //
        // "auto" picks by graph size; must not be mutated at runtime, since the
        // main-thread and worker solvers each build from this literal.
        quality: "auto" as QualitySetting,
        barnesHutTheta: 0.5,
        barnesHutFastTheta: 0.9,
        // At or above this order, "auto" uses the fast angle: the first size whose
        // step no longer fits one 50 ms tick.
        barnesHutFastMinNodes: 2048,
        barnesHutMinNodes: 64,
        // Bucket near-coincident points instead of recursing forever.
        barnesHutMaxDepth: 28,

        // Fixed timerTickPeriodMS steps, capped at maxStepsPerFrame per frame with
        // the remainder discarded so a slow frame cannot spiral (docs/physics.md).
        maxStepsPerFrame: 2,
        settleEpsilon: 0.01,
        settleFrames: 10,
    },

    ui: {
        /** Click hit radius in CSS pixels, independent of canvas size and devicePixelRatio. */
        minimumNodeSelectionRadiusPx : 15.0,
    },

    renderer: {
        // How long the main thread waits for a worker's `ready` before drawing in
        // process; the canvas is transferred only after `ready`.
        workerReadyTimeoutMS: 250,
        // At or above this count only the selection and its neighbours are labelled:
        // per-node label cost dominates at scale.
        labelMaxNodes: 150,
        // Above this count edges are batched per (style x alpha bucket); batching
        // draws all edges before the nodes, so they no longer interleave -- deliberate.
        batchEdgesMinEdges: 2000,
        edgeAlphaBuckets: 8,

        // Display emphasis presets (docs/model-camera-and-rendering.md), keyed by the
        // `Emphasis` enum. Every draw path resolves the same preset, so no size-gated
        // path can keep the other order. nodeAlphaScale stays 1.0 in both: dimming node
        // fills drops near node/edge contrast below the 3:1 floor.
        emphasis: {
            [Emphasis.nodes]: {
                edgesOnTop: false,
                edgeAlphaScale: 0.55,
                nodeAlphaScale: 1.0,
                edgeWidthPx: 1.0,
            },
            [Emphasis.edges]: {
                edgesOnTop: true,
                edgeAlphaScale: 1.0,
                nodeAlphaScale: 1.0,
                edgeWidthPx: 2.5,
            },
        },

        // Coarse large-graph preset (docs/model-camera-and-rendering.md). The threshold
        // is on vertices.length, independent of labelMaxNodes/batchEdgesMinEdges by design.
        performance: {
            minNodes: 4096,
            edgeAlphaBuckets: 1,
            // One fill per node colour: batching same-colour opaque nodes unions
            // their coverage instead of compositing per node. Deliberate and size-gated.
            batchNodeFills: true,
            selectionRing: false,
        },
    },

    space: {
        // Model space cube centred on the origin; nothing clamps nodes to it.
        W_0 : 600,
        H_0 : 600,
        D_0 : 600,
    },

    camera: {
        // Perspective camera, never reaching the physics. A power of two so the identity
        // view (focalLength === distance, z = 0) is bit-exact with the 2D mapping.
        focalLength : 1024,
        // Camera -> target along the view axis; must equal focalLength for the identity
        // view. The wheel dollies this, never focalLength.
        distance : 1024,
        // Guard, not in any reference model: the divide uses max(depth, nearPlane).
        nearPlane : 50,
        // Orbit sensitivity, radians per CSS pixel of middle-drag.
        orbitRadiansPerPixel : 0.01,
        // Console rotation speed while a button is held, radians per second, applied per tick.
        rotateRadiansPerSecond : Math.PI / 3,
        // pi/2 - epsilon: the turntable guard keeping middle-drag off the pole, where "up" is undefined.
        maxPitch : Math.PI / 2 - 0.01,
        // Dolly clamp, above nearPlane so the target plane is never culled.
        minDistance : 128,
        // Dolly clamp out, minDistance mirrored at 8x focalLength so zoom-out stops
        // before nodes shrink to the floor.
        maxDistance : 8192,
        dollyPerWheelNotch : 1.1,
    },

    depthCue: {
        // Perspective radius clamped so a near node cannot blow up and a far one cannot vanish.
        minNodeRadiusPx : 2.0,
        maxNodeRadiusPx : 12.0,
        // Depth fade range for nodes and edges; minAlpha keeps the far end legible on the near-black canvas.
        minAlpha : 0.35,
        maxAlpha : 1.0,
    },

    label: {
        verticalSpacing : 5,
        horizontalSpacing : 5,
        fontFamily : '10pt Arial',    
    },

    colours: {
        // Palette for the near-black canvas: nodes bright, edges deliberately dimmer.
        nodeDefault : '#39d98a',
        nodeSelected : SELECTION_COLOUR,
        label : '#e8f4ff',
        edgeDefault : '#4b5b70',
        edgeIncident : SELECTION_COLOUR,
    },

    initialConditions: {
        // Reference demo: DEMO_GRAPH_SIZE = 11, DEMO_GRAPH_BRANCHING_CONST = 2.
        order : 11,
        branching : 2
    },

    chooser: {
        // maxOrder is a measured usability cap; 8192 is deliberately not advertised.
        // minOrder is 2 because a one-node graph has no edges.
        minOrder : 2,
        maxOrder : 4096,
        // Largest size whose step still fits one 50 ms tick; above it the wizard hints
        // but never disables generate.
        interactiveOrder : 1024,
        // maxBranching is the practical cap; the hard limit is order - 1, enforced in parseRandomSpec().
        minBranching : 1,
        maxBranching : 8,
    },

    molecule: {
        // Must equal equilibriumDisplacement so seed neighbours start at the springs' rest length.
        seedSpacing : EQUILIBRIUM_DISPLACEMENT,
        // Enough that the seed spiral is not planar, small enough not to control the layout.
        seedDepthJitter : 4.5,
    },

    wordCloud: {
        // Chip font-size range in em; the catalog's heavy-atom counts are normalised onto it.
        minTagScale : 0.85,
        maxTagScale : 1.35,
    },
};