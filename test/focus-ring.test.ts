import test from "node:test";
import assert from "node:assert/strict";

import { advanceIndex } from "../src/ui/FocusRing";

/**
 * Roving-focus ring shared by the context menu (src/ui/ContextMenu.ts) and the graph wizard
 * (src/ui/GraphWizard.ts).
 */

test("advanceIndex steps within the ring and wraps at both ends", () => {
    assert.equal(advanceIndex(0, 1, 3), 1);
    assert.equal(advanceIndex(2, 1, 3), 0, "forward wraps past the last");
    assert.equal(advanceIndex(0, -1, 3), 2, "backward wraps past the first");
    assert.equal(advanceIndex(1, -1, 3), 0);
});

test("advanceIndex enters an out-of-range index from the end it travels from", () => {
    // "Nothing focused yet": a forward move lands on the first entry...
    assert.equal(advanceIndex(-1, 1, 4), 0);
    assert.equal(advanceIndex(9, 1, 4), 0, "an index past the end is also out of range");

    // ...and a backward move lands on the last, so the first Shift+Tab focuses the final control.
    assert.equal(advanceIndex(-1, -1, 4), 3);
    assert.equal(advanceIndex(9, -1, 4), 3);
});

test("advanceIndex has nothing to focus in an empty ring", () => {
    assert.equal(advanceIndex(0, 1, 0), 0);
    assert.equal(advanceIndex(-3, -1, 0), 0);
});

test("advanceIndex stays in range across a full lap in either direction", () => {
    for (let i = 0; i < 20; i++) {
        const forward = advanceIndex(i % 5, 1, 5);
        assert.ok(forward >= 0 && forward < 5, `forward from ${i % 5} was ${forward}`);

        const backward = advanceIndex(i % 5, -1, 5);
        assert.ok(backward >= 0 && backward < 5, `backward from ${i % 5} was ${backward}`);
    }
});
