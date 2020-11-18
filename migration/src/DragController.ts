export class DragController {

	public startDragScreenX: number = null;
	public startDragScreenY: number = null;
	
	public dragX: number = null;
	public dragY: number = null;
	
	public startTop: number = null;
    public startLeft: number = null;
    
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
	
		var rect = this.element.getBoundingClientRect();
		var parentRect = this.element.parentElement.getBoundingClientRect();
	
		this.startTop = rect.top - parentRect.top;
		this.startLeft = rect.left - parentRect.left;
	}
	
	onDrag = (event: MouseEvent) => {
	
		if ((event.screenX <= 0) && (event.screenY <= 0)){
			return
		}
	
		this.dragX = event.screenX - this.startDragScreenX;
		this.dragY = event.screenY - this.startDragScreenY;
	}
	
	onDragEnd = (event: MouseEvent) => {
	
		this.element.style.top = `$(this.dragY + this.startTop)`;
		this.element.style.left = `$(this.dragX + this.startLeft)`;
	}
}