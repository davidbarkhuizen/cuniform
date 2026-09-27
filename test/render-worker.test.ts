import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/graph/Graph";
import { buildMirrorGraph } from "../src/graph/MirrorGraph";
import { PhysicsWorkerEngine } from "../src/physics/PhysicsProtocol";
import { projectGraph } from "../src/view/Projection";
import { defaultCameraView, Projector } from "../src/view/Projector";
import { render } from "../src/render/Renderer";
import {
    DrawnResponse,
    encodeCamera,
    FrameRequest,
    initRequest,
    RenderWorkerEngine,
} from "../src/render/RenderProtocol";
import { Tag } from "../src/graph/Tag";
import { DrawOp, FakeContext2D, RendererSettings, withRendererSettings } from "./support/dom";
import { sparseGraph } from "./support/physics";

/**
 * The render worker's engine, driven headlessly. The correctness contract of
 * moving the draw off the main thread is pixel identity: for a given graph,
 * camera and selection the engine must produce exactly the draw calls the
 * in-process `render()` produces. No test here constructs a real `Worker` or
 * `OffscreenCanvas`.
 */


/** Attach a fake surface and build the engine's mirror from `graph`. */
function attached(graph: Graph, generation: number = 0): { engine: RenderWorkerEngine; context: FakeContext2D } {

    const context = new FakeContext2D();
    const engine = new RenderWorkerEngine();

    engine.attach(context, context.canvas);
    engine.handle(initRequest(graph, generation));

    return { engine, context };
}

/** A frame request carrying `graph`'s positions, as the main thread would post it. */
function frameFor(
    graph: Graph,
    generation: number,
    frameId: number,
    selected: number = -1,
    camera = defaultCameraView(),
    width: number = 800,
    height: number = 600,
    dpr: number = 1
): FrameRequest {

    const request = initRequest(graph, generation);

    return {
        type: "frame",
        generation,
        frameId,
        camera: encodeCamera(camera),
        positions: request.positions,
        selected,
        width,
        height,
        dpr,
    };
}

/** The same graph the engine builds, drawn directly: the reference output. */
function directDraw(
    graph: Graph,
    selected: number,
    camera = defaultCameraView(),
    width: number = 800,
    height: number = 600
): FakeContext2D {

    const data = initRequest(graph, 0);
    const mirror = buildMirrorGraph(graph.vertices.map(tag => tag.label), data.edges, data.positions);

    const context = new FakeContext2D();
    context.canvas = { width, height };

    const projector = Projector.forCanvas(width, height, camera);

    projectGraph(mirror, projector);

    const selectedTag = selected >= 0 ? mirror.vertices[selected] ?? null : null;

    render(context, mirror, projector.camera, selectedTag);

    return context;
}

// A fixture whose four nodes sit at four different depths, so the depth cue, the
// painter sort, the selection ring and the incident-edge highlight are all live.
function thresholdGraph(): Graph {
    const graph = new Graph();

    const a = new Tag({ x: 0, y: 0, z: 0 }, "a");
    const b = new Tag({ x: 50, y: 20, z: -30 }, "b");
    const c = new Tag({ x: 50, y: 50, z: 40 }, "c");
    const d = new Tag({ x: -20, y: 50, z: 10 }, "d");

    [a, b, c, d].forEach(tag => graph.addNode(tag));
    graph.addEdge(a, b);
    graph.addEdge(b, c);
    graph.addEdge(c, d);
    graph.addEdge(d, a);

    return graph;
}

interface Case {
    name: string;
    graph: Graph;
    selected: number;
    settings: RendererSettings;
}

const IDENTITY_CASES: Case[] = [
    { name: "small", graph: thresholdGraph(), selected: 1, settings: {} },
    { name: "small, unselected", graph: thresholdGraph(), selected: -1, settings: {} },
    { name: "labels culled", graph: thresholdGraph(), selected: 1, settings: { labelMaxNodes: 2 } },
    { name: "labels culled, unselected", graph: thresholdGraph(), selected: -1, settings: { labelMaxNodes: 0 } },
    { name: "batched edges", graph: sparseGraph(200, 4242), selected: 3, settings: { batchEdgesMinEdges: 0 } },
    { name: "batched edges, culled labels", graph: sparseGraph(200, 77), selected: 3, settings: { batchEdgesMinEdges: 0, labelMaxNodes: 0 } },
    { name: "coarse preset", graph: sparseGraph(200, 99), selected: 5, settings: { minNodes: 0 } },
    { name: "coarse preset, batched edges", graph: sparseGraph(200, 5), selected: -1, settings: { minNodes: 0, batchEdgesMinEdges: 0 } },
];

test("the engine's draw calls are identical to the direct renderer at every threshold", () => {

    for (const testCase of IDENTITY_CASES) {

        const ops = withRendererSettings(testCase.settings, (): { engine: DrawOp[]; direct: DrawOp[]; engineTexts: number; directTexts: number } => {

            const { engine, context } = attached(testCase.graph);

            const response = engine.handle(frameFor(testCase.graph, 0, 1, testCase.selected));

            assert.ok(response, `${testCase.name} must draw`);

            const direct = directDraw(testCase.graph, testCase.selected);

            return {
                engine: context.ops,
                direct: direct.ops,
                engineTexts: context.texts.length,
                directTexts: direct.texts.length,
            };
        });

        assert.deepEqual(ops.engine, ops.direct, `${testCase.name}: draw sequence`);
        assert.equal(ops.engineTexts, ops.directTexts, `${testCase.name}: fillText count`);
    }
});

test("the ack returns the frame's buffer and this frame's depths", () => {

    const graph = sparseGraph(64, 99);
    const camera = defaultCameraView();
    const { engine } = attached(graph);

    const request = frameFor(graph, 0, 7, 3, camera);
    const response = engine.handle(request) as DrawnResponse;

    assert.ok(response);
    assert.equal(response.type, "drawn");
    assert.equal(response.frameId, 7);
    assert.equal(response.positions, request.positions, "the frame's buffer must come back");
    assert.equal(response.positions.length, graph.vertices.length * 3);
    assert.equal(response.depths.length, graph.vertices.length);

    // Depths are the same projection the main thread would have cached.
    const mirror = buildMirrorGraph(
        graph.vertices.map(tag => tag.label),
        initRequest(graph, 0).edges,
        initRequest(graph, 0).positions
    );

    projectGraph(mirror, Projector.forCanvas(800, 600, camera));

    for (let i = 0; i < mirror.vertices.length; i++)
        assert.equal(response.depths[i], mirror.vertices[i].depth, `node ${i} depth`);
});

test("a frame before init draws nothing", () => {

    const engine = new RenderWorkerEngine();
    const context = new FakeContext2D();

    engine.attach(context, context.canvas);

    assert.equal(engine.handle(frameFor(thresholdGraph(), 0, 1)), null);
    assert.equal(context.ops.length, 0, "nothing may be drawn before the mirror exists");
});

test("a swap rebuilds the mirror and drops frames from the superseded generation", () => {

    const first = sparseGraph(4, 1);
    const second = sparseGraph(6, 2);

    const { engine } = attached(first, 0);

    // A frame for a generation the engine has never been initialised with.
    assert.equal(engine.handle(frameFor(second, 1, 1)), null, "an uninitialised generation is dropped");

    engine.handle(initRequest(second, 1));

    assert.equal(engine.graph?.vertices.length, 6, "the mirror must be the new graph");

    // The frame computed for the replaced graph must not be drawn.
    assert.equal(engine.handle(frameFor(first, 0, 2)), null, "a stale generation is dropped");
    assert.ok(engine.handle(frameFor(second, 1, 3)), "the current generation draws");
});

test("init reproduces the physics mirror for self-loops and duplicate edges", () => {

    const labels = ["a", "b", "c"];
    const positions = new Float64Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
    const edges = new Int32Array([0, 0, 0, 1, 0, 1, 1, 2]);

    const reference = buildMirrorGraph(labels, edges, positions);

    const context = new FakeContext2D();
    const renderEngine = new RenderWorkerEngine();
    renderEngine.attach(context, context.canvas);
    renderEngine.handle({ type: "init", generation: 0, labels, edges, positions });

    const physicsEngine = new PhysicsWorkerEngine();
    physicsEngine.handle({ type: "init", generation: 0, positions, edges });

    assert.ok(renderEngine.graph);
    assert.ok(physicsEngine.graph);

    // The render mirror needs the real labels; physics never reads one, so its
    // generated labels only have to be self-consistent. Topology must match both.
    const mirrors: Array<[string, Graph, boolean]> = [
        ["render", renderEngine.graph!, true],
        ["physics", physicsEngine.graph!, false],
    ];

    for (const [name, mirror, labelsMatch] of mirrors) {

        assert.equal(mirror.vertices.length, reference.vertices.length, `${name} vertices`);
        assert.equal(mirror.edges.length, reference.edges.length, `${name} edges`);

        for (let i = 0; i < reference.vertices.length; i++) {
            if (labelsMatch)
                assert.equal(mirror.vertices[i].label, reference.vertices[i].label, `${name} label ${i}`);

            assert.equal(mirror.incidentEdges(mirror.vertices[i]).length, reference.incidentEdges(reference.vertices[i]).length, `${name} degree ${i}`);
        }

        // A self-loop does not make a vertex its own neighbour, and a duplicate
        // edge does not change membership.
        assert.equal(mirror.hasEdge(mirror.vertices[0], mirror.vertices[0]), false, `${name} self-loop`);
        assert.equal(mirror.hasEdge(mirror.vertices[0], mirror.vertices[1]), true, `${name} duplicate edge`);
    }
});

test("a frame sizes the backing store in device pixels and clears in device space", () => {

    const graph = thresholdGraph();
    const { engine, context } = attached(graph);

    engine.handle(frameFor(graph, 0, 1, -1, defaultCameraView(), 800, 600, 2));

    assert.deepEqual([context.canvas.width, context.canvas.height], [1600, 1200]);
    assert.deepEqual(context.transforms[0], [2, 0, 0, 2, 0, 0], "the device transform");

    // render() clears the whole backing store in device space, not CSS pixels.
    assert.deepEqual(context.clears[0], [0, 0, 1600, 1200]);
});

test("an unchanged size does not reassign the backing store", () => {

    const graph = thresholdGraph();
    const { engine, context } = attached(graph);

    // dpr 2 so the device transform is distinguishable from the identity one
    // render() applies inside its own save/restore.
    engine.handle(frameFor(graph, 0, 1, -1, defaultCameraView(), 800, 600, 2));

    const width = context.canvas.width;
    const deviceTransforms = () => context.transforms.filter(t => t[0] === 2 && t[3] === 2).length;

    assert.equal(deviceTransforms(), 1);

    engine.handle(frameFor(graph, 0, 2, -1, defaultCameraView(), 800, 600, 2));

    assert.equal(context.canvas.width, width);
    assert.equal(deviceTransforms(), 1, "an unchanged frame must not re-set the device transform");
});

test("export is the worker entry's, so the engine returns nothing for it", () => {

    const { engine, context } = attached(thresholdGraph());
    const before = context.ops.length;

    assert.equal(engine.handle({ type: "export", requestId: 1 }), null);
    assert.equal(context.ops.length, before, "export must not draw");
});
