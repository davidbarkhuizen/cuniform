import test from "node:test";
import assert from "node:assert/strict";

import { readFormat2 } from "../src/network/Format2";
import { allEntries } from "../src/network/NetworkModel";
import { additionModels, modelJson, skipUnless } from "./support/models";

const tinyshakespeare = modelJson("tinyshakespeare");
const divisionProbe = modelJson("divisionProbe");
const branches = modelJson("branches");
const addition = additionModels();

test("the tinyshakespeare model: d 64, two rotary causal blocks of four heads", skipUnless(tinyshakespeare), () => {
    const model = readFormat2(tinyshakespeare);
    const entries = allEntries(model);
    const attention = entries.filter(e => e.kind === "attention");

    assert.equal(model.implementation, "numpy");
    assert.equal(model.shape, "sequence");
    assert.equal(model.width, 64);
    assert.equal(attention.length, 2);

    for (const entry of attention) {
        assert.equal(entry.spec.positions, "rotary");
        assert.equal(entry.spec.causal, true);
        assert.equal(entry.components.filter(c => c.kind === "head").length, 4);
        assert.equal(entry.components[0].units, 16);
    }

    const units = entries.flatMap(e => e.components).reduce((sum, c) => sum + c.units, 0);
    assert.ok(units > 1000 && units < 4096, `about 1.5k units at the unit level, got ${units}`);
});

test("the division probe: a window with state inputs and two coded factors", skipUnless(divisionProbe), () => {
    const model = readFormat2(divisionProbe);
    const entries = allEntries(model);

    assert.equal(model.shape, "window_recurrent");
    assert.equal(entries.filter(e => e.kind === "state_input").length, 3);
    assert.equal(model.recurrence!.factors.length, 2);
    assert.ok(model.recurrence!.factors.every(f => f.codes !== null));
    assert.deepEqual(
        entries.filter(e => e.factor !== null).map(e => e.kind),
        ["pooling", "cell", "codes", "initial_state", "pooling", "cell", "codes", "initial_state"]
    );
});

test("the window-branches model: lanes per branch, each factor reading its branch's end", skipUnless(branches), () => {
    const model = readFormat2(branches);
    const entries = allEntries(model);
    const lanes = new Set(entries.flatMap(e => e.lane === null ? [] : [e.lane]));

    assert.ok(lanes.size >= 2, "a branches window has at least two lanes");

    for (const factor of model.recurrence!.factors)
        assert.equal(entries[factor.reads].kind, "branch");
});

test("every model of the addition sweep parses", { skip: addition.length === 0 ? "indrajala-models is not checked out" : false }, () => {
    for (const [name, json] of addition)
        assert.doesNotThrow(() => readFormat2(json), name);
});
