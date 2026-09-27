import test from "node:test";
import assert from "node:assert/strict";

import { componentAnchorMagnitude } from "../src/physics/Kernel";
import { ForceDirectedGraph } from "../src/physics/ForceDirectedGraph";
import { Graph } from "../src/graph/Graph";
import { K } from "../src/core/K";
import { Tag } from "../src/graph/Tag";
import { assertClose } from "./support/assert";
import {
    ANALYTIC_EQUILIBRIUM,
    CANVAS_H,
    CANVAS_W,
    disconnectedPaths,
    edgeBetween,
    maxAbsPosition,
    pairAt,
    stepsUntilQuiet,
} from "./support/physics";

/**
 * The per-component anchor is a uniform force on a component's centroid, so it
 * can only translate that component. These tests pin the law, the translation,
 * the uniformity, and the reference agreement, and they pin the two properties
 * the design exists for: a detached component is bounded, and a connected
 * layout is untouched.
 */

const R0 = K.physics.componentAnchorRadius;
const STRENGTH = K.physics.componentAnchorStrength;

/**
 * The anchor vector the law prescribes for a component centroid `c`, with the
 * solver's explicit zero-radius branch: at the origin the magnitude is zero and
 * there is no direction to divide by.
 */
function expectedAnchor(cx: number, cy: number, cz: number): { x: number; y: number; z: number } {
    const r = Math.hypot(cx, cy, cz);

    if (r === 0)
        return { x: 0, y: 0, z: 0 };

    const magnitude = componentAnchorMagnitude(r);

    return { x: (magnitude * -cx) / r, y: (magnitude * -cy) / r, z: (magnitude * -cz) / r };
}

/**
 * `labelComponents`-independent reading of a fixture's component centroids.
 * `componentOf` is a label per vertex, so the number of components is one past
 * its largest label, not its length.
 */
function componentCentroids(graph: Graph, componentOf: number[]): Array<{ x: number; y: number; z: number; count: number }> {
    const components = componentOf.reduce((most, c) => Math.max(most, c), -1) + 1;
    const centres = Array.from({ length: components }, () => ({ x: 0, y: 0, z: 0, count: 0 }));

    graph.vertices.forEach((tag, i) => {
        const centre = centres[componentOf[i]];

        centre.x += tag.position.x;
        centre.y += tag.position.y;
        centre.z += tag.position.z;
        centre.count++;
    });

    for (const centre of centres) {
        centre.x /= centre.count;
        centre.y /= centre.count;
        centre.z /= centre.count;
    }

    return centres;
}

test("the anchor magnitude is the dead-zoned linear law", () => {
    assert.equal(R0, 150, "the default dead zone is a quarter of the model cube");
    assert.equal(STRENGTH, 0.1, "the default restoring pull");

    assert.equal(componentAnchorMagnitude(0), 0, "the origin is a root");
    assert.equal(componentAnchorMagnitude(R0), 0, "the dead zone edge is a root");

    // Strictly inside the dead zone nothing is felt.
    for (const r of [0, 1, 75, R0 - 1]) {
        assert.equal(componentAnchorMagnitude(r), 0, `r=${r} is inside the dead zone`);
    }

    // Beyond it the line is proportional, with no clamp and no constant term.
    for (const r of [R0 + 1, 300, 1000]) {
        assertClose(componentAnchorMagnitude(r), STRENGTH * (r - R0), 1e-12, `r=${r}`);
    }

    assertClose(
        componentAnchorMagnitude(R0 + 100) - componentAnchorMagnitude(R0 + 50),
        STRENGTH * 50,
        1e-12,
        "the pull per unit beyond the dead zone is constant"
    );

    // A zero dead zone is still a root at the origin, so R0 is free to retune.
    assert.equal(componentAnchorMagnitude(0), 0, "any dead zone keeps the origin a root");
});

test("a lone node past the dead zone is pulled toward the origin and settles", () => {
    const graph = new Graph();
    const lone = new Tag({ x: 1000, y: 0, z: 0 }, "lone");
    graph.addNode(lone);

    const fdg = new ForceDirectedGraph(graph);

    // Larger than any velocity a single step can build, so an outward move is
    // unambiguous evidence of a wrong sign.
    const start = lone.position.x;
    let previous = lone.position.x;

    fdg.step(CANVAS_W, CANVAS_H);

    assert.ok(lone.position.x < previous, `the pull must be inward, went ${previous} -> ${lone.position.x}`);

    const expected = expectedAnchor(1000, 0, 0);

    assertClose(lone.position.x - previous, expected.x * K.physics.timeStep, 1e-9, "the first step is the law");

    // A constant-magnitude force would limit-cycle; this one must come to rest.
    const settled = stepsUntilQuiet(fdg);

    assert.ok(
        settled.travel < K.physics.settleEpsilon,
        `a lone node must settle, final travel ${settled.travel}`
    );
    assert.ok(
        Math.abs(lone.position.x) <= R0 * 1.1,
        `it must settle around the dead zone, at ${lone.position.x}`
    );
    assert.ok(
        lone.position.x < start,
        "it must have moved toward the origin, never away"
    );
});

test("every member of a component receives the same anchor vector", () => {
    const { graph, tags, componentOf, fdg } = disconnectedPaths(1000, 6, 2);

    const out = new Float64Array(3);
    const first: Array<{ x: number; y: number; z: number } | null> = [null, null];

    assert.deepEqual([...new Set(componentOf)], [0, 1], "the fixture must have two components");
    assert.ok(
        Math.abs(componentCentroids(graph, componentOf)[0].x) > R0,
        "the fixture must activate the anchor"
    );

    tags.forEach((tag, i) => {
        fdg.anchorForceInto(tag, out);

        const c = componentOf[i];

        if (first[c] === null) {
            first[c] = { x: out[0], y: out[1], z: out[2] };
            assert.ok(Math.hypot(out[0], out[1], out[2]) > 0, `component ${c} must be active`);
            return;
        }

        // Identical components, not merely equal magnitudes: the force is a
        // function of the component centroid, so uniformity is exact.
        assert.deepEqual(
            { x: out[0], y: out[1], z: out[2] },
            first[c],
            `${tag.label} has a different anchor vector from its component`
        );
    });
});

test("anchorForceInto matches the anchor law at the component centroid", () => {
    const out = new Float64Array(3);

    // Active and inactive alike: a lone path at +400 has an active anchor, one
    // at the origin has none, and each must match the law at its own centroid.
    for (const offset of [0, 400]) {
        const { graph, tags, componentOf, fdg } = disconnectedPaths(0, 6, 1, { x: offset, y: 0, z: 0 });

        const centres = componentCentroids(graph, componentOf);
        const centre = centres[0];

        tags.forEach(tag => {
            fdg.anchorForceInto(tag, out);

            const law = expectedAnchor(centre.x, centre.y, centre.z);

            assertClose(out[0], law.x, 1e-12, `${tag.label} x at offset ${offset}`);
            assertClose(out[1], law.y, 1e-12, `${tag.label} y at offset ${offset}`);
            assertClose(out[2], law.z, 1e-12, `${tag.label} z at offset ${offset}`);
        });
    }
});

test("a component outside the dead zone is translated, not distorted", () => {
    // Two congruent lone 6-node paths. The control is centred on the origin, so
    // its anchor is zero; the subject is centred at (400, 600), outside the dead
    // zone. Congruent interiors mean an identical unanchored displacement
    // pattern, so after subtracting the anchor's uniform translation the two
    // displacement fields must agree: the anchor moved the subject, and nothing
    // else about it.
    const home = disconnectedPaths(0, 6, 1);
    const away = disconnectedPaths(0, 6, 1, { x: 400, y: 600, z: 0 });

    const before = (fixture: ReturnType<typeof disconnectedPaths>) =>
        fixture.tags.map(tag => ({ x: tag.position.x, y: tag.position.y, z: tag.position.z }));

    const homeBefore = before(home);
    const awayBefore = before(away);

    const homeCentre = componentCentroids(home.graph, home.componentOf)[0];
    const awayCentre = componentCentroids(away.graph, away.componentOf)[0];

    assert.ok(Math.hypot(homeCentre.x, homeCentre.y, homeCentre.z) < R0, "the control must be inside the dead zone");
    assert.ok(Math.hypot(awayCentre.x, awayCentre.y, awayCentre.z) > R0, "the subject must be outside it");

    const law = expectedAnchor(awayCentre.x, awayCentre.y, awayCentre.z);
    const translation = { x: law.x * K.physics.timeStep, y: law.y * K.physics.timeStep, z: law.z * K.physics.timeStep };

    home.fdg.step(CANVAS_W, CANVAS_H);
    away.fdg.step(CANVAS_W, CANVAS_H);

    const homeMoved = componentCentroids(home.graph, home.componentOf)[0];
    const awayMoved = componentCentroids(away.graph, away.componentOf)[0];

    // The anchored path's centroid translates by exactly the law's vector times
    // the step, over and above whatever its own internal forces do.
    assertClose(awayMoved.x, awayCentre.x + translation.x, 1e-9, "translation x");
    assertClose(awayMoved.y, awayCentre.y + translation.y, 1e-9, "translation y");
    assertClose(awayMoved.z, awayCentre.z + translation.z, 1e-9, "translation z");

    // The control's centroid does not move at all: a lone path's internal forces
    // cancel exactly in the centroid.
    assert.equal(homeMoved.x, homeCentre.x, "the control centroid must not move");
    assert.equal(homeMoved.y, homeCentre.y, "the control centroid must not move");
    assert.equal(homeMoved.z, homeCentre.z, "the control centroid must not move");

    // Subtract the anchor's uniform translation from each subject displacement.
    // What is left is the displacement the component would have had unanchored,
    // and it must equal the control's, node for node: the anchor is a
    // translation, so it can change only the centroid.
    home.tags.forEach((tag, i) => {
        const control = {
            x: tag.position.x - homeBefore[i].x,
            y: tag.position.y - homeBefore[i].y,
            z: tag.position.z - homeBefore[i].z,
        };

        const subject = away.tags[i];
        const residual = {
            x: subject.position.x - awayBefore[i].x - translation.x,
            y: subject.position.y - awayBefore[i].y - translation.y,
            z: subject.position.z - awayBefore[i].z - translation.z,
        };

        assertClose(residual.x, control.x, 1e-9, `${tag.label} residual x`);
        assertClose(residual.y, control.y, 1e-9, `${tag.label} residual y`);
        assertClose(residual.z, control.z, 1e-9, `${tag.label} residual z`);
    });

    // Stated as geometry: the shape the anchored component took is the control's
    // shape, to the last decimal the internal forces can distinguish.
    const shape = (fixture: ReturnType<typeof disconnectedPaths>, centre: { x: number; y: number; z: number }) =>
        fixture.tags.map(tag => ({
            x: tag.position.x - centre.x,
            y: tag.position.y - centre.y,
            z: tag.position.z - centre.z,
        }));

    const homeShape = shape(home, homeMoved);
    const awayShape = shape(away, awayMoved);

    homeShape.forEach((point, i) => {
        assertClose(awayShape[i].x, point.x, 1e-9, `${home.tags[i].label} shape x`);
        assertClose(awayShape[i].y, point.y, 1e-9, `${home.tags[i].label} shape y`);
        assertClose(awayShape[i].z, point.z, 1e-9, `${home.tags[i].label} shape z`);
    });
});

test("an off-centre seated edge is pulled toward the origin with r* unchanged", () => {
    // A symmetric single edge at the origin is untouched; the same edge seeded
    // off-centre starts outside the dead zone and is translated home. Both
    // settle at the analytic equilibrium, because the anchor is uniform.
    const centred = edgeBetween({ x: -100, y: 0, z: 0 }, { x: 100, y: 0, z: 0 });
    const offset = edgeBetween({ x: 400, y: 600, z: 0 }, { x: 400, y: 600, z: 0 });

    for (let i = 0; i < 4000; i++) {
        centred.fdg.step(CANVAS_W, CANVAS_H);
        offset.fdg.step(CANVAS_W, CANVAS_H);
    }

    const separation = (a: Tag, b: Tag) =>
        Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y, b.position.z - a.position.z);

    assertClose(separation(centred.a, centred.b), ANALYTIC_EQUILIBRIUM, 1.0, "the centred edge moved");
    assertClose(separation(offset.a, offset.b), ANALYTIC_EQUILIBRIUM, 1.0, "the off-centre edge moved");

    // The anchor translates the off-centre edge until its centroid is home.
    const cx = (offset.a.position.x + offset.b.position.x) / 2;
    const cy = (offset.a.position.y + offset.b.position.y) / 2;
    const cz = (offset.a.position.z + offset.b.position.z) / 2;

    assert.ok(Math.hypot(cx, cy, cz) <= R0 * 1.1, `the offset centroid must come home, at (${cx}, ${cy}, ${cz})`);

    // And the centred one never moved its centroid at all.
    const centredCx = (centred.a.position.x + centred.b.position.x) / 2;
    const centredCy = (centred.a.position.y + centred.b.position.y) / 2;

    assertClose(centredCx, 0, 1e-9, "a centred component must stay centred");
    assertClose(centredCy, 0, 1e-9, "a centred component must stay centred");
});

test("two detached components stay bounded and stop drifting", () => {
    // The fixture the workplan measured: two 6-node components seeded at
    // x = +/-250 separate to ~2005 units in 10 000 steps with nothing
    // centripetal. The anchor has to hold them.
    const { graph, fdg } = disconnectedPaths(500, 6, 2);

    const reach = maxAbsPosition(fdg, graph, 4000);

    assert.ok(reach < 1000, `the components reached ${reach} units from the origin`);

    // ...and the layout is quiet, not merely slow: after the run, a step moves
    // less than the settle epsilon.
    let previous = graph.vertices.map(tag => ({ ...tag.position }));

    fdg.step(CANVAS_W, CANVAS_H);

    const travel = Math.max(...graph.vertices.map((tag, i) =>
        Math.hypot(
            tag.position.x - previous[i].x,
            tag.position.y - previous[i].y,
            tag.position.z - previous[i].z
        )
    ));

    assert.ok(travel < K.physics.settleEpsilon, `4000 steps must leave the layout quiet, travel ${travel}`);

    // Bounded, not collapsed: the two components are still apart and each is
    // still a path, since only translation is available to the anchor.
    previous = graph.vertices.map(tag => ({ ...tag.position }));

    const first = graph.vertices[0].position;
    const far = previous[previous.length - 1];

    assert.ok(Math.hypot(far.x - first.x, far.y - first.y, far.z - first.z) > 100, "the components must not collapse");
});

test("the anchor is zero for every component whose centroid is inside the dead zone", () => {
    const { graph, tags, componentOf, fdg } = disconnectedPaths(200, 6, 2);

    // Just inside: 200-unit spacing puts a centroid at 100, inside the 150 dead
    // zone. The anchored step must equal the unanchored sum of the two
    // reference kernels, exactly.
    const out = new Float64Array(3);

    for (const tag of tags) {
        fdg.anchorForceInto(tag, out);

        // Exactly zero, not merely small; -0 is a zero here too.
        assert.ok(out[0] === 0, `${tag.label} x must be exactly zero, got ${out[0]}`);
        assert.ok(out[1] === 0, `${tag.label} y must be exactly zero, got ${out[1]}`);
        assert.ok(out[2] === 0, `${tag.label} z must be exactly zero, got ${out[2]}`);

        const e = fdg.netElectrostaticForceAtNode(tag);
        const s = fdg.netSpringForceAtNode(tag);
        const net = fdg.netForceAtNode(tag);

        assert.deepEqual(net, { x: e.x + s.x, y: e.y + s.y, z: e.z + s.z }, `${tag.label} net force`);
    }

    const centroids = componentCentroids(graph, componentOf);

    assert.ok(
        centroids.every(centre => Math.hypot(centre.x, centre.y, centre.z) < R0),
        "this fixture must have every centroid inside the dead zone"
    );

    // The fixtures the exact-valued assertions elsewhere depend on must all be
    // inside the zone too, so the anchor pass is skipped for every one of them.
    // `pairAt(300)` is the closest of the current suite: its centroid sits
    // exactly on the dead zone, and the activation test is strict (`r > R0`), so
    // it stays inactive. Retuning R0 below 150 would engage it.
    const close = pairAt(300);
    const centroid = {
        x: (close.a.position.x + close.b.position.x) / 2,
        y: (close.a.position.y + close.b.position.y) / 2,
        z: (close.a.position.z + close.b.position.z) / 2,
    };

    assert.equal(Math.hypot(centroid.x, centroid.y, centroid.z), R0, "pairAt(300) sits on the dead zone edge");
    assert.equal(componentAnchorMagnitude(R0), 0, "on the edge it must be inactive");

    // And a fixture well inside the zone reports an anchor of exactly zero.
    const inside = pairAt(100);
    const inner = new Float64Array(3);

    inside.fdg.anchorForceInto(inside.a, inner);

    assert.ok(inner[0] === 0 && inner[1] === 0 && inner[2] === 0, `expected exactly zero, got ${inner[0]},${inner[1]},${inner[2]}`);
});

test("an active anchor still evaluates repulsion exactly once per unordered pair", () => {
    // The anchor uses no Math.pow and does not disturb the pairwise kernel, so
    // the pair counter stays exactly C(N, 2) even with the anchor active and the
    // component far outside the dead zone.
    const { graph, fdg } = disconnectedPaths(1000, 6, 2);
    const n = graph.vertices.length;

    const realPow = Math.pow;
    let calls = 0;

    Math.pow = (base: number, exponent: number) => {
        calls++;
        return realPow(base, exponent);
    };

    try {
        fdg.step(CANVAS_W, CANVAS_H);
    } finally {
        Math.pow = realPow;
    }

    assert.equal(calls, (n * (n - 1)) / 2, `expected one evaluation per unordered pair, got ${calls}`);
});

test("netForceAtNode is repulsion + spring + anchor, and the step agrees", () => {
    const { tags, fdg } = disconnectedPaths(1000, 6, 2);

    for (const tag of tags) {
        const e = fdg.netElectrostaticForceAtNode(tag);
        const s = fdg.netSpringForceAtNode(tag);
        const anchor = new Float64Array(3);

        fdg.anchorForceInto(tag, anchor);

        assert.deepEqual(
            fdg.netForceAtNode(tag),
            { x: e.x + s.x + anchor[0], y: e.y + s.y + anchor[1], z: e.z + s.z + anchor[2] },
            `${tag.label}: net force is the three-term sum`
        );
    }

    // The step path applies exactly what velocityAtTag()'s default force says.
    const first = tags[0];
    const expected = fdg.velocityAtTag(first);

    fdg.step(CANVAS_W, CANVAS_H);

    assertClose(first.velocity.x, expected.x, 1e-12, "step velocity x");
    assertClose(first.velocity.y, expected.y, 1e-12, "step velocity y");
    assertClose(first.velocity.z, expected.z, 1e-12, "step velocity z");
});

test("the step path's velocity agrees with velocityAtTag on an active anchor", () => {
    // The three-term sum's order can move the last bit when the pairwise forces
    // are large, so this fixture makes them large: two components whose members
    // nearly coincide, with the clamped repulsion dominating. The step must
    // apply exactly what velocityAtTag()'s default force prescribes (the D4
    // contract), and the assertion is `assert.equal`, so any reordering of the
    // sum fails here rather than hiding inside a tolerance.
    const { tags, fdg } = disconnectedPaths(1000, 6, 2);

    // Pull each component's members almost onto one another, so repulsion is at
    // the clamp and the springs are compressed hard.
    tags.forEach((tag, i) => {
        tag.position.x += (i % 2 === 0 ? 1 : -1) * 1e-4;
        tag.position.z += (i % 3 === 0 ? 1 : -1) * 1e-4;
    });

    const expected = tags.map(tag => fdg.velocityAtTag(tag));

    fdg.step(CANVAS_W, CANVAS_H);

    tags.forEach((tag, i) => {
        assert.equal(tag.velocity.x, expected[i].x, `${tag.label} vx`);
        assert.equal(tag.velocity.y, expected[i].y, `${tag.label} vy`);
        assert.equal(tag.velocity.z, expected[i].z, `${tag.label} vz`);
    });
});

test("a pinned drag pulls the rest of its own component toward the origin", () => {
    // Pinning skips integration for the dragged node only, so the rest of its
    // component still feels the anchor, computed from a centroid the dragged
    // node moved. The pull is toward the origin, never toward the pointer.
    const { graph, tags, componentOf, fdg } = disconnectedPaths(600, 6, 2);

    const pinned = tags[0];

    pinned.position.x = 2000;
    pinned.position.y = 2000;
    pinned.position.z = 0;

    const centre = componentCentroids(graph, componentOf)[0];
    const dragged = expectedAnchor(centre.x, centre.y, centre.z);

    // The component's centroid is far outside the dead zone, so the anchor is
    // active and points back at the origin.
    assert.ok(dragged.x < 0 && dragged.y < 0, `the anchor must oppose the drag, got (${dragged.x}, ${dragged.y})`);

    // Every member of the dragged component, the pinned one included, gets the
    // same vector from the law.
    const out = new Float64Array(3);

    tags.forEach((tag, i) => {
        fdg.anchorForceInto(tag, out);

        if (componentOf[i] !== 0)
            return;

        assertClose(out[0], dragged.x, 1e-12, `${tag.label} anchor x`);
        assertClose(out[1], dragged.y, 1e-12, `${tag.label} anchor y`);
        assertClose(out[2], dragged.z, 1e-12, `${tag.label} anchor z`);
    });

    // A step with the drag pinned must not move the pinned node...
    const before = { ...pinned.position };
    const neighbour = { ...tags[1].position };

    fdg.step(CANVAS_W, CANVAS_H, tag => tag === pinned);

    assert.deepEqual({ x: pinned.position.x, y: pinned.position.y, z: pinned.position.z }, before, "the pinned node must hold");
    assert.notDeepEqual(
        { x: tags[1].position.x, y: tags[1].position.y, z: tags[1].position.z },
        { x: neighbour.x, y: neighbour.y, z: neighbour.z },
        "the rest must still react"
    );
});

test("a foreign tag feels no anchor rather than becoming NaN", () => {
    // The pairwise references already return zero for a tag that is not in this
    // graph; the anchor must not be the one reference that turns the whole net
    // force into NaN.
    const { fdg } = disconnectedPaths(1000, 6, 2);

    const out = new Float64Array(3);

    fdg.anchorForceInto(new Tag({ x: 9000, y: 9000, z: 9000 }, "foreign"), out);

    assert.ok(out[0] === 0 && out[1] === 0 && out[2] === 0, `a foreign tag must feel no anchor, got ${out[0]},${out[1]},${out[2]}`);
});

test("the anchor is exactly zero for a lone node at the origin", () => {
    const graph = new Graph();
    const lone = new Tag({ x: 0, y: 0, z: 0 }, "lone");
    graph.addNode(lone);

    const fdg = new ForceDirectedGraph(graph);

    const out = new Float64Array(3);

    fdg.anchorForceInto(lone, out);

    assert.ok(out[0] === 0 && out[1] === 0 && out[2] === 0, `the origin is the root, got ${out[0]},${out[1]},${out[2]}`);
    assert.deepEqual(fdg.netForceAtNode(lone), { x: 0, y: 0, z: 0 }, "a lone node at rest feels nothing");
});
