import { otherEndpoint } from "../graph/Edge";
import { doublingCapacity } from "../core/Growth";
import { Graph } from "../graph/Graph";
import { K } from "../core/K";
import { clamp } from "../core/Numeric";
import { CameraView, isDepthCulled } from "../view/Projector";
import { RenderSurface } from "./RenderSurface";
import { Tag } from "../graph/Tag";

// Node dot and selection-ring radii, in CSS pixels.
const NODE_RADIUS = 5;
const SELECTION_RADIUS = 10;

// The depth-fade range, as one distance: the batched paths split it into buckets.
const DEPTH_ALPHA_SPAN = K.depthCue.maxAlpha - K.depthCue.minAlpha;

const CIRCLE_START_ANGLE = 0;
const CIRCLE_END_ANGLE = 2 * Math.PI;
const CIRCLE_CLOCKWISE = true;

// Draw-item kinds, in insertion order: edges are collected before nodes so the
// explicit sort below reproduces the old stable-sort edge-before-node tie-break.
const EDGE_ITEM = 0;
const NODE_ITEM = 1;

function colourFor(active: boolean, highlight: string, base: string): string {
	return active ? highlight : base;
}

function circlePath(context: RenderSurface, x: number, y: number, radius: number): void {
	context.beginPath();
	context.arc(x, y, radius, CIRCLE_START_ANGLE, CIRCLE_END_ANGLE, CIRCLE_CLOCKWISE);
}

// maxAlpha near, minAlpha far. A flat scene has no range and draws at full opacity.
function alphaAt(depth: number, minDepth: number, maxDepth: number, hasRange: boolean): number {
	if (!hasRange)
		return K.depthCue.maxAlpha;

	const t = (depth - minDepth) / (maxDepth - minDepth);
	return K.depthCue.maxAlpha + (K.depthCue.minAlpha - K.depthCue.maxAlpha) * t;
}

// Perspective size: nearer is larger, clamped at both ends.
function radiusAt(depth: number, focalLength: number): number {
	const raw = (NODE_RADIUS * focalLength) / depth;
	return clamp(raw, K.depthCue.minNodeRadiusPx, K.depthCue.maxNodeRadiusPx);
}

// The selection ring keeps the drawn node's proportions, so it scales with the
// depth-cued radius. One home, so the filled ring and the stroked ring match.
function ringRadiusFor(radius: number): number {
	return (SELECTION_RADIUS * radius) / NODE_RADIUS;
}

// --------------------------------------------------------------- frame scratch
//
// Reused across frames so a steady-state draw allocates nothing: the old path
// filtered two arrays, built two closures and one {depth, draw} object per item
// every frame.

let itemKind = new Uint8Array(0);
let itemIndex = new Int32Array(0);
let itemDepth = new Float64Array(0);
let batchOrder = new Int32Array(0);
let groupCount = new Int32Array(0);
let groupStart = new Int32Array(0);
let groupWrite = new Int32Array(0);

// A plain array, reused: sort() needs a comparator, which a typed array accepts
// but a subarray view would allocate per frame.
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
}

function ensureGroupCapacity(n: number): void {
	if (n <= groupCount.length)
		return;

	groupCount = new Int32Array(n);
	groupStart = new Int32Array(n);
	groupWrite = new Int32Array(n);
}

/**
 * Draw `graph` onto `context`: clears the backing store in device space, then
 * paints edges and nodes together, farthest-first (painter's algorithm), in CSS
 * pixels. `camera` must be the one that produced each node's cached depth.
 *
 * Above the `K.renderer` thresholds the frame switches to a cheaper, size-gated
 * path: labels are culled to the selection and its neighbours, and edges are
 * batched into one stroke per (style x alpha bucket). Above
 * `K.renderer.performance.minNodes` a second, coarser preset also batches the
 * node fills by colour and collapses the depth fade to one bucket, keeping only
 * the selection ring and the labels as per-node work.
 *
 * `selected` is the caller's cached selection, not a scan: the controller knows
 * when the selection changes, so the renderer never walks O(N) per frame. The
 * graph is still needed for `hasEdge`/`vertices`/`edges`.
 */
export function render(
	context: RenderSurface,
	graph: Graph,
	camera: CameraView,
	selected: Tag | null
): void {

	// Cleared in device space, independent of any devicePixelRatio transform the
	// caller applied for HiDPI.
	context.save();
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, context.canvas.width, context.canvas.height);
	context.restore();

	const { nearPlane, focalLength } = camera;

	const vertices = graph.vertices;
	const edges = graph.edges;

	ensureItemCapacity(vertices.length + edges.length);

	// One pass each: visibility, depth bounds and the draw items together, with
	// no intermediate filter() arrays.
	let itemCount = 0;
	let edgeCount = 0;
	let nodeCount = 0;

	let minDepth = Infinity;
	let maxDepth = -Infinity;

	for (let j = 0; j < edges.length; j++) {

		const edge = edges[j];

		// An edge is skipped if either endpoint is culled: there is no near-plane
		// clipping here.
		if (isDepthCulled(edge.v1.depth, nearPlane) || isDepthCulled(edge.v2.depth, nearPlane))
			continue;

		// An edge sorts among its endpoints, not always behind or in front of them.
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

	// The fade range spans everything actually drawn, so a shallow scene still
	// uses the full ramp; a flat scene has no range and draws at full opacity.
	const hasRange = nodeCount > 0 && maxDepth > minDepth;

	// Explicit (depth descending, insertion index ascending) comparator: it
	// reproduces the previous stable sort's order without depending on
	// Array.prototype.sort stability. Edges were inserted first, so equal depths
	// still draw edge-before-node.
	itemOrder.length = 0;

	for (let k = 0; k < itemCount; k++)
		itemOrder.push(k);

	itemOrder.sort((a, b) => (itemDepth[b] - itemDepth[a]) || (a - b));

	// Frame constant: nothing drawn in the loop changes the font.
	context.font = K.label.fontFamily;

	// The coarse large-graph preset: at or above performance.minNodes the frame
	// batches node fills by colour and drops to one depth-fade bucket. It is off
	// below the threshold, so every small-graph frame is byte-for-byte the old
	// one.
	const coarse =
		K.renderer.performance.batchNodeFills &&
		vertices.length >= K.renderer.performance.minNodes;

	// Opt-in by size, so below every threshold the frame is byte-for-byte the old
	// one and the small-graph golden tests are untouched. A coarse frame always
	// batches edges: the per-item pass that would draw them per edge is skipped.
	const batchEdges = coarse || edges.length >= K.renderer.batchEdgesMinEdges;
	const labelAll = vertices.length < K.renderer.labelMaxNodes;

	// One bucket means one alpha for the whole frame; below the coarse threshold the
	// configured quantization is kept.
	const buckets = coarse
		? K.renderer.performance.edgeAlphaBuckets
		: K.renderer.edgeAlphaBuckets;

	if (batchEdges)
		drawBatchedEdges(context, edges, itemIndex, itemDepth, edgeCount, minDepth, maxDepth, hasRange, selected, buckets);

	if (coarse) {

		drawBatchedNodeFills(
			context,
			vertices,
			itemKind,
			itemIndex,
			itemDepth,
			itemOrder,
			itemCount,
			focalLength,
			hasRange
		);

		// The fills are done; only the ring and the labels remain per-node work.
		drawCoarseNodeWork(context, graph, focalLength, nearPlane, minDepth, maxDepth, hasRange, selected);

		return;
	}

	for (let k = 0; k < itemCount; k++) {

		const item = itemOrder[k];

		if (itemKind[item] === EDGE_ITEM) {

			// In batch mode every edge was already drawn, edges-first.
			if (batchEdges)
				continue;

			drawEdge(context, edges[itemIndex[item]], itemDepth[item], minDepth, maxDepth, hasRange, selected);
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
				labelAll
			);
		}
	}
}

function drawEdge(
	context: RenderSurface,
	edge: { v1: Tag; v2: Tag },
	depth: number,
	minDepth: number,
	maxDepth: number,
	hasRange: boolean,
	selected: Tag | null
): void {

	context.globalAlpha = alphaAt(depth, minDepth, maxDepth, hasRange);
	context.strokeStyle = colourFor(
		selected === edge.v1 || selected === edge.v2,
		K.colours.edgeIncident,
		K.colours.edgeDefault
	);

	context.beginPath();
	context.moveTo(edge.v1.translatedPosition.x, edge.v1.translatedPosition.y);
	context.lineTo(edge.v2.translatedPosition.x, edge.v2.translatedPosition.y);
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
	labelAll: boolean
): void {

	const x = node.translatedPosition.x;
	const y = node.translatedPosition.y;
	const radius = radiusAt(depth, focalLength);
	const ringRadius = ringRadiusFor(radius);

	context.globalAlpha = alphaAt(depth, minDepth, maxDepth, hasRange);

	context.fillStyle = colourFor(node.isSelected, K.colours.nodeSelected, K.colours.nodeDefault);

	circlePath(context, x, y, radius);
	context.fill();

	if (node.isSelected) {
		circlePath(context, x, y, ringRadius);
		context.strokeStyle = K.colours.nodeSelected;
		context.stroke();
	}

	// Label culling: with thousands of nodes the text is unreadable and fillText
	// is the dominant real-canvas cost, so only the selection and its neighbours
	// keep a label. hasEdge is O(1), so this allocates no neighbour set.
	const labelled =
		labelAll ||
		node === selected ||
		(selected !== null && graph.hasEdge(selected, node));

	if (labelled) {
		context.fillStyle = K.colours.label;
		context.fillText(node.label, x + K.label.horizontalSpacing, y - K.label.verticalSpacing);
	}
}

/**
 * One path and one stroke per (style x alpha bucket) group instead of one per
 * edge. All edges are drawn before the depth-sorted nodes, so a batched frame
 * loses the per-edge interleave with nodes; that is the documented, size-gated
 * divergence.
 */
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
	configuredBuckets: number
): void {

	const buckets = Math.max(1, Math.floor(configuredBuckets));
	const groups = 2 * buckets;
	const span = DEPTH_ALPHA_SPAN;

	ensureGroupCapacity(groups);
	ensureBatchCapacity(edgeCount);

	for (let g = 0; g < groups; g++)
		groupCount[g] = 0;

	// The edge items occupy [0, edgeCount) of the item arrays, edges-first.
	for (let k = 0; k < edgeCount; k++) {

		const edge = edges[itemIndex[k]];

		const bucket = alphaBucket(itemDepth[k], minDepth, maxDepth, hasRange, buckets, span);
		const group = (selected === edge.v1 || selected === edge.v2 ? buckets : 0) + bucket;

		groupCount[group]++;
	}

	let offset = 0;

	for (let g = 0; g < groups; g++) {
		groupStart[g] = offset;
		groupWrite[g] = offset;
		offset += groupCount[g];
	}

	for (let k = 0; k < edgeCount; k++) {

		const index = itemIndex[k];
		const edge = edges[index];

		const bucket = alphaBucket(itemDepth[k], minDepth, maxDepth, hasRange, buckets, span);
		const group = (selected === edge.v1 || selected === edge.v2 ? buckets : 0) + bucket;

		batchOrder[groupWrite[group]++] = index;
	}

	for (let g = 0; g < groups; g++) {

		const count = groupCount[g];

		if (count === 0)
			continue;

		const incident = g >= buckets;
		const bucket = g - (incident ? buckets : 0);

		context.globalAlpha = bucketAlpha(bucket, buckets, hasRange, span);
		context.strokeStyle = incident ? K.colours.edgeIncident : K.colours.edgeDefault;

		context.beginPath();

		for (let t = groupStart[g]; t < groupStart[g] + count; t++) {
			const edge = edges[batchOrder[t]];
			context.moveTo(edge.v1.translatedPosition.x, edge.v1.translatedPosition.y);
			context.lineTo(edge.v2.translatedPosition.x, edge.v2.translatedPosition.y);
		}

		context.stroke();
	}
}

/**
 * Coarse frame: one path and one `fill()` per node colour instead of one fill
 * per node - a bounded 2 fills however many nodes. The arcs are appended in the
 * already-sorted painter order, so each colour group keeps
 * (depth descending, insertion index ascending). Every visible node still
 * contributes its own `arc()`, so this saves the fill call and its state change,
 * not the subpath; real rasterisation still pays N circles.
 *
 * Compositing divergence, size-gated: overlapping opaque nodes of one colour are
 * unioned into a single fill instead of compositing per node. Only above
 * `performance.minNodes`, and only within one colour.
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
	hasRange: boolean
): void {

	// The depth fade collapsed to one bucket: the midpoint of the whole ramp,
	// matching what a 1-bucket edge batch draws at.
	const span = DEPTH_ALPHA_SPAN;
	const alpha = bucketAlpha(0, 1, hasRange, span);

	// Selected last, matching the per-node path's selected fill over the default.
	for (let pass = 0; pass < 2; pass++) {

		const wantSelected = pass === 1;

		context.globalAlpha = alpha;
		context.fillStyle = wantSelected ? K.colours.nodeSelected : K.colours.nodeDefault;
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
 * Coarse frame: the only per-node work left is the selection ring (when the
 * preset keeps it) and the labels. In production the coarse threshold is far
 * above `labelMaxNodes`, so `labelAll` is false and the labels are the selection
 * and its incident neighbours - bounded by `degree(selected) + 1`, not by N.
 * There is no hover feature, so nothing else forces a per-node draw.
 *
 * `incidentEdges()` hands back the adjacency array, so this allocates nothing; a
 * duplicate edge can label a neighbour twice, which is invisible (opaque text
 * over itself) and still bounded by the degree.
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

	const x = node.translatedPosition.x;
	const y = node.translatedPosition.y;

	context.globalAlpha = alphaAt(node.depth, minDepth, maxDepth, hasRange);
	context.fillStyle = K.colours.label;

	if (ring && K.renderer.performance.selectionRing) {
		const radius = radiusAt(node.depth, focalLength);

		circlePath(context, x, y, ringRadiusFor(radius));
		context.strokeStyle = K.colours.nodeSelected;
		context.stroke();
	}

	context.fillText(node.label, x + K.label.horizontalSpacing, y - K.label.verticalSpacing);
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

	return Math.min(buckets - 1, Math.max(0, Math.floor(farness * buckets)));
}

/** The alpha a whole bucket draws at: the midpoint of its slice of the ramp. */
function bucketAlpha(bucket: number, buckets: number, hasRange: boolean, span: number): number {
	if (!hasRange || span <= 0)
		return K.depthCue.maxAlpha;

	return K.depthCue.maxAlpha - span * ((bucket + 0.5) / buckets);
}
