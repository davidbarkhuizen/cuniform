import test from "node:test";
import assert from "node:assert/strict";

import { K } from "../src/K";
import { readWeb } from "./support/files";

/**
 * The layout lives in the two static demo assets rather than in TypeScript, so
 * these read them back and pin the structure the UI depends on.
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

test("the panel's fixed menu comes before the selected-node section", () => {
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

test("the panel's touch grip is inside the panel and precedes the menu", () => {
    const panel = panelMarkup(readWeb("index.html"));

    const handle = panel.indexOf('id="panelDragHandle"');
    const menu = panel.indexOf('class="overlayMenu"');

    assert.notEqual(handle, -1, "the panel needs a drag grip");
    assert.ok(handle < menu, "the grip belongs at the top of the panel");

    const css = readWeb("stylez.css");
    assert.match(cssRule(css, ".panelDragHandle"), /cursor\s*:\s*move/, "the grip is a drag handle");
});

test("the current-graph line sits under the title inside the menu section", () => {
    const panel = panelMarkup(readWeb("index.html"));

    const menu = panel.indexOf('class="overlayMenu"');
    const title = panel.indexOf('class="mainLabel"');
    const selection = panel.indexOf('class="selectionSection"');
    const label = panel.indexOf('id="currentGraphLabel"');

    assert.notEqual(label, -1, "the panel needs a currentGraphLabel line");
    assert.ok(label > title, "the graph line belongs under the title");
    assert.ok(label > menu && label < selection, "the graph line belongs in the menu section");
    assert.ok(panel.includes('class="graphLabel"'), "the line needs its style hook");
});

test("the current-graph line is small and wraps a long systematic name", () => {
    const css = readWeb("stylez.css");
    const label = cssRule(css, ".graphLabel");

    assert.match(label, /font-size\s*:/);
    assert.match(label, /overflow-wrap\s*:\s*anywhere/, "a long IUPAC name must break rather than overflow");
});

test("the panel's third section is the camera console, after the selected node", () => {
    const panel = panelMarkup(readWeb("index.html"));

    const selection = panel.indexOf('class="selectionSection"');
    const camera = panel.indexOf('class="cameraSection"');

    assert.notEqual(camera, -1, "the panel needs a cameraSection");
    assert.ok(selection < camera, "the camera console should come after the selected node");

    assert.ok(panel.includes('id="cameraConsole"'), "the console needs the id the entrypoint resolves");
});

test("the camera console has six labelled axis/direction rotate buttons", () => {
    const panel = panelMarkup(readWeb("index.html"));

    // Attributes may span several lines, so compare against whitespace-normalised markup.
    const markup = panel.replace(/\s+/g, " ");

    for (const axis of ["x", "y", "z"]) {
        for (const direction of ["cw", "acw"]) {
            assert.ok(
                markup.includes(`data-axis="${axis}" data-direction="${direction}"`),
                `the console needs a ${direction} button for the ${axis} axis`
            );
        }

        assert.ok(
            markup.includes(`aria-label="rotate clockwise about the ${axis} axis"`),
            `the ${axis} clockwise button needs an accessible name`
        );
        assert.ok(
            markup.includes(`aria-label="rotate anticlockwise about the ${axis} axis"`),
            `the ${axis} anticlockwise button needs an accessible name`
        );
    }

    const cameraSection = panel.slice(panel.indexOf('class="cameraSection"'));
    assert.ok(cameraSection.includes('class="sectionHeading"'), "the console needs a section heading");
    assert.ok(!/data-axis="[^xyz]/.test(markup), "an axis attribute must name one of x, y or z");
});

test("each rotate button draws its own axis and direction icon", () => {
    const panel = panelMarkup(readWeb("index.html"));

    // Attributes may span several lines, so compare against whitespace-normalised markup.
    const markup = panel.replace(/\s+/g, " ");

    // The one shared glyph per direction is gone: a rotate button now carries
    // an inline SVG, so the icon can name the axis and the way it turns.
    assert.ok(!markup.includes("&#8635;") && !markup.includes("&#8634;"),
        "the shared rotate glyphs should be replaced by per-axis icons");

    const rings = new Set<string>();

    for (const axis of ["x", "y", "z"]) {
        for (const direction of ["cw", "acw"]) {
            const at = markup.indexOf(`data-axis="${axis}" data-direction="${direction}"`);
            assert.notEqual(at, -1, `no ${direction} button for the ${axis} axis`);

            const svg = markup.slice(at, markup.indexOf("</svg>", at));
            const ring = /<path d="([^"]+)"/.exec(svg);

            assert.ok(ring, `the ${axis} ${direction} button needs an SVG ring`);
            rings.add(ring[1]);
        }
    }

    assert.equal(rings.size, 6, "each axis and direction must draw a distinct ring");

    const icon = cssRule(readWeb("stylez.css"), ".cameraIcon");
    assert.match(icon, /stroke\s*:\s*currentColor/, "the ring should stroke in the button's ink");
    assert.match(icon, /width\s*:/, "the icon needs a size");
});

test("the camera console has a labelled zoom row with in and out buttons", () => {
    const panel = panelMarkup(readWeb("index.html"));

    // Attributes may span several lines, so compare against whitespace-normalised markup.
    const markup = panel.replace(/\s+/g, " ");

    for (const direction of ["in", "out"]) {
        assert.ok(
            markup.includes(`data-zoom="${direction}"`),
            `the console needs a zoom ${direction} button`
        );
        assert.ok(
            markup.includes(`aria-label="zoom ${direction}"`),
            `the zoom ${direction} button needs an accessible name`
        );
    }

    const cameraSection = panel.slice(panel.indexOf('class="cameraSection"'));
    assert.ok(cameraSection.includes(">zoom<"), "the zoom row needs its label");
    assert.ok(!/data-zoom="[^io]/.test(markup), "a zoom attribute must name in or out");
});

test("the console buttons read as buttons, not as panel drag handles", () => {
    const css = readWeb("stylez.css");

    const button = cssRule(css, ".cameraButton");
    assert.match(button, /cursor\s*:\s*pointer/, "a console button should look pressable");
    assert.match(button, /background-color\s*:/, "a console button needs a visible face");

    assert.match(
        cssRule(css, ".cameraSection"),
        /cursor\s*:\s*default/,
        "the console itself is not a drag handle"
    );
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
    // The gestures are mouse-only, so the label is the only place a non-visual
    // user learns the view is 3D.
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

test("the stylesheet palette mirrors the canvas palette", () => {
    // The panel's selected-node text and the selected node itself are meant to
    // read as one highlight, so --fg is K.colours.label and --highlight is
    // K.colours.nodeSelected. Nothing but this assertion keeps the two
    // languages' copies in step.
    const root = cssRule(readWeb("stylez.css"), ":root");

    const token = (name: string): string | undefined =>
        new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(root)?.[1].trim();

    assert.equal(token("--fg"), K.colours.label, "--fg must be K.colours.label");
    assert.equal(
        token("--highlight"),
        K.colours.nodeSelected,
        "--highlight must be K.colours.nodeSelected"
    );
});

// ------------------------------------------------------------------ wizard

test("the graph wizard layers above the floating panel", () => {
    const css = readWeb("stylez.css");
    const wizard = cssRule(css, ".graphWizard");

    assert.match(wizard, /position\s*:\s*fixed/, "the wizard is a full-screen overlay");

    const zIndex = /z-index\s*:\s*(\d+)/.exec(wizard);
    assert.ok(zIndex, "the wizard needs an explicit z-index");

    const panelZIndex = Number(
        /z-index\s*:\s*(\d+)/.exec(cssRule(css, ".selectionInfoPanel"))?.[1] ?? "0"
    );
    assert.ok(
        Number(zIndex![1]) > panelZIndex,
        "the wizard must sit above the panel and the context menu"
    );
});

test("the wizard stylesheet covers every class the component builds", () => {
    const css = readWeb("stylez.css");

    const selectors = [
        ".wizardPanel",
        ".wizardTitle",
        ".wizardStep",
        ".wizardChoice",
        ".wizardField",
        ".wizardInput",
        ".wizardTags",
        ".wizardTagFamily",
        ".wizardFooter",
        ".wizardPrimary",
        ".wizardBack",
        ".wizardCancel",
        ".wizardValidation",
        ".wizardEmpty",
        ".wizardCount",
    ];

    for (const selector of selectors)
        assert.notEqual(css.indexOf(selector), -1, `${selector} rule is missing`);

    // `.wizardTag` is a prefix of `.wizardTagFamily`, so anchor on the line.
    assert.notEqual(css.indexOf(".wizardTag\n"), -1, ".wizardTag rule is missing");
    assert.match(cssRule(css, ".wizardTag\n"), /border-radius/, "a chip should read as a pill");
});

test("the wizard's step containers are hidden by class and toggled inline", () => {
    const css = readWeb("stylez.css");

    assert.match(
        cssRule(css, ".wizardStep"),
        /display\s*:\s*none/,
        "only the active step is shown; the rest are display:none until toggled"
    );
});
