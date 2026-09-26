/** Structural element shape, so the ancestor walk needs no DOM dependency. */
interface PressTarget {
    tagName?: string;
    parentElement?: PressTarget | null;
}

// Elements that own their own press. Pointer capture retargets the compatibility
// `click` to the panel, so without this guard a control's click would be swallowed.
const INTERACTIVE_TAGS = new Set([
    'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY',
]);

/** Drags the floating overlay panel; pointer events cover mouse, touch and pen continuously. */
export class DragController {

	public startPointerX: number = 0;
	public startPointerY: number = 0;

	public dragX: number = 0;
	public dragY: number = 0;

	public startTop: number = 0;
    public startLeft: number = 0;

    public element: HTMLElement;

    // The grip a touch drag must start on, or null when the whole element is the
    // drag surface. Mouse and pen always drag the whole element.
    private readonly touchHandle: HTMLElement | null;

    private activePointerId: number | null = null;

	constructor(element: HTMLElement, touchHandle: HTMLElement | null = null) {

		this.element = element
		this.touchHandle = touchHandle;

		// The panel body must stay touch-scrollable, so `touch-action: none` goes on
		// the handle when there is one; without a handle the element is the surface.
		(touchHandle ?? element).style.touchAction = 'none';

		// user-select: none stops label selection during a drag.
		this.element.style.userSelect = 'none';

		this.element.addEventListener('pointerdown', this.onPointerDown);
		this.element.addEventListener('pointermove', this.onPointerMove);
		this.element.addEventListener('pointerup', this.onPointerUp);
		this.element.addEventListener('pointercancel', this.onPointerUp);
	}

	onPointerDown = (event: PointerEvent) => {

		// A right- or middle-click must not move the panel.
		if (event.button !== 0)
			return;

		// A press starting on a control belongs to that control, not the panel.
		if (this.ownsInteractivePress(event.target))
			return;

		// A touch on the panel body scrolls it; only the handle starts a touch drag.
		if (event.pointerType === 'touch' && this.touchHandle && !this.isWithin(this.touchHandle, event.target))
			return;

		this.activePointerId = event.pointerId;

		this.startPointerX = event.clientX;
		this.startPointerY = event.clientY;

		this.dragX = 0;
		this.dragY = 0;

		var rect = this.element.getBoundingClientRect();
		var parent = this.element.parentElement;
		var parentRect = parent ? parent.getBoundingClientRect() : null;

		this.startTop = parentRect ? rect.top - parentRect.top : 0;
		this.startLeft = parentRect ? rect.left - parentRect.left : 0;

		// Capture so moves keep arriving once the pointer leaves the panel.
		this.element.setPointerCapture(event.pointerId);
	}

	onPointerMove = (event: PointerEvent) => {

		if (event.pointerId !== this.activePointerId)
			return;

		this.dragX = event.clientX - this.startPointerX;
		this.dragY = event.clientY - this.startPointerY;

		// Apply each move so the panel tracks the pointer instead of jumping on release.
		this.applyPosition();
	}

	onPointerUp = (event: PointerEvent) => {

		if (event.pointerId !== this.activePointerId)
			return;

		this.activePointerId = null;

		this.dragX = 0;
		this.dragY = 0;

		if (this.element.hasPointerCapture(event.pointerId))
			this.element.releasePointerCapture(event.pointerId);
	}

	// Walks the ancestor chain rather than closest(), so the check works on the
	// dependency-free test DOM as well as the browser.
	private ownsInteractivePress(target: EventTarget | null): boolean {

		const panel = this.element as unknown as PressTarget | null;

		let element = target as unknown as PressTarget | null;

		while (element && element !== panel) {

			const tagName = element.tagName;

			if (typeof tagName === 'string' && INTERACTIVE_TAGS.has(tagName.toUpperCase()))
				return true;

			element = element.parentElement ?? null;
		}

		return false;
	}

	/** True when `target` is `ancestor` itself or one of its descendants. */
	private isWithin(ancestor: HTMLElement, target: EventTarget | null): boolean {

		const wanted = ancestor as unknown as PressTarget;

		let element = target as unknown as PressTarget | null;

		while (element) {
			if (element === wanted)
				return true;

			element = element.parentElement ?? null;
		}

		return false;
	}

	private applyPosition() {
		this.element.style.top = `${this.dragY + this.startTop}px`;
		this.element.style.left = `${this.dragX + this.startLeft}px`;
	}
}
