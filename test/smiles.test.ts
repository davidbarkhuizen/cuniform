import test from "node:test";
import assert from "node:assert/strict";

import { parseSmiles, SmilesError } from "../src/Smiles";

/** The bond joining `a` and `b`, in either direction, or undefined. */
function bondBetween(topology: ReturnType<typeof parseSmiles>, a: number, b: number) {
    return topology.bonds.find(
        bond => (bond.a === a && bond.b === b) || (bond.a === b && bond.b === a)
    );
}

/** Asserts `input` fails to parse at exactly `position`. */
function assertSmilesErrorAt(input: string, position: number): void {
    assert.throws(
        () => parseSmiles(input),
        (error: unknown) => {
            assert.ok(error instanceof SmilesError, `expected a SmilesError, got ${error}`);
            assert.equal(error.position, position);
            return true;
        }
    );
}

test("CCO gives three atoms and two bonds, in SMILES order", () => {
    const topology = parseSmiles("CCO");

    assert.deepEqual(topology.atoms, ["C", "C", "O"]);
    assert.equal(topology.bonds.length, 2);
    assert.deepEqual(topology.bonds[0], { a: 0, b: 1, order: 1 });
    assert.deepEqual(topology.bonds[1], { a: 1, b: 2, order: 1 });
    assert.equal(topology.ringClosures, 0);
});

test("c1ccccc1 gives six aromatic atoms, six aromatic bonds and one ring closure", () => {
    const topology = parseSmiles("c1ccccc1");

    assert.deepEqual(topology.atoms, ["c", "c", "c", "c", "c", "c"]);
    assert.equal(topology.bonds.length, 6);
    assert.equal(topology.ringClosures, 1);
    assert.ok(
        topology.bonds.every(bond => bond.order === 4),
        "every bond in benzene is aromatic"
    );
});

test("a fused bicycle closes two rings and shares the fusion atoms", () => {
    // Decalin: two cyclohexane rings sharing one bond.
    const topology = parseSmiles("C1CCC2CCCCC2C1");

    assert.equal(topology.atoms.length, 10);
    assert.equal(topology.ringClosures, 2);

    // Atom 3 is the first fusion atom: two ring bonds plus one chain bond.
    const incident = topology.bonds.filter(bond => bond.a === 3 || bond.b === 3);
    assert.equal(incident.length, 3);

    const fusion = bondBetween(topology, 3, 8);
    assert.ok(fusion, "the closing bond must join the two fusion atoms");
    assert.equal(fusion!.order, 1);
});

test("branches nest and unwind", () => {
    const single = parseSmiles("CC(C)C");

    assert.deepEqual(single.atoms, ["C", "C", "C", "C"]);
    assert.equal(single.bonds.length, 3);
    assert.ok(bondBetween(single, 1, 2), "the branch hangs off the second atom");
    assert.ok(bondBetween(single, 1, 3), "the chain continues from the branch point");

    const double = parseSmiles("C(C)(C)C");

    assert.deepEqual(double.atoms, ["C", "C", "C", "C"]);
    assert.equal(double.bonds.length, 3);
    assert.ok(bondBetween(double, 0, 1));
    assert.ok(bondBetween(double, 0, 2));
    assert.ok(bondBetween(double, 0, 3));
});

test("the bond symbols - = # : are orders 1, 2, 3 and 4", () => {
    const orders: Array<[string, number]> = [
        ["C-C", 1],
        ["C=C", 2],
        ["C#C", 3],
        ["C:C", 4],
    ];

    for (const [smiles, order] of orders) {
        const topology = parseSmiles(smiles);
        assert.equal(topology.bonds[0].order, order, `${smiles} should be order ${order}`);
    }
});

test("the directional bond marks / and \\ are single bonds", () => {
    // The stereochemistry is not modelled, but the bond still exists.
    const topology = parseSmiles("C/C=C\\C");

    assert.equal(topology.atoms.length, 4);
    assert.deepEqual(topology.bonds.map(bond => bond.order), [1, 2, 1]);
});

test("bracket atoms keep the element and discard the rest", () => {
    const cases: Array<[string, string[]]> = [
        ["[nH]1cccc1", ["n", "c", "c", "c", "c"]],
        ["C[C@@H](C)O", ["C", "C", "C", "O"]],
        ["C[O-]", ["C", "O"]],
        ["C[NH3+]", ["C", "N"]],
        ["C[Si]", ["C", "Si"]],
    ];

    for (const [smiles, atoms] of cases) {
        assert.deepEqual(parseSmiles(smiles).atoms, atoms, `failed for ${smiles}`);
    }

    // The aromatic bracket atom keeps the aromatic default bond.
    const pyrrole = parseSmiles("[nH]1cccc1");
    assert.ok(pyrrole.bonds.every(bond => bond.order === 4), "the pyrrole ring is aromatic");
    assert.equal(pyrrole.ringClosures, 1);
});

test("a bracket atom keeps a two-letter lowercase (aromatic) element", () => {
    // Selenium and arsenic are written lowercase in aromatic notation; truncating
    // them to one letter would silently yield sulfur/carbon instead of failing.
    assert.deepEqual(parseSmiles("c1cc[se]c1").atoms, ["c", "c", "c", "se", "c"]);
    assert.deepEqual(parseSmiles("c1cc[as]c1").atoms, ["c", "c", "c", "as", "c"]);
    assert.deepEqual(parseSmiles("[si]").atoms, ["si"]);

    // The two-letter aromatic atom keeps the aromatic default bond order.
    assert.ok(
        parseSmiles("c1cc[se]c1").bonds.every(bond => bond.order === 4),
        "the selenophene ring is aromatic"
    );

    // The uppercase forms are distinct elements, not the aromatic pair.
    assert.deepEqual(parseSmiles("C[Se]").atoms, ["C", "Se"]);
    assert.equal(parseSmiles("C[Se]").bonds[0].order, 1, "uppercase Se is not aromatic");
});

test("the organic subset's two-letter symbols are one atom, not two", () => {
    const topology = parseSmiles("ClCBr");

    assert.deepEqual(topology.atoms, ["Cl", "C", "Br"]);
    assert.deepEqual(topology.bonds.map(bond => bond.order), [1, 1]);
});

test("a leading isotope number in a bracket atom is skipped", () => {
    assert.deepEqual(parseSmiles("[13CH4]").atoms, ["C"]);
});

test("%nn two-digit ring closures round-trip", () => {
    const topology = parseSmiles("C%12CC%12");

    assert.equal(topology.atoms.length, 3);
    assert.equal(topology.bonds.length, 3);
    assert.equal(topology.ringClosures, 1);
    assert.ok(bondBetween(topology, 0, 2), "the closure joins the first and last atoms");
});

test("a %nn closure is its own label and does not alias the single digit", () => {
    // Keyed by value, %01 would read as ring 1 and could close a ring opened as
    // `1`; the two are different labels, so mixing them leaves both open.
    const topology = parseSmiles("C%01CC%01");

    assert.equal(topology.ringClosures, 1);
    assert.ok(bondBetween(topology, 0, 2), "the closure joins the first and last atoms");

    assert.throws(() => parseSmiles("C1CC%01"), SmilesError);
});

test("a ring-closure bond may be written from either side of the closure", () => {
    // The closure is always the last bond recorded, whichever side wrote it.
    assert.equal(parseSmiles("C=1CC1").bonds[2].order, 2, "the opening side carries the order");
    assert.equal(parseSmiles("C1CC=1").bonds[2].order, 2, "the closing side carries the order");
});

test(". splits the graph without adding a bond", () => {
    const topology = parseSmiles("C.C");

    assert.deepEqual(topology.atoms, ["C", "C"]);
    assert.equal(topology.bonds.length, 0);
    assert.equal(topology.ringClosures, 0);
});

test("an unknown character throws with its position", () => {
    assertSmilesErrorAt("CC$C", 2);
});

test("an unmatched ) throws with its position", () => {
    assertSmilesErrorAt("C)C", 1);
});

test("an unclosed ( throws at the position it was opened", () => {
    assertSmilesErrorAt("CC(C", 2);
});

test("a ring digit opened but never closed throws at the digit", () => {
    assertSmilesErrorAt("C1CC", 1);
});

test("a duplicate bond between the same pair of atoms throws", () => {
    assertSmilesErrorAt("C12CC12", 6);
});

test("a ring closure onto the atom it opened from throws", () => {
    assert.throws(() => parseSmiles("C11"), SmilesError);
});

test("a dangling bond symbol throws", () => {
    assert.throws(() => parseSmiles("CC="), SmilesError);
});

test("an unclosed bracket throws", () => {
    assert.throws(() => parseSmiles("C[O"), SmilesError);
});

test("a bracket atom with no element symbol throws", () => {
    assert.throws(() => parseSmiles("C[+]"), SmilesError);
});

test("parsing is pure: two parses are deeply equal and share no array", () => {
    const first = parseSmiles("c1ccccc1C(=O)O");
    const second = parseSmiles("c1ccccc1C(=O)O");

    assert.deepEqual(first, second);
    assert.notEqual(first.atoms, second.atoms);
    assert.notEqual(first.bonds, second.bonds);
});
