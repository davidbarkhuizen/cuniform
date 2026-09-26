# P3 — Graph chooser: a first-run and reset wizard for random and molecule graphs

| | |
| --- | --- |
| **Status** | Implemented |
| **Landed** | PRs #73–#76; `main` green at 334 tests |
| **Area** | new `src/GraphSpec.ts`, `src/Smiles.ts`, `src/Molecules.ts`, `src/GraphWizard.ts`; changed `src/GraphFactory.ts`, `src/UIController.ts`, `src/entrypoint.ts`, `src/K.ts`; `web/index.html`, `web/stylez.css`; `README.md`; `test/**` |
| **Depends on** | nothing outstanding — `main` was green at 221 tests when this was planned |
| **Blocks** | nothing |

## 1. Goal

Replace the `confirm()`-then-rebuild reset with a **graph chooser** presented as a
modal wizard. The wizard opens **on first run and on every reset**, and it is the
only way a new graph is created.

```
step 1  choose ──┬─ random       ──> step 2  parameters ──> build
                 └─ molecules    ──> step 3  searchable tag cloud ──> build
```

- **Random** — a parameter form for the two knobs `GraphFactory.generateGraph()`
  already takes: the node count and the maximum edges per node.
- **Pre-configured** — a searchable, alphabetically sorted **word cloud** of about
  20 indole alkaloids, one flagship example per structural family. Selecting one
  builds its **molecular graph**: heavy atoms are nodes, bonds are edges, read
  from SMILES verified against PubChem.

The tag cloud shows the **common name** (a word cloud of IUPAC names is
unreadable); the **full systematic name** is the tooltip and is what the overlay
panel displays for the loaded graph, so the technical name is never lost.

Two behaviour changes fall out of this:

1. `reset` no longer rebuilds immediately. It opens the wizard, and the running
   graph is left alone until a choice is actually made; a cancelled wizard
   changes nothing.
2. A new graph is swapped **in place** (`loadGraph`) rather than through a full
   `initialize()`, so the timer, the listeners and the context menu are not
   churned and the camera survives.

Out of scope is enumerated in §9.

## 2. Decisions of record

| # | Decision | Choice |
| --- | --- | --- |
| D1 | The chooser | **One modal wizard** with a chooser step and one step per branch, not two separate dialogs |
| D2 | When it opens | **First run and reset**; first run is mandatory, reset is dismissible |
| D3 | The graph description | A **discriminated `GraphSpec`**, not loose parameters threaded through the controller |
| D4 | Molecule data | **Verified SMILES** parsed by an in-repo reader; no runtime dependency |
| D5 | Naming | Tag text = **common name**; tooltip, `aria-label` and the panel's graph line = **full systematic (IUPAC) name**; search matches both |
| D6 | Tag cloud | **Sorted by common name, filtered by a text input**, chip size scaled by heavy-atom count |
| D7 | Random parameters | `order` and `branching`, bounds in `K`, defaults from `K.initialConditions`, validated live |
| D8 | Applying a choice | **`loadGraph()` swaps the graph in place**; `initialize()` keeps its startup/lifecycle meaning |
| D9 | Wizard DOM | **Built in TypeScript** (the `ContextMenu` precedent) and styled by CSS classes; `index.html` gains only the current-graph line |
| D10 | Cancel | First run has no cancel; a reset cancel leaves the graph, timer, listeners and camera exactly as they were |
| D11 | Molecule seeding | **Deterministic phyllotaxis seed** at the spring rest length, instead of the random cube |

Why these, briefly, because each has a cheaper alternative:

- **A wizard over a second `confirm()` (D1).** The reset now has two outcomes and
  one of them has parameters; a confirm cannot express that, and two chained
  confirms cannot go back.
- **`loadGraph` over `initialize()` (D8).** `initialize()` is a *lifecycle*
  operation — attach the listeners, build the menu, start the timer. Changing
  the simulated graph is a *content* operation. Re-initializing to change content
  re-registers every listener, which is precisely the bug class
  `toggleEventListeners()` and `context-menu.test.ts` exist to prevent.
- **SMILES plus a parser over 20 hand-written adjacency lists (D4).** The SMILES
  string is the artifact that can be checked against a PubChem CID. A
  hand-copied adjacency list is ~25 unverifiable bond pairs per molecule; the
  parser is a pure module with small-molecule unit tests, and it makes the
  catalog data auditable by inspection.
- **A TypeScript-built dialog over native `<dialog>` (D9).** `showModal()` would
  give the focus trap and the backdrop for free, but it moves the behaviour
  under test into the browser, and the test DOM is hand-rolled. A plain
  `div[role=dialog][aria-modal]` keeps every rule in `src/` and testable.
- **A deterministic seed for molecules (D11).** A molecule dropped into the
  random cube starts as a tangle and unfolds into a blob; a phyllotaxis spiral
  spaced at the spring rest length starts every pair outside the repulsion
  guard, at roughly the separation the springs want, and makes a molecule's
  first frame reproducible.
- **The default placeholder (D2).** `initialize()` keeps building the
  documented default graph, so the app always has a valid graph and no render,
  step or hit-test path needs a "no graph" special case. The first-run wizard is
  mandatory and replaces it; it is inserted in the same task, before the first
  paint, so nothing of it is ever visible.

## 3. Why this is not just a menu

Three boundaries in the current code decide the shape of the change.

**The reset path is the lifecycle path.** `onReset()` today calls
`confirm()` and then `initialize()`, which tears down and rebuilds the timer,
every listener and the context menu. That was acceptable when "reset" meant "the
same graph again". Once reset means "a different graph", the teardown is
unnecessary work and a regression surface.

**The graph source is a no-argument closure.** `GraphSource = () => Graph` is
injected into `UIController` and called from `initialize()` and from the lazy
`solver` getter. A chooser has to hand a *description* of the graph across, so
the source becomes `(spec: GraphSpec) => Graph`. A one-argument function type
still accepts the `() => graph` fixtures the test helper injects, so the seam
changes without touching a fixture.

**There is no place for molecule data.** `GraphFactory` generates only random
graphs and labels every node `Node i`. Molecules need a second generator, a data
source and a naming policy for the nodes.

```ts
// today
onReset = (event?: MouseEvent) => {
    const reset = confirm('Reset.\nAre You Sure ?');
    event?.preventDefault();
    if (reset == true) this.initialize();
    return false;
};

// after
onReset = (event?: MouseEvent) => {
    event?.preventDefault();
    this.openGraphWizard();      // the graph is untouched until a choice is made
    return false;
};
```

## 4. Design

### 4.1 `src/GraphSpec.ts` (new)

The one vocabulary shared by the wizard, the controller and the factory. Pure,
DOM-free, no imports beyond `K` and the catalog.

```ts
import { K } from "./K";
import { moleculeById } from "./Molecules";

export type GraphSpec =
    | { kind: "random"; order: number; branching: number }
    | { kind: "molecule"; id: string };

/** The shipped default: the reference demo's 11 nodes, branching 2. */
export function defaultGraphSpec(): GraphSpec {
    return {
        kind: "random",
        order: K.initialConditions.order,
        branching: K.initialConditions.branching,
    };
}

/**
 * Validate the raw text of the two random-graph fields. The inputs are text
 * boxes, so the parse and the range check are one pure function the wizard
 * calls on every keystroke and the tests can drive without a DOM.
 */
export type RandomParams =
    | { ok: true; spec: Extract<GraphSpec, { kind: "random" }> }
    | { ok: false; message: string };

export function parseRandomSpec(orderText: string, branchingText: string): RandomParams;

/** The one-line description of a spec: the panel's current-graph label. */
export function specLabel(spec: GraphSpec): string;
```

`parseRandomSpec` rules, each with its own message:

| Field | Rule |
| --- | --- |
| both | a whole number, no decimals, no exponents, not blank |
| `order` | `K.chooser.minOrder <= order <= K.chooser.maxOrder` |
| `branching` | `K.chooser.minBranching <= branching <= min(K.chooser.maxBranching, order - 1)` |

The `order - 1` half is not arbitrary: a graph on `n` nodes has at most
`n - 1` distinct neighbours per node, so a larger value would silently produce
fewer edges than asked for. `maxBranching` is the practical cap on top of it.

`specLabel` returns `random graph: 11 nodes, up to 2 edges per node` for a random
spec, and the entry's `systematicName` for a molecule — so the panel's graph line
is technical, per D5.

### 4.2 `src/Smiles.ts` (new)

A reader for the SMILES subset the catalog needs, not a full chemistry toolkit.
Pure, DOM-free, ~120 lines.

```ts
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

export class SmilesError extends Error {
    constructor(message: string, readonly position: number) { super(message); }
}

export function parseSmiles(smiles: string): MoleculeTopology;
```

Supported:

| Feature | Example | Handling |
| --- | --- | --- |
| organic subset | `C N O S P F Cl Br I B` | one atom |
| aromatic subset | `c n o s p b` | aromatic atom |
| bracket atoms | `[nH]`, `[C@@H]`, `[O-]`, `[NH3+]`, `[Si]` | element symbol; H count, chirality and charge are read and discarded |
| branches | `CC(C)C` | a stack of pending atoms |
| ring closures | `1`..`9`, `%10`..`%99` | a map of pending closures |
| bonds | `-`, `=`, `#`, `:`, `/`, `\` | orders `1,2,3,4,1,1` |
| disconnection | `.` | no bond; the next atom starts a new component |
| default bond | `c1ccccc1`, `CC` | aromatic when both ends are aromatic, else single |

Rejected with an error, carrying the character position: an unknown character, an
unmatched `)` or an unclosed `(`, a ring digit opened but never closed or closed
twice, and a duplicate bond between the same pair of atoms. Valence and
chemistry are deliberately **not** validated: this is a graph reader, and the
data is verified at the source (§5).

### 4.3 `src/Molecules.ts` (new)

The catalog and everything derived from it.

```ts
import { K } from "./K";
import { MoleculeTopology, parseSmiles } from "./Smiles";

export interface Molecule {
    /** Stable kebab-case key used by a GraphSpec. */
    id: string;
    /** The word-cloud chip, e.g. "Ibogaine". */
    commonName: string;
    /** The full systematic name; the tooltip and the panel's graph line. */
    systematicName: string;
    /** The parent ring system, e.g. "ibogan" — compact and technical. */
    parentSystem: string;
    /** The structural family this molecule is the flagship example of. */
    family: string;
    /** Molecular formula as published, e.g. "C20H26N2O". */
    formula: string;
    /** Isomeric SMILES verified against `pubchemCid`. */
    smiles: string;
    pubchemCid: number;
    /** Alternate names the search also matches. */
    synonyms?: string[];
    /** One line on why this is the family's flagship example. */
    note?: string;
}

export interface CatalogEntry extends Molecule {
    topology: MoleculeTopology;
    heavyAtoms: number;
    bondCount: number;
    ringCount: number;
    /** The word-cloud font scale, in em, across `K.wordCloud`. */
    tagScale: number;
}

export const MOLECULES: Molecule[];

/** Built once at load: parses every SMILES and derives the metadata. */
export const CATALOG: CatalogEntry[];

/** Throws for an unknown id; a spec can only come from the catalog. */
export function moleculeById(id: string): Molecule;

/** Case-insensitive substring match, all terms, across every name and the formula. */
export function filterCatalog(query: string, entries?: CatalogEntry[]): CatalogEntry[];

/** Alphabetical by common name, ties broken by id, so the order is deterministic. */
export function sortCatalog(entries: CatalogEntry[]): CatalogEntry[];

/** The distinct family names, in catalog order. */
export function families(entries?: CatalogEntry[]): string[];

/** The full systematic name and family, for the chip's title and aria-label. */
export function moleculeTooltip(entry: CatalogEntry): string;
```

`CATALOG` is built by parsing each `MOLECULES.smiles` once at module load. A
parse failure therefore fails loudly at startup — which is the right behaviour
for data that is supposed to be verified — and a catalog test parses the whole
list anyway.

The search haystack is
`commonName + systematicName + parentSystem + family + formula + synonyms`,
lowercased. This is the reason the common-name chips still find a molecule by its
technical name and vice versa.

`tagScale` normalises `heavyAtoms` across the catalog into
`[K.wordCloud.minTagScale, K.wordCloud.maxTagScale]`; the chip with the fewest
heavy atoms is smallest and the largest molecule is biggest. It is a pure
function of the catalog, so the cloud looks the same every time.

### 4.4 `src/GraphFactory.ts`: `build()`, `generateMolecule()`, the seed

The existing `generateGraph(order, maxEdgesPerVertex)` is untouched; everything
below is additive.

```ts
import { CATALOG, moleculeById } from "./Molecules";
import { GraphSpec } from "./GraphSpec";
import { parseSmiles } from "./Smiles";

build(spec: GraphSpec): Graph {
    return spec.kind === "random"
        ? this.generateGraph(spec.order, spec.branching)
        : this.generateMolecule(spec.id);
}

generateMolecule(id: string): Graph {
    const molecule = moleculeById(id);
    const topology = parseSmiles(molecule.smiles);

    const graph = new Graph();
    const positions = moleculeSeedPositions(topology.atoms.length);

    const tags = topology.atoms.map((symbol, i) => {
        const tag = new Tag(positions[i], symbol);
        graph.addNode(tag);
        return tag;
    });

    for (const bond of topology.bonds)
        graph.addEdge(tags[bond.a], tags[bond.b]);

    return graph;
}
```

**Node labels are element symbols** (`C`, `N`, `O`), not `Node i` and not
`C1..C16`. The canvas draws a label at every node, so per-atom indices turn a
27-atom molecule into a wall of text; the element symbol is the conventional
skeletal-formula reading and keeps the cloud legible. Atom indices, bond orders
and element colours are out of scope (§9).

**The seed**, a module-level pure function beside the factory:

```ts
/**
 * A phyllotaxis (sunflower) spiral for `n` atoms, aimed at the spring rest
 * length, with a small deterministic z offset. `sqrt(i / PI)` gives every atom
 * `spacing^2` of area, so neighbours start about a rest length apart - well
 * outside the repulsion guard and already near the separation the springs want -
 * and the frame is reproducible for a given molecule.
 */
function moleculeSeedPositions(n: number): Point3D[] {
    const spacing = K.molecule.seedSpacing;          // == equilibriumDisplacement
    const golden = Math.PI * (3 - Math.sqrt(5));      // ~2.39996 rad
    const jitter = K.molecule.seedDepthJitter;

    return Array.from({ length: n }, (_, i) => {
        const r = spacing * Math.sqrt(i / Math.PI);
        const theta = i * golden;
        return point3(r * Math.cos(theta), r * Math.sin(theta), jitter * Math.sin(theta));
    });
}
```

The graph is fully connected by construction (the catalog has no disconnected
entries) and the parser rejects duplicate bonds, so `Graph.addEdge()` cannot
create a duplicate or a self-loop here.

### 4.5 `src/K.ts`

| Constant | Change |
| --- | --- |
| `initialConditions.order`, `.branching` | unchanged: they are the wizard's defaults and the first-run placeholder |
| `chooser.minOrder` | **new**: `2` |
| `chooser.maxOrder` | **new**: `64` — repulsion is O(N^2) per 50 ms tick and every node draws a label |
| `chooser.minBranching` | **new**: `1` |
| `chooser.maxBranching` | **new**: `8` — a practical cap; the hard limit is always `order - 1` |
| `molecule.seedSpacing` | **new**: `30`, the spring rest length |
| `molecule.seedDepthJitter` | **new**: `4.5` |
| `wordCloud.minTagScale` / `maxTagScale` | **new**: `0.85` / `1.35` em |

`chooser` and `molecule` are new top-level groups; nothing existing is removed,
so the README's constants table only grows.

### 4.6 `src/GraphWizard.ts` (new)

One modal dialog, built from plain DOM calls and appended to the body element it
is handed (the `ContextMenu` precedent — no `document.body` lookup, so the test
DOM needs no `document.body`).

```ts
export type WizardStep = "choose" | "random" | "molecules";

export interface GraphWizardOptions {
    /** Called once with the chosen spec; the wizard has already closed. */
    onComplete: (spec: GraphSpec) => void;
    /** Called when the user dismisses without choosing. */
    onCancel?: () => void;
    /** False on first run: there is no previous graph to keep. */
    dismissible: boolean;
    /** Returns focus to the canvas, as the context menu does. */
    onDismiss?: () => void;
    catalog?: CatalogEntry[];
    /** Pre-fills the random step with the last random choice. */
    initialSpec?: GraphSpec | null;
}

export class GraphWizard {
    readonly element: HTMLElement;
    readonly choiceButtons: Array<{ kind: "random" | "molecules"; element: HTMLButtonElement }>;
    readonly searchInput: HTMLInputElement;
    readonly orderInput: HTMLInputElement;
    readonly branchingInput: HTMLInputElement;
    readonly generateButton: HTMLButtonElement;
    readonly backButton: HTMLButtonElement;
    readonly cancelButton: HTMLButtonElement;
    readonly tags: Array<{ entry: CatalogEntry; element: HTMLButtonElement }>;
    readonly titleLabel: HTMLElement;
    readonly countLabel: HTMLElement;
    readonly emptyLabel: HTMLElement;
    readonly validationLabel: HTMLElement;

    constructor(body: HTMLElement, options: GraphWizardOptions);

    get step(): WizardStep;
    get isOpen(): boolean;
    open(step?: WizardStep): void;      // appends to the body and shows a step
    close(): void;                      // removes from the body
}
```

**Markup**, three step containers toggled by `style.display`, all styled by
class:

```
div.graphWizard                 [role=dialog, aria-modal=true, aria-labelledby=wizardTitle]
  div.wizardPanel
    div.wizardTitle#wizardTitle
    div.wizardStep[data-step=choose]
      button.wizardChoice[data-choice=random]       "random"
      button.wizardChoice[data-choice=molecules]    "molecules"
    div.wizardStep[data-step=random]
      label + input.wizardInput[type=number]        nodes
      label + input.wizardInput[type=number]        edges per node
      p.wizardValidation
      button.wizardPrimary                          "generate"
    div.wizardStep[data-step=molecules]
      input.wizardInput[type=text]                  search
      div.wizardCount                               "20 of 20"
      div.wizardTags
        button.wizardTag[data-molecule=id]          common name + family caption
      p.wizardEmpty                                 "no molecule matches..."
    div.wizardFooter
      button.wizardBack                             "back"
      button.wizardCancel                           "cancel"  (hidden when !dismissible)
```

Behaviour:

| Interaction | Result |
| --- | --- |
| `random` choice | the `random` step, seeded from `initialSpec` when it was random, else `K.initialConditions` |
| `molecules` choice | the `molecules` step with every tag visible and the search box focused |
| `input` in the search box | tags are re-filtered and re-sorted; the count and the empty state update |
| clicking a tag | `onComplete({ kind: "molecule", id })` immediately, then close |
| `generate` (valid) | `onComplete(parseRandomSpec(...).spec)`, then close |
| `generate` (invalid) | disabled, with the message in `.wizardValidation` |
| `back` | returns to `choose`; nothing is submitted |
| `cancel` / `Escape` | `onCancel()`, then close; ignored entirely when `!dismissible` |
| `Enter` in the search box | completes with the first visible tag, if any |
| `Tab` | trapped inside the dialog: wraps at both ends |
| open / close | the tag list is never rebuilt; `close()` removes the element and calls `onDismiss()` |

Details worth stating because they are the fiddly parts:

- **Filtering never rebuilds the tags.** The tag buttons are created once for the
  whole catalog; the filter sets `style.display` on each. Twenty static buttons
  mean twenty stable listeners and a filter that cannot leak one.
- **Validation is live.** Every `input` on either number field re-runs
  `parseRandomSpec` and writes the result to `generateButton.disabled` and
  `.wizardValidation`. The parse is a pure function, so the tests drive it with
  strings and never need to fake a key event.
- **The focus trap tracks its own index.** Each control registers a `focus`
  listener that records its position (the `ContextMenu` roving-index
  precedent), so the trap never needs `document.activeElement` and the fake DOM
  needs no new global.
- **Escape has one meaning.** It cancels a dismissible wizard and does nothing on
  the mandatory first run; it never steps backwards, so there is no way to
  dismiss the first-run wizard by reflex and land on a graph that was never
  chosen.
- **The word cloud is decoration with a rule.** `tagScale` is applied as
  `element.style.fontSize`; the chip's `title` and `aria-label` carry
  `moleculeTooltip(entry)` — the full systematic name, the family and the
  formula.

### 4.7 `src/UIController.ts` and `src/entrypoint.ts`

```ts
export type GraphSource = (spec: GraphSpec) => Graph;   // was () => Graph

const defaultGraphSource: GraphSource = spec => new GraphFactory().build(spec);
```

The constructor takes one more resolved element, `currentGraphLabel`, and the
class holds two new fields: the last chosen `spec: GraphSpec | null` and the open
`wizard: GraphWizard | null`.

```ts
/** The graph a fresh initialize() shows: the last choice, else the default. */
private initialGraph(): Graph {
    return this.makeGraph(this.spec ?? defaultGraphSpec());
}

initialize = () => {
    this.terminate();                    // now also closes an open wizard
    this.resizeCanvas();
    // ... the existing state resets ...
    this.solverRef = new ForceDirectedGraph(this.initialGraph());
    this.updateCurrentGraphLabel();
    this.buildContextMenu();
    this.toggleEventListeners(true);
    this.timer = setInterval(this.onTimerTick, K.physics.timerTickPeriodMS);
    this.updateSelectionInfo();
};

/**
 * Replace the simulated graph in place. This is the reset path: the timer, the
 * listeners, the context menu and the camera are all left alone, only the graph
 * the solver steps changes.
 */
loadGraph = (graph: Graph) => {
    this.solverRef = new ForceDirectedGraph(graph);
    this.state.b0Down = false;
    this.state.b1Down = false;
    this.state.b2Down = false;
    this.state.lastMiddleDragPos = null;
    this.updateSelectionInfo();
};

private applyGraphSpec = (spec: GraphSpec) => {
    this.spec = spec;
    this.loadGraph(this.makeGraph(spec));
    this.updateCurrentGraphLabel();
    this.closeGraphWizard();
};

openGraphWizard = () => {
    this.closeGraphWizard();
    this.hideContextMenu();
    this.wizard = new GraphWizard(this.body, {
        onComplete: this.applyGraphSpec,
        onCancel: this.closeGraphWizard,
        onDismiss: () => this.canvas.focus(),
        dismissible: this.spec !== null,   // first run: there is no choice to keep
        initialSpec: this.spec,
    });
    this.wizard.open();
};

closeGraphWizard = () => {
    if (this.wizard) {
        this.wizard.close();
        this.wizard = null;
    }
};

onReset = (event?: MouseEvent) => {
    event?.preventDefault();
    this.openGraphWizard();
    return false;
};

private updateCurrentGraphLabel = () => {
    this.currentGraphLabel.innerHTML = specLabel(this.spec ?? defaultGraphSpec());
};
```

The lazy `solver` getter routes through the same `initialGraph()` helper, so a
handler that runs before `initialize()` — and a test that never initializes —
still gets a valid graph instead of a call with no spec.

`terminate()` gains `this.closeGraphWizard();` beside the context-menu removal,
so a wizard cannot outlive the controller.

`entrypoint()` resolves `currentGraphLabel` through the existing `required([...])`
list and calls `uiController.openGraphWizard()` after `initialize()` — the
wizard is a startup step, not a constructor side effect, which keeps every test
that calls `initialize()` for listener or HiDPI reasons wizard-free.

The order in `openGraphWizard()` matters: the context menu is hidden first, so
the two overlays can never be open together, and the wizard is stored before
`open()` so a synchronous completion cannot leave a stale reference.

### 4.8 `web/index.html` and `web/stylez.css`

`index.html` gains exactly one line, inside the existing `.overlayMenu`, under
the title:

```html
<div id="currentGraphLabel" class="graphLabel"></div>
```

so the panel always answers "which graph am I looking at" — the systematic name
for a molecule, the node and edge counts for a random graph. No wizard markup is
added: the wizard is built in TypeScript (D9), which keeps the layout tests
asserting structure that exists rather than duplicating the component.

`stylez.css` gains a `.graphLabel` rule (small, dim, wrapping) and the wizard
block:

| Rule | Intent |
| --- | --- |
| `.graphWizard` | `position: fixed; inset: 0; z-index: 100`, a dim backdrop, centred flex — above the panel (`z-index: 2`) and the menu (`z-index: 10`) |
| `.wizardPanel` | the same palette as `.selectionInfoPanel`: `#22d3ee` border, translucent dark fill, 10px radius, capped width and height |
| `.wizardTitle` | the step heading |
| `.wizardStep` | toggled by `style.display` |
| `.wizardChoice` | the two big first-step buttons |
| `.wizardInput`, `.wizardField` | the number and search fields |
| `.wizardTags` | `display: flex; flex-wrap: wrap; gap` — the cloud |
| `.wizardTag` | a pill, with the dynamic `font-size` applied inline |
| `.wizardTagFamily` | the small dim family caption inside a chip |
| `.wizardFooter`, `.wizardPrimary`, `.wizardBack`, `.wizardCancel` | the action row |
| `.wizardValidation`, `.wizardEmpty`, `.wizardCount` | state text |

The wizard is excluded from the panel drag for free: it is a sibling of the
panel in the body, not a child, so `DragController` never sees it.

## 5. The molecule catalog

One flagship example per structural family, all indole alkaloids. Every row was
verified against the PubChem CID shown; the SMILES in `src/Molecules.ts` are
copied verbatim from that record, and the catalog test asserts that the
heavy-atom count derived from the SMILES equals the non-hydrogen count in the
formula — a transcription error in either field fails CI.

Provenance for every row, so PR 3 is a copy rather than a re-derivation:

```
https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/<name>/property/CanonicalSMILES,MolecularFormula,MolecularWeight,IUPACName,Title/JSON
```

PubChem returns the field alongside `ConnectivitySMILES`; `SMILES` is the
isomeric one and is what the `smiles` field holds (stereochemistry is carried in
the data even though the first cut does not draw it). `Title` is the common name
and `IUPACName` the systematic name; where a name is ambiguous the CID form is
used instead of the name form.

### 5.1 The twenty families

| # | Chip (common name) | Structural family | Parent ring system | Formula | Heavy atoms | CID |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | N,N-Dimethyltryptamine | Simple indole (tryptamine) | indole / tryptamine | C12H16N2 | 14 | [6089](https://pubchem.ncbi.nlm.nih.gov/compound/6089) |
| 2 | Harmine | β-Carboline | pyrido[3,4-b]indole | C13H12N2O | 16 | [5280953](https://pubchem.ncbi.nlm.nih.gov/compound/5280953) |
| 3 | Ergotamine | Ergoline (ergot) | indolo[4,3-fg]quinoline | C33H35N5O5 | 43 | [8223](https://pubchem.ncbi.nlm.nih.gov/compound/8223) |
| 4 | Yohimbine | Corynanthe (yohimbane) | yohimban | C21H26N2O3 | 26 | [8969](https://pubchem.ncbi.nlm.nih.gov/compound/8969) |
| 5 | Ibogaine | Iboga | ibogan | C20H26N2O | 23 | [197060](https://pubchem.ncbi.nlm.nih.gov/compound/197060) |
| 6 | Tabersonine | Aspidosperma | aspidosperman | C21H24N2O2 | 25 | [20485](https://pubchem.ncbi.nlm.nih.gov/compound/20485) |
| 7 | Ajmaline | Ajmaline | ajmalan | C20H26N2O2 | 24 | [6100671](https://pubchem.ncbi.nlm.nih.gov/compound/6100671) |
| 8 | Sarpagine | Sarpagine | sarpagan | C19H22N2O2 | 23 | [12314884](https://pubchem.ncbi.nlm.nih.gov/compound/12314884) |
| 9 | Akuammiline | Akuammiline | akuammilan | C23H26N2O4 | 29 | [16058537](https://pubchem.ncbi.nlm.nih.gov/compound/16058537) |
| 10 | Strychnine | Strychnos | strychnan | C21H22N2O2 | 25 | [441071](https://pubchem.ncbi.nlm.nih.gov/compound/441071) |
| 11 | Camptothecin | Camptotheca (quinoline-fused) | quinoline-fused indole | C20H16N2O4 | 26 | [24360](https://pubchem.ncbi.nlm.nih.gov/compound/24360) |
| 12 | Vincristine | Bisindole (dimeric MIA) | iboga + aspidosperma dimer | C46H56N4O10 | 60 | [5978](https://pubchem.ncbi.nlm.nih.gov/compound/5978) |
| 13 | Reserpine | Rauwolfia | yohimban (reserpate ester) | C33H40N2O9 | 44 | [5770](https://pubchem.ncbi.nlm.nih.gov/compound/5770) |
| 14 | Staurosporine | Carbazole (bis-indole) | indolo[2,3-a]carbazole | C28H26N4O3 | 35 | [44259](https://pubchem.ncbi.nlm.nih.gov/compound/44259) |
| 15 | Rhynchophylline | Oxindole (spiro) | spiro[indole-3,3′-pyrrolidine] | C22H28N2O4 | 28 | [5281408](https://pubchem.ncbi.nlm.nih.gov/compound/5281408) |
| 16 | Physostigmine | Calabar bean (pyrroloindoline) | pyrrolo[2,3-b]indole | C15H21N3O2 | 20 | [5983](https://pubchem.ncbi.nlm.nih.gov/compound/5983) |
| 17 | Vincamine | Eburnane | eburnan | C21H26N2O3 | 26 | [15376](https://pubchem.ncbi.nlm.nih.gov/compound/15376) |
| 18 | Gelsemine | Gelsemium | spiro[indole-3,7′-oxa-azatetracyclo] | C20H22N2O2 | 24 | [5390854](https://pubchem.ncbi.nlm.nih.gov/compound/5390854) |
| 19 | Ellipticine | Pyridocarbazole | pyrido[4,3-b]carbazole | C17H14N2 | 19 | [3213](https://pubchem.ncbi.nlm.nih.gov/compound/3213) |
| 20 | Uleine | Uleine | uleine | C18H22N2 | 20 | [252320](https://pubchem.ncbi.nlm.nih.gov/compound/252320) |

The heavy-atom column is the non-hydrogen count of the formula, and it is the
number the catalog test compares against the parser. The spread is 14
(dimethyltryptamine) to 60 (vincristine) heavy atoms, which is what `tagScale`
normalises over `K.wordCloud`. Vincristine is the one dimer and by far the
largest graph; ergotamine and reserpine are the next largest.

### 5.2 Systematic names and verified SMILES

Copied from the CID in the table above; `SMILES` is PubChem's isomeric form. The
parenthesised key is the entry's `id` — the `GraphSpec` key — and the entries are
in the file's order; `systematicName` holds the `IUPAC` line and `smiles` the
`SMILES` line.

```
(dimethyltryptamine)
  IUPAC  2-(1H-indol-3-yl)-N,N-dimethylethanamine
  SMILES CN(C)CCC1=CNC2=CC=CC=C21

(harmine)
  IUPAC  7-methoxy-1-methyl-9H-pyrido[3,4-b]indole
  SMILES CC1=NC=CC2=C1NC3=C2C=CC(=C3)OC

(ergotamine)
  IUPAC  (6aR,9R)-N-[(1S,2S,4R,7S)-7-benzyl-2-hydroxy-4-methyl-5,8-dioxo-3-oxa-6,9-diazatricyclo[7.3.0.02,6]dodecan-4-yl]-7-methyl-6,6a,8,9-tetrahydro-4H-indolo[4,3-fg]quinoline-9-carboxamide
  SMILES C[C@@]1(C(=O)N2[C@H](C(=O)N3CCC[C@H]3[C@@]2(O1)O)CC4=CC=CC=C4)NC(=O)[C@H]5CN([C@@H]6CC7=CNC8=CC=CC(=C78)C6=C5)C

(yohimbine)
  IUPAC  methyl (1S,15R,18S,19R,20S)-18-hydroxy-1,3,11,12,14,15,16,17,18,19,20,21-dodecahydroyohimban-19-carboxylate
  SMILES COC(=O)[C@H]1[C@H](CC[C@@H]2[C@@H]1C[C@H]3C4=C(CCN3C2)C5=CC=CC=C5N4)O

(ibogaine)
  IUPAC  (1R,15R,17S,18S)-17-ethyl-7-methoxy-3,13-diazapentacyclo[13.3.1.02,10.04,9.013,18]nonadeca-2(10),4(9),5,7-tetraene
  SMILES CC[C@H]1C[C@@H]2C[C@@H]3[C@H]1N(C2)CCC4=C3NC5=C4C=C(C=C5)OC

(tabersonine)
  IUPAC  methyl (1R,12R,19S)-12-ethyl-8,16-diazapentacyclo[10.6.1.01,9.02,7.016,19]nonadeca-2,4,6,9,13-pentaene-10-carboxylate
  SMILES CC[C@]12CC(=C3[C@@]4([C@H]1N(CC4)CC=C2)C5=CC=CC=C5N3)C(=O)OC

(ajmaline)
  IUPAC  (1R,9R,10S,12R,13S,14R,16S,17S,18R)-13-ethyl-8-methyl-8,15-diazahexacyclo[14.2.1.01,9.02,7.010,15.012,17]nonadeca-2,4,6-triene-14,18-diol
  SMILES CC[C@H]1[C@@H]2C[C@H]3[C@H]4[C@@]5(C[C@@H]([C@H]2[C@H]5O)N3[C@@H]1O)C6=CC=CC=C6N4C

(sarpagine)
  IUPAC  (1S,12S,13R,14R,15E)-15-ethylidene-13-(hydroxymethyl)-3,17-diazapentacyclo[12.3.1.02,10.04,9.012,17]octadeca-2(10),4(9),5,7-tetraen-7-ol
  SMILES C/C=C\1/CN2[C@H]3C[C@@H]1[C@H]([C@@H]2CC4=C3NC5=C4C=C(C=C5)O)CO

(akuammiline)
  IUPAC  methyl (1S,10S,12S,13E)-18-(acetyloxymethyl)-13-ethylidene-8,15-diazapentacyclo[10.5.1.01,9.02,7.010,15]octadeca-2,4,6,8-tetraene-18-carboxylate
  SMILES C/C=C\1/CN2CC[C@@]34C5=CC=CC=C5N=C3[C@@H]2C[C@@H]1C4(COC(=O)C)C(=O)OC

(strychnine)
  IUPAC  (4aR,5aS,8aR,13aS,15aS,15bR)-4a,5,5a,7,8,13a,15,15a,15b,16-decahydro-2H-4,6-methanoindolo[3,2,1-ij]oxepino[2,3,4-de]pyrrolo[2,3-h]quinolin-14-one
  SMILES C1CN2CC3=CCO[C@H]4CC(=O)N5[C@H]6[C@H]4[C@H]3C[C@H]2[C@@]61C7=CC=CC=C75

(camptothecin)
  IUPAC  (19S)-19-ethyl-19-hydroxy-17-oxa-3,13-diazapentacyclo[11.8.0.02,11.04,9.015,20]henicosa-1(21),2,4,6,8,10,15(20)-heptaene-14,18-dione
  SMILES CC[C@@]1(C2=C(COC1=O)C(=O)N3CC4=CC5=CC=CC=C5N=C4C3=C2)O

(vincristine)
  IUPAC  methyl (1R,9R,10S,11R,12R,19R)-11-acetyloxy-12-ethyl-4-[(13S,15S,17S)-17-ethyl-17-hydroxy-13-methoxycarbonyl-1,11-diazatetracyclo[13.3.1.04,12.05,10]nonadeca-4(12),5,7,9-tetraen-13-yl]-8-formyl-10-hydroxy-5-methoxy-8,16-diazapentacyclo[10.6.1.01,9.02,7.016,19]nonadeca-2,4,6,13-tetraene-10-carboxylate
  SMILES CC[C@@]1(C[C@@H]2C[C@@](C3=C(CCN(C2)C1)C4=CC=CC=C4N3)(C5=C(C=C6C(=C5)[C@]78CCN9[C@H]7[C@@](C=CC9)([C@H]([C@@]([C@@H]8N6C=O)(C(=O)OC)O)OC(=O)C)CC)OC)C(=O)OC)O

(reserpine)
  IUPAC  methyl (1R,15S,17R,18R,19S,20S)-6,18-dimethoxy-17-(3,4,5-trimethoxybenzoyl)oxy-1,3,11,12,14,15,16,17,18,19,20,21-dodecahydroyohimban-19-carboxylate
  SMILES CO[C@H]1[C@@H](C[C@@H]2CN3CCC4=C([C@H]3C[C@@H]2[C@@H]1C(=O)OC)NC5=C4C=CC(=C5)OC)OC(=O)C6=CC(=C(C(=C6)OC)OC)OC

(staurosporine)
  IUPAC  (2S,3R,4R,6R)-3-methoxy-2-methyl-4-(methylamino)-29-oxa-1,7,17-triazaoctacyclo[12.12.2.12,6.07,28.08,13.015,19.020,27.021,26]nonacosa-8,10,12,14,19,21,23,25,27-nonaen-16-one
  SMILES C[C@@]12[C@@H]([C@@H](C[C@@H](O1)N3C4=CC=CC=C4C5=C6C(=C7C8=CC=CC=C8N2C7=C53)CNC6=O)NC)OC

(rhynchophylline)
  IUPAC  methyl (E)-2-[(3R,6'R,7'S,8'aS)-6'-ethyl-2-oxospiro[1H-indole-3,1'-3,5,6,7,8,8a-hexahydro-2H-indolizine]-7'-yl]-3-methoxyprop-2-enoate
  SMILES CC[C@H]1CN2CC[C@]3([C@@H]2C[C@@H]1/C(=C\OC)/C(=O)OC)C4=CC=CC=C4NC3=O

(physostigmine)
  IUPAC  [(3aR,8bS)-3,4,8b-trimethyl-2,3a-dihydro-1H-pyrrolo[2,3-b]indol-7-yl] N-methylcarbamate
  SMILES C[C@@]12CCN([C@@H]1N(C3=C2C=C(C=C3)OC(=O)NC)C)C

(vincamine)
  IUPAC  methyl (15S,17S,19S)-15-ethyl-17-hydroxy-1,11-diazapentacyclo[9.6.2.02,7.08,18.015,19]nonadeca-2,4,6,8(18)-tetraene-17-carboxylate
  SMILES CC[C@@]12CCCN3[C@@H]1C4=C(CC3)C5=CC=CC=C5N4[C@](C2)(C(=O)OC)O

(gelsemine)
  IUPAC  (1'R,2'S,3S,5'S,6'S,8'R,11'S)-2'-ethenyl-4'-methylspiro[1H-indole-3,7'-9-oxa-4-azatetracyclo[6.3.1.02,6.05,11]dodecane]-2-one
  SMILES CN1C[C@]2([C@@H]3C[C@@H]4[C@]5([C@H]2[C@H]1[C@H]3CO4)C6=CC=CC=C6NC5=O)C=C

(ellipticine)
  IUPAC  5,11-dimethyl-6H-pyrido[4,3-b]carbazole
  SMILES CC1=C2C=CN=CC2=C(C3=C1NC4=CC=CC=C43)C

(uleine)
  IUPAC  16-ethyl-15-methyl-11-methylidene-9,15-diazatetracyclo[10.3.1.02,10.03,8]hexadeca-2(10),3,5,7-tetraene
  SMILES CCC1C2CCN(C1C3=C(C2=C)NC4=CC=CC=C43)C
```

Every string above exercises only the subset in §4.2: bracket stereocentres
(`[C@@]`, `[C@H]`), directional bonds (`/`, `\`), fused and bridged ring
closures, and aromatic-fused ring systems written in the Kekulé form PubChem
emits. None needs a feature the reader does not have, which the catalog test
proves by parsing all twenty.

### 5.3 Candidates considered and dropped

| Candidate | Why it is not a row |
| --- | --- |
| Quinine | A quinoline alkaloid, not an indole alkaloid — the most common misclassification in this area |
| Vinblastine | A second bisindole dimer; vincristine already represents the family (and both are ~60 heavy atoms) |
| Brucine | A second Strychnos alkaloid; strychnine is the flagship |
| Ajmalicine, catharanthine, voacangine, vindoline | Further examples inside the corynanthe, iboga and aspidosperma families already represented |
| Harmaline, harmalol | Further β-carbolines; harmine is the flagship |
| Psilocybin, serotonin, melatonin | Tryptamine derivatives, but usually classed as indoleamines rather than alkaloids; the simple-indole row is dimethyltryptamine |
| Mitragynine | Often called an oxindole, but its published structure is an indole (corynanthe-type); rhynchophylline is the genuine oxindole |
| Spirotryprostatin A, pteropodine | Genuine oxindoles, but far less widely known than rhynchophylline |
| Rescinnamine, deserpidine | Further Rauwolfia esters; reserpine is the flagship |
| Ellipticine analogues (olivacine) | Same pyridocarbazole family as the ellipticine row |


Derived from the table: `heavyAtoms`, `bondCount` and `ringCount` are computed
by the parser, never stored by hand, and the word-cloud scale is normalised over
the `heavyAtoms` column.

## 6. Phased delivery

Four focused PRs. Each leaves `main` green.

### PR 1 — this work-plan

- `docs/workplans/graph-chooser-wizard.md` only.
- **Acceptance:** `npm run ci` green (221 tests, no source change).

### PR 2 — graph specs, the SMILES reader and molecule graphs

Pure modules only; no UI change.

- `src/GraphSpec.ts` (new): the spec type, `defaultGraphSpec`, `parseRandomSpec`.
- `src/Smiles.ts` (new): `parseSmiles` and `SmilesError`.
- `src/GraphFactory.ts`: `build()`, `generateMolecule()`, `moleculeSeedPositions()`.
- `src/K.ts`: the `molecule` group.
- Tests: new `smiles.test.ts`; `graph-generation.test.ts` extended.
- **Acceptance:** `npm run ci` green; no existing test edited; no UI change.

### PR 3 — the molecule catalog

- `src/Molecules.ts` (new): the entries, `CATALOG`, `filterCatalog`,
  `sortCatalog`, `families`, `moleculeTooltip`, `moleculeById`.
- `src/K.ts`: the `wordCloud` group.
- `src/GraphSpec.ts`: `specLabel`'s molecule branch resolves through the catalog.
- Tests: new `molecules.test.ts`.
- **Acceptance:** `npm run ci` green; a test parses every catalog entry and
  compares the derived heavy-atom count with the formula.

### PR 4 — the wizard component

- `src/GraphWizard.ts` (new).
- `web/stylez.css`: the wizard block.
- `test/support/dom.ts`: `value` and `disabled` on `FakeElement`.
- Tests: new `graph-wizard.test.ts`; `layout.test.ts` CSS assertions.
- **Acceptance:** `npm run ci` green; the wizard is not yet reachable from the
  app, so there is no user-visible change beyond the stylesheet.

### PR 5 — wiring: first-run and reset

- `src/UIController.ts`: `GraphSource`, `spec`, `wizard`, `currentGraphLabel`,
  `loadGraph`, `applyGraphSpec`, `openGraphWizard`, `closeGraphWizard`, the new
  `onReset`, `updateCurrentGraphLabel`, `terminate`.
- `src/entrypoint.ts`: resolve `currentGraphLabel`, open the wizard at startup.
- `web/index.html`: the `#currentGraphLabel` line.
- `web/stylez.css`: `.graphLabel`.
- Tests: `entrypoint.test.ts`, `context-menu.test.ts`, `test/support/dom.ts`,
  new `graph-chooser.test.ts`.
- `README.md`: the Layout and Interaction sections, the wizard, the catalog and
  the constants table.
- **Acceptance:** `npm run ci` green with a higher test count; the first run
  opens the wizard, and a completed reset swaps the graph without re-registering
  a single listener.

## 7. Test plan

### New tests

| Area | Assertion |
| --- | --- |
| `Smiles` | `CCO` gives 3 atoms and 2 bonds, in SMILES order |
| `Smiles` | `c1ccccc1` gives 6 aromatic atoms, 6 aromatic bonds, 1 ring closure |
| `Smiles` | a fused bicycle closes two rings and shares the fusion atoms |
| `Smiles` | branches nest and unwind: `CC(C)C`, `C(C)(C)C` |
| `Smiles` | bond symbols `-`, `=`, `#`, `:` are orders 1, 2, 3, 4 |
| `Smiles` | `[nH]`, `[C@@H]`, `[O-]`, `[NH3+]` yield the element and ignore the rest |
| `Smiles` | `%nn` two-digit closures round-trip |
| `Smiles` | `.` splits the graph without adding a bond |
| `Smiles` | an unknown character, an unmatched `)`, an unclosed `(`, a dangling ring digit and a duplicate bond each throw with a position |
| `Smiles` | parsing is pure: two parses of one string are `deepEqual` and share no array |
| `GraphSpec` | `parseRandomSpec` accepts the bounds and rejects blank, decimal, negative, out-of-range and `branching >= order` |
| `GraphSpec` | an error message names the offending field |
| `GraphSpec` | `specLabel` of a molecule spec is the systematic name, not the common name |
| `GraphFactory` | `build({kind:"random"})` matches `generateGraph(order, branching)` |
| `GraphFactory` | `build({kind:"molecule"})` has one vertex per parsed atom and one edge per bond |
| `GraphFactory` | molecule vertices are labelled with element symbols only |
| `GraphFactory` | molecule seeds are unique, deterministic and bounded by the jitter |
| `GraphFactory` | an unknown molecule id throws |
| Catalog | at least 20 entries, unique ids, unique common names, unique families |
| Catalog | every entry parses; heavy atoms, bonds and rings are all positive |
| Catalog | the parsed heavy-atom count equals the non-hydrogen count in the formula |
| Catalog | every systematic name is present, longer than the common name and not equal to it |
| Catalog | every entry has a CID, a formula, a family and a parent system |
| Catalog | `filterCatalog("")` returns everything; whitespace behaves as empty |
| Catalog | filtering is case-insensitive and matches common name, systematic name, parent system, family, formula and synonyms |
| Catalog | multi-term queries are an AND over terms |
| Catalog | a query with no match returns `[]` |
| Catalog | `sortCatalog` is alphabetical by common name and stable on ties |
| Catalog | `tagScale` is monotone in heavy atoms and inside `K.wordCloud` |
| Wizard | `open()` appends the dialog and sets `isOpen`; `close()` removes it |
| Wizard | the first step offers exactly random and molecules |
| Wizard | the random step is pre-filled from `K.initialConditions`, or from the last random spec |
| Wizard | an invalid field disables `generate` and shows the message; a valid one re-enables it |
| Wizard | `generate` calls `onComplete` once with the parsed numbers and closes |
| Wizard | the molecules step shows every tag, sorted, with the count |
| Wizard | typing in the search box filters the tags, updates the count and shows the empty state |
| Wizard | the filter hides tags without removing them or their listeners |
| Wizard | a tag click calls `onComplete({kind:"molecule", id})` once and closes |
| Wizard | `Enter` in the search box completes with the first visible tag |
| Wizard | `back` returns to the first step and submits nothing |
| Wizard | `Escape` cancels a dismissible wizard and is ignored on a mandatory one |
| Wizard | `cancel` is hidden when the wizard is not dismissible |
| Wizard | `Tab` wraps at both ends of the visible controls |
| Wizard | the chip title and aria-label carry the systematic name |
| Wizard | a chip's inline font size is its `tagScale` |
| Wizard | `onComplete` is never called without a choice |
| Chooser | `onReset()` opens the wizard and leaves `solver.graph` identical while it is open |
| Chooser | completing with a random spec replaces the graph, keeps the camera and re-registers nothing |
| Chooser | completing with a molecule spec builds that molecule's graph |
| Chooser | cancelling leaves the graph, the timer, the listener counts and the camera untouched |
| Chooser | the panel's graph line shows the systematic name after a molecule is chosen |
| Chooser | `openGraphWizard()` closes an open context menu |
| Chooser | `terminate()` removes an open wizard |
| Chooser | `initialize()` twice with a chosen spec builds that spec both times |
| Entrypoint | startup opens the wizard and still starts the timer |
| Entrypoint | the wizard is not opened by `initialize()` itself |
| Source guard | `UIController.ts` no longer calls `confirm` |
| Layout | `.graphLabel` exists in the CSS and inside the menu section |
| Layout | the wizard's CSS rules exist and `.graphWizard` sits above the panel |

### Existing tests: expected impact

| Test | Impact |
| --- | --- |
| `graph-generation.test.ts` | extended; the random-generation assertions are untouched |
| `entrypoint.test.ts` | `currentGraphLabel` joins the required-element list; the "live graph" assertion holds via the default placeholder; a new assertion that the wizard is open |
| `context-menu.test.ts` | the two `confirm`-based reset tests are replaced: reset opens the wizard, the graph is unchanged until a choice, and a completion does not rebuild the menu or double-register |
| `layout.test.ts` | the menu section's id list gains `currentGraphLabel`; new CSS assertions |
| `test/support/dom.ts` | `value`/`disabled` on `FakeElement`; `currentGraphLabel` in `demoElements()` |
| `camera.test.ts`, `projector.test.ts`, `pan.test.ts`, `hidpi.test.ts`, `selection.test.ts`, `render.test.ts`, `forces.test.ts`, `solver.test.ts`, `pipeline.test.ts`, `transform.test.ts`, `robustness.test.ts` | untouched: they consume a graph, a projector or the solver, and the default placeholder keeps their fixtures valid |

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A catalog SMILES is transcribed wrong | Every entry carries its PubChem CID; a test parses all of them and compares the derived heavy-atom count with the formula, so a wrong atom count fails CI |
| The parser subset is too small for a real entry | The catalog test parses the whole list; a `SmilesError` names the position, so the fix is local |
| The initial placeholder graph is discarded unused | It is built for the documented default, before first paint, and is O(N^2) at 11 nodes; `initialize()` keeps its contract and no render path needs an empty-graph case |
| The panel line overflows with a long IUPAC name | The label wraps (`overflow-wrap: anywhere`) and is dim; the chip keeps the cloud short |
| The filter is applied by rebuilding the tags | It only toggles `style.display` on twenty static buttons, so no listener can leak and no focus is lost mid-typing |
| A modal swallows focus and never returns it | `close()` calls `onDismiss`, which focuses the canvas — the `ContextMenu` contract; a test asserts `canvas.focused` |
| The wizard and the context menu are open together | `openGraphWizard()` hides the menu first, and `open()` is not reachable while the wizard exists |
| A cancelled reset still disturbs the graph | Cancel paths call only `closeGraphWizard()`; a test asserts the graph object, timer and listener counts are identical across a cancel |
| A molecule graph is too large for the layout | The catalog is capped at ~20 entries including at most one bisindole dimer; the size note travels with the data, and `K.chooser` documents the random-graph cap |
| Escape on first run leaves the app with an unchosen graph | Impossible: the first-run wizard is mandatory, so Escape is a no-op and `cancel` is hidden |
| `confirm()` lingers in the controller | A source guard test asserts `UIController.ts` does not mention it |

## 9. Out of scope

- **Bond-order rendering.** Bond order is parsed and carried in the topology but
  every edge draws as one stroke; double bonds, aromatic rings and dashed bonds
  are a renderer change with its own decisions.
- **Element colours, radii or a legend.** Every node is the same dot.
- **Atom-index labels, atom numbering, or any 2D depiction.** The layout is the
  force simulation, not a chemical structure diagram.
- **Ring perception and aromaticity perception.** The parser records ring
  closures and the aromatic flag from the notation; it does not perceive.
- **SMILES input by the user**, or any editing of the catalog at runtime.
- **Persisting the chosen graph** across reloads, or deep-linking to one.
- **A random seed** for reproducible random graphs; `Math.random` stays.
- **Fuzzy search, ranking or stemming.** The filter is case-insensitive
  substring matching with AND over whitespace-separated terms.
- **Renaming the `reset` link** to "new graph". The id and the label stay; only
  what it opens changes.
- **Touch and pointer gestures inside the wizard**, and drag-to-reposition the
  dialog.
- **Removing the top-level `confirm()` stub** from the test DOM. It stays
  harmless, and the source guard is what pins the behaviour.

## 10. Verification

1. `npm run ci` on every PR; the count rises in PRs 2–5 and no earlier test is
   deleted, only rewritten where its contract changed.
2. `git diff main -- test/` is reviewed per PR: PR 2 edits no existing test at
   all, which is the evidence that the pure layer is additive.
3. Catalog spot-check: open three rows against
   `https://pubchem.ncbi.nlm.nih.gov/compound/<CID>` and compare the SMILES,
   formula and IUPAC name.
4. Run the demo (`BROWSER=... ./cli run`) and exercise: the first-run wizard,
   Escape on first run (no-op), the random path at both bounds and one invalid
   value, the search box (a common name, a systematic-name fragment, a family, a
   formula, a nonsense string), a molecule selection, reset and cancel, a middle
   drag before and after a reset to confirm the camera is kept, and export.
5. Confirm the panel's graph line names the technical molecule after a molecule
   is chosen, and that the chip tooltip carries the full systematic name.
