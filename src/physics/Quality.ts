import { K, QualitySetting } from "../core/K";

/** The one place the Barnes-Hut opening angle is chosen; returned unclamped (docs/performance.md). */
export function openingAngleFor(nodeCount: number, quality: QualitySetting): number {

    if (quality === "accurate")
        return K.physics.barnesHutTheta;

    if (quality === "fast")
        return K.physics.barnesHutFastTheta;

    return nodeCount >= K.physics.barnesHutFastMinNodes
        ? K.physics.barnesHutFastTheta
        : K.physics.barnesHutTheta;
}
