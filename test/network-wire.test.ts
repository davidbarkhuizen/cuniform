import test from "node:test";
import assert from "node:assert/strict";

import { ForceDirectedGraph } from "../src/physics/ForceDirectedGraph";
import { buildGraph } from "../src/network/BuildGraph";
import { buildMirrorGraph, packMirror } from "../src/graph/MirrorGraph";
import { Emphasis } from "../src/core/Emphasis";
import { emptyAttributes } from "../src/graph/Attributes";
import { PhysicsRunner, PhysicsWorkerPort } from "../src/physics/PhysicsRunner";
import { PhysicsWorkerEngine, PositionsResponse, WorkerRequest } from "../src/physics/PhysicsProtocol";
import { readFormat2 } from "../src/network/Format2";
import { RenderRunner } from "../src/render/RenderRunner";
import { defaultCameraView } from "../src/view/Projector";
import { FakeCanvas, FakeRenderWorker } from "./support/dom";
import { branchedWindow, sequenceModel } from "./support/format2";

/** Static attributes cross both worker boundaries once per graph (workplan D10); nothing new per frame. */

const sequence = () => buildGraph(readFormat2(sequenceModel())).graph;
const window2 = () => buildGraph(readFormat2(branchedWindow(false))).graph;

class EnginePhysicsWorker implements PhysicsWorkerPort {
    onmessage: ((event: { data: PositionsResponse }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    readonly engine = new PhysicsWorkerEngine();
    readonly transfers: Transferable[][] = [];

    postMessage(message: WorkerRequest, transfer: Transferable[] = []): void {
        this.transfers.push(transfer);
        const response = this.engine.handle(message);

        if (response !== null)
            this.onmessage?.({ data: response });
    }

    terminate(): void {}
}

test("attributes round-trip through the mirror wire as copies", () => {
    const graph = sequence();
    const wire = packMirror(graph);

    assert.deepEqual(wire.attributes, graph.attributes);
    assert.notEqual(wire.attributes!.kind, graph.attributes!.kind, "a copy, so transferring it leaves the graph's own");

    const mirror = buildMirrorGraph([], wire.edges, wire.positions, wire.attributes);
    assert.deepEqual(mirror.attributes, graph.attributes);

    assert.equal(packMirror(new ForceDirectedGraph(mirror).graph).attributes!.bands.length, graph.attributes!.bands.length);
});

test("a plain graph carries no attributes, and attributes that do not fit are dropped", () => {
    const graph = sequence();
    const wire = packMirror(graph);

    assert.equal(buildMirrorGraph([], wire.edges, wire.positions).attributes, null);
    assert.equal(
        buildMirrorGraph([], wire.edges, wire.positions, emptyAttributes(graph.vertices.length + 1, graph.edges.length, 1)).attributes,
        null
    );
});

test("the physics worker receives the attributes, by transfer, and a rebuild re-inits them", () => {
    const fake = new EnginePhysicsWorker();
    const first = sequence();
    const runner = new PhysicsRunner(new ForceDirectedGraph(first), () => fake);

    assert.deepEqual(fake.engine.graph!.attributes, first.attributes);
    assert.ok(fake.transfers[0].length > 2, "the attribute buffers are transferred with positions and edges");

    const second = window2();
    runner.setGraph(new ForceDirectedGraph(second));

    assert.deepEqual(fake.engine.graph!.attributes, second.attributes);

    // A step request carries no attributes: they are static.
    runner.step(-1, 0, 0, 0);
    assert.equal(fake.transfers[fake.transfers.length - 1].length, 0);

    runner.terminate();
});

test("the render worker receives the attributes, and a rebuild re-inits them", () => {
    const fake = new FakeRenderWorker();
    const first = sequence();
    const runner = RenderRunner.create(new FakeCanvas() as unknown as HTMLCanvasElement, () => {}, {
        graph: first,
        workerFactory: () => fake,
        readyTimeoutMS: 20,
    })!;

    fake.becomeReady();
    assert.deepEqual(fake.engine.graph!.attributes, first.attributes);

    const second = window2();
    runner.setGraph(second);
    runner.draw(second, defaultCameraView(), null, 800, 600, Emphasis.nodes);

    assert.deepEqual(fake.engine.graph!.attributes, second.attributes);

    const frame = fake.posts.filter(post => post.message.type === "frame").pop()!;
    assert.ok(!("attributes" in frame.message), "a frame request carries no attributes");

    runner.terminate();
});
