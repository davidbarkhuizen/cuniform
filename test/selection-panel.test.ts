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
    return elements.selectedNodeInfoList.children.map(child => child.textContent);
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

        assert.equal(elements.selectedNodeInfoLabel.textContent, "Click on a node to select...");
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

        assert.equal(elements.selectedNodeInfoLabel.textContent, leaf.label);
        assert.deepEqual(listItems(elements), ["hub"]);
    });
});

// A host-supplied label is text, never markup: it must reach the panel verbatim and through textContent.
test("a label that looks like markup is shown as literal text", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const graph = new Graph();
    const node = new Tag({ x: 0, y: 0, z: 0 }, hostile);
    const neighbour = new Tag({ x: 10, y: 0, z: 0 }, `<b>${hostile}</b>`);
    graph.addNode(node);
    graph.addNode(neighbour);
    graph.addEdge(node, neighbour);

    withUIController(({ elements, controller }) => {
        node.isSelected = true;
        controller.updateSelectionInfo();

        assert.equal(elements.selectedNodeInfoLabel.textContent, hostile);
        assert.deepEqual(listItems(elements), [`<b>${hostile}</b>`]);
        assert.equal((elements.selectedNodeInfoLabel as unknown as { innerHTML?: string }).innerHTML, undefined, "nothing is written as markup");
        assert.ok(elements.selectedNodeInfoList.children.every(child => child.tagName === "LI"), "the list holds only the items it built");
    }, { graph, initialize: false });
});

