// Real format-2 files, read in place from the sibling repositories and never copied into git (workplan
// PR 3). Each is null when its repository is not checked out beside this one, and its tests skip.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Compiled tests run from `<root>/.test-build/test/support`, so the siblings are four levels up.
const CODE = join(__dirname, "..", "..", "..", "..");

export const MODEL_PATHS = {
    tinyshakespeare: "indrajala-ml/data/generation/tinyshakespeare-2layer-rotary-e10-s0.json",
    divisionProbe: "indrajala-studies/data/window-recurrent/division-probe-2b/seed4-certified-step-10.network.json",
    branches: "indrajala-studies/data/window-recurrent/window-branches/b2/move-to-front-5/seed0/step-23.network.json",
};

export type ModelName = keyof typeof MODEL_PATHS;

export function modelJson(name: ModelName): unknown | null {
    const path = join(CODE, MODEL_PATHS[name]);

    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/** The small sequence models of the addition sweep, by directory name; empty when absent. */
export function additionModels(): Array<[string, unknown]> {
    const dir = join(CODE, "indrajala-models", "addition", "2026-10-11-sweep", "models");

    if (!existsSync(dir))
        return [];

    return readdirSync(dir)
        .sort()
        .filter(name => existsSync(join(dir, name, "network.json")))
        .map(name => [name, JSON.parse(readFileSync(join(dir, name, "network.json"), "utf8"))]);
}

/** A test's skip reason when the model is missing, so a clone without the siblings still passes. */
export function skipUnless(json: unknown | null): { skip: string | false } {
    return { skip: json === null ? "the sibling repository holding this model is not checked out" : false };
}
