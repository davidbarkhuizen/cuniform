// Compiled tests run from `<root>/.test-build/test/support`, hence the three levels up to the root.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export function readAllSources(): Record<string, string> {
    const dir = join(__dirname, "..", "..", "..", "src");
    const out: Record<string, string> = {};

    for (const path of sourceFilesIn(dir))
        out[relative(dir, path).split(sep).join("/")] = readFileSync(path, "utf8");

    return out;
}

// Sorted depth-first so `readAllSources()` keys are stable; the drawing test compares that list.
function sourceFilesIn(dir: string): string[] {
    const out: string[] = [];

    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(dir, entry.name);

        if (entry.isDirectory())
            out.push(...sourceFilesIn(path));
        else if (entry.name.endsWith(".ts"))
            out.push(path);
    }

    return out;
}

export function readWeb(name: string): string {
    return readFileSync(join(__dirname, "..", "..", "..", "web", name), "utf8");
}
