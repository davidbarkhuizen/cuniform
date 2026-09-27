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

// Draw-item kinds, in insertion order: edges first, as the sort tie-break expects.
const EDGE_ITEM = 0;
const NODE_ITEM = 1;

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

	ensureItemCapacity(vertices.length + edges.length);

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

	// The batched pass is a call the emphasis places, not a fixed prefix.
	if (coarse) {

		if (preset.edgesOnTop) {

			drawBatchedNodeFills(
				context,
				vertices,
				itemKind,
				itemIndex,
				itemDepth,
				itemOrder,
				itemCount,
				focalLength,
				hasRange,
				nodeAlphaScale
			);

			drawCoarseNodeWork(context, graph, focalLength, nearPlane, minDepth, maxDepth, hasRange, selected);

			drawBatchedEdges(context, edges, itemIndex, itemDepth, edgeCount, minDepth, maxDepth, hasRange, selected, buckets, edgeAlphaScale, preset.edgeWidthPx);

			// Re-drawn after the mesh so the selected label is not buried by it.
			drawCoarseNodeWork(context, graph, focalLength, nearPlane, minDepth, maxDepth, hasRange, selected);

			return;
		}

		if (batchEdges)
			drawBatchedEdges(context, edges, itemIndex, itemDepth, edgeCount, minDepth, maxDepth, hasRange, selected, buckets, edgeAlphaScale, preset.edgeWidthPx);

		drawBatchedNodeFills(
			context,
			vertices,
			itemKind,
			itemIndex,
			itemDepth,
			itemOrder,
			itemCount,
			focalLength,
			hasRange,
			nodeAlphaScale
		);

		drawCoarseNodeWork(context, graph, focalLength, nearPlane, minDepth, maxDepth, hasRange, selected);

		return;
	}

	if (batchEdges && !preset.edgesOnTop)
		drawBatchedEdges(context, edges, itemIndex, itemDepth, edgeCount, minDepth, maxDepth, hasRange, selected, buckets, edgeAlphaScale, preset.edgeWidthPx);

	for (let k = 0; k < itemCount; k++) {

		const item = itemOrder[k];

		if (itemKind[item] === EDGE_ITEM) {

			if (batchEdges)
				continue;

			drawEdge(context, edges[itemIndex[item]], itemDepth[item], minDepth, maxDepth, hasRange, selected, edgeAlphaScale, preset.edgeWidthPx);
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
		drawBatchedEdges(context, edges, itemIndex, itemDepth, edgeCount, minDepth, maxDepth, hasRange, selected, buckets, edgeAlphaScale, preset.edgeWidthPx);
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

	context.fillStyle = colourFor(node.isSelected, K.colours.nodeSelected, K.colours.nodeDefault);

	circlePath(context, x, y, radius);
	context.fill();

	if (node.isSelected)
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

		for (let t = groupStart[g]; t < groupStart[g] + count; t++)
			edgeSegment(context, edges[batchOrder[t]]);

		context.stroke();
	}
}

/**
 * Coarse: one path per node colour; overlapping same-colour nodes union rather
 * than composite, a size-gated divergence.
 */
function drawBatchedNodeFills(
	context: RenderSurface,
	vertices: Array<Tag>,
	itemKind: Uint8Array,
	itemIndex: Int32Array,
	itemDepth: Float64Array,
	itemOrder: number[],
	itemCount: number,
	focalLength: number,
	hasRange: boolean,
	alphaScale: number
): void {

	// Collapsed to one bucket: the ramp midpoint, as a 1-bucket edge batch draws.
	const span = DEPTH_ALPHA_SPAN;
	const alpha = scaledAlpha(bucketAlpha(0, 1, hasRange, span), alphaScale);

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

			if (node.isSelected !== wantSelected)
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
