import test from "node:test";
import assert from "node:assert/strict";

import { componentDetails, modelSummary } from "../src/network/Details";
import { entrypoint } from "../src/app/entrypoint";
import { fileSource, modelParameter, ModelSource, urlSource } from "../src/app/ModelSource";
import { fitView } from "../src/view/Fit";
import { readFormat2 } from "../src/network/Format2";
import { demoElements, FakeElement, installFakeDom, withUIControllerAsync } from "./support/dom";
import { branchedWindow, sequenceModel } from "./support/format2";

/** A file the picker or a drop would hand over. */
function file(name: string, json: unknown) {
    return { name, text: async () => (typeof json === "string" ? json : JSON.stringify(json)) };
}

function items(list: FakeElement): string[] {
    return list.children.map(child => child.textContent);
}

test("sources: a file parses its text, a URL fetches JSON, ?model= names the URL", async () => {
    assert.deepEqual(await fileSource(file("m.json", { a: 1 })).load(), { a: 1 });

    const fetched: string[] = [];
    const source = urlSource("http://localhost:8000/models/seed4.network.json?x=1", async url => {
        fetched.push(url);
        return { ok: true, status: 200, json: async () => ({ b: 2 }) };
    });

    assert.equal(source.name, "seed4.network.json");
    assert.deepEqual(await source.load(), { b: 2 });
    assert.deepEqual(fetched, ["http://localhost:8000/models/seed4.network.json?x=1"]);

    const missing = urlSource("/nope.json", async () => ({ ok: false, status: 404, json: async () => null }));
    await assert.rejects(missing.load(), /HTTP 404/);

    assert.equal(modelParameter("?model=a%2Fb.json"), "a/b.json");
    assert.equal(modelParameter("?other=1"), null);
    assert.equal(modelParameter(""), null);
});

test("opening a model builds its graph, frames it, and fills the model line and panel", async () => {
    await withUIControllerAsync(async ({ elements, controller }) => {
        const info = new FakeElement('UL');
        controller.modelInfoList = info as unknown as HTMLElement;

        assert.equal(await controller.openModel(fileSource(file("seq.json", sequenceModel()))), true);

        const graph = controller.solver.graph;
        assert.ok(graph.attributes, "the shown graph is the network's");
        assert.equal(graph, controller.built!.graph);
        assert.equal(elements.currentGraphLabel.textContent, "seq.json");
        assert.equal(controller.state.camera.distance, fitView(graph.attributes!.bands)!.distance);

        assert.deepEqual(items(info), [
            "implementation: rust",
            "shape: sequence",
            "input: dimension 5",
            "model width: 4",
            `bands: ${graph.attributes!.bands.length / 7}`,
            `nodes: ${graph.vertices.length}, edges: ${graph.edges.length}`,
        ]);
    });
});

test("a refused file leaves the graph on screen and says why on the model line", async () => {
    await withUIControllerAsync(async ({ elements, controller }) => {
        const before = controller.solver.graph;

        assert.equal(await controller.openModel(fileSource(file("py.json", { ...sequenceModel(), implementation: "python" }))), false);
        assert.equal(controller.solver.graph, before);
        assert.match(elements.currentGraphLabel.textContent, /^could not open py\.json: .*pure-Python/);

        assert.equal(await controller.openModel(fileSource(file("bad.json", "{ not json"))), false);
        assert.match(elements.currentGraphLabel.textContent, /^could not open bad\.json: /);

        // A later good open clears the error.
        await controller.openModel(fileSource(file("seq.json", sequenceModel())));
        assert.equal(elements.currentGraphLabel.textContent, "seq.json");
    });
});

test("only the latest open lands: a slow earlier file cannot replace a later one", async () => {
    await withUIControllerAsync(async ({ controller }) => {
        let release!: () => void;
        const slow: ModelSource = {
            name: "slow.json",
            load: () => new Promise(resolve => { release = () => resolve(sequenceModel()); }),
        };

        const first = controller.openModel(slow);
        await controller.openModel(fileSource(file("window.json", branchedWindow(false))));

        release();

        assert.equal(await first, false);
        assert.equal(controller.model!.shape, "window_recurrent");
    });
});

test("selecting a component lists its place, spec fields and weight statistics", async () => {
    await withUIControllerAsync(async ({ elements, controller }) => {
        await controller.openModel(fileSource(file("seq.json", sequenceModel())));

        const graph = controller.solver.graph;
        const head = graph.vertices.findIndex(v => v.label.startsWith("head1"));

        graph.vertices[head].isSelected = true;
        controller.updateSelectionInfo();

        assert.equal(elements.selectedNodeInfoLabel.textContent, "head1 · d_k 2");

        const lines = items(elements.selectedNodeInfoList);
        assert.equal(lines[0], "kind: head");
        assert.equal(lines[1], "at: layer 2, block body 1");
        assert.ok(lines.includes("units: 2"));
        assert.ok(lines.includes("causal: true"));
        assert.ok(lines.some(line => /^Wq \[2×4\]: min 0, max 0, mean 0, rms 0$/.test(line)));
    });
});

test("reset re-seeds the same model from its band grid and keeps the camera", async () => {
    await withUIControllerAsync(async ({ controller }) => {
        await controller.openModel(fileSource(file("seq.json", sequenceModel())));

        const seeded = controller.solver.graph.vertices.map(v => ({ ...v.position }));
        controller.solver.graph.vertices[0].position.x += 50;
        controller.state.camera.dolly(2);
        const distance = controller.state.camera.distance;

        controller.onReset();

        assert.deepEqual(controller.solver.graph.vertices.map(v => ({ ...v.position })), seeded);
        assert.equal(controller.model!.shape, "sequence");
        assert.equal(controller.state.camera.distance, distance);
    });
});

test("the file picker and a drop on the canvas both open the file", async () => {
    await withUIControllerAsync(async ({ canvas, controller }) => {
        const input = new FakeElement('INPUT') as FakeElement & { files: unknown[] };
        controller.modelFileInput = input as unknown as HTMLInputElement;
        controller.initialize();

        input.files = [file("picked.json", sequenceModel())];
        input.value = "C:\\fakepath\\picked.json";
        input.dispatch("change");
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(controller.model?.shape, "sequence");
        assert.equal(input.value, "", "cleared, so the same file can be chosen again");

        let prevented = 0;
        const preventDefault = () => { prevented++; };

        canvas.dispatch("dragover", { preventDefault });
        canvas.dispatch("drop", { preventDefault, dataTransfer: { files: [file("dropped.json", branchedWindow(false))] } });
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(prevented, 2, "both the dragover and the drop are taken from the browser");
        assert.equal(controller.model?.shape, "window_recurrent");
    });
});

test("the entrypoint wires the picker and the panel, and opens ?model=", async () => {
    const elements = demoElements();
    elements.modelFileInput = new FakeElement('INPUT');
    elements.modelInfoList = new FakeElement('UL');

    const global = globalThis as any;
    const previous = { location: global.location, fetch: global.fetch };
    const fetched: string[] = [];

    global.location = { search: "?model=models/seq.json" };
    global.fetch = async (url: string) => {
        fetched.push(url);
        return { ok: true, status: 200, json: async () => sequenceModel() };
    };

    const dom = installFakeDom(elements);

    try {
        {
            const realError = console.error;
            console.error = () => {};
            const controller = entrypoint();
            console.error = realError;

            assert.ok(controller);
            assert.equal(controller.modelFileInput, elements.modelFileInput as unknown);
            assert.equal(elements.modelFileInput.listenerCount("change"), 1);

            await new Promise(resolve => setImmediate(resolve));

            assert.deepEqual(fetched, ["models/seq.json"]);
            assert.equal(controller.model?.shape, "sequence");
            assert.equal(elements.currentGraphLabel.textContent, "seq.json");
            assert.ok(elements.modelInfoList.children.length > 0);

            controller.terminate();
        }
    }
    finally {
        dom.restore();
        global.location = previous.location;
        global.fetch = previous.fetch;
    }
});

test("the panel's wording: a model summary and a component's details", () => {
    const model = readFormat2(branchedWindow(false));
    const summary = modelSummary(model, { bands: 9, nodes: 20, edges: 30 });

    assert.ok(summary.includes("factors: 2/3 codes, 3"));
    assert.ok(summary.includes("nodes: 20, edges: 30"));

    const entry = model.stacks[0].entries[0];
    const details = componentDetails(entry, entry.components[0]);

    assert.deepEqual(details.slice(0, 5), ["kind: embedding", "at: layer 0", "units: 4", "vocabulary: 6", "size: 4"]);
    assert.match(details[5], /^E \[6×4\]: min 0, max 0, mean 0, rms 0$/);
});
