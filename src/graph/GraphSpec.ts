import { K } from "../core/K";
import { moleculeById } from "./Molecules";

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

function wholeNumber(text: string): number | null {
    const trimmed = text.trim();

    if (!/^\d+$/.test(trimmed))
        return null;

    return parseInt(trimmed, 10);
}

/** The two random-graph field names, shared by the chooser captions and the parser's messages. */
export const ORDER_FIELD = "nodes";
export const BRANCHING_FIELD = "new edges per node";

/** Validate the two random-graph fields, naming the offending field. */
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

/** The panel's one-line description of a spec. */
export function specLabel(spec: GraphSpec): string {

    if (spec.kind === "random")
        return `random graph: ${spec.order} ${ORDER_FIELD}, up to ${spec.branching} ${BRANCHING_FIELD}`;

    return moleculeById(spec.id).systematicName;
}
