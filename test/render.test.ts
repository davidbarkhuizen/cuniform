import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { CameraView, defaultCameraView } from "../src/Projector";
import { render } from "../src/Renderer";
import { Tag } from "../src/Tag";
import { assertClose } from "./support/assert";
import { FakeContext2D, poisonSelection, withRendererSettings } from "./support/dom";

const NODE_DEFAULT = K.colours.nodeDefault;
const NODE_SELECTED = K.colours.nodeSelected;
const EDGE_DEFAULT = K.colours.edgeDefault;
const EDGE_INCIDENT = K.colours.edgeIncident;

/** Renderer's marker radius; not exported, so the flat-scene golden pins the literal. */
const NODE_RADIUS = 5;

// A path a - b - c - d: an interior selection gives two incident edges and one
// unrelated edge. Every node sits at the camera distance (the flat demo scene).
function build() {
    const graph = new Graph();
    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 50, y: 0, z: 0 }, "b");
    const c = new Tag({ x: 50, y: 50, z: 0 }, "c");
    const d = new Tag({ x: 0, y: 50, z: 0 }, "d");
    [a, b, c, d].forEach(t => {
        t.depth = K.camera.distance;
        graph.addNode(t);
    });
    graph.addEdge(a, b);
    graph.addEdge(b, c);
    graph.addEdge(c, d);

    return { graph, a, b, c, d };
}

function withDepths(depths: number[], labels: string[] = []) {
    const graph = new Graph();
    const nodes = depths.map((depth, i) => {
        const node = new Tag({ x: i * 40, y: 0, z: 0 }, labels[i] ?? `n${i}`);
        node.depth = depth;
        graph.addNode(node);
        return node;
    });

    if (nodes.length >= 2)
        graph.addEdge(nodes[0], nodes[1]);

    return { graph, nodes };
}

function drawWith(graph: Graph, camera: CameraView): FakeContext2D {
    const context = new FakeContext2D();
    context.canvas = { width: 800, height: 600 };
    // Tests resolve the selection once per fixture draw, as the controller does;
    // production passes its cache and the renderer never scans.
    render(context, graph, camera, graph.selectedVertex());
    return context;
}

function draw(graph: Graph): FakeContext2D {
    return drawWith(graph, defaultCameraView());
}

function radiusAt(depth: number): number {
    const graph = new Graph();
    const node = new Tag({ x: 0, y: 0, z: 0 }, "n");
    node.depth = depth;
    graph.addNode(node);

    return draw(graph).fillRadii[0];
}

// At equal depth the stable sort keeps the old "all edges, then all nodes" order.
function edgeStrokes(context: FakeContext2D, edgeCount: number): string[] {
    return context.strokes.slice(0, edgeCount);
}

test("an edge incident to the selected node is highlighted distinctly", () => {
    const { graph, a } = build();
    a.isSelected = true;

    const context = draw(graph);
    const strokes = edgeStrokes(context, 3);

    assert.equal(strokes[0], EDGE_INCIDENT, "a-b is incident to the selection");
    assert.notEqual(strokes[0], strokes[1], "the incident edge must differ from the rest");
    assert.equal(strokes[1], EDGE_DEFAULT);
    assert.equal(strokes[2], EDGE_DEFAULT);

    // The fourth stroke is the selection ring, not another edge.
    assert.equal(context.strokes.length, 4);
});

test("both edges incident to an interior selected node are highlighted", () => {
    const { graph, c } = build();
    c.isSelected = true;

    assert.deepEqual(edgeStrokes(draw(graph), 3), [EDGE_DEFAULT, EDGE_INCIDENT, EDGE_INCIDENT]);
});

test("with no selection every edge uses the default colour", () => {
    const { graph } = build();

    const context = draw(graph);

    assert.deepEqual(context.strokes, [EDGE_DEFAULT, EDGE_DEFAULT, EDGE_DEFAULT]);
});

test("the selected node is filled with the selected colour", () => {
    const { graph, b } = build();
    b.isSelected = true;

    const { fills } = draw(graph);

    // Fills are in vertex order a, b, c, d.
    assert.deepEqual(fills, [NODE_DEFAULT, NODE_SELECTED, NODE_DEFAULT, NODE_DEFAULT]);
});

test("nodes, edges and labels each use a distinct colour", () => {
    // The node must not disappear into the edges, nor the label into either.
    assert.notEqual(NODE_DEFAULT, EDGE_DEFAULT);
    assert.notEqual(K.colours.label, NODE_DEFAULT);
    assert.notEqual(K.colours.label, EDGE_DEFAULT);
});

test("labels are drawn in the label colour, not the node fill", () => {
    const { graph } = build();

    const context = draw(graph);

    // Labels are in vertex order.
    assert.deepEqual(context.texts, [K.colours.label, K.colours.label, K.colours.label, K.colours.label]);
});

test("render reproduces the pre-refactor draw sequence exactly", () => {
    // Golden capture taken before the renderer moved out of ForceDirectedGraph:
    // a whole-frame equivalence check rather than colour spot-checks.
    const { graph, b } = build();
    b.isSelected = true;

    const context = draw(graph);

    assert.deepEqual(context.strokes, [EDGE_INCIDENT, EDGE_INCIDENT, EDGE_DEFAULT, NODE_SELECTED]);
    assert.deepEqual(context.fills, [NODE_DEFAULT, NODE_SELECTED, NODE_DEFAULT, NODE_DEFAULT]);
    assert.deepEqual(context.texts, [K.colours.label, K.colours.label, K.colours.label, K.colours.label]);
    assert.deepEqual(context.transforms, [[1, 0, 0, 1, 0, 0]]);
    assert.deepEqual(context.clears, [[0, 0, 800, 600]]);

    // At the camera distance the cue is the identity: full opacity, 2D radius.
    assert.deepEqual(context.fillRadii, [NODE_RADIUS, NODE_RADIUS, NODE_RADIUS, NODE_RADIUS]);
    assert.ok(
        context.strokeAlphas.every(a => a === K.depthCue.maxAlpha),
        `golden stroke alphas were ${context.strokeAlphas}`
    );
    assert.ok(
        context.fillAlphas.every(a => a === K.depthCue.maxAlpha),
        `golden fill alphas were ${context.fillAlphas}`
    );
});

test("render takes the context, the graph, the camera and the selection, and no label-spacing parameter", () => {
    // Regression for 5.4: the unused label-spacing parameter was removed;
    // spacing lives in K.label and the camera keeps cull/focal in step. The
    // selection is now the caller's argument, so the renderer never scans.
    const { graph } = build();

    assert.equal(render.length, 4);
    assert.equal(K.label.horizontalSpacing, 5);
    assert.equal(K.label.verticalSpacing, 5);
    assert.doesNotThrow(() => draw(graph));
});

test("render never scans the graph for the selection", () => {
    // The frame takes the selection; an O(N) walk per frame is exactly what this
    // signature removes. A throwing stub fails loudly if it comes back.
    const { graph, b } = build();
    b.isSelected = true;

    poisonSelection(graph, "render() must not scan for the selection");

    const context = new FakeContext2D();
    context.canvas = { width: 800, height: 600 };

    assert.doesNotThrow(() =>
        render(context, graph, defaultCameraView(), b)
    );

    assert.deepEqual(context.fills, [NODE_DEFAULT, NODE_SELECTED, NODE_DEFAULT, NODE_DEFAULT]);
    assert.ok(context.strokes.includes(EDGE_INCIDENT), `strokes were ${context.strokes}`);
});

// ------------------------------------------------------------- depth ordering

test("the painter's algorithm draws farthest-first across edges and nodes", () => {
    // near = 100, far = 300, so the joining edge sits at depth 200.
    const { graph } = withDepths([100, 300], ["near", "far"]);

    const context = draw(graph);

    assert.deepEqual(
        context.ops.map(op => (op.kind === "text" ? `text:${op.text}` : op.kind)),
        ["fill", "text:far", "stroke", "fill", "text:near"]
    );
    assert.deepEqual(context.textLabels, ["far", "near"]);
});

test("a nearer node overpaints a farther one when they overlap", () => {
    // Equal x: the circles coincide, so the last drawn is the one seen.
    const graph = new Graph();
    const near = new Tag({ x: 10, y: 0, z: 0 }, "near");
    const far = new Tag({ x: 10, y: 0, z: 0 }, "far");
    near.depth = 100;
    far.depth = 300;
    graph.addNode(near);
    graph.addNode(far);

    const context = draw(graph);

    assert.deepEqual(context.textLabels, ["far", "near"]);
});

// ------------------------------------------------------------- depth cue

test("node radius scales with 1/depth and is clamped at both ends", () => {
    const near = radiusAt(512);
    const far = radiusAt(2048);

    // radius = NODE_RADIUS * focalLength / depth: four-fold depth, four-fold smaller.
    assertClose(near / far, 4, 1e-9, `radius ratio was ${near / far}`);

    // At the camera distance the cue is the identity: the 2D marker radius.
    const atDistance = radiusAt(K.camera.distance);
    assertClose(atDistance, NODE_RADIUS, 1e-9, `radius at the camera distance was ${atDistance}`);
    assert.ok(
        atDistance > K.depthCue.minNodeRadiusPx && atDistance < K.depthCue.maxNodeRadiusPx,
        "the identity radius must sit inside the clamp"
    );

    // Depth 100 would be 51.2px raw; 1e6 would be 0.005px raw.
    assert.equal(radiusAt(100), K.depthCue.maxNodeRadiusPx);
    assert.equal(radiusAt(1e6), K.depthCue.minNodeRadiusPx);
});

test("the selection ring scales with the node radius", () => {
    const { graph } = withDepths([512], ["solo"]);
    graph.vertices[0].isSelected = true;

    const context = draw(graph);

    const [fill, ring] = context.arcs;

    assertClose(fill[2], radiusAt(512), 1e-9, "the fill circle uses the depth radius");
    assertClose(ring[2] / fill[2], 2, 1e-9, "the ring keeps the 2D ring/marker ratio");
});

test("alpha ramps from maxAlpha at the near end to minAlpha at the far end", () => {
    const { graph } = withDepths([100, 300]);

    const context = draw(graph);

    // Painter order is farthest-first, so the far node fills first.
    assert.deepEqual(context.fillAlphas, [K.depthCue.minAlpha, K.depthCue.maxAlpha]);

    // The edge between them sits at the midpoint of the ramp.
    const mid = (K.depthCue.maxAlpha + K.depthCue.minAlpha) / 2;
    assertClose(context.strokeAlphas[0], mid, 1e-9, `edge alpha was ${context.strokeAlphas[0]}`);
});

test("a flat scene draws at full opacity with no fade", () => {
    const { graph } = build();

    const context = draw(graph);

    assert.ok(
        context.fillAlphas.every(a => a === K.depthCue.maxAlpha),
        `flat fills were ${context.fillAlphas}`
    );
    assert.ok(
        context.strokeAlphas.every(a => a === K.depthCue.maxAlpha),
        `flat strokes were ${context.strokeAlphas}`
    );
});

// ------------------------------------------------------------- culling

test("a culled node is not drawn and its edges are skipped", () => {
    const graph = new Graph();
    const near = new Tag({ x: 0, y: 0, z: 0 }, "near");
    const behind = new Tag({ x: 50, y: 0, z: 0 }, "behind");
    near.depth = K.camera.distance;
    behind.depth = K.camera.nearPlane; // exactly the guard: culled
    graph.addNode(near);
    graph.addNode(behind);
    graph.addEdge(near, behind);

    const context = draw(graph);

    assert.deepEqual(context.textLabels, ["near"], "only the visible node is drawn");
    assert.equal(context.strokes.length, 0, "an edge with a culled endpoint is skipped");
    assert.equal(context.fills.length, 1);
});

test("a node just inside the near plane is still drawn", () => {
    const graph = new Graph();
    const node = new Tag({ x: 0, y: 0, z: 0 }, "inside");
    node.depth = K.camera.nearPlane + 1e-6;
    graph.addNode(node);

    const context = draw(graph);

    assert.deepEqual(context.textLabels, ["inside"]);
});

// ------------------------------------------------- the camera argument

test("render culls against the near plane of the camera it is given", () => {
    // The renderer must read the cull boundary from the caller's camera, not
    // the K defaults, or drawing and hit-testing disagree at the boundary.
    const { graph } = withDepths([100], ["solo"]);

    assert.deepEqual(draw(graph).textLabels, ["solo"], "the default near plane (50) draws depth 100");

    const raised = { ...defaultCameraView(), nearPlane: 200 };
    const lowered = { ...defaultCameraView(), nearPlane: 10 };

    assert.deepEqual(drawWith(graph, raised).textLabels, [], "a raised near plane must cull depth 100");
    assert.deepEqual(drawWith(graph, lowered).textLabels, ["solo"], "a lowered near plane still draws it");
});

test("render sizes nodes with the focal length of the camera it is given", () => {
    // Same coupling for the cue: the radius must use the camera's focal length,
    // or a custom-camera frame is sized for a different lens.
    const { graph } = withDepths([K.camera.distance], ["solo"]);

    const base = drawWith(graph, defaultCameraView()).fillRadii[0];
    const zoomed = drawWith(
        graph,
        { ...defaultCameraView(), focalLength: K.camera.focalLength * 2 }
    ).fillRadii[0];

    assertClose(base, NODE_RADIUS, 1e-9, "at the camera distance the cue is the marker radius");
    assertClose(zoomed, NODE_RADIUS * 2, 1e-9, "the doubled focal length must double the radius");
});

// ---------------------------------------------------------- size-gated scaling

test("above labelMaxNodes only the selection and its neighbours are labelled", () => {
    const { graph, b } = build();
    b.isSelected = true;

    // The fixture is a-b-c-d, so b's neighbours are a and c; d is two hops away.
    const context = withRendererSettings({ labelMaxNodes: graph.vertices.length }, () => draw(graph));

    assert.deepEqual([...context.textLabels].sort(), ["a", "b", "c"]);
});

test("above labelMaxNodes nothing is labelled without a selection", () => {
    const { graph } = build();

    const context = withRendererSettings({ labelMaxNodes: graph.vertices.length }, () => draw(graph));

    assert.deepEqual(context.textLabels, [], "an unselected large graph carries no labels");
});

test("below labelMaxNodes every label is still drawn", () => {
    const { graph } = build();

    const context = withRendererSettings({ labelMaxNodes: graph.vertices.length + 1 }, () => draw(graph));

    assert.equal(context.textLabels.length, graph.vertices.length);
});

test("at equal depths the explicit comparator keeps edges before nodes", () => {
    const { graph } = build();

    const context = draw(graph);

    // Three edges, then four fill+label pairs, in insertion order.
    assert.deepEqual(context.ops.map(op => op.kind), [
        "stroke", "stroke", "stroke",
        "fill", "text", "fill", "text", "fill", "text", "fill", "text",
    ]);
});

test("a forced batch frame represents every edge and bounds stroke calls", () => {
    const { graph } = build();

    const context = withRendererSettings({ batchEdgesMinEdges: 0 }, () => draw(graph));

    assert.equal(context.moveTos.length, graph.edges.length, "every edge needs a moveTo");
    assert.equal(context.lineTos.length, graph.edges.length, "every edge needs a lineTo");
    assert.ok(
        context.strokes.length <= 2 * K.renderer.edgeAlphaBuckets,
        `batched edges must need at most 2*buckets strokes, got ${context.strokes.length}`
    );
    assert.equal(context.fills.length, graph.vertices.length, "every node is still filled");
});

test("batch mode draws every edge before any node", () => {
    const { graph } = build();

    const context = withRendererSettings({ batchEdgesMinEdges: 0 }, () => draw(graph));
    const kinds = context.ops.map(op => op.kind);

    const lastStroke = kinds.lastIndexOf("stroke");
    const firstFill = kinds.indexOf("fill");

    assert.ok(firstFill >= 0, "nodes must still be drawn");
    assert.ok(lastStroke < firstFill, `edges must not interleave with nodes, got ${kinds.join(",")}`);
});

test("batched edges keep the incident highlight", () => {
    const { graph, b } = build();
    b.isSelected = true;

    const context = withRendererSettings({ batchEdgesMinEdges: 0 }, () => draw(graph));

    assert.ok(context.strokes.includes(EDGE_INCIDENT), `strokes were ${context.strokes}`);
    assert.ok(context.strokes.includes(EDGE_DEFAULT), `strokes were ${context.strokes}`);
});

test("batch and per-edge modes agree on which edges and nodes are drawn", () => {
    const { graph } = build();

    const batched = withRendererSettings({ batchEdgesMinEdges: 0 }, () => draw(graph));
    const unbatched = withRendererSettings({ batchEdgesMinEdges: 1000 }, () => draw(graph));

    assert.deepEqual(batched.moveTos, unbatched.moveTos, "the same segments, in the same order");
    assert.deepEqual(batched.lineTos, unbatched.lineTos);
    assert.deepEqual(batched.fills, unbatched.fills);
    assert.deepEqual(batched.textLabels, unbatched.textLabels);

    // The saving is the point: one path per group instead of one per edge.
    assert.ok(batched.strokes.length < unbatched.strokes.length, "batch mode must stroke fewer times");
});

// ---------------------------------------------------- coarse large-graph preset

test("the coarse preset collapses every node fill to one fill per colour", () => {
    const { graph, b } = build();
    b.isSelected = true;

    const context = withRendererSettings({ minNodes: 0 }, () => draw(graph));

    assert.deepEqual(context.fills, [NODE_DEFAULT, NODE_SELECTED], "one fill per colour, default first");
    assert.equal(context.arcs.length, graph.vertices.length, "every visible node still contributes an arc");

    assert.equal(new Set(context.fillAlphas).size, 1, "the collapsed fade gives the fills one alpha");
});

test("the coarse preset draws every edge and drops the selection-ring stroke", () => {
    const { graph, b } = build();
    b.isSelected = true;

    const context = withRendererSettings({ minNodes: 0 }, () => draw(graph));

    assert.equal(context.moveTos.length, graph.edges.length, "every edge needs a moveTo");
    assert.equal(context.lineTos.length, graph.edges.length, "every edge needs a lineTo");

    // Three edges collapse to the incident and default edge groups; the per-node
    // ring stroke is gone, so no fourth stroke appears.
    assert.equal(context.strokes.length, 2, `strokes were ${context.strokes}`);
});

test("the coarse preset fills every node's colour and labels the selection's neighbourhood", () => {
    const { graph, b } = build();
    b.isSelected = true;

    const context = withRendererSettings({ minNodes: 0 }, () => draw(graph));

    // b's neighbours are a and c; d is two hops away and unlabelled.
    assert.deepEqual([...context.textLabels].sort(), ["a", "b", "c"]);
    assert.equal(context.fills.length, 2, "the selected fill must still be drawn");
});

test("a coarse frame is deterministic", () => {
    const { graph, b } = build();
    b.isSelected = true;

    const first = withRendererSettings({ minNodes: 0 }, () => draw(graph));
    const second = withRendererSettings({ minNodes: 0 }, () => draw(graph));

    assert.deepEqual(first.ops, second.ops);
});

test("coarse node arcs keep painter order inside each colour group", () => {
    // The default-colour group stays (depth descending); the selected group is a
    // separate fill, so it follows the whole default path.
    const { graph, nodes } = withDepths([100, 300, 200], ["near", "far", "mid"]);
    nodes[1].isSelected = true;

    const context = withRendererSettings({ minNodes: 0 }, () => draw(graph));

    // x encodes the insertion index: mid (80), near (0), then the selected far (40).
    assert.deepEqual(context.arcs.map(arc => arc[0]), [80, 0, 40]);
});

test("forcing the coarse preset off reproduces the small-graph golden exactly", () => {
    const { graph, b } = build();
    b.isSelected = true;

    const plain = draw(graph);
    const forcedOff = withRendererSettings({ minNodes: Infinity }, () => draw(graph));

    assert.deepEqual(forcedOff.ops, plain.ops);
    assert.deepEqual(forcedOff.strokes, plain.strokes);
    assert.deepEqual(forcedOff.fills, plain.fills);
    assert.deepEqual(forcedOff.textLabels, plain.textLabels);
});
