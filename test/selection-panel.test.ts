import test from "node:test";
import assert from "node:assert/strict";

import { Graph } from "../src/graph/Graph";
import { Tag } from "../src/graph/Tag";
import {
    FakeElement,
    UIControllerFixture,
    withUIController,
} from "./support/dom";

interface Fixture extends UIControllerFixture {
    graph: Graph;
}

/** A star with a duplicate edge, so the panel must follow graph.neighbours() rather than the raw edge list. */
function withFixture<T>(fn: (ui: Fixture) => T): T {
    const graph = new Graph();
    const hub = new Tag({ x: 0, y: 0, z: 0 }, "hub");
    const leaves = ["a", "b", "c"].map(name => new Tag({ x: 10, y: 0, z: 0 }, name));
    graph.addNode(hub);
    leaves.forEach(leaf => graph.addNode(leaf));
    graph.addEdge(hub, leaves[0]);
    graph.addEdge(hub, leaves[0]);
    graph.addEdge(hub, leaves[1]);
    graph.addEdge(hub, leaves[2]);

    return withUIController(ui => fn({ ...ui, graph }), { graph, initialize: false });
}

function listItems(elements: Record<string, FakeElement>): string[] {
    return elements.selectedNodeInfoList.children.map(child => child.innerHTML);
}

test("the selected node's neighbours are listed in graph order, not reversed", () => {
    withFixture(({ elements, controller, graph }) => {
        const hub = graph.vertices[0];
        hub.isSelected = true;

        controller.updateSelectionInfo();

        assert.deepEqual(graph.neighbours(hub).map(n => n.label), ["a", "b", "c"]);
        assert.deepEqual(listItems(elements), ["a", "b", "c"]);
    });
});

test("no selection shows the prompt and empties the list", () => {
    withFixture(({ elements, controller, graph }) => {
        graph.vertices[0].isSelected = true;
        controller.updateSelectionInfo();
        assert.deepEqual(listItems(elements), ["a", "b", "c"]);

        graph.clearSelection();
        controller.updateSelectionInfo();

        assert.equal(elements.selectedNodeInfoLabel.innerHTML, "Click on a node to select...");
        assert.deepEqual(listItems(elements), []);
    });
});

test("selecting a different node replaces the previous neighbour list", () => {
    withFixture(({ elements, controller, graph }) => {
        graph.vertices[0].isSelected = true;
        controller.updateSelectionInfo();
        assert.deepEqual(listItems(elements), ["a", "b", "c"]);

        graph.clearSelection();
        const leaf = graph.vertices[1];
        leaf.isSelected = true;
        controller.updateSelectionInfo();

        assert.equal(elements.selectedNodeInfoLabel.innerHTML, leaf.label);
        assert.deepEqual(listItems(elements), ["hub"]);
    });
});
