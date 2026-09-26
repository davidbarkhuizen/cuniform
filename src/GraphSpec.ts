import { K } from "./K";

/**
 * The one vocabulary shared by the graph chooser, the controller and the
 * factory: a discriminated description of the graph to build.
 *
 * It is a value object, not a builder: the wizard produces one, the controller
 * remembers the last one, and the factory turns one into a `Graph`.
 */
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

/** The result of reading the two random-graph text fields. */
export type RandomParams =
    | { ok: true; spec: Extract<GraphSpec, { kind: "random" }> }
    | { ok: false; message: string };

/** A whole number as typed into one of the two fields: digits only, no sign. */
function wholeNumber(text: string): number | null {
    const trimmed = text.trim();

    if (!/^\d+$/.test(trimmed))
        return null;

    return parseInt(trimmed, 10);
}

/**
 * Validate the raw text of the two random-graph fields.
 *
 * The inputs are text boxes, so the parse and the range check are one pure
 * function the wizard calls on every keystroke and the tests can drive without
 * a DOM. The returned message always names the offending field.
 *
 * `branching` is additionally bounded by `order - 1`: a graph on n nodes has at
 * most n - 1 distinct neighbours per node, so a larger value would silently
 * produce fewer edges than asked for. `K.chooser.maxBranching` is the practical
 * cap on top of that.
 */
export function parseRandomSpec(orderText: string, branchingText: string): RandomParams {

    const order = wholeNumber(orderText);

    if (order === null)
        return { ok: false, message: "nodes: enter a whole number" };

    const branching = wholeNumber(branchingText);

    if (branching === null)
        return { ok: false, message: "edges per node: enter a whole number" };

    if (order < K.chooser.minOrder || order > K.chooser.maxOrder) {
        return {
            ok: false,
            message: `nodes: must be between ${K.chooser.minOrder} and ${K.chooser.maxOrder}`,
        };
    }

    const maxBranching = Math.min(K.chooser.maxBranching, order - 1);

    if (branching < K.chooser.minBranching || branching > maxBranching) {
        return {
            ok: false,
            message: `edges per node: must be between ${K.chooser.minBranching} and ${maxBranching}`,
        };
    }

    return { ok: true, spec: { kind: "random", order, branching } };
}
