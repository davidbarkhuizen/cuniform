import test from "node:test";
import assert from "node:assert/strict";

import { buildGraph, BuiltGraph } from "../src/network/BuildGraph";
import { carryPositions } from "../src/network/Carry";
import { EdgeKind, Mark } from "../src/graph/Attributes";
import { fileSource } from "../src/app/ModelSource";
import { ForceDirectedGraph } from "../src/physics/ForceDirectedGraph";
import { Graph } from "../src/graph/Graph";
import { K } from "../src/core/K";
import { NetworkModel } from "../src/network/NetworkModel";
import { readFormat2 } from "../src/network/Format2";
import { bandViolations } from "./support/bands";
import { array, dense, file, sequenceModel } from "./support/format2";
import { FakeElement, withUIControllerAsync } from "./support/dom";
import { modelJson, skipUnless } from "./support/models";

/** 4 -> 3 -> 2, with every weight distinct, so the strongest inputs are known. */
function weightedClassifier(): NetworkModel {
    // Row r of the hidden layer favours input (r + 1) % 4 most, then input r.
    const hidden = (i: number) => {
        const r = Math.floor(i / 4);
        const c = i % 4;
        return c === (r + 1) % 4 ? 10 + r : c === r ? -(5 + r) : 0.1 * (c + 1);
    };

    return readFormat2(file(
        [dense(3), dense(2, { output: true })],
        [[array([3, 4], hidden), array([3])], [array([2, 3], i => i + 1), array([2])]],
        { input: { dimension: 4 } }
    ));
}

const id = (built: BuiltGraph, label: string) => built.ids[built.graph.vertices.findIndex(v => v.label === label)];

function incoming(graph: Graph, j: number): Array<{ from: string; kind: number; weight: number }> {
    const target = graph.vertices[j];
    const a = graph.attributes!;
    return graph.edges.flatMap((e, k) => e.v2 === target ? [{ from: e.v1.label, kind: a.edgeKind[k], weight: a.weight[k] }] : []);
}

test("an expanded component becomes one dot per unit, in the component's band", () => {
    const model = readFormat2(sequenceModel());
    const collapsed = buildGraph(model);
    const ffn = id(collapsed, "dense 8 relu");

    const built = buildGraph(model, { expanded: new Set([ffn]) });
    const a = built.graph.attributes!;
    const units = built.ids.flatMap((x, i) => x.startsWith(`${ffn}/u`) ? [i] : []);

    assert.equal(units.length, 8);
    assert.equal(built.ids[units[3]], `${ffn}/u3`);
    assert.equal(built.graph.vertices.length, collapsed.graph.vertices.length + 7);
    assert.ok(units.every(i => a.marks[i] === Mark.unit));
    assert.ok(units.every(i => a.band[i] === a.band[units[0]]), "the units share the component's band");
    assert.ok(units.every(i => a.group[i] === a.group[units[0]]), "and its group");
    assert.deepEqual(bandViolations(built.graph), []);

    // Its collapsed source feeds every unit; every unit feeds the collapsed node after it.
    for (const u of units) {
        assert.equal(incoming(built.graph, u).length, 1);
        assert.equal(incoming(built.graph, u)[0].kind, EdgeKind.flow);
    }
});

test("between two expanded components, each unit draws its k strongest incoming weights, signed", () => {
    const model = weightedClassifier();
    const [hidden, output] = model.stacks[0].entries.map(e => e.components[0].id);

    // Expand the hidden layer and the output; the hidden layer's source is the raw input, which has no node.
    const built = buildGraph(model, { expanded: new Set([hidden, output]), edgesPerUnit: 2 });
    const outputs = built.ids.flatMap((x, i) => x.startsWith(`${output}/u`) ? [i] : []);
    assert.equal(outputs.length, 2);

    for (const o of outputs) {
        const weights = incoming(built.graph, o);

        assert.equal(weights.length, 2, "k = 2 per unit");
        assert.ok(weights.every(w => w.kind === EdgeKind.weight));

        // Output row r is [3r+1, 3r+2, 3r+3]: the two strongest are hidden units 2 and 1.
        assert.deepEqual(weights.map(w => w.from.split(" · ")[1]).sort(), ["1", "2"]);
    }

    const all = Array.from(built.graph.attributes!.weight).filter((_, j) => built.graph.attributes!.edgeKind[j] === EdgeKind.weight);
    assert.ok(all.every(w => Math.abs(w) <= 1) && all.some(w => w === 1), "normalised to the strongest kept weight");
});

test("the sign of a weight survives, and top-k ranks by magnitude", () => {
    const model = readFormat2(file(
        [dense(2), dense(2, { output: true })],
        [[array([2, 4]), array([2])], [[[-9, 1], [2, 0.5]], array([2])]],
        { input: { dimension: 4 } }
    ));
    const [first, second] = model.stacks[0].entries;
    const built = buildGraph(model, { expanded: new Set([first.components[0].id, second.components[0].id]), edgesPerUnit: 1 });

    const out0 = built.ids.indexOf(`${second.components[0].id}/u0`);
    const out1 = built.ids.indexOf(`${second.components[0].id}/u1`);

    const [only0] = incoming(built.graph, out0);
    const [only1] = incoming(built.graph, out1);

    assert.equal(only0.from.split(" · ")[1], "0");
    assert.equal(only0.weight, -1, "the strongest is negative, and keeps its sign");
    assert.equal(only1.from.split(" · ")[1], "0");
    assert.ok(Math.abs(only1.weight - 2 / 9) < 1e-6, "normalised by the strongest kept weight");
});

test("attention: an expanded output projection reads the expanded heads' units through Wo", () => {
    const model = readFormat2(sequenceModel());
    const attention = model.stacks[0].entries.find(e => e.kind === "attention")!;
    const ids = new Set(attention.components.map(c => c.id));
    const built = buildGraph(model, { expanded: ids, edgesPerUnit: 3 });
    const out = attention.components[attention.components.length - 1];

    for (let u = 0; u < out.units; u++) {
        const weights = incoming(built.graph, built.ids.indexOf(`${out.id}/u${u}`));
        assert.equal(weights.length, 3);
        assert.ok(weights.every(w => w.from.startsWith("head")));
    }
});

test("a band's weight edges are capped, strongest kept", () => {
    const model = weightedClassifier();
    const ids = new Set(model.stacks[0].entries.map(e => e.components[0].id));
    const saved = K.network.maxWeightEdgesPerBand;

    try {
        K.network.maxWeightEdgesPerBand = 3;
        const built = buildGraph(model, { expanded: ids, edgesPerUnit: 3 });
        const a = built.graph.attributes!;
        const weightEdges = Array.from(a.edgeKind).filter(k => k === EdgeKind.weight).length;

        assert.equal(weightEdges, 3, "the output band keeps its 3 strongest of 6");
    }
    finally {
        K.network.maxWeightEdgesPerBand = saved;
    }
});

test("positions carry over a toggle: survivors stay, units start around their node, a collapse returns to the centroid", () => {
    const model = readFormat2(sequenceModel());
    const before = buildGraph(model);
    const ffn = id(before, "dense 8 relu");
    const solver = new ForceDirectedGraph(before.graph);

    for (let s = 0; s < 40; s++)
        solver.stepPhysics();

    const expanded = buildGraph(model, { expanded: new Set([ffn]) });
    carryPositions(before, expanded);

    before.ids.forEach((x, i) => {
        if (x === ffn)
            return;

        assert.deepEqual({ ...expanded.graph.vertices[expanded.ids.indexOf(x)].position }, { ...before.graph.vertices[i].position }, `${x} keeps its place`);
    });

    const node = before.graph.vertices[before.ids.indexOf(ffn)].position;
    const units = expanded.ids.flatMap((x, i) => x.startsWith(`${ffn}/u`) ? [expanded.graph.vertices[i].position] : []);
    const mean = (f: (p: { x: number; y: number; z: number }) => number) => units.reduce((sum, p) => sum + f(p), 0) / units.length;

    assert.ok(Math.abs(mean(p => p.x) - node.x) < K.network.unitSpacing, "the grid is centred on the collapsed node");
    assert.deepEqual(bandViolations(expanded.graph), [], "and held inside the band");

    const collapsed = buildGraph(model);
    carryPositions(expanded, collapsed);
    const back = collapsed.graph.vertices[collapsed.ids.indexOf(ffn)].position;

    // The units lie in the band, which is convex, so their centroid needs no clamp.
    assert.ok(Math.abs(back.x - mean(p => p.x)) < 1e-9);
    assert.ok(Math.abs(back.y - mean(p => p.y)) < 1e-9);
    assert.ok(Math.abs(back.z - mean(p => p.z)) < 1e-9);
    assert.deepEqual(bandViolations(collapsed.graph), []);
});

test("every component of the tinyshakespeare model expanded stays in the 4096-node regime and in its bands", skipUnless(modelJson("tinyshakespeare")), () => {
    const model = readFormat2(modelJson("tinyshakespeare"));
    const all = new Set(model.stacks[0].entries.flatMap(e => e.components.map(c => c.id)));
    const built = buildGraph(model, { expanded: all });

    assert.ok(built.graph.vertices.length < K.renderer.performance.minNodes, `${built.graph.vertices.length} nodes`);

    const solver = new ForceDirectedGraph(built.graph);

    for (let s = 0; s < 5; s++)
        solver.stepPhysics();

    assert.deepEqual(bandViolations(built.graph), []);
});

test("the selection's button expands and collapses, keeping the other nodes where they were", async () => {
    await withUIControllerAsync(async ({ elements, controller }) => {
        const button = new FakeElement('BUTTON') as FakeElement & { hidden: boolean };
        controller.expandToggle = button as unknown as HTMLElement;
        controller.initialize();

        await controller.openModel(fileSource({ name: "seq.json", text: async () => JSON.stringify(sequenceModel()) }));

        const graph = controller.solver.graph;
        const ffn = graph.vertices.findIndex(v => v.label === "dense 8 relu");
        const embedding = { ...graph.vertices[0].position };

        graph.vertices[ffn].isSelected = true;
        controller.updateSelectionInfo();

        assert.equal(button.hidden, false);
        assert.equal(button.textContent, "expand");

        button.dispatch("click");

        const expanded = controller.solver.graph;
        assert.notEqual(expanded, graph);
        assert.equal(expanded.vertices.length, graph.vertices.length + 7);
        assert.deepEqual({ ...expanded.vertices[0].position }, embedding, "an untouched node keeps its place");
        assert.ok(controller.expanded.size === 1);

        // Select a unit: the button now offers to collapse its component.
        const unit = expanded.vertices.findIndex(v => v.label === "dense 8 relu · 5");
        expanded.vertices[unit].isSelected = true;
        controller.updateSelectionInfo();
        assert.equal(button.textContent, "collapse");
        assert.ok(elements.selectedNodeInfoList.children.length > 0, "a unit shows its component's details");

        button.dispatch("click");

        assert.equal(controller.solver.graph.vertices.length, graph.vertices.length);
        assert.equal(controller.solver.graph.selectedVertex()?.label, "dense 8 relu", "the collapsed node is selected");
    });
});

test("the weights-per-unit field rebuilds an expanded model with more edges", async () => {
    await withUIControllerAsync(async ({ controller }) => {
        const input = new FakeElement('INPUT');
        controller.edgesPerUnitInput = input as unknown as HTMLInputElement;
        controller.initialize();

        await controller.openModel(fileSource({ name: "seq.json", text: async () => JSON.stringify(sequenceModel()) }));

        const attention = controller.model!.stacks[0].entries.find(e => e.kind === "attention")!;
        attention.components.forEach(c => controller.expanded.add(c.id));
        controller.toggleExpanded(controller.model!.stacks[0].entries[0].components[0].id);

        const weightEdges = () => Array.from(controller.solver.graph.attributes!.edgeKind).filter(k => k === EdgeKind.weight).length;
        const atFour = weightEdges();

        input.value = "1";
        input.dispatch("change");

        assert.equal(controller.edgesPerUnit, 1);
        assert.ok(weightEdges() < atFour);

        input.value = "0";
        input.dispatch("change");
        assert.equal(controller.edgesPerUnit, 1, "an out-of-range value is ignored");
    });
});
