import { K } from "../core/K";
import { moleculeById } from "./Molecules";

// A discriminated description of the graph to build: the vocabulary shared by
// the chooser, the controller and the factory.
export type GraphSpec =
    | { kind: "random"; order: number; branching: number }
    | { kind: "molecule"; id: string };

/** The shipped default, from `K.initialConditions`. */
export function defaultGraphSpec(): GraphSpec {
    return {
        kind: "random",
        order: K.initialConditions.order,
        branching: K.initialConditions.branching,
    };
}

export type RandomParams =
    | { ok: true; spec: Extract<GraphSpec, { kind: "random" }> }
    | { ok: false; message: string };

// Digits only, no sign; null when the text is not a whole number.
function wholeNumber(text: string): number | null {
    const trimmed = text.trim();

    if (!/^\d+$/.test(trimmed))
        return null;

    return parseInt(trimmed, 10);
}

/**
 * The two random-graph fields, named once. The chooser captions its inputs with
 * these and the parser names the offending field in its messages, so a rename
 * cannot leave an error referring to a field the user can no longer see.
 */
export const ORDER_FIELD = "nodes";
export const BRANCHING_FIELD = "new edges per node";

/** Validate the raw text of the two random-graph fields, naming the offending field.
 * `branching` is capped at `order - 1` new edges per node: a node cannot start more than
 * that many distinct edges, so a larger value would silently start fewer than asked for. */
export function parseRandomSpec(orderText: string, branchingText: string): RandomParams {

    const order = wholeNumber(orderText);

    if (order === null)
        return { ok: false, message: `${ORDER_FIELD}: enter a whole number` };

    const branching = wholeNumber(branchingText);

    if (branching === null)
        return { ok: false, message: `${BRANCHING_FIELD}: enter a whole number` };

    if (order < K.chooser.minOrder || order > K.chooser.maxOrder) {
        return {
            ok: false,
            message: `${ORDER_FIELD}: must be between ${K.chooser.minOrder} and ${K.chooser.maxOrder}`,
        };
    }

    const maxBranching = Math.min(K.chooser.maxBranching, order - 1);

    if (branching < K.chooser.minBranching || branching > maxBranching) {
        return {
            ok: false,
            message: `${BRANCHING_FIELD}: must be between ${K.chooser.minBranching} and ${maxBranching}`,
        };
    }

    return { ok: true, spec: { kind: "random", order, branching } };
}

/** The panel's one-line description of a spec; molecules use the full
 * systematic name, so the word cloud can stay short. */
export function specLabel(spec: GraphSpec): string {

    if (spec.kind === "random")
        return `random graph: ${spec.order} ${ORDER_FIELD}, up to ${spec.branching} ${BRANCHING_FIELD}`;

    return moleculeById(spec.id).systematicName;
}
