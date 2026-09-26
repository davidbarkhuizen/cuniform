export class DragController {

	public startDragScreenX: number = 0;
	public startDragScreenY: number = 0;

	public dragX: number = 0;
	public dragY: number = 0;

	public startTop: number = 0;
    public startLeft: number = 0;

    public element: HTMLElement;

	constructor(element: HTMLElement) {

		this.element = element

		this.element.draggable = true

		this.element.addEventListener('dragstart', this.onDragStart);
		this.element.addEventListener('drag', this.onDrag);
		this.element.addEventListener('dragend', this.onDragEnd);
	}

	onDragStart = (event: MouseEvent) => {

		this.startDragScreenX = event.screenX;
		this.startDragScreenY = event.screenY;

		this.dragX = 0;
		this.dragY = 0;

		var rect = this.element.getBoundingClientRect();
		var parent = this.element.parentElement;
		var parentRect = parent ? parent.getBoundingClientRect() : null;

		this.startTop = parentRect ? rect.top - parentRect.top : 0;
		this.startLeft = parentRect ? rect.left - parentRect.left : 0;
	}

	onDrag = (event: MouseEvent) => {

		if ((event.screenX <= 0) && (event.screenY <= 0)){
			return
		}

		this.dragX = event.screenX - this.startDragScreenX;
		this.dragY = event.screenY - this.startDragScreenY;
	}

	onDragEnd = () => {

		// The previous version stored the literal text "$(this.dragY + ...)"
		// because the interpolation dollar sat outside the braces, and omitted
		// the "px" unit that style.top/style.left require.
		this.element.style.top = `${this.dragY + this.startTop}px`;
		this.element.style.left = `${this.dragX + this.startLeft}px`;

		this.dragX = 0;
		this.dragY = 0;
	}
}
