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

// The selection ring's own stroke width. It is set per stroke rather than once
// per frame, because an `edges`-emphasis frame leaves `lineWidth` at the edge
// width and the ring must not inherit it.
const NODE_RING_WIDTH = 1;

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

// The per-class depth-fade scale, clamped so a retuned preset can never push an
// alpha outside [0, 1]. One home, so both the per-item and the batched paths
// clamp identically.
function scaledAlpha(base: number, scale: number): number {
	return clamp(base * scale, 0, 1);
}

// The leading sort key: whichever class draws first ends up underneath, so the
// other class's items land on top. `nodes` promotes the old edges-first
// tie-break to an absolute rule; `edges` is its mirror.
function rank(kind: number, emphasis: Emphasis): number {
	if (emphasis === Emphasis.nodes)
		return kind;

	return 1 - kind;
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
// The (style x alpha bucket) group of each batched edge item, computed once in
// the counting pass and reused by the scatter pass.
let batchGroup = new Int32Array(0);
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
 * Draw `graph` onto `context`: clears the backing store in device space, then
 * paints edges and nodes (painter's algorithm), in CSS pixels. `camera` must be
 * the one that produced each node's cached depth.
 *
 * `emphasis` picks one of the two display configurations
 * (`K.renderer.emphasis`): `nodes` draws edges first and nodes on top at a
 * reduced edge alpha, `edges` mirrors that order, draws the mesh at
 * `edgeWidthPx` and leaves the depth fade unscaled. The same policy governs the
 * per-item, batched and coarse paths below, so an emphasis cannot reverse above
 * a size threshold. Within a class the painter order is still
 * (depth descending, insertion index ascending).
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
	selected: Tag | null,
	emphasis: Emphasis
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

	// The emphasis preset, resolved once per frame into local numbers: no config
	// object is built per draw (invariant 8).
	const preset = K.renderer.emphasis[emphasis];
	const edgeAlphaScale = preset.edgeAlphaScale;
	const nodeAlphaScale = preset.nodeAlphaScale;

	// Explicit (emphasis rank, depth descending, insertion index ascending)
	// comparator: an absolute total order that does not depend on
	// Array.prototype.sort stability.
	//
	// The rank term is an explicit `if` rather than one `||` chain: chained, two
	// items of *different* ranks would fall through to the depth term, which makes
	// the comparator non-transitive and lets the sort order the two classes
	// arbitrarily. Edges were inserted first, which is why the insertion
	// tie-break still reproduces the old stable edges-before-nodes order at equal
	// depth.
	itemOrder.length = 0;

	for (let k = 0; k < itemCount; k++)
		itemOrder.push(k);

	itemOrder.sort((a, b) => {

		const byRank = rank(itemKind[a], emphasis) - rank(itemKind[b], emphasis);

		if (byRank !== 0)
			return byRank;

		return (itemDepth[b] - itemDepth[a]) || (a - b);
	});

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

	// A batched edge pass is one call that can be made first or last rather than
	// a fixed prefix, so every path can honour the emphasis's paint order. The
	// coarse path returns below, after its own ordering; the per-item path draws
	// whichever items fall outside the batch pass in sorted order.
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

			// The fills are done, so only the ring and the labels remain per-node
			// work. They precede the edge pass here, because the mesh draws on top.
			drawCoarseNodeWork(context, graph, focalLength, nearPlane, minDepth, maxDepth, hasRange, selected);

			drawBatchedEdges(context, edges, itemIndex, itemDepth, edgeCount, minDepth, maxDepth, hasRange, selected, buckets, edgeAlphaScale, preset.edgeWidthPx);

			// A 2.5 px mesh over the frame would bury the one label a user is
			// reading, so the selection and its incident neighbours are re-drawn
			// after the edges. Bounded by degree(selected) + 1, not by N.
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

	// The batched edge pass draws the whole mesh in one go, so it is a call the
	// emphasis places before or after the depth-sorted items rather than a fixed
	// prefix. The per-item loop then draws only the other class.
	if (batchEdges && !preset.edgesOnTop)
		drawBatchedEdges(context, edges, itemIndex, itemDepth, edgeCount, minDepth, maxDepth, hasRange, selected, buckets, edgeAlphaScale, preset.edgeWidthPx);

	for (let k = 0; k < itemCount; k++) {

		const item = itemOrder[k];

		if (itemKind[item] === EDGE_ITEM) {

			// In batch mode every edge was already drawn, or is drawn below.
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

// The leaf marks the per-item and coarse paths share. Those paths differ in
// *when* they emit these, not in what they emit, so the primitives live once and
// a size-gated path cannot drift.

/** One edge segment at its cached canvas endpoints. */
function edgeSegment(context: RenderSurface, edge: { v1: Tag; v2: Tag }): void {
	context.moveTo(edge.v1.translatedPosition.x, edge.v1.translatedPosition.y);
	context.lineTo(edge.v2.translatedPosition.x, edge.v2.translatedPosition.y);
}

/** True when `tag` is either endpoint of `edge`. */
function edgeIncidentTo(edge: { v1: Tag; v2: Tag }, tag: Tag | null): boolean {
	return tag !== null && (tag === edge.v1 || tag === edge.v2);
}

/**
 * The selection ring, scaled to the node's depth-cued radius. Its width is set
 * per stroke: an `edges` frame leaves `lineWidth` at the edge width, and the ring
 * must not inherit it.
 */
function strokeSelectionRing(context: RenderSurface, x: number, y: number, radius: number): void {
	circlePath(context, x, y, ringRadiusFor(radius));
	context.strokeStyle = K.colours.nodeSelected;
	context.lineWidth = NODE_RING_WIDTH;
	context.stroke();
}

/** The node's label at the full depth ramp, which the fill's alpha scale never dims. */
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

	// The node scale applies to the fill only: a label at 0.19 alpha would be
	// unreadable, so text keeps the full depth ramp.
	context.globalAlpha = scaledAlpha(alphaAt(depth, minDepth, maxDepth, hasRange), alphaScale);

	context.fillStyle = colourFor(node.isSelected, K.colours.nodeSelected, K.colours.nodeDefault);

	circlePath(context, x, y, radius);
	context.fill();

	if (node.isSelected)
		strokeSelectionRing(context, x, y, radius);

	// Label culling: with thousands of nodes the text is unreadable and fillText
	// is the dominant real-canvas cost, so only the selection and its neighbours
	// keep a label. hasEdge is O(1), so this allocates no neighbour set.
	const labelled =
		labelAll ||
		node === selected ||
		(selected !== null && graph.hasEdge(selected, node));

	if (labelled)
		drawNodeLabel(context, node, depth, minDepth, maxDepth, hasRange);
}

/**
 * One path and one stroke per (style x alpha bucket) group instead of one per
 * edge. The whole mesh draws in one pass, so it is a call the caller makes first
 * or last; in `nodes` mode that is before the depth-sorted nodes, which loses the
 * per-edge interleave with nodes - the documented, size-gated divergence. The
 * pass is emitted after the class's sort tier, so `edges` mode draws it last.
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

	// The edge items occupy [0, edgeCount) of the item arrays, edges-first. The
	// item's group is computed once here, then reused by the scatter pass.
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
	hasRange: boolean,
	alphaScale: number
): void {

	// The depth fade collapsed to one bucket: the midpoint of the whole ramp,
	// matching what a 1-bucket edge batch draws at. The node scale is applied to
	// the collapsed value, as it is to the per-node ramp.
	const span = DEPTH_ALPHA_SPAN;
	const alpha = scaledAlpha(bucketAlpha(0, 1, hasRange, span), alphaScale);

	// Selected last, matching the per-node path's selected fill over the default.
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
 * Coarse frame: the only per-node work left is the selection ring (when the
 * preset keeps it) and the labels. In production the coarse threshold is far
 * above `labelMaxNodes`, so `labelAll` is false and the labels are the selection
 * and its incident neighbours - bounded by `degree(selected) + 1`, not by N.
 * There is no hover feature, so nothing else forces a per-node draw.
 *
 * `incidentEdges()` hands back the adjacency array, so this allocates nothing; a
 * duplicate edge can label a neighbour twice, which is invisible (opaque text
 * over itself) and still bounded by the degree.
 *
 * In `edges` mode the caller runs this twice: once before the mesh is drawn, and
 * once after, so the selection the user is reading is not buried by it. The
 * second pass is the same bounded set, so it costs no more than the first.
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

	// The ring draws at the label's alpha, over the fill the batched pass emitted.
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
