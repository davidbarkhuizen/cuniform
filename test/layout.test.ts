import test from "node:test";
import assert from "node:assert/strict";

import { K } from "../src/K";
import { readWeb } from "./support/files";

/**
 * The layout lives in the two static demo assets rather than in TypeScript, so
 * these read them back and pin down the structure the UI depends on: the
 * floating panel owns the title and menu, and the canvas fills the viewport.
 */

/** Everything from the overlay panel's opening tag to the end of the body. */
function panelMarkup(html: string): string {
    const start = html.indexOf('id="selectionInfoPanel"');
    assert.notEqual(start, -1, "index.html has no #selectionInfoPanel");
    return html.slice(start, html.indexOf("</body>", start));
}

/** The declaration block of the first rule whose selector contains `selector`. */
function cssRule(css: string, selector: string): string {
    const start = css.indexOf(selector);
    assert.notEqual(start, -1, `stylez.css has no rule matching ${selector}`);
    const open = css.indexOf("{", start);
    const close = css.indexOf("}", open);
    return css.slice(open + 1, close);
}

// ------------------------------------------------------------------ markup

test("the title and the export/reset links live inside the floating panel", () => {
    const panel = panelMarkup(readWeb("index.html"));

    for (const id of ["export_canvas_link", "reset_link"]) {
        assert.ok(panel.includes(`id="${id}"`), `${id} should be inside the overlay panel`);
    }

    assert.ok(panel.includes('class="mainLabel"'), "the title should be inside the overlay panel");
    assert.ok(panel.includes("cuniform"), "the title text should be inside the overlay panel");
});

test("the panel is split into a fixed menu section and a selected-node section", () => {
    const panel = panelMarkup(readWeb("index.html"));

    const menu = panel.indexOf('class="overlayMenu"');
    const selection = panel.indexOf('class="selectionSection"');

    assert.notEqual(menu, -1, "the panel needs an overlayMenu section");
    assert.notEqual(selection, -1, "the panel needs a selectionSection");
    assert.ok(menu < selection, "the fixed menu should come before the selected node");

    for (const id of ["export_canvas_link", "reset_link"]) {
        const at = panel.indexOf(`id="${id}"`);
        assert.ok(at > menu && at < selection, `${id} belongs in the menu section`);
    }

    for (const id of ["selectedNodeInfoLabel", "selectedNodeInfoList"]) {
        assert.ok(panel.indexOf(`id="${id}"`) > selection, `${id} belongs in the selection section`);
    }
});

test("the old second title line is gone", () => {
    const html = readWeb("index.html");

    assert.ok(
        !html.includes("force directed graphs in javascript"),
        "the subtitle under the title should not be rendered"
    );
});

test("the canvas is focusable and carries fallback content", () => {
    const html = readWeb("index.html");

    const start = html.indexOf("<canvas");
    assert.notEqual(start, -1, "index.html has no canvas element");

    const openEnd = html.indexOf(">", start);
    const close = html.indexOf("</canvas>", start);
    assert.notEqual(close, -1, "the canvas element is not closed");

    const tag = html.slice(start, openEnd);
    assert.match(tag, /tabindex="0"/, "the canvas needs to be reachable by keyboard");
    assert.match(tag, /role="img"/, "the canvas needs a role");
    assert.match(tag, /aria-label="[^"]+"/, "the canvas needs an accessible label");

    const fallback = html.slice(openEnd + 1, close).trim();
    assert.ok(fallback.length > 0, "the canvas needs text for browsers without canvas support");
});

test("the canvas accessible label names the 3D view and the mouse gestures", () => {
    // The camera gestures are mouse-only, so the label is the only place a
    // non-visual user can learn that the view is 3D and how to move it.
    const html = readWeb("index.html");

    const start = html.indexOf("<canvas");
    const tag = html.slice(start, html.indexOf(">", start));
    const label = /aria-label="([^"]+)"/.exec(tag)?.[1] ?? "";

    assert.match(label, /3D/, "the label should say the view is 3D");
    assert.match(label, /orbit/i, "the label should describe the orbit gesture");
    assert.match(label, /Shift\+middle-drag/i, "the label should describe the pan gesture");
    assert.match(label, /wheel to zoom/i, "the label should describe the dolly gesture");
    assert.match(label, /Shift\+F10/, "the label should keep the actions-menu hint");
});

// -------------------------------------------------------------------- css

test("the canvas container fills the viewport and the canvas fills it", () => {
    const css = readWeb("stylez.css");

    const container = cssRule(css, ".canvas-container");
    assert.match(container, /position\s*:\s*fixed/);
    for (const edge of ["top", "right", "bottom", "left"]) {
        assert.match(container, new RegExp(`${edge}\\s*:\\s*0`), `container should be pinned at ${edge}`);
    }

    const canvas = cssRule(css, "#canvas");
    assert.match(canvas, /width\s*:\s*100%/);
    assert.match(canvas, /height\s*:\s*100%/);
});

test("the overlay panel is opaque and outlined rather than washed out", () => {
    const panel = cssRule(readWeb("stylez.css"), ".selectionInfoPanel");

    assert.match(panel, /background-color\s*:/);
    assert.match(panel, /border\s*:/);
    assert.ok(!/opacity\s*:/.test(panel), "the panel should no longer be translucent");
});

// ----------------------------------------------------------------- colours

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
    const value = hex.replace("#", "");
    const linear = [0, 2, 4].map(offset => {
        const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
        return channel <= 0.03928
            ? channel / 12.92
            : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
    const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (bright + 0.05) / (dark + 0.05);
}

test("nodes and the selection highlight contrast strongly with the edges", () => {
    assert.ok(
        contrast(K.colours.nodeDefault, K.colours.edgeDefault) > 3,
        "default nodes must stand out from the edge mesh"
    );
    assert.ok(
        contrast(K.colours.nodeSelected, K.colours.edgeDefault) > 3,
        "the selected node must stand out from the edge mesh"
    );
    assert.ok(
        contrast(K.colours.label, K.colours.edgeDefault) > 3,
        "labels must stay legible over the edges"
    );
});
