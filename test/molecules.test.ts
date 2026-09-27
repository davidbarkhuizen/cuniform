import test from "node:test";
import assert from "node:assert/strict";

import { K } from "../src/K";
import {
    CATALOG,
    CatalogEntry,
    filterCatalog,
    MOLECULES,
    moleculeById,
    moleculeTooltip,
    sortCatalog,
} from "../src/Molecules";
import { parseSmiles } from "../src/Smiles";
import { catalogEntry } from "./support/catalog";

/** Non-hydrogen atom count of a formula: an element symbol plus an optional count. */
function heavyAtomCount(formula: string): number {

    let total = 0;
    const pattern = /([A-Z][a-z]?)([0-9]*)/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(formula)) !== null) {
        if (match[1] === "H")
            continue;

        total += match[2] === "" ? 1 : Number(match[2]);
    }

    return total;
}

/** A throwaway catalog entry, for the ordering tests that need a tie. */
function stub(id: string, commonName: string): CatalogEntry {
    return { id, commonName } as unknown as CatalogEntry;
}

test("the catalog holds at least twenty entries with unique keys and names", () => {
    assert.ok(CATALOG.length >= 20, `expected at least 20 entries, got ${CATALOG.length}`);

    const ids = new Set(MOLECULES.map(molecule => molecule.id));
    assert.equal(ids.size, MOLECULES.length, "every id must be unique");

    const commonNames = new Set(MOLECULES.map(molecule => molecule.commonName));
    assert.equal(commonNames.size, MOLECULES.length, "every common name must be unique");
});

test("every structural family has one flagship, except the two chlorophylls", () => {
    // One flagship per family is the catalog's rule; chlorophylls a and b are the
    // two compounds of a single family, so theirs is the only name that may repeat.
    const byFamily = new Map<string, string[]>();

    for (const molecule of MOLECULES)
        byFamily.set(molecule.family, [...(byFamily.get(molecule.family) ?? []), molecule.id]);

    for (const [family, ids] of byFamily) {
        if (ids.length === 1)
            continue;

        assert.deepEqual(
            ids,
            ["chlorophyll-a", "chlorophyll-b"],
            `family '${family}' repeats outside the chlorophylls`
        );
    }
});

test("every entry parses, with a positive atom, bond and ring count", () => {
    for (const entry of CATALOG) {
        assert.ok(entry.heavyAtoms > 0, `${entry.id}: no heavy atoms`);
        assert.ok(entry.topology.bonds.length > 0, `${entry.id}: no bonds`);
        assert.ok(entry.topology.ringClosures > 0, `${entry.id}: no rings`);
        assert.equal(entry.topology.atoms.length, entry.heavyAtoms);
    }
});

test("the parsed heavy-atom count equals the non-hydrogen count in the formula", () => {
    for (const entry of CATALOG) {
        assert.equal(
            entry.heavyAtoms,
            heavyAtomCount(entry.formula),
            `${entry.id}: the SMILES and the formula disagree`
        );
    }
});

test("every entry has a distinct systematic name that is longer than its chip", () => {
    const systematicNames = new Set(MOLECULES.map(molecule => molecule.systematicName));

    assert.equal(systematicNames.size, MOLECULES.length, "every systematic name must be unique");

    for (const molecule of MOLECULES) {
        assert.ok(molecule.systematicName.length > 0, `${molecule.id}: no systematic name`);
        assert.notEqual(molecule.systematicName, molecule.commonName, `${molecule.id}: names are equal`);
        assert.ok(
            molecule.systematicName.length > molecule.commonName.length,
            `${molecule.id}: the systematic name should carry the technical detail`
        );
    }
});

test("every entry has a CID, a formula, a family and a parent ring system", () => {
    for (const molecule of MOLECULES) {
        assert.ok(Number.isInteger(molecule.pubchemCid) && molecule.pubchemCid > 0, `${molecule.id}: CID`);
        assert.match(molecule.formula, /^[A-Z]/, `${molecule.id}: formula`);
        assert.ok(molecule.family.length > 0, `${molecule.id}: family`);
        assert.ok(molecule.parentSystem.length > 0, `${molecule.id}: parent system`);
        assert.ok(molecule.smiles.length > 0, `${molecule.id}: SMILES`);
    }
});

test("the catalog is the molecules list, parsed in order", () => {
    assert.deepEqual(
        CATALOG.map(entry => entry.id),
        MOLECULES.map(molecule => molecule.id)
    );

    for (const entry of CATALOG)
        assert.deepEqual(entry.topology, parseSmiles(entry.smiles), `${entry.id}: topology`);
});

test("moleculeById returns the catalog record and throws for an unknown id", () => {
    assert.equal(moleculeById("ibogaine").commonName, "Ibogaine");
    assert.throws(() => moleculeById("unobtainium"), /unknown molecule id/);
});

test("filterCatalog(\"\") returns everything, and whitespace behaves as empty", () => {
    assert.equal(filterCatalog("").length, CATALOG.length);
    assert.equal(filterCatalog("   ").length, CATALOG.length);
    assert.equal(filterCatalog("\t\n ").length, CATALOG.length);
});

test("filtering is case-insensitive and matches the common name", () => {
    for (const query of ["ibogaine", "Ibogaine", "IBOGAINE"]) {
        assert.ok(
            filterCatalog(query).some(entry => entry.id === "ibogaine"),
            `${query} should find ibogaine`
        );
    }
});

test("filtering matches the systematic name, parent system, family and formula", () => {
    const cases: Array<[string, string]> = [
        ["dodecahydroyohimban", "reserpine"],
        ["yohimban", "yohimbine"],
        ["Rauwolfia", "reserpine"],
        ["C20H26N2O", "ibogaine"],
    ];

    for (const [query, id] of cases) {
        assert.ok(
            filterCatalog(query).some(entry => entry.id === id),
            `${query} should find ${id}`
        );
    }
});

test("filtering matches the synonyms", () => {
    assert.ok(filterCatalog("eserine").some(entry => entry.id === "physostigmine"));
    assert.ok(filterCatalog("DMT").some(entry => entry.id === "dimethyltryptamine"));
    assert.ok(filterCatalog("serpasil").some(entry => entry.id === "reserpine"));
});

test("multi-term queries are an AND over the terms and may span fields", () => {
    const matches = filterCatalog("yohimban ester");

    assert.ok(matches.some(entry => entry.id === "reserpine"));
    assert.ok(
        matches.every(entry => filterCatalog("yohimban").includes(entry)),
        "every hit must also match the first term alone"
    );

    assert.deepEqual(filterCatalog("harmine ibogaine"), [], "no molecule carries both names");
});

test("a query with no match returns an empty list", () => {
    assert.deepEqual(filterCatalog("zzzznotamolecule"), []);
});

test("sortCatalog is alphabetical by common name and deterministic on ties", () => {
    const sorted = sortCatalog([stub("b", "Same"), stub("a", "Same"), stub("c", "Aaa")]);

    assert.deepEqual(sorted.map(entry => entry.id), ["c", "a", "b"]);

    const catalog = sortCatalog(CATALOG);
    for (let i = 1; i < catalog.length; i++) {
        assert.ok(
            catalog[i - 1].commonName.localeCompare(catalog[i].commonName) <= 0,
            `${catalog[i - 1].commonName} should not follow ${catalog[i].commonName}`
        );
    }
});

test("sortCatalog does not reorder the caller's array", () => {
    const input = [stub("b", "B"), stub("a", "A")];
    const before = input.map(entry => entry.id);

    sortCatalog(input);

    assert.deepEqual(input.map(entry => entry.id), before);
});

test("tagScale is monotone in heavy atoms and inside the configured range", () => {
    const byAtoms = [...CATALOG].sort((a, b) => a.heavyAtoms - b.heavyAtoms);

    for (let i = 1; i < byAtoms.length; i++) {
        assert.ok(
            byAtoms[i - 1].tagScale <= byAtoms[i].tagScale,
            `${byAtoms[i - 1].id} should not be larger than ${byAtoms[i].id}`
        );
    }

    for (const entry of CATALOG) {
        assert.ok(entry.tagScale >= K.wordCloud.minTagScale, `${entry.id}: scale below the range`);
        assert.ok(entry.tagScale <= K.wordCloud.maxTagScale, `${entry.id}: scale above the range`);
    }

    const smallest = byAtoms[0];
    const largest = byAtoms[byAtoms.length - 1];
    assert.equal(smallest.tagScale, K.wordCloud.minTagScale);
    assert.equal(largest.tagScale, K.wordCloud.maxTagScale);
});

test("the word cloud spans a visible range", () => {
    assert.ok(K.wordCloud.maxTagScale > K.wordCloud.minTagScale);
});

test("moleculeTooltip carries the systematic name, family and formula", () => {
    const entry = catalogEntry("gelsemine");

    const tooltip = moleculeTooltip(entry);

    assert.ok(tooltip.includes(entry.systematicName), "the tooltip must carry the technical name");
    assert.ok(tooltip.includes(entry.family));
    assert.ok(tooltip.includes(entry.formula));
    assert.notEqual(tooltip, entry.commonName);
});

test("every flagship note travels in its molecule's tooltip", () => {
    for (const entry of CATALOG) {
        if (!entry.note)
            continue;

        assert.ok(
            moleculeTooltip(entry).includes(entry.note),
            `${entry.id}: the flagship note must reach the tooltip`
        );
    }
});
