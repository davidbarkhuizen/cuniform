import { K } from "./K";
import { point, Point2D } from "./Point2D";

/**
 * Projected-plane <-> canvas mapping. Its input is the projector's output: model
 * units already divided by view depth. The scale is uniform on both axes, so a
 * canvas of any aspect ratio never stretches the layout, and y is flipped.
 */
export class Viewport {

	constructor(
		readonly w0: number, readonly h0: number,
		readonly w1: number, readonly h1: number
	) {}

	/** The model rectangle mapped onto a `w1` x `h1` canvas. */
	static forCanvas(w1: number, h1: number): Viewport {
		return new Viewport(K.space.W_0, K.space.H_0, w1, h1);
	}

	/** Uniform model -> canvas scale. */
	get scale(): number {
		return Math.min(this.w1 / this.w0, this.h1 / this.h0);
	}

	toCanvas(xy: Point2D): Point2D {
		const s = this.scale;

		return point(
			(this.w1 / 2.0) + xy.x * s,
			(this.h1 / 2.0) - xy.y * s
		);
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
