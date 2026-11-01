import { Activation, BAND_FAMILY, BAND_STRIDE, EdgeKind, GraphAttributes, Mark, NodeKind, nodeFamily } from "../graph/Attributes";
import { BAND_SCREEN_DEPTH, BAND_SCREEN_STRIDE } from "../view/Projection";
import { otherEndpoint } from "../graph/Edge";
import { doublingCapacity } from "../core/Growth";
import { Emphasis } from "../core/Emphasis";
import { Graph } from "../graph/Graph";
import { K } from "../core/K";
import { clamp } from "../core/Numeric";
import { CameraView, isDepthCulled } from "../view/Projector";
import { RenderSurface } from "./RenderSurface";
import { Tag } from "../graph/Tag";

// Node dot and selection-ring radii, in CSS pixels.
const NODE_RADIUS = 5;
const SELECTION_RADIUS = 10;

// Set per stroke: an `edges` frame leaves `lineWidth` at the edge width.
const NODE_RING_WIDTH = 1;

// The full depth-fade range; the batched paths split it into buckets.
const DEPTH_ALPHA_SPAN = K.depthCue.maxAlpha - K.depthCue.minAlpha;

const CIRCLE_START_ANGLE = 0;
const CIRCLE_END_ANGLE = 2 * Math.PI;
const CIRCLE_CLOCKWISE = true;

// Draw-item kinds, in insertion order: edges first, as the sort tie-break expects. Bands rank below both in
// either emphasis (workplan D11).
const EDGE_ITEM = 0;
const NODE_ITEM = 1;
const BAND_ITEM = 2;

function colourFor(active: boolean, highlight: string, base: string): string {
    return active ? highlight : base;
}

function circlePath(context: RenderSurface, x: number, y: number, radius: number): void {
    context.beginPath();
    context.arc(x, y, radius, CIRCLE_START_ANGLE, CIRCLE_END_ANGLE, CIRCLE_CLOCKWISE);
}

// maxAlpha near, minAlpha far; a flat scene draws at full opacity.
function alphaAt(depth: number, minDepth: number, maxDepth: number, hasRange: boolean): number {
    if (!hasRange)
        return K.depthCue.maxAlpha;

    const t = (depth - minDepth) / (maxDepth - minDepth);
    return K.depthCue.maxAlpha + (K.depthCue.minAlpha - K.depthCue.maxAlpha) * t;
}

// Clamped so a retuned preset cannot push an alpha outside [0, 1].
function scaledAlpha(base: number, scale: number): number {
    return clamp(base * scale, 0, 1);
}

// Whichever class draws first ends up underneath, so the other lands on top.
function rank(kind: number, emphasis: Emphasis): number {
    if (kind === BAND_ITEM)
        return -1;

    if (emphasis === Emphasis.nodes)
        return kind;

    return 1 - kind;
}

function radiusAt(depth: number, focalLength: number): number {
    const raw = (NODE_RADIUS * focalLength) / depth;
    return clamp(raw, K.depthCue.minNodeRadiusPx, K.depthCue.maxNodeRadiusPx);
}

function ringRadiusFor(radius: number): number {
    return (SELECTION_RADIUS * radius) / NODE_RADIUS;
}

// Reused across frames, so a steady-state draw allocates nothing.

let itemKind = new Uint8Array(0);
let itemIndex = new Int32Array(0);
let itemDepth = new Float64Array(0);
let batchOrder = new Int32Array(0);
let batchGroup = new Int32Array(0);
let groupCount = new Int32Array(0);
let groupStart = new Int32Array(0);
let groupWrite = new Int32Array(0);

// A plain array, reused: a typed-array subarray view would allocate per frame.
const itemOrder: number[] = [];

function ensureItemCapacity(n: number): void {
    if (n <= itemKind.length)
        return;

    const capacity = doublingCapacity(itemKind.length, n);

    itemKind = new Uint8Array(capacity);
    itemIndex = new Int32Array(capacity);
    itemDepth = new Float64Array(capacity);
}

function ensureBatchCapacity(n: number): void {
    if (n <= batchOrder.length)
        return;

    const capacity = doublingCapacity(batchOrder.length, n);

    batchOrder = new Int32Array(capacity);
    batchGroup = new Int32Array(capacity);
}

function ensureGroupCapacity(n: number): void {
    if (n <= groupCount.length)
        return;

    const capacity = doublingCapacity(groupCount.length, n);

    groupCount = new Int32Array(capacity);
    groupStart = new Int32Array(capacity);
    groupWrite = new Int32Array(capacity);
}

/**
 * `camera` must be the one that produced each node's cached depth; `selected` is
 * the caller's cached selection, not a scan. See docs/model-camera-and-rendering.md.
 */
export function render(
    context: RenderSurface,
    graph: Graph,
    camera: CameraView,
    selected: Tag | null,
    emphasis: Emphasis
): void {

    // Cleared in device space, independent of the caller's devicePixelRatio transform.
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.restore();

    const { nearPlane, focalLength } = camera;

    const vertices = graph.vertices;
    const edges = graph.edges;

    // A banded graph's projection caches; null for a plain graph, which draws exactly as before.
    const attributes = graph.attributes;
    const bandScreen = attributes === null ? null : graph.bandScreen;
    const controls = attributes === null ? null : graph.edgeControls;
    const bandCount = bandScreen === null ? 0 : bandScreen.length / BAND_SCREEN_STRIDE;

    ensureItemCapacity(vertices.length + edges.length + bandCount);

    let itemCount = 0;
    let edgeCount = 0;
    let nodeCount = 0;

    let minDepth = Infinity;
    let maxDepth = -Infinity;

    for (let j = 0; j < edges.length; j++) {

        const edge = edges[j];

        // No near-plane clipping: an edge is skipped if either endpoint is culled.
        if (isDepthCulled(edge.v1.depth, nearPlane) || isDepthCulled(edge.v2.depth, nearPlane))
            continue;

        // An edge sorts at its endpoints' mean depth, so it can interleave with them.
        const depth = (edge.v1.depth + edge.v2.depth) / 2;

        itemKind[itemCount] = EDGE_ITEM;
        itemIndex[itemCount] = j;
        itemDepth[itemCount] = depth;
        itemCount++;
        edgeCount++;

        if (depth < minDepth) minDepth = depth;
        if (depth > maxDepth) maxDepth = depth;
    }

    for (let i = 0; i < vertices.length; i++) {

        const node = vertices[i];

        if (isDepthCulled(node.depth, nearPlane))
            continue;

        itemKind[itemCount] = NODE_ITEM;
        itemIndex[itemCount] = i;
        itemDepth[itemCount] = node.depth;
        itemCount++;
        nodeCount++;

        if (node.depth < minDepth) minDepth = node.depth;
        if (node.depth > maxDepth) maxDepth = node.depth;
    }

    for (let b = 0; b < bandCount; b++) {

        const depth = bandScreen![b * BAND_SCREEN_STRIDE + BAND_SCREEN_DEPTH];

        if (Number.isNaN(depth))
            continue;

        itemKind[itemCount] = BAND_ITEM;
        itemIndex[itemCount] = b;
        itemDepth[itemCount] = depth;
        itemCount++;
    }

    // The range spans everything actually drawn; a flat scene draws at full opacity.
    const hasRange = nodeCount > 0 && maxDepth > minDepth;

    // Resolved once per frame into locals, not a config object per draw (invariant 8).
    const preset = K.renderer.emphasis[emphasis];
    const edgeAlphaScale = preset.edgeAlphaScale;
    const nodeAlphaScale = preset.nodeAlphaScale;

    // An explicit `if` rather than one `||` chain: chained, items of different
    // ranks fall through to the depth term, which is non-transitive.
    itemOrder.length = 0;

    for (let k = 0; k < itemCount; k++)
        itemOrder.push(k);

    itemOrder.sort((a, b) => {

        const byRank = rank(itemKind[a], emphasis) - rank(itemKind[b], emphasis);

        if (byRank !== 0)
            return byRank;

        return (itemDepth[b] - itemDepth[a]) || (a - b);
    });

    context.font = K.label.fontFamily;

    // Off below the threshold, so a small-graph frame is byte-for-byte unchanged.
    const coarse =
        K.renderer.performance.batchNodeFills &&
        vertices.length >= K.renderer.performance.minNodes;

    // A coarse frame always batches edges: its per-item edge pass is skipped.
    const batchEdges = coarse || edges.length >= K.renderer.batchEdgesMinEdges;
    const labelAll = vertices.length < K.renderer.labelMaxNodes;

    const buckets = coarse
        ? K.renderer.performance.edgeAlphaBuckets
        : K.renderer.edgeAlphaBuckets;

    // Bands rank lowest in both emphases, so they lead the sorted order: drawn first, beneath every path.
    if (attributes !== null)
        for (let k = 0; k < itemCount && itemKind[itemOrder[k]] === BAND_ITEM; k++)
            drawBand(context, bandScreen!, attributes, itemIndex[itemOrder[k]]);

    // The batched pass is a call the emphasis places, not a fixed prefix.
    if (coarse) {

        if (preset.edgesOnTop) {

            drawBatchedNodeFills(
                context,
                attributes,
                vertices,
                itemKind,
                itemIndex,
                itemDepth,
                itemOrder,
                itemCount,
                focalLength,
                hasRange,
                nodeAlphaScale,
                selected
            );

            drawBatchedEdges(context, edges, controls, itemIndex, itemDepth, edgeCount, minDepth, maxDepth, hasRange, selected, buckets, edgeAlphaScale, preset.edgeWidthPx);

            // Once, after the mesh, so the selected label is not buried by it; drawn before the mesh too it
            // would composite twice and brighten.
            drawCoarseNodeWork(context, graph, focalLength, nearPlane, minDepth, maxDepth, hasRange, selected);

            return;
        }

        if (batchEdges)
            drawBatchedEdges(context, edges, controls, itemIndex, itemDepth, edgeCount, minDepth, maxDepth, hasRange, selected, buckets, edgeAlphaScale, preset.edgeWidthPx);

        drawBatchedNodeFills(
            context,
            attributes,
            vertices,
            itemKind,
            itemIndex,
            itemDepth,
            itemOrder,
            itemCount,
            focalLength,
            hasRange,
            nodeAlphaScale,
            selected
        );

        drawCoarseNodeWork(context, graph, focalLength, nearPlane, minDepth, maxDepth, hasRange, selected);

        return;
    }

    if (batchEdges && !preset.edgesOnTop)
        drawBatchedEdges(context, edges, controls, itemIndex, itemDepth, edgeCount, minDepth, maxDepth, hasRange, selected, buckets, edgeAlphaScale, preset.edgeWidthPx);

    for (let k = 0; k < itemCount; k++) {

        const item = itemOrder[k];

        if (itemKind[item] === BAND_ITEM)
            continue;

        if (itemKind[item] === EDGE_ITEM) {

            if (batchEdges)
                continue;

            if (attributes !== null)
                drawNetworkEdge(context, edges, attributes, controls!, itemIndex[item], itemDepth[item], minDepth, maxDepth, hasRange, selected, edgeAlphaScale, preset.edgeWidthPx);
            else
                drawEdge(context, edges[itemIndex[item]], itemDepth[item], minDepth, maxDepth, hasRange, selected, edgeAlphaScale, preset.edgeWidthPx);
        }
        else if (attributes !== null) {
            drawNetworkNode(
                context,
                attributes,
                vertices[itemIndex[item]],
                itemIndex[item],
                itemDepth[item],
                focalLength,
                minDepth,
                maxDepth,
                hasRange,
                graph,
                selected,
                labelAll,
                nodeAlphaScale
            );
        }
        else {
            drawNode(
                context,
                vertices[itemIndex[item]],
                itemDepth[item],
                focalLength,
                minDepth,
                maxDepth,
                hasRange,
                graph,
                selected,
                labelAll,
                nodeAlphaScale
            );
        }
    }

    if (batchEdges && preset.edgesOnTop)
        drawBatchedEdges(context, edges, controls, itemIndex, itemDepth, edgeCount, minDepth, maxDepth, hasRange, selected, buckets, edgeAlphaScale, preset.edgeWidthPx);
}

// Shared leaf marks, so a size-gated path cannot drift from the per-item one.

function edgeSegment(context: RenderSurface, edge: { v1: Tag; v2: Tag }): void {
    context.moveTo(edge.v1.translatedPosition.x, edge.v1.translatedPosition.y);
    context.lineTo(edge.v2.translatedPosition.x, edge.v2.translatedPosition.y);
}

function edgeIncidentTo(edge: { v1: Tag; v2: Tag }, tag: Tag | null): boolean {
    return tag !== null && (tag === edge.v1 || tag === edge.v2);
}

/** The selection ring, scaled to the node's depth-cued radius. */
function strokeSelectionRing(context: RenderSurface, x: number, y: number, radius: number): void {
    circlePath(context, x, y, ringRadiusFor(radius));
    context.strokeStyle = K.colours.nodeSelected;
    context.lineWidth = NODE_RING_WIDTH;
    context.stroke();
}

/** The label at the full depth ramp the fill's alpha scale never dims. */
function drawNodeLabel(
    context: RenderSurface,
    node: Tag,
    depth: number,
    minDepth: number,
    maxDepth: number,
    hasRange: boolean
): void {

    context.globalAlpha = alphaAt(depth, minDepth, maxDepth, hasRange);
    context.fillStyle = K.colours.label;
    context.fillText(
        node.label,
        node.translatedPosition.x + K.label.horizontalSpacing,
        node.translatedPosition.y - K.label.verticalSpacing
    );
}

function drawEdge(
    context: RenderSurface,
    edge: { v1: Tag; v2: Tag },
    depth: number,
    minDepth: number,
    maxDepth: number,
    hasRange: boolean,
    selected: Tag | null,
    alphaScale: number,
    width: number
): void {

    context.globalAlpha = scaledAlpha(alphaAt(depth, minDepth, maxDepth, hasRange), alphaScale);
    context.strokeStyle = colourFor(
        edgeIncidentTo(edge, selected),
        K.colours.edgeIncident,
        K.colours.edgeDefault
    );
    context.lineWidth = width;

    context.beginPath();
    edgeSegment(context, edge);
    context.stroke();
}

function drawNode(
    context: RenderSurface,
    node: Tag,
    depth: number,
    focalLength: number,
    minDepth: number,
    maxDepth: number,
    hasRange: boolean,
    graph: Graph,
    selected: Tag | null,
    labelAll: boolean,
    alphaScale: number
): void {

    const x = node.translatedPosition.x;
    const y = node.translatedPosition.y;
    const radius = radiusAt(depth, focalLength);

    // The scale applies to the fill only: a label at 0.19 alpha is unreadable.
    context.globalAlpha = scaledAlpha(alphaAt(depth, minDepth, maxDepth, hasRange), alphaScale);

    // `selected` is the renderer's only selection input; a worker mirror's tags carry no `isSelected`.
    const isSelected = node === selected;

    context.fillStyle = colourFor(isSelected, K.colours.nodeSelected, K.colours.nodeDefault);

    circlePath(context, x, y, radius);
    context.fill();

    if (isSelected)
        strokeSelectionRing(context, x, y, radius);

    // With many nodes only the selection and its neighbours are labelled.
    const labelled =
        labelAll ||
        node === selected ||
        (selected !== null && graph.hasEdge(selected, node));

    if (labelled)
        drawNodeLabel(context, node, depth, minDepth, maxDepth, hasRange);
}

/** One path and one stroke per (style x alpha bucket) group, not per edge. */
function drawBatchedEdges(
    context: RenderSurface,
    edges: Array<{ v1: Tag; v2: Tag }>,
    controls: Float64Array | null,
    itemIndex: Int32Array,
    itemDepth: Float64Array,
    edgeCount: number,
    minDepth: number,
    maxDepth: number,
    hasRange: boolean,
    selected: Tag | null,
    configuredBuckets: number,
    alphaScale: number,
    width: number
): void {

    const buckets = Math.max(1, Math.floor(configuredBuckets));
    const groups = 2 * buckets;
    const span = DEPTH_ALPHA_SPAN;

    ensureGroupCapacity(groups);
    ensureBatchCapacity(edgeCount);

    for (let g = 0; g < groups; g++)
        groupCount[g] = 0;

    for (let k = 0; k < edgeCount; k++) {

        const bucket = alphaBucket(itemDepth[k], minDepth, maxDepth, hasRange, buckets, span);
        const group = (edgeIncidentTo(edges[itemIndex[k]], selected) ? buckets : 0) + bucket;

        batchGroup[k] = group;
        groupCount[group]++;
    }

    let offset = 0;

    for (let g = 0; g < groups; g++) {
        groupStart[g] = offset;
        groupWrite[g] = offset;
        offset += groupCount[g];
    }

    for (let k = 0; k < edgeCount; k++)
        batchOrder[groupWrite[batchGroup[k]]++] = itemIndex[k];

    for (let g = 0; g < groups; g++) {

        const count = groupCount[g];

        if (count === 0)
            continue;

        const incident = g >= buckets;
        const bucket = g - (incident ? buckets : 0);

        context.globalAlpha = scaledAlpha(bucketAlpha(bucket, buckets, hasRange, span), alphaScale);
        context.strokeStyle = colourFor(incident, K.colours.edgeIncident, K.colours.edgeDefault);
        context.lineWidth = width;

        context.beginPath();

        for (let t = groupStart[g]; t < groupStart[g] + count; t++) {
            if (controls === null)
                edgeSegment(context, edges[batchOrder[t]]);
            else
                networkEdgeSegment(context, edges[batchOrder[t]], controls, batchOrder[t]);
        }

        context.stroke();
    }
}

/**
 * Coarse: one path per node colour; overlapping same-colour nodes union rather
 * than composite, a size-gated divergence.
 */
function drawBatchedNodeFills(
    context: RenderSurface,
    attributes: GraphAttributes | null,
    vertices: Array<Tag>,
    itemKind: Uint8Array,
    itemIndex: Int32Array,
    itemDepth: Float64Array,
    itemOrder: number[],
    itemCount: number,
    focalLength: number,
    hasRange: boolean,
    alphaScale: number,
    selected: Tag | null
): void {

    // Collapsed to one bucket: the ramp midpoint, as a 1-bucket edge batch draws.
    const span = DEPTH_ALPHA_SPAN;
    const alpha = scaledAlpha(bucketAlpha(0, 1, hasRange, span), alphaScale);

    if (attributes !== null) {
        drawBatchedNetworkFills(context, attributes, vertices, itemKind, itemIndex, itemDepth, itemOrder, itemCount, focalLength, alpha, selected);
        return;
    }

    for (let pass = 0; pass < 2; pass++) {

        const wantSelected = pass === 1;

        context.globalAlpha = alpha;
        context.fillStyle = colourFor(wantSelected, K.colours.nodeSelected, K.colours.nodeDefault);
        context.beginPath();

        let any = false;

        for (let k = 0; k < itemCount; k++) {

            const item = itemOrder[k];

            if (itemKind[item] !== NODE_ITEM)
                continue;

            const node = vertices[itemIndex[item]];

            if ((node === selected) !== wantSelected)
                continue;

            context.arc(
                node.translatedPosition.x,
                node.translatedPosition.y,
                radiusAt(itemDepth[item], focalLength),
                CIRCLE_START_ANGLE,
                CIRCLE_END_ANGLE,
                CIRCLE_CLOCKWISE
            );

            any = true;
        }

        if (any)
            context.fill();
    }
}

/**
 * Coarse: the ring and the labels only, bounded by `degree(selected) + 1` rather
 * than by N.
 */
function drawCoarseNodeWork(
    context: RenderSurface,
    graph: Graph,
    focalLength: number,
    nearPlane: number,
    minDepth: number,
    maxDepth: number,
    hasRange: boolean,
    selected: Tag | null
): void {

    if (selected === null)
        return;

    drawCoarseNode(context, selected, true, focalLength, nearPlane, minDepth, maxDepth, hasRange);

    for (const edge of graph.incidentEdges(selected)) {

        const neighbour = otherEndpoint(edge, selected);

        if (neighbour !== null)
            drawCoarseNode(context, neighbour, false, focalLength, nearPlane, minDepth, maxDepth, hasRange);
    }
}

function drawCoarseNode(
    context: RenderSurface,
    node: Tag,
    ring: boolean,
    focalLength: number,
    nearPlane: number,
    minDepth: number,
    maxDepth: number,
    hasRange: boolean
): void {

    // The batched fill already skipped culled nodes; the ring and label must too.
    if (isDepthCulled(node.depth, nearPlane))
        return;

    context.globalAlpha = alphaAt(node.depth, minDepth, maxDepth, hasRange);

    if (ring && K.renderer.performance.selectionRing) {
        strokeSelectionRing(
            context,
            node.translatedPosition.x,
            node.translatedPosition.y,
            radiusAt(node.depth, focalLength)
        );
    }

    drawNodeLabel(context, node, node.depth, minDepth, maxDepth, hasRange);
}

/** Quantized bucket for a depth's fade alpha: 0 is nearest, buckets-1 farthest. */
function alphaBucket(
    depth: number,
    minDepth: number,
    maxDepth: number,
    hasRange: boolean,
    buckets: number,
    span: number
): number {

    if (!hasRange || span <= 0)
        return 0;

    const alpha = alphaAt(depth, minDepth, maxDepth, hasRange);
    const farness = (K.depthCue.maxAlpha - alpha) / span;

    return clamp(Math.floor(farness * buckets), 0, buckets - 1);
}

/** The alpha a whole bucket draws at: the midpoint of its slice of the ramp. */
function bucketAlpha(bucket: number, buckets: number, hasRange: boolean, span: number): number {
    if (!hasRange || span <= 0)
        return K.depthCue.maxAlpha;

    return K.depthCue.maxAlpha - span * ((bucket + 0.5) / buckets);
}

// ------------------------------------------------------------------ networks --
// The visual grammar of a banded graph (workplan D8, D11): colour encodes the family, the glyph the kind,
// and marks the variant. Every function below draws only when the graph has attributes.

// A component glyph is larger than a plain node's dot, so its marks read; a unit is a plain dot's size.
const GLYPH_SCALE = 1.5;
const BAND_FILL_ALPHA = 0.06;
const BAND_STROKE_ALPHA = 0.22;
const HOLLOW_WIDTH = 1.5;
const DROPOUT_DASH = [2, 2];
const DOTTED_EDGE_DASH = [4, 3];
const NO_DASH: number[] = [];

const ACTIVATION_MARKS: Record<number, string> = {
    [Activation.sigmoid]: "σ",
    [Activation.relu]: "r",
    [Activation.linear]: "l",
    [Activation.softmax]: "s",
    [Activation.gelu]: "g",
};

function familyColour(kind: number): string {
    return K.colours.family[nodeFamily(kind)];
}

function glyphRadius(kind: number, depth: number, focalLength: number): number {
    return radiusAt(depth, focalLength) * (kind === NodeKind.unit ? 1 : GLYPH_SCALE);
}

/** A closed polygon of `sides` around (x, y), its first vertex at `start` radians. */
function polygonPath(context: RenderSurface, x: number, y: number, r: number, sides: number, start: number): void {
    for (let k = 0; k < sides; k++) {
        const angle = start + (2 * Math.PI * k) / sides;
        const px = x + r * Math.cos(angle);
        const py = y + r * Math.sin(angle);

        if (k === 0)
            context.moveTo(px, py);
        else
            context.lineTo(px, py);
    }

    context.lineTo(x + r * Math.cos(start), y + r * Math.sin(start));
}

function rectPath(context: RenderSurface, x: number, y: number, halfWidth: number, halfHeight: number): void {
    context.moveTo(x - halfWidth, y - halfHeight);
    context.lineTo(x + halfWidth, y - halfHeight);
    context.lineTo(x + halfWidth, y + halfHeight);
    context.lineTo(x - halfWidth, y + halfHeight);
    context.lineTo(x - halfWidth, y - halfHeight);
}

/**
 * Adds the kind's glyph outline to the current path, without beginning or filling it, so one path can hold
 * many glyphs (the coarse batch). Canvas y grows downwards.
 */
function glyphPath(context: RenderSurface, kind: number, x: number, y: number, r: number): void {
    switch (kind) {
        case NodeKind.embedding:
        case NodeKind.position:
        case NodeKind.patches:
        case NodeKind.initialState:
            rectPath(context, x, y, r * 0.85, r * 0.85);
            return;
        case NodeKind.stateInput:
            // Inverted: the point is at the bottom.
            polygonPath(context, x, y, r, 3, Math.PI / 2);
            return;
        case NodeKind.layerNorm:
        case NodeKind.batchNorm:
        case NodeKind.tokenMean:
            rectPath(context, x, y, r * 1.4, r * 0.35);
            return;
        case NodeKind.head:
        case NodeKind.pooling:
            polygonPath(context, x, y, r, 6, 0);
            return;
        case NodeKind.conv:
        case NodeKind.pool:
        case NodeKind.cell:
            // A rounded square, drawn as a chamfered one: the surface has no arcTo.
            polygonPath(context, x, y, r, 8, Math.PI / 8);
            return;
        case NodeKind.codes: {
            const dot = r * 0.28;

            for (let row = -1; row <= 1; row++)
                for (let column = -1; column <= 1; column++) {
                    context.moveTo(x + column * r * 0.65 + dot, y + row * r * 0.65);
                    context.arc(x + column * r * 0.65, y + row * r * 0.65, dot, CIRCLE_START_ANGLE, CIRCLE_END_ANGLE, CIRCLE_CLOCKWISE);
                }

            return;
        }
        case NodeKind.unknown:
            polygonPath(context, x, y, r, 4, -Math.PI / 2);
            return;
        case NodeKind.add:
        case NodeKind.merge:
            context.moveTo(x + r * 0.75, y);
            context.arc(x, y, r * 0.75, CIRCLE_START_ANGLE, CIRCLE_END_ANGLE, CIRCLE_CLOCKWISE);
            return;
        default:
            // generic, dense, output, attention output, unit
            context.moveTo(x + r, y);
            context.arc(x, y, r, CIRCLE_START_ANGLE, CIRCLE_END_ANGLE, CIRCLE_CLOCKWISE);
    }
}

function strokeMark(context: RenderSurface, colour: string, width: number): void {
    context.strokeStyle = colour;
    context.lineWidth = width;
    context.stroke();
}

/** The marks over a glyph: the kind's own (output ring, "+", "Σ", grid, query dot, "↻") and the variants. */
function drawMarks(context: RenderSurface, kind: number, marks: number, x: number, y: number, r: number, labelled: boolean): void {

    const ink = K.colours.label;

    switch (kind) {
        case NodeKind.output:
            circlePath(context, x, y, r * 0.55);
            strokeMark(context, K.colours.glyphInk, NODE_RING_WIDTH);
            break;
        case NodeKind.add:
            context.beginPath();
            context.moveTo(x - r * 0.45, y);
            context.lineTo(x + r * 0.45, y);
            context.moveTo(x, y - r * 0.45);
            context.lineTo(x, y + r * 0.45);
            strokeMark(context, K.colours.glyphInk, HOLLOW_WIDTH);
            break;
        case NodeKind.patches:
            context.beginPath();
            context.moveTo(x, y - r * 0.85);
            context.lineTo(x, y + r * 0.85);
            context.moveTo(x - r * 0.85, y);
            context.lineTo(x + r * 0.85, y);
            strokeMark(context, K.colours.glyphInk, NODE_RING_WIDTH);
            break;
        case NodeKind.pooling:
            context.fillStyle = K.colours.glyphInk;
            circlePath(context, x, y, r * 0.3);
            context.fill();
            break;
        case NodeKind.merge:
        case NodeKind.cell:
            context.fillStyle = K.colours.glyphInk;
            context.fillText(kind === NodeKind.merge ? "Σ" : "↻", x - r * 0.4, y + r * 0.4);
            break;
    }

    if (marks & Mark.hatched) {
        context.beginPath();
        context.moveTo(x - r, y + r * 0.35);
        context.lineTo(x - r * 0.3, y - r * 0.35);
        context.moveTo(x, y + r * 0.35);
        context.lineTo(x + r * 0.7, y - r * 0.35);
        strokeMark(context, K.colours.glyphInk, NODE_RING_WIDTH);
    }

    if (marks & Mark.segments) {
        context.beginPath();
        context.moveTo(x, y - r * 0.85);
        context.lineTo(x, y + r * 0.85);
        strokeMark(context, K.colours.glyphInk, NODE_RING_WIDTH);
    }

    if (marks & Mark.causal) {
        // A small triangle at the upper right: the mask lets each token see only what came before.
        context.fillStyle = ink;
        context.beginPath();
        context.moveTo(x + r * 0.7, y - r * 1.2);
        context.lineTo(x + r * 1.3, y - r * 1.2);
        context.lineTo(x + r * 1.3, y - r * 0.6);
        context.lineTo(x + r * 0.7, y - r * 1.2);
        context.fill();
    }

    if (marks & Mark.rotary) {
        circlePath(context, x, y, r * 1.35);
        strokeMark(context, ink, NODE_RING_WIDTH);
    }

    if (marks & Mark.dropout) {
        context.setLineDash(DROPOUT_DASH);
        circlePath(context, x, y, r * 1.15);
        strokeMark(context, ink, NODE_RING_WIDTH);
        context.setLineDash(NO_DASH);
    }

    const activation = ACTIVATION_MARKS[(marks & Mark.activationMask) >> Mark.activationShift];

    // Text marks cost a fillText each, so they follow the labels' size gate.
    if (activation !== undefined && labelled) {
        context.fillStyle = ink;
        context.fillText(activation, x + r * 0.9, y + r * 1.4);
    }
}

function drawNetworkNode(
    context: RenderSurface,
    attributes: GraphAttributes,
    node: Tag,
    index: number,
    depth: number,
    focalLength: number,
    minDepth: number,
    maxDepth: number,
    hasRange: boolean,
    graph: Graph,
    selected: Tag | null,
    labelAll: boolean,
    alphaScale: number
): void {

    const x = node.translatedPosition.x;
    const y = node.translatedPosition.y;
    const kind = attributes.kind[index];
    const marks = attributes.marks[index];
    const r = glyphRadius(kind, depth, focalLength);
    const isSelected = node === selected;
    const colour = isSelected ? K.colours.nodeSelected : familyColour(kind);

    context.globalAlpha = scaledAlpha(alphaAt(depth, minDepth, maxDepth, hasRange), alphaScale);

    context.beginPath();
    glyphPath(context, kind, x, y, r);

    if (marks & Mark.hollow) {
        strokeMark(context, colour, HOLLOW_WIDTH);
    }
    else {
        context.fillStyle = colour;
        context.fill();
    }

    const labelled =
        labelAll ||
        isSelected ||
        (selected !== null && graph.hasEdge(selected, node));

    drawMarks(context, kind, marks, x, y, r, labelled);

    if (isSelected)
        strokeSelectionRing(context, x, y, r);

    if (labelled)
        drawNodeLabel(context, node, depth, minDepth, maxDepth, hasRange);
}

/** A straight segment, or the projected quadratic curve when the edge has a control point. */
function networkEdgeSegment(context: RenderSurface, edge: { v1: Tag; v2: Tag }, controls: Float64Array, j: number): void {
    const cx = controls[2 * j];

    context.moveTo(edge.v1.translatedPosition.x, edge.v1.translatedPosition.y);

    if (Number.isNaN(cx))
        context.lineTo(edge.v2.translatedPosition.x, edge.v2.translatedPosition.y);
    else
        context.quadraticCurveTo(cx, controls[2 * j + 1], edge.v2.translatedPosition.x, edge.v2.translatedPosition.y);
}

function drawNetworkEdge(
    context: RenderSurface,
    edges: Array<{ v1: Tag; v2: Tag }>,
    attributes: GraphAttributes,
    controls: Float64Array,
    j: number,
    depth: number,
    minDepth: number,
    maxDepth: number,
    hasRange: boolean,
    selected: Tag | null,
    alphaScale: number,
    width: number
): void {

    const edge = edges[j];
    const raw = attributes.edgeKind[j];
    const kind = raw & ~EdgeKind.dotted;
    const weight = attributes.weight[j];
    const magnitude = Math.min(Math.abs(weight), 1);
    const weighted = kind === EdgeKind.flow || kind === EdgeKind.weight;

    // Width and alpha follow |weight| (D11); structural edges (skips, loops, the cross term) draw at full.
    const strength = weighted ? 0.35 + 0.65 * magnitude : 1;

    context.globalAlpha = scaledAlpha(alphaAt(depth, minDepth, maxDepth, hasRange), alphaScale * strength);
    context.lineWidth = weighted ? width * (0.5 + magnitude) : width;
    context.strokeStyle = edgeIncidentTo(edge, selected)
        ? K.colours.edgeIncident
        : kind === EdgeKind.weight
            ? (weight >= 0 ? K.colours.weightPositive : K.colours.weightNegative)
            : kind === EdgeKind.recurrent
                ? K.colours.recurrentEdge
                : K.colours.edgeDefault;

    const dotted = (raw & EdgeKind.dotted) !== 0;

    if (dotted)
        context.setLineDash(DOTTED_EDGE_DASH);

    context.beginPath();
    networkEdgeSegment(context, edge, controls, j);
    context.stroke();

    if (dotted)
        context.setLineDash(NO_DASH);
}

/** A band's outline: a translucent fill and a faint stroke in its family's colour. */
function drawBand(context: RenderSurface, screen: Float64Array, attributes: GraphAttributes, b: number): void {

    const s = b * BAND_SCREEN_STRIDE;
    const colour = K.colours.family[attributes.bands[b * BAND_STRIDE + BAND_FAMILY]] ?? K.colours.edgeDefault;

    context.beginPath();
    context.moveTo(screen[s], screen[s + 1]);

    for (let c = 1; c < 4; c++)
        context.lineTo(screen[s + 2 * c], screen[s + 2 * c + 1]);

    context.lineTo(screen[s], screen[s + 1]);

    context.globalAlpha = BAND_FILL_ALPHA;
    context.fillStyle = colour;
    context.fill();

    context.globalAlpha = BAND_STROKE_ALPHA;
    strokeMark(context, colour, NODE_RING_WIDTH);
}

/**
 * Coarse network fills: one path and one fill per (kind, colour), not per node (D11). The selection is its
 * own last pass; marks and per-node strokes are dropped, as the plain coarse path drops the ring.
 */
function drawBatchedNetworkFills(
    context: RenderSurface,
    attributes: GraphAttributes,
    vertices: Array<Tag>,
    itemKind: Uint8Array,
    itemIndex: Int32Array,
    itemDepth: Float64Array,
    itemOrder: number[],
    itemCount: number,
    focalLength: number,
    alpha: number,
    selected: Tag | null
): void {

    context.globalAlpha = alpha;

    for (let kind = 0; kind <= NodeKind.unit + 1; kind++) {

        // The pass after the last kind is the selection's.
        const selectionPass = kind === NodeKind.unit + 1;
        let any = false;

        context.beginPath();

        for (let k = 0; k < itemCount; k++) {

            const item = itemOrder[k];

            if (itemKind[item] !== NODE_ITEM)
                continue;

            const i = itemIndex[item];
            const node = vertices[i];

            if (selectionPass ? node !== selected : (node === selected || attributes.kind[i] !== kind))
                continue;

            glyphPath(context, attributes.kind[i], node.translatedPosition.x, node.translatedPosition.y, glyphRadius(attributes.kind[i], itemDepth[item], focalLength));
            any = true;
        }

        if (!any)
            continue;

        context.fillStyle = selectionPass ? K.colours.nodeSelected : familyColour(kind);
        context.fill();
    }
}
