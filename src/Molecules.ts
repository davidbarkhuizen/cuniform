import { K } from "./K";
import { MoleculeTopology, parseSmiles } from "./Smiles";

// The molecule catalog: one flagship example per indole-alkaloid family, each
// row PubChem-verified; the SMILES and formula must agree on heavy-atom count (a test asserts it).

export interface Molecule {
    /** Kebab-case key used by a GraphSpec. */
    id: string;
    commonName: string;
    systematicName: string;
    parentSystem: string;
    family: string;
    formula: string;
    /** Isomeric SMILES, verified against `pubchemCid`. */
    smiles: string;
    pubchemCid: number;
    /** Also matched by search. */
    synonyms?: string[];
    note?: string;
}

export interface CatalogEntry extends Molecule {
    /** Parsed once at module load, so a bad SMILES fails loudly at startup. */
    topology: MoleculeTopology;
    heavyAtoms: number;
    /** Font scale in em, across `K.wordCloud`. */
    tagScale: number;
}

export const MOLECULES: Molecule[] = [
    {
        id: "dimethyltryptamine",
        commonName: "N,N-Dimethyltryptamine",
        systematicName: "2-(1H-indol-3-yl)-N,N-dimethylethanamine",
        parentSystem: "indole / tryptamine",
        family: "Simple indole (tryptamine)",
        formula: "C12H16N2",
        smiles: "CN(C)CCC1=CNC2=CC=CC=C21",
        pubchemCid: 6089,
        synonyms: ["DMT", "N,N-DMT"],
        note: "the simplest indole alkaloid: a bare tryptamine with two methyls on the nitrogen",
    },
    {
        id: "harmine",
        commonName: "Harmine",
        systematicName: "7-methoxy-1-methyl-9H-pyrido[3,4-b]indole",
        parentSystem: "pyrido[3,4-b]indole",
        family: "β-Carboline",
        formula: "C13H12N2O",
        smiles: "CC1=NC=CC2=C1NC3=C2C=CC(=C3)OC",
        pubchemCid: 5280953,
        synonyms: ["telepathine", "banisterine"],
        note: "the flagship β-carboline: an indole fused to a pyridine",
    },
    {
        id: "ergotamine",
        commonName: "Ergotamine",
        systematicName: "(6aR,9R)-N-[(1S,2S,4R,7S)-7-benzyl-2-hydroxy-4-methyl-5,8-dioxo-3-oxa-6,9-diazatricyclo[7.3.0.02,6]dodecan-4-yl]-7-methyl-6,6a,8,9-tetrahydro-4H-indolo[4,3-fg]quinoline-9-carboxamide",
        parentSystem: "indolo[4,3-fg]quinoline",
        family: "Ergoline (ergot)",
        formula: "C33H35N5O5",
        smiles: "C[C@@]1(C(=O)N2[C@H](C(=O)N3CCC[C@H]3[C@@]2(O1)O)CC4=CC=CC=C4)NC(=O)[C@H]5CN([C@@H]6CC7=CNC8=CC=CC(=C78)C6=C5)C",
        pubchemCid: 8223,
        note: "the ergoline ring system, and the largest of the ergot alkaloids here",
    },
    {
        id: "yohimbine",
        commonName: "Yohimbine",
        systematicName: "methyl (1S,15R,18S,19R,20S)-18-hydroxy-1,3,11,12,14,15,16,17,18,19,20,21-dodecahydroyohimban-19-carboxylate",
        parentSystem: "yohimban",
        family: "Corynanthe (yohimbane)",
        formula: "C21H26N2O3",
        smiles: "COC(=O)[C@H]1[C@H](CC[C@@H]2[C@@H]1C[C@H]3C4=C(CCN3C2)C5=CC=CC=C5N4)O",
        pubchemCid: 8969,
        synonyms: ["quebrachine", "corynine"],
        note: "the yohimban skeleton, the parent of the corynanthe family",
    },
    {
        id: "ibogaine",
        commonName: "Ibogaine",
        systematicName: "(1R,15R,17S,18S)-17-ethyl-7-methoxy-3,13-diazapentacyclo[13.3.1.02,10.04,9.013,18]nonadeca-2(10),4(9),5,7-tetraene",
        parentSystem: "ibogan",
        family: "Iboga",
        formula: "C20H26N2O",
        smiles: "CC[C@H]1C[C@@H]2C[C@@H]3[C@H]1N(C2)CCC4=C3NC5=C4C=C(C=C5)OC",
        pubchemCid: 197060,
        note: "the ibogan pentacycle, the family's defining rearrangement",
    },
    {
        id: "tabersonine",
        commonName: "Tabersonine",
        systematicName: "methyl (1R,12R,19S)-12-ethyl-8,16-diazapentacyclo[10.6.1.01,9.02,7.016,19]nonadeca-2,4,6,9,13-pentaene-10-carboxylate",
        parentSystem: "aspidosperman",
        family: "Aspidosperma",
        formula: "C21H24N2O2",
        smiles: "CC[C@]12CC(=C3[C@@]4([C@H]1N(CC4)CC=C2)C5=CC=CC=C5N3)C(=O)OC",
        pubchemCid: 20485,
        note: "the aspidosperman skeleton, the second large monoterpene indole family",
    },
    {
        id: "ajmaline",
        commonName: "Ajmaline",
        systematicName: "(1R,9R,10S,12R,13S,14R,16S,17S,18R)-13-ethyl-8-methyl-8,15-diazahexacyclo[14.2.1.01,9.02,7.010,15.012,17]nonadeca-2,4,6-triene-14,18-diol",
        parentSystem: "ajmalan",
        family: "Ajmaline",
        formula: "C20H26N2O2",
        smiles: "CC[C@H]1[C@@H]2C[C@H]3[C@H]4[C@@]5(C[C@@H]([C@H]2[C@H]5O)N3[C@@H]1O)C6=CC=CC=C6N4C",
        pubchemCid: 6100671,
        note: "the ajmalan hexacycle, the most densely bridged skeleton in the catalog",
    },
    {
        id: "sarpagine",
        commonName: "Sarpagine",
        systematicName: "(1S,12S,13R,14R,15E)-15-ethylidene-13-(hydroxymethyl)-3,17-diazapentacyclo[12.3.1.02,10.04,9.012,17]octadeca-2(10),4(9),5,7-tetraen-7-ol",
        parentSystem: "sarpagan",
        family: "Sarpagine",
        formula: "C19H22N2O2",
        smiles: "C/C=C\\1/CN2[C@H]3C[C@@H]1[C@H]([C@@H]2CC4=C3NC5=C4C=C(C=C5)O)CO",
        pubchemCid: 12314884,
        note: "the sarpagan skeleton, an early branch off the corynanthe line",
    },
    {
        id: "akuammiline",
        commonName: "Akuammiline",
        systematicName: "methyl (1S,10S,12S,13E)-18-(acetyloxymethyl)-13-ethylidene-8,15-diazapentacyclo[10.5.1.01,9.02,7.010,15]octadeca-2,4,6,8-tetraene-18-carboxylate",
        parentSystem: "akuammilan",
        family: "Akuammiline",
        formula: "C23H26N2O4",
        smiles: "C/C=C\\1/CN2CC[C@@]34C5=CC=CC=C5N=C3[C@@H]2C[C@@H]1C4(COC(=O)C)C(=O)OC",
        pubchemCid: 16058537,
        note: "the akuammilan skeleton, with a seven-membered ring fused to the indole",
    },
    {
        id: "strychnine",
        commonName: "Strychnine",
        systematicName: "(4aR,5aS,8aR,13aS,15aS,15bR)-4a,5,5a,7,8,13a,15,15a,15b,16-decahydro-2H-4,6-methanoindolo[3,2,1-ij]oxepino[2,3,4-de]pyrrolo[2,3-h]quinolin-14-one",
        parentSystem: "strychnan",
        family: "Strychnos",
        formula: "C21H22N2O2",
        smiles: "C1CN2CC3=CCO[C@H]4CC(=O)N5[C@H]6[C@H]4[C@H]3C[C@H]2[C@@]61C7=CC=CC=C75",
        pubchemCid: 441071,
        note: "the strychnan cage, the archetypal Strychnos alkaloid",
    },
    {
        id: "camptothecin",
        commonName: "Camptothecin",
        systematicName: "(19S)-19-ethyl-19-hydroxy-17-oxa-3,13-diazapentacyclo[11.8.0.02,11.04,9.015,20]henicosa-1(21),2,4,6,8,10,15(20)-heptaene-14,18-dione",
        parentSystem: "quinoline-fused indole",
        family: "Camptotheca (quinoline-fused)",
        formula: "C20H16N2O4",
        smiles: "CC[C@@]1(C2=C(COC1=O)C(=O)N3CC4=CC5=CC=CC=C5N=C4C3=C2)O",
        pubchemCid: 24360,
        note: "an indole fused to a quinoline rather than to a full extra ring",
    },
    {
        id: "vincristine",
        commonName: "Vincristine",
        systematicName: "methyl (1R,9R,10S,11R,12R,19R)-11-acetyloxy-12-ethyl-4-[(13S,15S,17S)-17-ethyl-17-hydroxy-13-methoxycarbonyl-1,11-diazatetracyclo[13.3.1.04,12.05,10]nonadeca-4(12),5,7,9-tetraen-13-yl]-8-formyl-10-hydroxy-5-methoxy-8,16-diazapentacyclo[10.6.1.01,9.02,7.016,19]nonadeca-2,4,6,13-tetraene-10-carboxylate",
        parentSystem: "iboga + aspidosperma dimer",
        family: "Bisindole (dimeric MIA)",
        formula: "C46H56N4O10",
        smiles: "CC[C@@]1(C[C@@H]2C[C@@](C3=C(CCN(C2)C1)C4=CC=CC=C4N3)(C5=C(C=C6C(=C5)[C@]78CCN9[C@H]7[C@@](C=CC9)([C@H]([C@@]([C@@H]8N6C=O)(C(=O)OC)O)OC(=O)C)CC)OC)C(=O)OC)O",
        pubchemCid: 5978,
        synonyms: ["leurocristine"],
        note: "the one dimer: an iboga unit joined to an aspidosperma unit, and the largest graph here",
    },
    {
        id: "reserpine",
        commonName: "Reserpine",
        systematicName: "methyl (1R,15S,17R,18R,19S,20S)-6,18-dimethoxy-17-(3,4,5-trimethoxybenzoyl)oxy-1,3,11,12,14,15,16,17,18,19,20,21-dodecahydroyohimban-19-carboxylate",
        parentSystem: "yohimban (reserpate ester)",
        family: "Rauwolfia",
        formula: "C33H40N2O9",
        smiles: "CO[C@H]1[C@@H](C[C@@H]2CN3CCC4=C([C@H]3C[C@@H]2[C@@H]1C(=O)OC)NC5=C4C=CC(=C5)OC)OC(=O)C6=CC(=C(C(=C6)OC)OC)OC",
        pubchemCid: 5770,
        synonyms: ["serpasil"],
        note: "a yohimban ester carrying the trimethoxybenzoyl group that defines the Rauwolfia family",
    },
    {
        id: "staurosporine",
        commonName: "Staurosporine",
        systematicName: "(2S,3R,4R,6R)-3-methoxy-2-methyl-4-(methylamino)-29-oxa-1,7,17-triazaoctacyclo[12.12.2.12,6.07,28.08,13.015,19.020,27.021,26]nonacosa-8,10,12,14,19,21,23,25,27-nonaen-16-one",
        parentSystem: "indolo[2,3-a]carbazole",
        family: "Carbazole (bis-indole)",
        formula: "C28H26N4O3",
        smiles: "C[C@@]12[C@@H]([C@@H](C[C@@H](O1)N3C4=CC=CC=C4C5=C6C(=C7C8=CC=CC=C8N2C7=C53)CNC6=O)NC)OC",
        pubchemCid: 44259,
        note: "two indoles fused into a carbazole, with a sugar-like ring on top",
    },
    {
        id: "rhynchophylline",
        commonName: "Rhynchophylline",
        systematicName: "methyl (E)-2-[(3R,6'R,7'S,8'aS)-6'-ethyl-2-oxospiro[1H-indole-3,1'-3,5,6,7,8,8a-hexahydro-2H-indolizine]-7'-yl]-3-methoxyprop-2-enoate",
        parentSystem: "spiro[indole-3,3′-pyrrolidine]",
        family: "Oxindole (spiro)",
        formula: "C22H28N2O4",
        smiles: "CC[C@H]1CN2CC[C@]3([C@@H]2C[C@@H]1/C(=C\\OC)/C(=O)OC)C4=CC=CC=C4NC3=O",
        pubchemCid: 5281408,
        note: "a genuine oxindole: the indole's C2 is oxidised and carries the spiro centre",
    },
    {
        id: "physostigmine",
        commonName: "Physostigmine",
        systematicName: "[(3aR,8bS)-3,4,8b-trimethyl-2,3a-dihydro-1H-pyrrolo[2,3-b]indol-7-yl] N-methylcarbamate",
        parentSystem: "pyrrolo[2,3-b]indole",
        family: "Calabar bean (pyrroloindoline)",
        formula: "C15H21N3O2",
        smiles: "C[C@@]12CCN([C@@H]1N(C3=C2C=C(C=C3)OC(=O)NC)C)C",
        pubchemCid: 5983,
        synonyms: ["eserine"],
        note: "a pyrroloindoline: the pyrrole ring is saturated and fused at the indole's 2,3 positions",
    },
    {
        id: "vincamine",
        commonName: "Vincamine",
        systematicName: "methyl (15S,17S,19S)-15-ethyl-17-hydroxy-1,11-diazapentacyclo[9.6.2.02,7.08,18.015,19]nonadeca-2,4,6,8(18)-tetraene-17-carboxylate",
        parentSystem: "eburnan",
        family: "Eburnane",
        formula: "C21H26N2O3",
        smiles: "CC[C@@]12CCCN3[C@@H]1C4=C(CC3)C5=CC=CC=C5N4[C@](C2)(C(=O)OC)O",
        pubchemCid: 15376,
        note: "the eburnan skeleton, an aspidosperma relative with a contracted ring",
    },
    {
        id: "gelsemine",
        commonName: "Gelsemine",
        systematicName: "(1'R,2'S,3S,5'S,6'S,8'R,11'S)-2'-ethenyl-4'-methylspiro[1H-indole-3,7'-9-oxa-4-azatetracyclo[6.3.1.02,6.05,11]dodecane]-2-one",
        parentSystem: "spiro[indole-3,7′-oxa-azatetracyclo]",
        family: "Gelsemium",
        formula: "C20H22N2O2",
        smiles: "CN1C[C@]2([C@@H]3C[C@@H]4[C@]5([C@H]2[C@H]1[C@H]3CO4)C6=CC=CC=C6NC5=O)C=C",
        pubchemCid: 5390854,
        note: "an oxindole whose spiro centre carries an oxa-bridged tetracycle",
    },
    {
        id: "ellipticine",
        commonName: "Ellipticine",
        systematicName: "5,11-dimethyl-6H-pyrido[4,3-b]carbazole",
        parentSystem: "pyrido[4,3-b]carbazole",
        family: "Pyridocarbazole",
        formula: "C17H14N2",
        smiles: "CC1=C2C=CN=CC2=C(C3=C1NC4=CC=CC=C43)C",
        pubchemCid: 3213,
        note: "an indole fused to a pyridine fused to a benzene: a planar four-ring chromophore",
    },
    {
        id: "uleine",
        commonName: "Uleine",
        systematicName: "16-ethyl-15-methyl-11-methylidene-9,15-diazatetracyclo[10.3.1.02,10.03,8]hexadeca-2(10),3,5,7-tetraene",
        parentSystem: "uleine",
        family: "Uleine",
        formula: "C18H22N2",
        smiles: "CCC1C2CCN(C1C3=C(C2=C)NC4=CC=CC=C43)C",
        pubchemCid: 252320,
        note: "a rearranged aspidosperma skeleton missing the tryptamine bridge",
    },
];

// Every entry parsed and measured once at module load; a parse failure fails
// loudly at startup, which is the point for PubChem-verified data.
const PARSED = MOLECULES.map(molecule => {

    const topology = parseSmiles(molecule.smiles);

    return {
        ...molecule,
        topology,
        heavyAtoms: topology.atoms.length,
    };
});

// The heavy-atom span the cloud normalises over.
const HEAVY_ATOM_COUNTS = PARSED.map(entry => entry.heavyAtoms);
const MIN_HEAVY_ATOMS = Math.min(...HEAVY_ATOM_COUNTS);
const MAX_HEAVY_ATOMS = Math.max(...HEAVY_ATOM_COUNTS);

// `heavyAtoms` mapped linearly onto `[minTagScale, maxTagScale]`; pure, so the
// cloud looks the same every time.
function tagScaleFor(heavyAtoms: number): number {

    if (MAX_HEAVY_ATOMS === MIN_HEAVY_ATOMS)
        return K.wordCloud.maxTagScale;

    const t = (heavyAtoms - MIN_HEAVY_ATOMS) / (MAX_HEAVY_ATOMS - MIN_HEAVY_ATOMS);

    return K.wordCloud.minTagScale + t * (K.wordCloud.maxTagScale - K.wordCloud.minTagScale);
}

export const CATALOG: CatalogEntry[] = PARSED.map(entry => ({
    ...entry,
    tagScale: tagScaleFor(entry.heavyAtoms),
}));

/** The parsed catalog record for `id`; throws for an unknown id, so a spec can only
 * come from the catalog. Returned parsed so callers reuse the topology built at load. */
export function moleculeById(id: string): CatalogEntry {

    const found = CATALOG.find(entry => entry.id === id);

    if (!found)
        throw new Error(`moleculeById: unknown molecule id: ${id}`);

    return found;
}

// Everything a query matches against, lowercased: names, family and formula, so
// a common-name chip still finds a molecule by its technical name.
function searchText(entry: CatalogEntry): string {
    return [
        entry.commonName,
        entry.systematicName,
        entry.parentSystem,
        entry.family,
        entry.formula,
        ...(entry.synonyms ?? []),
    ].join(" ").toLowerCase();
}

/** Case-insensitive substring match, all terms, across every name and the formula.
 * An empty query matches everything, so an empty search box shows the whole cloud. */
export function filterCatalog(query: string, entries: CatalogEntry[] = CATALOG): CatalogEntry[] {

    const terms = query.toLowerCase().split(/\s+/).filter(term => term.length > 0);

    if (terms.length === 0)
        return entries.slice();

    return entries.filter(entry => {
        const haystack = searchText(entry);
        return terms.every(term => haystack.includes(term));
    });
}

/** Alphabetical by common name, ties broken by id, so the order is deterministic. */
export function sortCatalog(entries: CatalogEntry[]): CatalogEntry[] {
    return [...entries].sort(
        (a, b) => a.commonName.localeCompare(b.commonName) || a.id.localeCompare(b.id)
    );
}

export function moleculeTooltip(entry: CatalogEntry): string {

    const summary = `${entry.systematicName} — ${entry.family} (${entry.formula})`;

    // The note is the catalog's one-line "why this is the family's flagship";
    // the tooltip is its reader, so it travels with the technical summary.
    return entry.note ? `${summary}\n${entry.note}` : summary;
}
