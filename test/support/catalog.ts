import assert from "node:assert/strict";

import { CATALOG, CatalogEntry } from "../../src/Molecules";

/**
 * The catalog entry for `id`, failing the test with a clear message when the
 * catalog has been renamed out from under it.
 *
 * Every suite that needs a known molecule used to inline the same
 * `CATALOG.find(...)` plus a non-null assertion; this is the one home for the
 * lookup and the "it must exist" check together.
 */
export function catalogEntry(id: string): CatalogEntry {
    const found = CATALOG.find(entry => entry.id === id);

    assert.ok(found, `no catalog entry for ${id}`);

    return found!;
}
