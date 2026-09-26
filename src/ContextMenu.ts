export interface ContextMenuItem {
    label: string;
    onSelect: () => void;
}

export interface ContextMenuEntry {
    label: string;
    element: HTMLElement;
}

/**
 * A small absolutely-positioned menu shown at the cursor on right-click.
 *
 * Built from plain DOM calls so it needs no markup or CSS changes and can be
 * driven headlessly through the test DOM stub. Selecting an entry hides the
 * menu and runs its callback.
 */
export class ContextMenu {

    element: HTMLElement;
    entries: ContextMenuEntry[] = [];

    constructor(items: ContextMenuItem[]) {

        this.element = document.createElement('div');
        this.element.className = 'contextMenu';

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

        for (const item of items) {

            const entry = document.createElement('div');
            entry.className = 'contextMenuItem';
            entry.innerHTML = item.label;

            this.setStyle(entry, {
                padding: '4px 8px',
                cursor: 'pointer',
                color: 'purple',
            });

            entry.addEventListener('click', () => {
                this.hide();
                item.onSelect();
            });

            this.element.appendChild(entry);
            this.entries.push({ label: item.label, element: entry });
        }
    }

    get isOpen(): boolean {
        return this.element.style.display !== 'none';
    }

    open(x: number, y: number) {
        this.element.style.left = `${x}px`;
        this.element.style.top = `${y}px`;
        this.element.style.display = 'block';
    }

    hide() {
        this.element.style.display = 'none';
    }

    private setStyle(element: HTMLElement, styles: Record<string, string>) {
        for (const key of Object.keys(styles)) {
            (element.style as any)[key] = styles[key];
        }
    }
}
