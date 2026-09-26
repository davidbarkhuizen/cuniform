# H1 — Export via a blob URL

| | |
| --- | --- |
| **Finding** | H1, high — export navigates to a `data:` URL |
| **Status** | Planned |
| **Area** | `src/UIController.ts`, `test/support/dom.ts`, `test/context-menu.test.ts` |
| **Depends on** | nothing |
| **Blocks** | nothing |

## 1. Problem

`UIController.onExport` hands `canvas.toDataURL()` straight to `window.open`:

```ts
// src/UIController.ts:206-215
onExport = (event?: MouseEvent) => {
    // The link sits inside the overlay panel and carries an href, so the
    // default navigation has to be suppressed or the page reloads.
    event?.preventDefault();

    window.open(
        this.canvas.toDataURL('image/png')
    );
};
```

Chrome (since 60), Firefox, Edge and IE all block **top-frame navigation to
`data:` URLs**. `window.open('data:image/png;base64,…')` therefore opens a
window that is not permitted to navigate, and the PNG never appears. The export
feature is broken in every current browser, for both entry points that share the
handler: the panel's `export` link (`dist/index.html:33`) and the context-menu
`export` entry (`src/UIController.ts:291-295`).

## 2. Evidence

- [Chrome 60 deprecations](https://developer.chrome.google.cn/blog/chrome-60-deprecations?skip_cache=true&hl=de) — top-frame `data:` navigation removed.
- ["Window is not allowed to navigate Top-frame navigations to data URLs"](https://stackoverflow.com/feeds/question/46666559#1) — the canonical report of this exact failure.

The existing test cannot catch it because it substitutes the transport:

```ts
// test/context-menu.test.ts:154-166
test("export opens the canvas PNG data URL", () => {
    withController(({ dom, controller }) => {
        const opened: string[] = [];
        dom.window.open = (url: string): null => { opened.push(url); return null; };
        entry(controller, 'export').dispatch('click');
        assert.deepEqual(opened, ['data:image/png;base64,FAKE']);
    });
});
```

That test asserts the *call shape*, which is exactly the part that is wrong. It
must be rewritten to assert the *scheme*, which is the part that matters.

## 3. Proposed change

Convert the canvas to a `Blob` and use an object URL, whose scheme browsers do
permit. Recommended: trigger a download, because it works with no popup and no
blank tab.

```ts
// src/UIController.ts
onExport = (event?: MouseEvent) => {
    event?.preventDefault();

    const url = URL.createObjectURL(pngBlob(this.canvas));

    const link = document.createElement('a');
    link.href = url;
    link.download = 'cuniform.png';
    link.click();

    // Revoking synchronously can cancel the download in some browsers; one
    // task's delay lets the navigation start first.
    setTimeout(() => URL.revokeObjectURL(url), 0);
};
```

```ts
// src/UIController.ts (module scope) — canvas -> PNG Blob without a second copy
function pngBlob(canvas: HTMLCanvasElement): Blob {
    const [header, base64] = canvas.toDataURL('image/png').split(',');
    const mime = /:(.*?);/.exec(header)?.[1] ?? 'image/png';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);

    return new Blob([bytes], { type: mime });
}
```

**Alternative if the new-tab UX must be preserved:** `window.open(url)` with the
same object URL, keeping the URL alive long enough for the new tab to load
(e.g. revoke from a `window.addEventListener('load')` on the opened window, or a
generous timeout). Blob URLs are not subject to the `data:` block. The download
form is preferred because it has no lifetime hazard and no popup-blocker
dependency.

Two smaller tidy-ups while the method is open:

- The `href=""` on the export anchor is now dead weight (it was only there to be
  suppressed). Leave it or drop it, but do not let a real `href` survive — the
  console would log a navigation attempt.
- `window.open` is no longer read, which removes one more `window` global from
  the controller (relevant to M1).

## 4. Tests to add / change

`test/support/dom.ts`:

- Give `FakeElement` a `click()` that records the call (mirroring
  `listenerCount`/`dispatch`), so the anchor can be observed without a browser.
- Add object-URL recorders to `FakeDom`, e.g.
  `objectUrls: { created: string[]; revoked: string[] }`, installed on a fake
  `URL` namespace during `installFakeDom` and restored by `restore()`. Do **not**
  stub global `Blob`/`atob`; Node 25 provides both.

`test/context-menu.test.ts`:

- Replace "export opens the canvas PNG data URL" with:
  - "export navigates to a `blob:` URL, not a `data:` URL" — assert
    `created[0].startsWith('blob:')` and that no `data:` URL reaches any
    transport;
  - "export triggers a download named `cuniform.png`" — assert the clicked
    anchor's `download` and `href`;
  - "export revokes the object URL it created" — assert `revoked` contains it
    after the deferred callback runs (use fake timers or a microtask flush).

- Add a **textual regression guard** in the same spirit as
  `test/entrypoint.test.ts:100-110` and `test/pipeline.test.ts:114-122`:
  `src/UIController.ts` must not pass `toDataURL` to `window.open`. This is the
  guard the original bug lacked.

## 5. Acceptance criteria

- No `data:` URL reaches `window.open`; export produces a `blob:` URL.
- Export works in headless Chrome and Firefox against `dist/index.html` — the
  PNG is either downloaded or displayed.
- Both entry points (panel link, context menu) exercised manually.
- `npm run ci` green; test count does not fall (the guard and the split
  assertions mean it rises).
- README interaction sections (`README.md:37, 50`) reworded if the UX changes
  from "opens" to "downloads".

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Object URL revoked before the download/tab starts | Revoke on a `setTimeout(…, 0)`, and cover it with the revocation test |
| `atob` on a large canvas is slow or memory-heavy | The demo canvas is viewport-sized; if this ever matters, switch to `canvas.toBlob()` (async, no base64 round-trip) — noted as the natural follow-up |
| Fake `URL` stub leaks into other tests | Install and restore inside `installFakeDom`/`restore`, as the existing timer and `window` stubs do |
| Download attribute ignored for cross-origin content | The canvas is same-origin and untainted, so it applies |

## 7. Out of scope

- Changing the image format (PNG stays).
- Adding an SVG or JSON export.
- Reworking the overlay panel or context-menu styling.

## 8. Verification

1. `npm run ci`.
2. `BROWSER=... ./cli run`, then click `export` in the panel and in the context
   menu; confirm a PNG is produced.
3. Confirm no console message of the form "Not allowed to navigate top frame to
   data URL".
