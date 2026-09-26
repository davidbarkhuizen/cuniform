/**
 * Read repository files back as text, so the architecture guards that assert on
 * source (`entrypoint`, `pipeline`, `layout`) do not each re-derive the path
 * from `__dirname`.
 *
 * Compiled tests run from `<root>/.test-build/test/support`, hence the three
 * levels up to the repository root.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Read a TypeScript source file from `src/` as text. */
export function readSource(name: string): string {
    return readFileSync(join(__dirname, "..", "..", "..", "src", name), "utf8");
}

/** Read a hand-maintained static asset from `dist/` as text. */
export function readDist(name: string): string {
    return readFileSync(join(__dirname, "..", "..", "..", "dist", name), "utf8");
}
