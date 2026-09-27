import test from "node:test";
import assert from "node:assert/strict";

import { Emphasis, emphasisFromWire, isEmphasis } from "../src/core/Emphasis";
import { Graph } from "../src/graph/Graph";
import { K } from "../src/core/K";
import { defaultCameraView } from "../src/view/Projector";
import { render } from "../src/render/Renderer";
import { Tag } from "../src/graph/Tag";
import { DragController } from "../src/ui/DragController";
import {
    EMPHASIS_CONSOLE_EVENTS,
    countSteps,
    FakeContext2D,
    FakeElement,
    FakeRenderBackend,
    emphasisConsoleElement,
    poisonSelection,
    settleFrames,
    settledGraph,
    withRendererSettings,
    withUIController,
} from "./support/dom";
import { pointerEvent } from "./support/dom";
import { sparseGraph } from "./support/physics";

/**
 * The display emphasis: one frame configuration per graph element. The vocabulary
 * and its preset, then the same policy asserted per draw path, because the
 * per-item, batched and coarse paths are a performance ladder rather than three
 * renderers and a configuration that reversed above a size threshold would be a
 * bug the demo's eleven nodes never show.
 */

const NODES = K.renderer.emphasis[Emphasis.nodes];
const EDGES = K.renderer.emphasis[Emphasis.edges];

// ------------------------------------------------------------- the vocabulary

test("isEmphasis accepts exactly the two wire values", () => {
    assert.equal(isEmphasis(Emphasis.nodes), true);
    assert.equal(isEmphasis(Emphasis.edges), true);

    // Names are the panel's vocabulary, not the wire's.
    for (const value of ['nodes', 'edges', null, undefined, 2, -1, NaN, 0.5, {}, true]) {
        assert.equal(isEmphasis(value as unknown), false, `isEmphasis(${String(value)}) must be false`);
    }
});

test("emphasisFromWire maps an unknown number to the default", () => {
    assert.equal(emphasisFromWire(Emphasis.nodes), Emphasis.nodes);
    assert.equal(emphasisFromWire(Emphasis.edges), Emphasis.edges);

    for (const value of [2, -1, NaN, 0.5, Number.MAX_SAFE_INTEGER]) {
        assert.equal(
            emphasisFromWire(value),
            Emphasis.nodes,
            `${value} must decode to the default`
        );
    }
});

test("the two presets differ in exactly the declared fields", () => {
    // The two configurations are the whole feature: a field added to one preset
    // and forgotten in the other is the bug this pins.
    assert.deepEqual(
        Object.keys(NODES).sort(),
        Object.keys(EDGES).sort(),
        "both presets must carry the same fields"
    );

    assert.deepEqual(
        Object.keys(NODES).sort(),
        ["edgeAlphaScale", "edgeWidthPx", "edgesOnTop", "nodeAlphaScale"]
    );

    assert.equal(NODES.edgesOnTop, false, "nodes are the subject by default");
    assert.equal(EDGES.edgesOnTop, true, "the mesh is the subject in edges mode");

    assert.equal(NODES.edgeAlphaScale, 0.55, "the nodes preset pushes the mesh back");
    assert.equal(EDGES.edgeAlphaScale, 1.0, "the edges preset leaves the ramp unscaled");
    assert.equal(NODES.edgeWidthPx, 1.0, "the nodes preset keeps the base width");
    assert.equal(EDGES.edgeWidthPx, 2.5, "the edges preset draws a heavier mesh");
});

test("the shipped node alpha scale keeps the measured contrast floor", () => {
    // Dimming the node fills collapses node/edge contrast: 0.70 measures 1.95:1
    // and 0.85 measures 2.77:1, both below the 3:1 UI floor, while the shipped
    // palette at full opacity is 3.78:1. So both presets leave it at 1.0, and a
    // future tune has to move this assertion deliberately.
    assert.equal(NODES.nodeAlphaScale, 1.0, "the nodes preset must not fade the nodes");
    assert.equal(EDGES.nodeAlphaScale, 1.0, "the edges preset must not fade the nodes");
});

// ------------------------------------------------------------ the fixture

/** A path n0 - n1 - n2, with the given view depth per node. */
function chain(depths: number[]): { graph: Graph; nodes: Tag[] } {
    const graph = new Graph();
    const nodes = depths.map((depth, i) => {
        const node = new Tag({ x: i * 40, y: 0, z: 0 }, `n${i}`);
        node.depth = depth;
        graph.addNode(node);
        return node;
    });

    graph.addEdge(nodes[0], nodes[1]);
    graph.addEdge(nodes[1], nodes[2]);

    return { graph, nodes };
}

// n0 - n1 - n2 falling away from the camera: the painter order *within* a class
// is n0, n1, n2 (farthest first), so a trace reads in node index order. The two
// edges sit at 250 and 150.
const DESCENDING = () => chain([300, 200, 100]);

function draw(graph: Graph, emphasis: Emphasis): FakeContext2D {
    const context = new FakeContext2D();
    context.canvas = { width: 800, height: 600 };

    render(context, graph, defaultCameraView(), graph.selectedVertex(), emphasis);

    return context;
}

/** The op kinds with each label named, so an order assertion reads. */
function trace(context: FakeContext2D): string[] {
    return context.ops.map(op => (op.kind === "text" ? `text:${op.text}` : op.kind));
}

// ------------------------------------------------------- per-item paint order

test("nodes emphasis draws the whole mesh behind the nodes", () => {
    const { graph } = DESCENDING();

    const context = draw(graph, Emphasis.nodes);
    const kinds = trace(context);

    const lastStroke = kinds.lastIndexOf("stroke");
    const firstFill = kinds.indexOf("fill");

    assert.ok(lastStroke < firstFill, `the nodes must cover the mesh, got ${kinds.join(",")}`);
    assert.deepEqual(context.textLabels, ["n0", "n1", "n2"], "nodes keep painter order among themselves");
});

test("edges emphasis draws the whole mesh over the nodes", () => {
    const { graph } = DESCENDING();

    const context = draw(graph, Emphasis.edges);
    const kinds = trace(context);

    const firstStroke = kinds.indexOf("stroke");
    const lastFill = kinds.lastIndexOf("fill");

    assert.ok(firstStroke > lastFill, `the mesh must cover the nodes, got ${kinds.join(",")}`);
    assert.deepEqual(context.textLabels, ["n0", "n1", "n2"], "labels still draw with their nodes");
});

test("the per-item emphasis reverses the order and nothing else", () => {
    // Same nodes, same edges, same colours: only the class order moves.
    const { graph } = DESCENDING();

    const nodes = draw(graph, Emphasis.nodes);
    const edges = draw(graph, Emphasis.edges);

    assert.deepEqual([...edges.fills].sort(), [...nodes.fills].sort(), "the same fills");
    assert.deepEqual([...edges.strokes].sort(), [...nodes.strokes].sort(), "the same strokes");
    assert.deepEqual(edges.textLabels, nodes.textLabels, "the same labels in the same depth order");
    assert.notDeepEqual(trace(edges), trace(nodes), "but not the same paint order");
});

// ------------------------------------------------------- batched paint order

test("the batched path draws edges before the nodes in nodes mode", () => {
    // Above the gate the frame keeps the old shape: the whole mesh in one pass,
    // then the depth-sorted nodes over it.
    const { graph } = DESCENDING();

    const context = withRendererSettings({ batchEdgesMinEdges: 0 }, () => draw(graph, Emphasis.nodes));
    const kinds = trace(context);

    assert.ok(kinds.lastIndexOf("stroke") < kinds.indexOf("fill"), `got ${kinds.join(",")}`);
});

test("the batched path draws edges after the nodes in edges mode", () => {
    // The size gate must not exempt the frame: this is the regression the demo's
    // 11 nodes can never show.
    const { graph } = DESCENDING();

    const context = withRendererSettings({ batchEdgesMinEdges: 0 }, () => draw(graph, Emphasis.edges));
    const kinds = trace(context);

    assert.ok(kinds.indexOf("stroke") > kinds.lastIndexOf("fill"), `got ${kinds.join(",")}`);
});

test("no edge is drawn twice when the batch pass moves after the node loop", () => {
    const { graph } = DESCENDING();

    const context = withRendererSettings({ batchEdgesMinEdges: 0 }, () => draw(graph, Emphasis.edges));

    assert.equal(context.moveTos.length, graph.edges.length, "one moveTo per edge");
    assert.equal(context.lineTos.length, graph.edges.length, "one lineTo per edge");
    assert.equal(context.strokes.length, 2, "one stroke per depth bucket, not one per edge");
});

// -------------------------------------------------------- coarse paint order

test("the coarse path draws edges after the fills in edges mode", () => {
    const { graph, nodes } = DESCENDING();
    nodes[1].isSelected = true;

    const context = withRendererSettings({ minNodes: 0 }, () => draw(graph, Emphasis.edges));
    const kinds = trace(context);

    assert.ok(
        kinds.indexOf("stroke") > kinds.lastIndexOf("fill"),
        `the mesh must follow both colour-batched fills, got ${kinds.join(",")}`
    );
});

test("the coarse path keeps the ordinary order in nodes mode", () => {
    // The mesh is drawn first, then the colour-batched fills, then the selection's
    // ring and labels on top of everything.
    const { graph, nodes } = DESCENDING();
    nodes[1].isSelected = true;

    const context = withRendererSettings({ minNodes: 0 }, () => draw(graph, Emphasis.nodes));
    const kinds = trace(context);

    assert.equal(kinds[0], "stroke", "the mesh draws first");
    assert.deepEqual(
        kinds.slice(3),
        ["text:n1", "text:n0", "text:n2"],
        "the selection's ring and labels follow the fills"
    );
});

test("the coarse edges mode re-draws the selection's ring and labels over the mesh", () => {
    // Without the bounded second pass a 2.5 px mesh would bury the one label the
    // user is reading. The set is the selection and its incident neighbours.
    const { graph, nodes } = DESCENDING();
    nodes[1].isSelected = true;

    const context = withRendererSettings({ minNodes: 0 }, () => draw(graph, Emphasis.edges));

    const lastStroke = context.ops.map(op => op.kind).lastIndexOf("stroke");

    assert.equal(context.ops[context.ops.length - 1].kind, "text", "the last op is a label");
    assert.ok(lastStroke < context.ops.length - 1, "the label pass must follow the edge pass");

    // Nodes 0, 1 and 2 are the selection and its neighbours, each drawn twice:
    // once before the mesh and once after it.
    const after = context.textLabels.slice(-3);
    assert.deepEqual([...after].sort(), ["n0", "n1", "n2"]);
    assert.equal(context.textLabels.length, 6, "each label is drawn on both passes");
});

test("the coarse edges mode does not re-draw anything without a selection", () => {
    const { graph } = DESCENDING();

    const context = withRendererSettings({ minNodes: 0 }, () => draw(graph, Emphasis.edges));

    assert.deepEqual(context.textLabels, [], "no selection means no label pass");
    assert.equal(context.ops[context.ops.length - 1].kind, "stroke", "the mesh is still last");
});

// ------------------------------------------------------------------- alpha

test("the nodes preset scales only the edge alphas", () => {
    const { graph } = chain([100, 300, 500]);


    const scaled = draw(graph, Emphasis.nodes);
    const plain = draw(graph, Emphasis.edges);

    // The per-item path draws each edge at its own depth.
    assert.equal(scaled.strokeAlphas.length, plain.strokeAlphas.length);
    scaled.strokeAlphas.forEach((alpha, i) => {
        assert.equal(
            alpha,
            plain.strokeAlphas[i] * NODES.edgeAlphaScale,
            `edge ${i} alpha must be the unscaled ramp times the edge scale`
        );
    });

    assert.deepEqual(scaled.fillAlphas, plain.fillAlphas, "the node fills are untouched");
});

test("the edges preset leaves every alpha at the unscaled ramp", () => {
    const { graph } = DESCENDING();

    const context = draw(graph, Emphasis.edges);

    // The fade spans the drawn range 100..300: near 1.0, far 0.35.
    const ramp = (depth: number) => {
        const t = (depth - 100) / 200;
        return K.depthCue.maxAlpha + (K.depthCue.minAlpha - K.depthCue.maxAlpha) * t;
    };

    assert.deepEqual(context.fillAlphas, [ramp(300), ramp(200), ramp(100)]);

    // The two edges sit at 250 and 150, on the plain ramp; the batch groups run
    // nearest bucket first, so the nearer edge strokes first.
    assert.deepEqual(
        context.strokeAlphas.map(a => Number(a.toFixed(6))),
        [Number(ramp(250).toFixed(6)), Number(ramp(150).toFixed(6))]
    );
});

test("the batched paths scale their bucketed alphas by the class scale", () => {
    // A flat chain: every bucket sits at the top of the ramp, so the nodes preset's
    // scale is the only thing that can move the batched alpha.
    const { graph } = chain([K.camera.distance, K.camera.distance, K.camera.distance]);

    const nodes = withRendererSettings({ batchEdgesMinEdges: 0 }, () => draw(graph, Emphasis.nodes));
    const edges = withRendererSettings({ batchEdgesMinEdges: 0 }, () => draw(graph, Emphasis.edges));

    assert.equal(nodes.strokeAlphas[0], K.depthCue.maxAlpha * NODES.edgeAlphaScale);
    assert.equal(edges.strokeAlphas[0], K.depthCue.maxAlpha);

    // The collapsed coarse fill follows the same rule.
    const coarse = withRendererSettings({ minNodes: 0 }, () => draw(graph, Emphasis.edges));
    assert.equal(coarse.fillAlphas[0], K.depthCue.maxAlpha);
});

// -------------------------------------------------------------- edge width

test("the edge stroke width follows the emphasis in every path", () => {
    const { graph } = DESCENDING();

    const perItemNodes = draw(graph, Emphasis.nodes);
    const perItemEdges = draw(graph, Emphasis.edges);

    assert.ok(perItemNodes.strokeWidths.every(w => w === NODES.edgeWidthPx));
    assert.ok(perItemEdges.strokeWidths.every(w => w === EDGES.edgeWidthPx));

    const batched = withRendererSettings({ batchEdgesMinEdges: 0 }, () => draw(graph, Emphasis.edges));
    assert.deepEqual(batched.strokeWidths, [EDGES.edgeWidthPx, EDGES.edgeWidthPx], "every batched group keeps the width");

    const coarse = withRendererSettings({ minNodes: 0 }, () => draw(graph, Emphasis.edges));
    assert.deepEqual(coarse.strokeWidths, [EDGES.edgeWidthPx], "the coarse mesh keeps the width");
});

test("the selection ring keeps its own width beside a heavier mesh", () => {
    // The ring must not inherit the edge width: `edges` mode is what makes that
    // inheritance possible, so it is asserted rather than assumed.
    const { graph, nodes } = DESCENDING();
    nodes[0].isSelected = true;

    const context = draw(graph, Emphasis.edges);

    // The ring is drawn with its node, before the mesh; every other stroke is an
    // edge at the emphasis's width. The ring must not inherit it.
    assert.equal(context.strokeWidths.length, graph.edges.length + 1);

    const ringAt = context.strokes.indexOf(K.colours.nodeSelected);
    assert.notEqual(ringAt, -1, "the selection ring must be drawn");

    assert.equal(context.strokeWidths[ringAt], 1, "the ring has its own width");
    assert.deepEqual(
        context.strokeWidths.filter((_, i) => i !== ringAt),
        [EDGES.edgeWidthPx, EDGES.edgeWidthPx],
        "the edges keep theirs"
    );
});

test("the coarse ring and labels take no node alpha scale", () => {
    // Text is the one thing the depth fade must not compound, so the label alpha
    // is the plain ramp even when a node scale exists.
    const { graph, nodes } = DESCENDING();
    nodes[1].isSelected = true;

    const context = withRendererSettings({ minNodes: 0 }, () => draw(graph, Emphasis.edges));

    assert.ok(
        context.textAlphas.every(a => a >= K.depthCue.minAlpha),
        `labels must stay on the full ramp, got ${context.textAlphas}`
    );
});

// --------------------------------------------------------------- determinism

test("each emphasis is deterministic", () => {
    const { graph } = DESCENDING();

    for (const emphasis of [Emphasis.nodes, Emphasis.edges]) {
        const first = withRendererSettings({ batchEdgesMinEdges: 0, minNodes: 0 }, () => draw(graph, emphasis));
        const second = withRendererSettings({ batchEdgesMinEdges: 0, minNodes: 0 }, () => draw(graph, emphasis));

        assert.deepEqual(first.ops, second.ops, `emphasis ${emphasis} must be reproducible`);
    }
});

test("the renderer still never scans the graph in either emphasis", () => {
    const { graph } = DESCENDING();
    graph.vertices[0].isSelected = true;

    poisonSelection(graph, "render() must not scan for the selection");

    for (const emphasis of [Emphasis.nodes, Emphasis.edges]) {
        const context = new FakeContext2D();
        context.canvas = { width: 800, height: 600 };

        assert.doesNotThrow(() => render(context, graph, defaultCameraView(), graph.vertices[0], emphasis));
    }
});

// ------------------------------------------------------- the panel control

/** The `data-emphasis` button the fake console owns. */
function emphasisButton(ui: { elements: Record<string, FakeElement> }, name: string): FakeElement {
    const button = ui.elements.emphasisConsole.children.find(child => child.getAttribute('data-emphasis') === name);
    assert.ok(button, `the console needs a ${name} button`);
    return button;
}

/**
 * Press a console button: the fake DOM does not bubble, so the delegated listener
 * is invoked where the browser would invoke it, on the container, with the button
 * as the target.
 */
function press(ui: { elements: Record<string, FakeElement> }, name: string): void {
    const button = emphasisButton(ui, name);
    ui.elements.emphasisConsole.dispatch('click', { target: button, detail: 1 });
}

/** Read `aria-pressed` off both buttons, as the browser would. */
function pressed(ui: { elements: Record<string, FakeElement> }): Record<string, string | null> {
    return {
        nodes: emphasisButton(ui, 'nodes').getAttribute('aria-pressed'),
        edges: emphasisButton(ui, 'edges').getAttribute('aria-pressed'),
    };
}

test("initialize starts on the default emphasis with the matching button pressed", () => {
    withUIController(ui => {
        assert.equal(ui.controller.state.emphasis, Emphasis.nodes, "a run starts at nodes");
        assert.deepEqual(pressed(ui), { nodes: 'true', edges: 'false' });
    });
});

test("pressing edges switches the frame, flips both buttons and requests one redraw", () => {
    const backend = new FakeRenderBackend();

    withUIController(ui => {
        ui.controller.updateSelectionInfo();

        ui.dom.runAnimationFrames(0);
        const before = backend.draws.length;

        press(ui, 'edges');

        assert.equal(ui.controller.state.emphasis, Emphasis.edges, "the click sets the frame's emphasis");
        assert.deepEqual(pressed(ui), { nodes: 'false', edges: 'true' }, "the pair mirrors the choice");
        assert.equal(backend.draws[before - 1].emphasis, Emphasis.nodes, "the frame before the toggle");

        ui.dom.runAnimationFrames(0);

        assert.equal(backend.draws.length, before + 1, "the toggle must request exactly one redraw");
        assert.equal(backend.draws[before].emphasis, Emphasis.edges, "the next frame draws the new emphasis");
    }, { backend, graph: settledGraph() });
});

test("pressing the pressed button again changes nothing", () => {
    const backend = new FakeRenderBackend();

    withUIController(ui => {
        ui.dom.runAnimationFrames(0);
        const before = backend.draws.length;

        press(ui, 'nodes');

        assert.equal(ui.controller.state.emphasis, Emphasis.nodes);
        assert.deepEqual(pressed(ui), { nodes: 'true', edges: 'false' });
        assert.equal(backend.draws.length, before, "a no-op press must not request a redraw");
    }, { backend, graph: settledGraph() });
});

test("a click on the section's own padding changes nothing", () => {
    withUIController(ui => {
        ui.elements.emphasisConsole.dispatch('click', { target: ui.elements.emphasisConsole, detail: 1 });

        assert.equal(ui.controller.state.emphasis, Emphasis.nodes, "only a button may switch the emphasis");
        assert.deepEqual(pressed(ui), { nodes: 'true', edges: 'false' });
    });
});

test("terminate detaches the emphasis listener", () => {
    withUIController(ui => {
        assert.equal(
            ui.elements.emphasisConsole.listenerCount('click'),
            1,
            "one delegated listener while the controller lives"
        );

        ui.controller.terminate();

        assert.equal(ui.elements.emphasisConsole.listenerCount('click'), 0, "terminate must not leave it behind");
    });
});

test("a graph swap preserves the emphasis and resets the pressed button to the default", () => {
    const backend = new FakeRenderBackend();

    withUIController(ui => {
        ui.controller.setEmphasis(Emphasis.edges);
        ui.controller.state.reset();

        assert.equal(ui.controller.state.emphasis, Emphasis.edges, "state.reset() must not clear the display choice");

        ui.controller.loadGraph(sparseGraph(12, 3));

        assert.equal(
            ui.controller.state.emphasis,
            Emphasis.edges,
            "a graph swap must not lose the emphasis"
        );

        ui.dom.runAnimationFrames(0);

        assert.equal(backend.draws[backend.draws.length - 1].emphasis, Emphasis.edges);

        // A second run is a fresh demo, not a restored preference.
        ui.controller.initialize();

        assert.equal(ui.controller.state.emphasis, Emphasis.nodes, "a run starts at the shipped default");
        assert.deepEqual(pressed(ui), { nodes: 'true', edges: 'false' });
    }, { backend, graph: settledGraph() });
});

test("the emphasis console carries one delegated click listener", () => {
    withUIController(ui => {
        assert.deepEqual(EMPHASIS_CONSOLE_EVENTS, ['click'], "a click is the whole control's protocol");

        for (const type of EMPHASIS_CONSOLE_EVENTS)
            assert.equal(ui.elements.emphasisConsole.listenerCount(type), 1, `${type} listener`);
    });
});

test("a press on an emphasis button never starts a panel drag", () => {
    // The panel is a drag surface. Real buttons are what make the control safe
    // without a stopPropagation guard, so the exclusion is asserted rather than
    // assumed.
    const panel = new FakeElement('DIV');
    const console = emphasisConsoleElement();
    panel.appendChild(console);

    const drag = new DragController(panel as unknown as HTMLElement);

    const button = emphasisButton({ elements: { emphasisConsole: console } }, 'edges');

    panel.dispatch('pointerdown', pointerEvent({
        target: button,
        button: 0,
        pointerType: 'mouse',
        clientX: 40,
        clientY: 40,
    }));

    assert.equal(drag.dragX, 0, "the panel must not move");
    assert.equal(drag.dragY, 0, "the panel must not move");
});

test("the selection highlight composes with, and is never replaced by, the emphasis", () => {
    const { graph, nodes } = DESCENDING();

    for (const emphasis of [Emphasis.nodes, Emphasis.edges]) {
        const context = draw(graph, emphasis);
        context.fills.length = 0;

        nodes[0].isSelected = true;

        const selected = draw(graph, emphasis);

        assert.equal(selected.fills[0], K.colours.nodeSelected, `emphasis ${emphasis} must keep the selection fill`);
        assert.ok(
            selected.strokes.includes(K.colours.nodeSelected),
            `emphasis ${emphasis} must keep the selection ring`
        );
    }
});

test("toggling the emphasis neither wakes the layout nor moves the camera", () => {
    // The toggle is a legibility control, not a data operation: it redraws, and a
    // settled layout must stay settled.
    const backend = new FakeRenderBackend();

    withUIController(ui => {
        const steps = countSteps(ui.controller);
        const camera = { ...ui.controller.state.camera, orientation: [...ui.controller.state.camera.orientation] };

        const timestamp = settleFrames(ui);
        const settledSteps = steps();

        press(ui, 'edges');

        assert.equal(steps(), settledSteps, "a toggle must run no physics step");

        ui.dom.runAnimationFrames(timestamp);

        assert.equal(backend.draws[backend.draws.length - 1].emphasis, Emphasis.edges, "the frame still redraws");
        assert.deepEqual(
            {
                distance: ui.controller.state.camera.distance,
                target: { ...ui.controller.state.camera.target },
                orientation: [...ui.controller.state.camera.orientation],
            },
            { distance: camera.distance, target: { ...camera.target }, orientation: camera.orientation },
            "a toggle must not move the camera"
        );
    }, { backend, graph: settledGraph() });
});
