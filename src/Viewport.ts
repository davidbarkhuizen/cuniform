import { K } from "./K";
import { Point2D } from "./Point2D";

/**
 * Model <-> canvas mapping.
 *
 * The scale is uniform on both axes so a canvas whose aspect ratio differs from
 * the model square never stretches the layout, and the y axis is flipped so
 * increasing model y moves up the canvas. Owning the four numbers here (rather
 * than threading them through every mapping call) is what keeps the scale
 * formula in exactly one place.
 */
export class Viewport {

	constructor(
		readonly w0: number, readonly h0: number,
		readonly w1: number, readonly h1: number
	) {}

	/** The demo's model rectangle mapped onto a canvas of `w1` x `h1`. */
	static forCanvas(w1: number, h1: number): Viewport {
		return new Viewport(K.space.W_0, K.space.H_0, w1, h1);
	}

	/** Uniform model -> canvas scale: min(w1/w0, h1/h0). */
	get scale(): number {
		return Math.min(this.w1 / this.w0, this.h1 / this.h0);
	}

	/** Model point -> canvas point. */
	toCanvas(xy: Point2D): Point2D {
		const s = this.scale;

		return {
			x : (this.w1 / 2.0) + xy.x * s,
			y : (this.h1 / 2.0) - xy.y * s
		};
	}

	/** Exact inverse of toCanvas(): canvas point -> model point. */
	toModel(xy: Point2D): Point2D {
		const s = this.scale;

		return {
			x : (xy.x - (this.w1 / 2.0)) / s,
			y : ((this.h1 / 2.0) - xy.y) / s
		};
	}
}
