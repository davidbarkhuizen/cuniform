import { advanceIndex } from "./FocusRing";
import { clamp } from "../core/Numeric";

export interface ContextMenuItem {
    label: string;
    onSelect: () => void;
}

export interface ContextMenuEntry {
    label: string;
    element: HTMLElement;
}

/** Shown at the cursor on right-click or Shift+F10; entries are real `button`s. */
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
            // Body supplies the font family; the stylesheet stays its one source.
            fontSize: 'large',
        });

        items.forEach((item, index) => {

            const entry = document.createElement('button');
            entry.setAttribute('type', 'button');
            entry.setAttribute('role', 'menuitem');
            entry.innerHTML = item.label;

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
                // Before the action: an overlay it opens focuses its own control, which this must not
                // override.
                this.onDismiss?.();
                item.onSelect();
            });

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

        // Shown first so the clamp measures the real size.
        const rect = this.element.getBoundingClientRect();
        const maxLeft = Math.max(0, window.innerWidth - rect.width);
        const maxTop = Math.max(0, window.innerHeight - rect.height);

        // Keep the whole menu on-screen for edge clicks.
        this.element.style.left = `${clamp(x, 0, maxLeft)}px`;
        this.element.style.top = `${clamp(y, 0, maxTop)}px`;

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

    // Partial<CSSStyleDeclaration> keeps the camelCase keys checked.
    private setStyle(element: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
        Object.assign(element.style, styles);
    }
}
