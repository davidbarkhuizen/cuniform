import test from "node:test";
import assert from "node:assert/strict";

import { defaultGraphSpec, parseRandomSpec, specLabel } from "../src/GraphSpec";
import { K } from "../src/K";
import { moleculeById } from "../src/Molecules";

test("defaultGraphSpec is the shipped reference demo", () => {
    assert.deepEqual(defaultGraphSpec(), {
        kind: "random",
        order: K.initialConditions.order,
        branching: K.initialConditions.branching,
    });
});

test("parseRandomSpec accepts the bounds and a value in between", () => {
    const accepted: Array<[number, number]> = [
        [K.chooser.minOrder, K.chooser.minBranching],
        [K.chooser.maxOrder, K.chooser.maxBranching],
        [11, 2],
    ];

    for (const [order, branching] of accepted) {
        const result = parseRandomSpec(String(order), String(branching));

        assert.equal(result.ok, true, `${order}/${branching} should be accepted`);
        assert.deepEqual(
            result.ok ? result.spec : null,
            { kind: "random", order, branching }
        );
    }
});

test("parseRandomSpec rejects a blank field", () => {
    for (const [order, branching] of [["", "2"], ["11", ""], ["   ", "2"]]) {
        assert.equal(parseRandomSpec(order, branching).ok, false);
    }
});

test("parseRandomSpec rejects a decimal, an exponent, a sign and a non-number", () => {
    for (const text of ["1.5", "1e2", "-3", "+3", "3px", "three"]) {
        assert.equal(parseRandomSpec(text, "2").ok, false, `${text} should be rejected as nodes`);
    }
});

test("parseRandomSpec rejects an order outside the chooser's bounds", () => {
    assert.equal(parseRandomSpec(String(K.chooser.minOrder - 1), "1").ok, false);
    assert.equal(parseRandomSpec(String(K.chooser.maxOrder + 1), "1").ok, false);
});

test("parseRandomSpec rejects branching below the minimum", () => {
    assert.equal(parseRandomSpec("11", String(K.chooser.minBranching - 1)).ok, false);
});

test("parseRandomSpec rejects branching above the practical cap", () => {
    assert.equal(parseRandomSpec("64", String(K.chooser.maxBranching + 1)).ok, false);
});

test("parseRandomSpec rejects branching at or above the order", () => {
    // A graph on n nodes has at most n - 1 distinct neighbours per node.
    assert.equal(parseRandomSpec("3", "3").ok, false, "branching == order must be rejected");
    assert.equal(parseRandomSpec("3", "2").ok, true, "branching == order - 1 is still valid");
});

test("an error message names the offending field", () => {
    const orderError = parseRandomSpec("", "2");
    assert.equal(orderError.ok, false);
    assert.match(orderError.ok ? "" : orderError.message, /^nodes:/);

    const branchingError = parseRandomSpec("11", "");
    assert.equal(branchingError.ok, false);
    assert.match(branchingError.ok ? "" : branchingError.message, /^edges per node:/);
});

test("the range message states the effective bounds", () => {
    const result = parseRandomSpec("3", "5");

    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /between 1 and 2/);
});

test("specLabel of a random spec names the order and the branching", () => {
    assert.equal(
        specLabel({ kind: "random", order: 11, branching: 2 }),
        "random graph: 11 nodes, up to 2 edges per node"
    );
});

test("specLabel of a molecule spec is the systematic name, not the common name", () => {
    const molecule = moleculeById("ibogaine");

    assert.equal(specLabel({ kind: "molecule", id: "ibogaine" }), molecule.systematicName);
    assert.notEqual(specLabel({ kind: "molecule", id: "ibogaine" }), molecule.commonName);
});

test("specLabel of an unknown molecule id throws", () => {
    assert.throws(() => specLabel({ kind: "molecule", id: "unobtainium" }), /unknown molecule id/);
});
