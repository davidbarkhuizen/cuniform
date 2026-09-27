import { K } from "../core/K";
import { point, Point2D } from "../core/Point2D";

/**
 * Projected-plane <-> canvas mapping; its input is the projector's output (model units already divided by
 * view depth).
 */
export class Viewport {

	constructor(
		readonly w0: number, readonly h0: number,
		readonly w1: number, readonly h1: number
	) {}

	static forCanvas(w1: number, h1: number): Viewport {
		return new Viewport(K.space.W_0, K.space.H_0, w1, h1);
	}

	get scale(): number {
		return Math.min(this.w1 / this.w0, this.h1 / this.h0);
	}

	toCanvas(xy: Point2D): Point2D {
		return this.toCanvasInto(xy.x, xy.y, point(0, 0));
	}

	/** `toCanvas()` into `out`, so a per-node mapping pass allocates nothing. */
	toCanvasInto(screenX: number, screenY: number, out: Point2D): Point2D {
		const s = this.scale;

		out.x = (this.w1 / 2.0) + screenX * s;
		out.y = (this.h1 / 2.0) - screenY * s;

		return out;
	}

	/** Exact inverse of `toCanvas()`. */
	toModel(xy: Point2D): Point2D {
		const s = this.scale;

		return point(
			(xy.x - (this.w1 / 2.0)) / s,
			((this.h1 / 2.0) - xy.y) / s
		);
	}
}
