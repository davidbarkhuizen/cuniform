import test from "node:test";
import assert from "node:assert/strict";

import { K } from "../src/core/K";
import { clampOpeningAngle, MAX_OPENING_ANGLE, Octree } from "../src/physics/Octree";
import { assertClose } from "./support/assert";
import { sparseGraph } from "./support/physics";

/** Every body index under a cell, in bucket/child order. */
function bodiesIn(tree: Octree, cell: number): number[] {
    const out: number[] = [];

    const walk = (current: number) => {

        const first = tree.cellFirstChild[current];

        if (first < 0) {
            const start = tree.cellStart[current];

            for (let k = 0; k < tree.cellCount[current]; k++)
                out.push(tree.bodyOrder[start + k]);

            return;
        }

        for (let c = 0; c < tree.cellChildCount[current]; c++)
            walk(first + c);
    };

    walk(cell);

    return out;
}

test("the root covers every body and children partition their parent", () => {
    const graph = sparseGraph(200, 4242);
    const tree = new Octree();

    tree.build(graph.vertices);

    assert.equal(tree.bodies, 200);
    assert.ok(tree.cells >= 1, "a non-empty build must create a root");
    assert.equal(tree.cellCount[0], 200);
    assert.deepEqual(bodiesIn(tree, 0).sort((a, b) => a - b), graph.vertices.map((_, i) => i));

    for (let cell = 0; cell < tree.cells; cell++) {

        const first = tree.cellFirstChild[cell];

        if (first < 0)
            continue;

        const children = tree.cellChildCount[cell];

        assert.ok(children > 0, `internal cell ${cell} must have at least one child`);

        const union: number[] = [];

        for (let c = 0; c < children; c++) {
            const child = first + c;

            // The child cube must sit inside the parent cube.
            const half = tree.cellHalf[child];

            assertClose(
                Math.abs(tree.cellCenterX[child] - tree.cellCenterX[cell]),
                half,
                1e-9,
                `cell ${child} x offset`
            );

            assert.ok(
                Math.abs(tree.cellCenterY[child] - tree.cellCenterY[cell]) <= half * (1 + 1e-12) &&
                Math.abs(tree.cellCenterZ[child] - tree.cellCenterZ[cell]) <= half * (1 + 1e-12),
                `cell ${child} must stay inside its parent`
            );

            union.push(...bodiesIn(tree, child));
        }

        assert.equal(
            union.length,
            tree.cellCount[cell],
            `cell ${cell}: children must partition the parent's bodies`
        );
        assert.equal(
            new Set(union).size,
            union.length,
            `cell ${cell}: a body cannot appear under two children`
        );
    }
});

test("cell aggregates match their contents", () => {
    const graph = sparseGraph(300, 99);
    const tree = new Octree();

    tree.build(graph.vertices);

    for (let cell = 0; cell < tree.cells; cell++) {

        const bodies = bodiesIn(tree, cell);

        assert.equal(tree.cellMass[cell], bodies.length, `cell ${cell}: mass is the charge total`);

        let mx = 0;
        let my = 0;
        let mz = 0;

        for (const body of bodies) {
            mx += graph.vertices[body].position.x;
            my += graph.vertices[body].position.y;
            mz += graph.vertices[body].position.z;
        }

        assertClose(tree.cellCenterOfMassX[cell], mx / bodies.length, 1e-9, `cell ${cell} com x`);
        assertClose(tree.cellCenterOfMassY[cell], my / bodies.length, 1e-9, `cell ${cell} com y`);
        assertClose(tree.cellCenterOfMassZ[cell], mz / bodies.length, 1e-9, `cell ${cell} com z`);
    }
});

test("coincident bodies terminate at the depth cap in a single bucket", () => {
    const graph = sparseGraph(4, 7);
    const coincident = graph.vertices.map(tag => {
        tag.position.x = 5;
        tag.position.y = -3;
        tag.position.z = 0;
        return tag;
    });

    const tree = new Octree();
    const maxDepth = 12;

    tree.build(coincident, 0.5, maxDepth);

    assert.equal(tree.bodies, 4);
    assert.equal(tree.cellMass[0], 4, "the root still holds every body");
    assert.ok(
        tree.cells <= maxDepth + 1,
        `a coincident chain must stop at the depth cap, got ${tree.cells} cells`
    );

    // The deepest cell is a bucket holding all four, so traversal does exact
    // pairwise work there rather than subdividing forever.
    assert.equal(tree.cellFirstChild[tree.cells - 1], -1);
    assert.equal(tree.cellCount[tree.cells - 1], 4);
});

test("an empty body set builds an empty tree and adds no force", () => {
    const tree = new Octree();

    tree.build([]);

    assert.equal(tree.bodies, 0);
    assert.equal(tree.cells, 0);

    const out = new Float64Array(0);
    tree.accumulateForce(out, out, out);
});

test("rebuilding at the same size reuses the pooled buffers", () => {
    const vertices = sparseGraph(300, 7).vertices;
    const tree = new Octree();

    tree.build(vertices);

    const bodies = tree.bodyX;
    const cells = tree.cellMass;

    tree.build(vertices);

    assert.equal(tree.bodyX, bodies, "the body buffer must be pooled across builds");
    assert.equal(tree.cellMass, cells, "the cell buffers must be pooled across builds");
    assert.equal(tree.cellMass[0], 300);
});

test("the opening angle is clamped to the documented ceiling", () => {
    assertClose(MAX_OPENING_ANGLE, 2 / Math.sqrt(3), 1e-12, "the ceiling is 2/sqrt(3)");
    assert.equal(clampOpeningAngle(K.physics.barnesHutTheta), K.physics.barnesHutTheta);
    assert.equal(clampOpeningAngle(-1), 0, "a negative angle means exact");
    assert.equal(clampOpeningAngle(Number.NaN), 0, "a non-finite angle means exact");
    assert.equal(clampOpeningAngle(100), MAX_OPENING_ANGLE, "an oversized angle is capped");
});
