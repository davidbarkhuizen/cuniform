import assert from "node:assert/strict";

import { CATALOG, CatalogEntry } from "../../src/graph/Molecules";

/** The catalog entry for `id`; fails the test if the catalog lacks it. */
export function catalogEntry(id: string): CatalogEntry {
    const found = CATALOG.find(entry => entry.id === id);

    assert.ok(found, `no catalog entry for ${id}`);

    return found!;
}
