import { advanceIndex } from "./FocusRing";

export interface ContextMenuItem {
    label: string;
    onSelect: () => void;
}

export interface ContextMenuEntry {
    label: string;
    element: HTMLElement;
}

/**
 * A small absolutely-positioned menu shown at the cursor on right-click or Shift+F10. Entries are
 * real `button`s so Enter and Space work natively; the menu handles Escape and the arrow keys.
 */
export class ContextMenu {

    element: HTMLElement;
    entries: ContextMenuEntry[] = [];

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

            // Reset the button chrome so a row renders as plain menu text.
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
                // Return focus before the action runs: an action that opens
                // another overlay (the graph chooser) focuses its own control
                // and must not be overridden by this dismissal. Doing it first
                // also covers the plain actions, whose focus still lands on the
                // canvas so keyboard shortcuts keep working.
                this.onDismiss?.();
                item.onSelect();
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
        this.element.style.display = 'block';

        // Shown before measuring, so the clamp uses the menu's real size.
        const rect = this.element.getBoundingClientRect();
        const maxLeft = Math.max(0, window.innerWidth - rect.width);
        const maxTop = Math.max(0, window.innerHeight - rect.height);

        // Clamped to the viewport so a right- or bottom-edge click still shows
        // the whole menu rather than half of it off-screen.
        this.element.style.left = `${Math.min(Math.max(x, 0), maxLeft)}px`;
        this.element.style.top = `${Math.min(Math.max(y, 0), maxTop)}px`;

        // Land focus in the menu so the keyboard works without a pointer event.
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

        this.focusedIndex = advanceIndex(this.focusedIndex, step, this.entries.length);
        this.entries[this.focusedIndex].element.focus();
    }

    // Typed as Partial<CSSStyleDeclaration> so the camelCase keys are checked.
    private setStyle(element: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
        Object.assign(element.style, styles);
    }
}
