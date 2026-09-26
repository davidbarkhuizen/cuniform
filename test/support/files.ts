/**
 * Read repository files back as text, so the architecture guards that assert on
 * source (`entrypoint`, `pipeline`, `layout`) do not each re-derive the path
 * from `__dirname`.
 *
 * Compiled tests run from `<root>/.test-build/test/support`, hence the three
 * levels up to the repository root.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Read a TypeScript source file from `src/` as text. */
export function readSource(name: string): string {
    return readFileSync(join(__dirname, "..", "..", "..", "src", name), "utf8");
}

/**
 * Every TypeScript source file under `src/`, keyed by file name. The
 * whole-tree architecture guards (no `window` state, no solver globals) need to
 * look at more than the one file they are named after.
 */
export function readAllSources(): Record<string, string> {
    const dir = join(__dirname, "..", "..", "..", "src");
    const out: Record<string, string> = {};

    for (const name of readdirSync(dir)) {
        if (name.endsWith(".ts"))
            out[name] = readFileSync(join(dir, name), "utf8");
    }

    return out;
}

/** Read a hand-maintained static asset from `dist/` as text. */
export function readDist(name: string): string {
    return readFileSync(join(__dirname, "..", "..", "..", "dist", name), "utf8");
}
