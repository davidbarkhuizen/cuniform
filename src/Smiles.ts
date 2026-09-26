/**
 * A reader for the SMILES subset the molecule catalog needs, not a full
 * chemistry toolkit.
 *
 * The catalog stores a SMILES string per molecule because that string is the
 * artifact that can be checked against a PubChem CID. Parsing it here, rather
 * than hand-copying an adjacency list per molecule, keeps the data auditable by
 * inspection and turns ~25 unverifiable bond pairs per entry into one parser
 * with small-molecule unit tests.
 *
 * The module is pure and DOM-free: it reads a string and returns a topology.
 *
 * Chemistry is deliberately *not* validated - no valence, no aromaticity
 * perception, no ring perception. This is a graph reader, and the data it reads
 * is verified at the source (see the catalog's PubChem CIDs). What *is* checked
 * is that the notation itself is well formed: brackets balance, ring closures
 * pair up, and no bond is written twice.
 */

/** One bond, as the pair of atom indices it joins and its bond order. */
export interface SmilesBond {
    /** Indices into `atoms`. */
    a: number;
    b: number;
    /** 1 single, 2 double, 3 triple, 4 aromatic. */
    order: 1 | 2 | 3 | 4;
}

export interface MoleculeTopology {
    /** One element symbol per heavy atom, in SMILES order. */
    atoms: string[];
    bonds: SmilesBond[];
    /** Ring-closure bonds, which is also the cycle rank of a connected graph. */
    ringClosures: number;
}

/**
 * A malformed SMILES string. `position` is the 0-based character offset the
 * reader stopped at, which is what makes a catalog transcription error a local
 * fix rather than a hunt.
 */
export class SmilesError extends Error {
    constructor(message: string, readonly position: number) {
        super(`${message} (at position ${position})`);
        this.name = "SmilesError";
    }
}

/** The single-letter organic subset, plus the two two-letter members. */
const ORGANIC_SINGLE = new Set(["B", "C", "N", "O", "P", "S", "F", "I"]);

/** The aromatic subset: an atom written as a lowercase element symbol. */
const AROMATIC = new Set(["b", "c", "n", "o", "p", "s"]);

/** An aromatic atom is written as its own lowercase element symbol. */
function isAromaticSymbol(symbol: string): boolean {
    return symbol === symbol.toLowerCase();
}

/**
 * The bond order implied when no symbol is written: aromatic (4) when both
 * ends are aromatic, a single bond (1) otherwise. One home for the default, so
 * extending the chain and closing a ring cannot disagree about it.
 */
function defaultBondOrder(symbolA: string, symbolB: string): 1 | 4 {
    return isAromaticSymbol(symbolA) && isAromaticSymbol(symbolB) ? 4 : 1;
}

/**
 * Read the element symbol out of a bracket atom such as `[nH]`, `[C@@H]`,
 * `[O-]`, `[NH3+]`, `[13CH4]` or `[Si]`.
 *
 * Only the symbol is kept: the hydrogen count, the chirality and the charge
 * that follow it describe chemistry this reader does not model. A leading
 * isotope number is skipped for the same reason.
 */
function bracketSymbol(body: string, position: number): string {
    let i = 0;

    while (i < body.length && body[i] >= "0" && body[i] <= "9")
        i++;

    if (i >= body.length)
        throw new SmilesError("bracket atom has no element symbol", position);

    const first = body[i];

    if (first >= "A" && first <= "Z") {
        const second = body[i + 1] ?? "";
        return second >= "a" && second <= "z" ? first + second : first;
    }

    if (first >= "a" && first <= "z")
        return first;

    throw new SmilesError("bracket atom has no element symbol", position + i);
}

/**
 * Parse `smiles` into the heavy-atom graph it describes.
 *
 * Supported: the organic subset (`C N O S P F Cl Br I B`), the aromatic subset
 * (`c n o s p b`), bracket atoms (the element is kept, the rest discarded),
 * branches, ring closures (`1`..`9` and `%10`..`%99`), the bond symbols
 * `- = # : / \`, disconnection with `.`, and the implicit default bond - which
 * is aromatic when both ends are aromatic and single otherwise.
 *
 * Throws a `SmilesError` carrying the character position for an unknown
 * character, an unmatched `)`, an unclosed `(`, a ring closure that is never
 * closed, a bond symbol with no following atom, and a duplicate bond between
 * the same pair of atoms.
 */
export function parseSmiles(smiles: string): MoleculeTopology {

    const atoms: string[] = [];
    const bonds: SmilesBond[] = [];
    const bondKeys = new Set<string>();

    /** The atom the next atom or closure attaches to; null after a `.`. */
    let current: number | null = null;

    /** A bond symbol waiting for the atom it applies to; 0 means unset. */
    let pending: 1 | 2 | 3 | 4 | 0 = 0;

    /** Pending branch atoms, with the position of the `(` that opened them. */
    const branches: Array<{ atom: number; position: number }> = [];

    /** Ring closures opened but not yet closed, keyed by their written number. */
    const rings = new Map<string, { atom: number; order: 1 | 2 | 3 | 4 | 0; position: number }>();

    let ringClosures = 0;

    const at = (index: number) => atoms[index];

    const addBond = (a: number, b: number, order: 1 | 2 | 3 | 4, position: number) => {

        if (a === b)
            throw new SmilesError("a bond cannot join an atom to itself", position);

        const key = a < b ? `${a}-${b}` : `${b}-${a}`;

        if (bondKeys.has(key))
            throw new SmilesError("duplicate bond between the same pair of atoms", position);

        bondKeys.add(key);
        bonds.push({ a, b, order });
    };

    const addAtom = (symbol: string, position: number) => {

        const index = atoms.length;

        atoms.push(symbol);

        if (current !== null) {
            // The default bond is aromatic when both ends are aromatic, else a
            // single bond. An explicit bond symbol always wins.
            const order: 1 | 2 | 3 | 4 = pending !== 0
                ? pending
                : defaultBondOrder(at(current), symbol);

            addBond(current, index, order, position);
        }

        pending = 0;
        current = index;
    };

    const useRingClosure = (number: number, position: number) => {

        const key = String(number);
        const opened = rings.get(key);

        // First use of the number opens a closure on the current atom.
        if (!opened) {
            if (current === null)
                throw new SmilesError("a ring closure was opened before any atom", position);

            rings.set(key, { atom: current, order: pending, position });
            pending = 0;
            return;
        }

        if (current === null)
            throw new SmilesError("a ring closure was closed before any atom", position);

        rings.delete(key);
        ringClosures++;

        // The order may be written on either side of the closure; an explicit
        // symbol on the closing side wins, then the opening side, then the
        // aromatic/single default.
        const order: 1 | 2 | 3 | 4 = pending !== 0
            ? pending
            : opened.order !== 0
                ? opened.order
                : defaultBondOrder(at(opened.atom), at(current));

        addBond(opened.atom, current, order, position);
        pending = 0;
    };

    let i = 0;

    while (i < smiles.length) {

        const ch = smiles[i];

        if (ch === "(") {
            if (current === null)
                throw new SmilesError("a branch was opened before any atom", i);

            branches.push({ atom: current, position: i });
            i++;
            continue;
        }

        if (ch === ")") {
            const branch = branches.pop();

            if (!branch)
                throw new SmilesError("unmatched ')'", i);

            if (pending !== 0)
                throw new SmilesError("a bond symbol has no following atom", i);

            current = branch.atom;
            i++;
            continue;
        }

        if (ch === "-" || ch === "=" || ch === "#" || ch === ":") {
            if (pending !== 0)
                throw new SmilesError("two bond symbols in a row", i);

            pending = ch === "-" ? 1 : ch === "=" ? 2 : ch === "#" ? 3 : 4;
            i++;
            continue;
        }

        if (ch === "/" || ch === "\\") {
            if (pending !== 0)
                throw new SmilesError("two bond symbols in a row", i);

            // A directional bond is a single bond carrying a stereo mark.
            pending = 1;
            i++;
            continue;
        }

        if (ch === ".") {
            if (pending !== 0)
                throw new SmilesError("a bond symbol has no following atom", i);

            // Disconnection: the next atom starts a fresh component.
            current = null;
            i++;
            continue;
        }

        if (ch === "[") {
            const close = smiles.indexOf("]", i);

            if (close === -1)
                throw new SmilesError("unclosed '['", i);

            addAtom(bracketSymbol(smiles.slice(i + 1, close), i + 1), i);
            i = close + 1;
            continue;
        }

        if (ch === "%") {
            const digits = smiles.slice(i + 1, i + 3);

            if (!/^\d\d$/.test(digits))
                throw new SmilesError("'%' must be followed by two ring-closure digits", i);

            useRingClosure(parseInt(digits, 10), i);
            i += 3;
            continue;
        }

        if (ch >= "0" && ch <= "9") {
            useRingClosure(parseInt(ch, 10), i);
            i++;
            continue;
        }

        const next = smiles[i + 1] ?? "";

        if (ch === "C" && next === "l") {
            addAtom("Cl", i);
            i += 2;
            continue;
        }

        if (ch === "B" && next === "r") {
            addAtom("Br", i);
            i += 2;
            continue;
        }

        if (ORGANIC_SINGLE.has(ch)) {
            addAtom(ch, i);
            i++;
            continue;
        }

        if (AROMATIC.has(ch)) {
            addAtom(ch, i);
            i++;
            continue;
        }

        throw new SmilesError(`unknown character '${ch}'`, i);
    }

    // Every opening must have a matching close, or the notation is truncated.
    const openBranch = branches[branches.length - 1];

    if (openBranch)
        throw new SmilesError("unclosed '('", openBranch.position);

    for (const [key, opened] of rings)
        throw new SmilesError(`ring closure '${key}' was opened but never closed`, opened.position);

    if (pending !== 0)
        throw new SmilesError("a bond symbol has no following atom", smiles.length - 1);

    return { atoms, bonds, ringClosures };
}
