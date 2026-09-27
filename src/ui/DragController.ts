import { AncestorNode, firstAncestor } from "./Dom";

// A control owns its own press; pointer capture retargets `click` to the panel, which would swallow it.
const INTERACTIVE_TAGS = new Set([
    'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY',
]);

export class DragController {

	public startPointerX: number = 0;
	public startPointerY: number = 0;

	public dragX: number = 0;
	public dragY: number = 0;

	public startTop: number = 0;
    public startLeft: number = 0;

    public element: HTMLElement;

    // Touch drag must start here; null means the whole element is the drag surface.
    private readonly touchHandle: HTMLElement | null;

    private activePointerId: number | null = null;

	constructor(element: HTMLElement, touchHandle: HTMLElement | null = null) {

		this.element = element
		this.touchHandle = touchHandle;

		// On the handle when there is one, so the panel body stays touch-scrollable.
		(touchHandle ?? element).style.touchAction = 'none';

		this.element.style.userSelect = 'none';

		this.element.addEventListener('pointerdown', this.onPointerDown);
		this.element.addEventListener('pointermove', this.onPointerMove);
		this.element.addEventListener('pointerup', this.onPointerUp);
		this.element.addEventListener('pointercancel', this.onPointerUp);
	}

	onPointerDown = (event: PointerEvent) => {

		if (event.button !== 0)
			return;

		if (this.ownsInteractivePress(event.target))
			return;

		// Touch on the body scrolls; only the handle starts a touch drag.
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

		// So moves keep arriving outside the panel.
		this.element.setPointerCapture(event.pointerId);
	}

	onPointerMove = (event: PointerEvent) => {

		if (event.pointerId !== this.activePointerId)
			return;

		this.dragX = event.clientX - this.startPointerX;
		this.dragY = event.clientY - this.startPointerY;

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

	// Uses Dom.firstAncestor() (the test DOM has no closest()), shared with the delegated handlers.
	private ownsInteractivePress(target: EventTarget | null): boolean {

		const panel = this.element as unknown as AncestorNode;

		return firstAncestor<AncestorNode>(target, element => {
			const tagName = element.tagName;
			return typeof tagName === 'string' && INTERACTIVE_TAGS.has(tagName.toUpperCase());
		}, panel) !== null;
	}

	private isWithin(ancestor: HTMLElement, target: EventTarget | null): boolean {

		const wanted = ancestor as unknown as AncestorNode;

		return firstAncestor<AncestorNode>(target, element => element === wanted) !== null;
	}

	private applyPosition() {
		this.element.style.top = `${this.dragY + this.startTop}px`;
		this.element.style.left = `${this.dragX + this.startLeft}px`;
	}
}
