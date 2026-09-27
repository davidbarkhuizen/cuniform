/**
 * The element walk shared by the panel drag and the two delegated consoles.
 *
 * Declared structurally rather than as `HTMLElement`: the walk must run on the
 * dependency-free test DOM as well as in a browser, which is also why it
 * ascends via `parentElement` rather than calling `closest()`.
 */

/** The structural node shape the walk needs: a parent link and what it tests. */
export interface AncestorNode {
    parentElement?: AncestorNode | null;
    tagName?: string;
    getAttribute?(name: string): string | null;
}

/**
 * The nearest node on `target`'s ancestor chain - `target` included - that
 * `accept` takes, or null when the chain ends first.
 *
 * `stopBefore` is exclusive: a press that starts on a component's body must not
 * match that component's own boundary. One implementation, so the panel drag's
 * press-ownership check, the camera console's delegated buttons and the emphasis
 * console's delegated buttons cannot disagree about which element an event
 * belongs to (or about where their walk stops).
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
