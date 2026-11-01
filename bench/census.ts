// Reads every format-2 file under the given directories (default: the sibling repos the workplan's census
// covered) and reports what parses, by implementation and shape, and every refusal. `npm run census`.
//
// A file is a candidate when it is JSON whose first bytes declare format 2; refusals the reader means to
// make (pure Python, ensembles) are counted apart from failures.

import { closeSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { Format2Error, readFormat2 } from "../src/network/Format2";

const DEFAULT_ROOTS = ["../indrajala-models", "../indrajala-studies/data", "../indrajala-ml/data"];
const DELIBERATE = /pure-Python|ensemble/;

function* jsonFiles(dir: string): Generator<string> {
    let entries;

    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(dir, entry.name);

        if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules")
            yield* jsonFiles(path);
        else if (entry.isFile() && entry.name.endsWith(".json"))
            yield path;
    }
}

function declaresFormat2(path: string): boolean {
    const head = Buffer.alloc(256);
    const fd = openSync(path, "r");

    try {
        const read = readSync(fd, head, 0, head.length, 0);
        return /"format"\s*:\s*2\b/.test(head.subarray(0, read).toString("utf8"));
    } finally {
        closeSync(fd);
    }
}

const roots = (process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_ROOTS).map(root => resolve(root));
const counts = new Map<string, number>();
const deliberate = new Map<string, number>();
const failures: string[] = [];
let total = 0;
const started = Date.now();

for (const root of roots) {
    for (const path of jsonFiles(root)) {
        if (!declaresFormat2(path))
            continue;

        total++;

        try {
            const model = readFormat2(JSON.parse(readFileSync(path, "utf8")));
            const key = `${model.implementation} ${model.shape}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            if (error instanceof Format2Error && DELIBERATE.test(message))
                deliberate.set(message, (deliberate.get(message) ?? 0) + 1);
            else
                failures.push(`${path}: ${message}`);
        }

        if (total % 2000 === 0)
            console.error(`... ${total} files`);
    }
}

console.log(`census of ${roots.join(", ")}`);
console.log(`${total} format-2 files in ${((Date.now() - started) / 1000).toFixed(1)} s`);

for (const [key, n] of [...counts].sort())
    console.log(`  parsed   ${String(n).padStart(6)}  ${key}`);

for (const [message, n] of deliberate)
    console.log(`  refused  ${String(n).padStart(6)}  ${message}`);

console.log(`  failed   ${String(failures.length).padStart(6)}`);

for (const failure of failures.slice(0, 50))
    console.log(`    ${failure}`);

process.exitCode = failures.length === 0 ? 0 : 1;
