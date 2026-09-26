/**
 * Drags the floating overlay panel. Pointer events are used rather than HTML5
 * drag-and-drop so the same code handles mouse, touch and pen, and so the panel
 * can track the cursor continuously instead of jumping on release.
 */
export class DragController {

	public startPointerX: number = 0;
	public startPointerY: number = 0;

	public dragX: number = 0;
	public dragY: number = 0;

	public startTop: number = 0;
    public startLeft: number = 0;

    public element: HTMLElement;

	/** The pointer currently dragging, or null when the panel is idle. */
	private activePointerId: number | null = null;

	constructor(element: HTMLElement) {

		this.element = element

		// touch-action: none stops the browser scrolling the page instead of
		// dragging the panel; user-select: none stops a mouse drag selecting
		// the labels as it moves.
		this.element.style.touchAction = 'none';
		this.element.style.userSelect = 'none';

		this.element.addEventListener('pointerdown', this.onPointerDown);
		this.element.addEventListener('pointermove', this.onPointerMove);
		this.element.addEventListener('pointerup', this.onPointerUp);
		this.element.addEventListener('pointercancel', this.onPointerUp);
	}

	onPointerDown = (event: PointerEvent) => {

		// Primary button, touch or pen only: a right- or middle-click on the
		// panel must not move it.
		if (event.button !== 0)
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

		// Track the pointer while the drag is live; writing only on release
		// made the panel snap to its final position at the end.
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

	/** Write the accumulated delta onto the panel, in px. */
	private applyPosition() {
		this.element.style.top = `${this.dragY + this.startTop}px`;
		this.element.style.left = `${this.dragX + this.startLeft}px`;
	}
}
