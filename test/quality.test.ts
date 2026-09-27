import test from "node:test";
import assert from "node:assert/strict";

import { K } from "../src/core/K";
import { clampOpeningAngle, MAX_OPENING_ANGLE } from "../src/physics/Octree";
import { openingAngleFor } from "../src/physics/Quality";

const FAST = K.physics.barnesHutFastMinNodes;

test("auto uses the accurate angle below the fast threshold", () => {
    assert.equal(openingAngleFor(0, "auto"), K.physics.barnesHutTheta);
    assert.equal(openingAngleFor(FAST - 1, "auto"), K.physics.barnesHutTheta);
});

test("auto switches to the fast angle at the threshold and above", () => {
    assert.equal(openingAngleFor(FAST, "auto"), K.physics.barnesHutFastTheta);
    assert.equal(openingAngleFor(FAST * 4, "auto"), K.physics.barnesHutFastTheta);
});

test("accurate and fast override the graph size", () => {
    assert.equal(openingAngleFor(FAST * 4, "accurate"), K.physics.barnesHutTheta);
    assert.equal(openingAngleFor(0, "fast"), K.physics.barnesHutFastTheta);
});

test("the fast angle survives the octree's clamp", () => {
    // openingAngleFor() returns unclamped so Octree owns the ceiling; the fast
    // angle itself must sit under it and pass through unchanged.
    assert.ok(K.physics.barnesHutFastTheta <= MAX_OPENING_ANGLE, "the fast angle exceeds the ceiling");
    assert.equal(clampOpeningAngle(K.physics.barnesHutFastTheta), K.physics.barnesHutFastTheta);
});
