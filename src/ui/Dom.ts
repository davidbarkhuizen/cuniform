/**
 * The element walk shared by the panel drag and the delegated consoles. Declared
 * structurally, and ascending via `parentElement` rather than `closest()`, so it
 * also runs on the dependency-free test DOM.
 */

export interface AncestorNode {
    parentElement?: AncestorNode | null;
    tagName?: string;
    getAttribute?(name: string): string | null;
}

/**
 * The nearest node on `target`'s ancestor chain - `target` included - that
 * `accept` takes, or null when the chain ends first. `stopBefore` is exclusive:
 * a press that starts on a component's body must not match that component's own
 * boundary.
 */
export function firstAncestor<T extends AncestorNode>(
    target: EventTarget | null,
    accept: (element: T) => boolean,
    stopBefore: AncestorNode | null = null
): T | null {

    let element = target as unknown as T | null;

    while (element && element !== stopBefore) {

        if (accept(element))
            return element;

        element = (element.parentElement ?? null) as T | null;
    }

    return null;
}

/** `element`'s `name` attribute, or null when it has no attributes to read. */
export function attributeOf(element: AncestorNode, name: string): string | null {

    const getAttribute = element.getAttribute;

    return typeof getAttribute === "function" ? getAttribute.call(element, name) : null;
}
