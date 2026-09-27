import { K, QualitySetting } from "../core/K";

/**
 * The one place the Barnes-Hut opening angle is chosen (docs/performance.md).
 *
 * A larger angle means fewer accepted aggregates and more error, so the policy
 * is size-gated: the eye cannot see the approximation on a large layout, and the
 * step no longer fits one tick there anyway. The value is returned unclamped;
 * `Octree.build()` clamps it, so the ceiling keeps one home.
 */
export function openingAngleFor(nodeCount: number, quality: QualitySetting): number {

    if (quality === "accurate")
        return K.physics.barnesHutTheta;

    if (quality === "fast")
        return K.physics.barnesHutFastTheta;

    // "auto": accurate exactly where the eye can tell, fast where it cannot.
    return nodeCount >= K.physics.barnesHutFastMinNodes
        ? K.physics.barnesHutFastTheta
        : K.physics.barnesHutTheta;
}
