import { K } from "../core/K";
import { randomSeed, SEED_LIMIT } from "../core/Random";
import { moleculeById } from "./Molecules";

export type GraphSpec =
    // `seed` makes the graph reproducible; a spec without one is given a fresh seed by withSeed().
    | { kind: "random"; order: number; branching: number; seed?: number }
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
export const SEED_FIELD = "seed";

/** Validate the random-graph fields, naming the offending field; a blank seed means "draw one". */
export function parseRandomSpec(orderText: string, branchingText: string, seedText: string = ""): RandomParams {

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

    if (seedText.trim() === "")
        return { ok: true, spec: { kind: "random", order, branching } };

    const seed = wholeNumber(seedText);

    if (seed === null || seed >= SEED_LIMIT)
        return { ok: false, message: `${SEED_FIELD}: enter a whole number below ${SEED_LIMIT}, or leave it blank` };

    return { ok: true, spec: { kind: "random", order, branching, seed } };
}

/** The spec with a seed recorded, so the graph it builds can be rebuilt; molecules are already deterministic. */
export function withSeed(spec: GraphSpec): GraphSpec {
    if (spec.kind !== "random" || spec.seed !== undefined)
        return spec;

    return { ...spec, seed: randomSeed() };
}

/** The panel's one-line description of a spec. */
export function specLabel(spec: GraphSpec): string {

    if (spec.kind === "random")
        return `random graph: ${spec.order} ${ORDER_FIELD}, up to ${spec.branching} ${BRANCHING_FIELD}`
            + (spec.seed === undefined ? "" : `, ${SEED_FIELD} ${spec.seed}`);

    return moleculeById(spec.id).systematicName;
}
