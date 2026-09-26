import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/Graph";
import { K } from "../src/K";
import { CameraView, defaultCameraView } from "../src/Projector";
import { render } from "../src/Renderer";
import { Tag } from "../src/Tag";
import { assertClose } from "./support/assert";
import { FakeContext2D } from "./support/dom";
import { readAllSources } from "./support/files";

const NODE_DEFAULT = K.colours.nodeDefault;
const NODE_SELECTED = K.colours.nodeSelected;
const EDGE_DEFAULT = K.colours.edgeDefault;
const EDGE_INCIDENT = K.colours.edgeIncident;

/**
 * The renderer's marker radius. Not exported by Renderer, but the flat-scene
 * golden below pins it, so the literal is asserted rather than hidden.
 */
const NODE_RADIUS = 5;

/**
 * A path a - b - c - d, so selecting any interior node has two incident edges
 * and one unrelated edge to compare against. Every node sits at the camera
 * distance: the flat scene the shipped demo has, where the depth cue is the
 * identity and equal depths preserve the old edges-then-nodes order.
 */
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

/** Nodes at explicit view depths, with one edge joining the first two. */
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
    render(context as unknown as CanvasRenderingContext2D, graph, camera);
    return context;
}

function draw(graph: Graph): FakeContext2D {
    return drawWith(graph, defaultCameraView());
}

/** The fill radius for a lone node at `depth`. */
function radiusAt(depth: number): number {
    const graph = new Graph();
    const node = new Tag({ x: 0, y: 0, z: 0 }, "n");
    node.depth = depth;
    graph.addNode(node);

    return draw(graph).fillRadii[0];
}

/**
 * The first `edgeCount` stroke() calls are the edges: at equal depth the stable
 * sort keeps the old "all edges, then all nodes" order. A selected node appends
 * one more stroke for its ring.
 */
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

    // The extra stroke is the selected node's ring, not another edge.
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

    // One fill per vertex, in vertex order a, b, c, d.
    assert.deepEqual(fills, [NODE_DEFAULT, NODE_SELECTED, NODE_DEFAULT, NODE_DEFAULT]);
});

test("nodes, edges and labels each use a distinct colour", () => {
    // The default node must not disappear into the mesh of edges beneath it,
    // and the label must stay legible against both.
    assert.notEqual(NODE_DEFAULT, EDGE_DEFAULT);
    assert.notEqual(K.colours.label, NODE_DEFAULT);
    assert.notEqual(K.colours.label, EDGE_DEFAULT);
});

test("labels are drawn in the label colour, not the node fill", () => {
    const { graph } = build();

    const context = draw(graph);

    // One label per vertex, in vertex order.
    assert.deepEqual(context.texts, [K.colours.label, K.colours.label, K.colours.label, K.colours.label]);
});

test("render reproduces the pre-refactor draw sequence exactly", () => {
    // Golden capture of every recorder array, in order, taken from the
    // renderer before it moved out of ForceDirectedGraph. The recorders
    // reduce drawing to comparable primitives, so this is a whole-frame
    // equivalence check rather than three colour spot-checks.
    const { graph, b } = build();
    b.isSelected = true;

    const context = draw(graph);

    assert.deepEqual(context.strokes, [EDGE_INCIDENT, EDGE_INCIDENT, EDGE_DEFAULT, NODE_SELECTED]);
    assert.deepEqual(context.fills, [NODE_DEFAULT, NODE_SELECTED, NODE_DEFAULT, NODE_DEFAULT]);
    assert.deepEqual(context.texts, [K.colours.label, K.colours.label, K.colours.label, K.colours.label]);
    assert.deepEqual(context.transforms, [[1, 0, 0, 1, 0, 0]]);
    assert.deepEqual(context.clears, [[0, 0, 800, 600]]);

    // The depth cue is the identity at the camera distance: full opacity and
    // the unclamped 2D marker radius, so the flat frame is unchanged.
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

test("render takes the context, the graph and the camera, and no label-spacing parameter", () => {
    // Regression for 5.4: the unused label-spacing parameter was removed. The
    // signature is render(context, graph, camera); label spacing lives only in
    // K.label, and the camera is what keeps the cull/focal math in step with
    // the projection.
    const { graph } = build();

    assert.equal(render.length, 3);
    assert.equal(K.label.horizontalSpacing, 5);
    assert.equal(K.label.verticalSpacing, 5);
    assert.doesNotThrow(() => draw(graph));
});

test("the renderer is the only module that draws", () => {
    // The point of the split: drawing sits behind one module boundary, so the
    // solver cannot quietly grow a canvas call. UIController still owns the
    // context it hands to render(), but it issues no drawing call itself.
    const drawingCall = /\b(clearRect|beginPath|moveTo|lineTo|arc|stroke|fill|fillText)\s*\(/;
    const sources = readAllSources();
    const drawers = Object.keys(sources).filter(name => drawingCall.test(sources[name]));

    assert.deepEqual(drawers, ["Renderer.ts"], "drawing must live behind the Renderer module");
});

// ------------------------------------------------------------- depth ordering

test("the painter's algorithm draws farthest-first across edges and nodes", () => {
    // near = 100, far = 300, so the joining edge sits at depth 200.
    const { graph } = withDepths([100, 300], ["near", "far"]);

    const context = draw(graph);

    // Far node, then the edge, then the near node.
    assert.deepEqual(
        context.ops.map(op => (op.kind === "text" ? `text:${op.text}` : op.kind)),
        ["fill", "text:far", "stroke", "fill", "text:near"]
    );
    assert.deepEqual(context.textLabels, ["far", "near"]);
});

test("a nearer node overpaints a farther one when they overlap", () => {
    // Equal x, so the two circles coincide on the canvas: whichever is drawn
    // last is the one a viewer sees, and it must be the nearer node.
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

    // radius = NODE_RADIUS * focalLength / depth, so a four-fold depth is a
    // four-fold smaller radius.
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

    // Two arcs: the fill circle and the larger selection ring.
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
    // The renderer must read the cull boundary from the same camera the caller
    // projected with, not from the K defaults, or drawing and hit-testing can
    // disagree about the boundary.
    const { graph } = withDepths([100], ["solo"]);

    assert.deepEqual(draw(graph).textLabels, ["solo"], "the default near plane (50) draws depth 100");

    // A near plane above the depth culls it; one below it still draws it.
    const raised = { ...defaultCameraView(), nearPlane: 200 };
    const lowered = { ...defaultCameraView(), nearPlane: 10 };

    assert.deepEqual(drawWith(graph, raised).textLabels, [], "a raised near plane must cull depth 100");
    assert.deepEqual(drawWith(graph, lowered).textLabels, ["solo"], "a lowered near plane still draws it");
});

test("render sizes nodes with the focal length of the camera it is given", () => {
    // Same coupling for the depth cue: the radius formula's focal length must
    // be the camera's, or a custom-camera frame is sized for a different lens.
    const { graph } = withDepths([K.camera.distance], ["solo"]);

    const base = drawWith(graph, defaultCameraView()).fillRadii[0];
    const zoomed = drawWith(
        graph,
        { ...defaultCameraView(), focalLength: K.camera.focalLength * 2 }
    ).fillRadii[0];

    assertClose(base, NODE_RADIUS, 1e-9, "at the camera distance the cue is the marker radius");
    assertClose(zoomed, NODE_RADIUS * 2, 1e-9, "the doubled focal length must double the radius");
});
