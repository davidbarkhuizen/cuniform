export interface ContextMenuItem {
    label: string;
    onSelect: () => void;
}

export interface ContextMenuEntry {
    label: string;
    element: HTMLElement;
}

/**
 * A small absolutely-positioned menu shown at the cursor on right-click, or
 * from the keyboard via Shift+F10.
 *
 * Entries are real `button`s, so Enter and Space activate them natively; the
 * menu itself handles Escape to close and the arrow keys to move between
 * entries. Built from plain DOM calls so it needs no markup or CSS changes and
 * can be driven headlessly through the test DOM stub.
 */
export class ContextMenu {

    element: HTMLElement;
    entries: ContextMenuEntry[] = [];

    /** Which entry has focus, so the arrow keys know where to move from. */
    private focusedIndex = 0;

    constructor(items: ContextMenuItem[], private readonly onDismiss?: () => void) {

        this.element = document.createElement('div');
        this.element.setAttribute('role', 'menu');
        this.element.setAttribute('aria-label', 'node actions');

        this.setStyle(this.element, {
            position: 'absolute',
            display: 'none',
            zIndex: '10',
            padding: '4px',
            backgroundColor: 'black',
            border: '1px solid lightgray',
            borderRadius: '5px',
            fontFamily: 'Courier',
            fontSize: 'large',
        });

        items.forEach((item, index) => {

            const entry = document.createElement('button');
            entry.setAttribute('type', 'button');
            entry.setAttribute('role', 'menuitem');
            entry.innerHTML = item.label;

            // A button's own chrome is reset so it looks like the old div; the
            // point of the change is that it is focusable and keyboard-
            // activated, not that it looks different.
            this.setStyle(entry, {
                display: 'block',
                width: '100%',
                boxSizing: 'border-box',
                padding: '4px 8px',
                border: 'none',
                backgroundColor: 'transparent',
                font: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
                color: 'purple',
            });

            entry.addEventListener('click', () => {
                this.hide();
                item.onSelect();
                // Return focus to the canvas so the keyboard shortcuts keep
                // working after an entry is activated by Enter or Space.
                this.onDismiss?.();
            });

            // Keeps the arrow-key roving index in step when Tab moves focus.
            entry.addEventListener('focus', () => {
                this.focusedIndex = index;
            });

            this.element.appendChild(entry);
            this.entries.push({ label: item.label, element: entry });
        });

        this.element.addEventListener('keydown', this.onKeyDown);
    }

    get isOpen(): boolean {
        return this.element.style.display !== 'none';
    }

    open(x: number, y: number) {
        this.element.style.left = `${x}px`;
        this.element.style.top = `${y}px`;
        this.element.style.display = 'block';

        // Land focus in the menu so Tab, the arrow keys and Enter all work
        // without a further pointer event.
        this.focusedIndex = 0;
        this.entries[0]?.element.focus();
    }

    hide() {
        this.element.style.display = 'none';
    }

    onKeyDown = (event: KeyboardEvent) => {

        if (event.key === 'Escape') {
            this.hide();
            this.onDismiss?.();
            return;
        }

        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')
            return;

        if (this.entries.length === 0)
            return;

        event.preventDefault();

        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.focusedIndex = (this.focusedIndex + step + this.entries.length) % this.entries.length;
        this.entries[this.focusedIndex].element.focus();
    }

    /**
     * Apply inline styles by name. Typed as `Partial<CSSStyleDeclaration>` so
     * the camelCase keys are checked against the real style properties rather
     * than written through an `any` hole.
     */
    private setStyle(element: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
        Object.assign(element.style, styles);
    }
}
