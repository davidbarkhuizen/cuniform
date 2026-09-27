import test from "node:test";
import assert from "node:assert/strict";

import { GraphWizard, GraphWizardOptions } from "../src/ui/GraphWizard";
import { GraphSpec } from "../src/graph/GraphSpec";
import { K } from "../src/core/K";
import { CATALOG, moleculeTooltip } from "../src/graph/Molecules";
import {
    FakeElement,
    demoElements,
    el,
    generateRandom,
    keyEvent,
    withFakeDom,
} from "./support/dom";

/** Every element in a fake subtree, so a markup write anywhere can be observed. */
function subtree(root: FakeElement): FakeElement[] {
    const out: FakeElement[] = [];
    const queue = [root];

    while (queue.length > 0) {
        const element = queue.shift()!;
        out.push(element);
        queue.push(...element.children);
    }

    return out;
}

interface Fixture {
    wizard: GraphWizard;
    body: FakeElement;
    completed: GraphSpec[];
    counts: { cancels: number; dismisses: number };
}

function withWizard<T>(
    fn: (fixture: Fixture) => T,
    options: Partial<GraphWizardOptions> = {}
): T {

    const elements = demoElements();

    return withFakeDom(elements, () => {

        const body = elements.body;
        const completed: GraphSpec[] = [];
        const counts = { cancels: 0, dismisses: 0 };

        const wizard = new GraphWizard(body as unknown as HTMLElement, {
            onComplete: spec => completed.push(spec),
            onCancel: () => counts.cancels++,
            onDismiss: () => counts.dismisses++,
            dismissible: options.dismissible ?? true,
            initialSpec: options.initialSpec ?? null,
            catalog: options.catalog,
        });

        return fn({ wizard, body, completed, counts });
    });
}

test("open appends the dialog and close removes it", () => {
    withWizard(({ wizard, body, counts }) => {
        assert.equal(wizard.isOpen, false);
        assert.equal(body.children.length, 0);

        wizard.open();

        assert.equal(wizard.isOpen, true);
        assert.equal(body.children.length, 1);
        assert.equal(body.children[0], el(wizard.element));
        assert.equal(el(wizard.element).getAttribute("role"), "dialog");
        assert.equal(el(wizard.element).getAttribute("aria-modal"), "true");
        assert.equal(el(wizard.element).getAttribute("aria-labelledby"), "wizardTitle");

        wizard.close();

        assert.equal(wizard.isOpen, false);
        assert.equal(body.children.length, 0);
        assert.equal(counts.dismisses, 1, "closing returns focus through onDismiss");

        wizard.close();
        assert.equal(counts.dismisses, 1, "close is idempotent");
    });
});

test("the tag list is built once and survives a close and reopen", () => {
    withWizard(({ wizard }) => {
        wizard.open("molecules");

        const firstChip = wizard.tags[0].element;
        const chipCount = wizard.tags.length;

        wizard.close();
        wizard.open("molecules");

        assert.equal(wizard.tags[0].element, firstChip, "the tags must not be rebuilt");
        assert.equal(wizard.tags.length, chipCount);
        assert.equal(chipCount, CATALOG.length);
    });
});

test("the first step offers exactly random and molecules", () => {
    withWizard(({ wizard }) => {
        wizard.open();

        assert.equal(wizard.step, "choose");
        assert.deepEqual(
            wizard.choiceButtons.map(choice => choice.kind),
            ["random", "molecules"]
        );
        assert.deepEqual(
            wizard.choiceButtons.map(choice => el(choice.element).getAttribute("data-choice")),
            ["random", "molecules"]
        );
    });
});

test("a choice button moves to its step", () => {
    withWizard(({ wizard }) => {
        wizard.open();

        const molecules = wizard.choiceButtons.find(choice => choice.kind === "molecules")!;
        el(molecules.element).dispatch("click");

        assert.equal(wizard.step, "molecules");
    });
});

test("the random step is pre-filled from the initial conditions", () => {
    withWizard(({ wizard }) => {
        wizard.open("random");

        assert.equal(wizard.orderInput.value, String(K.initialConditions.order));
        assert.equal(wizard.branchingInput.value, String(K.initialConditions.branching));
        assert.equal(wizard.generateButton.disabled, false);
        assert.equal(wizard.validationLabel.innerHTML, "");
    });
});

test("the random step is pre-filled from the last random spec", () => {
    withWizard(({ wizard }) => {
        wizard.open("random");

        assert.equal(wizard.orderInput.value, "7");
        assert.equal(wizard.branchingInput.value, "3");
    }, { initialSpec: { kind: "random", order: 7, branching: 3 } });
});

test("a molecule initial spec falls back to the initial conditions", () => {
    withWizard(({ wizard }) => {
        wizard.open("random");

        assert.equal(wizard.orderInput.value, String(K.initialConditions.order));
        assert.equal(wizard.branchingInput.value, String(K.initialConditions.branching));
    }, { initialSpec: { kind: "molecule", id: "ibogaine" } });
});

test("an invalid field disables generate and shows the message", () => {
    withWizard(({ wizard }) => {
        wizard.open("random");

        wizard.orderInput.value = "0";
        el(wizard.orderInput).dispatch("input");

        assert.equal(wizard.generateButton.disabled, true);
        assert.match(wizard.validationLabel.innerHTML, /^nodes:/);

        wizard.orderInput.value = "10";
        el(wizard.orderInput).dispatch("input");

        assert.equal(wizard.generateButton.disabled, false);
        assert.equal(wizard.validationLabel.innerHTML, "", "a valid form clears the message");
    });
});

test("branching is validated against the order as it is typed", () => {
    withWizard(({ wizard }) => {
        wizard.open("random");

        wizard.orderInput.value = "3";
        wizard.branchingInput.value = "3";
        el(wizard.branchingInput).dispatch("input");

        assert.equal(wizard.generateButton.disabled, true);
        assert.match(wizard.validationLabel.innerHTML, /^new edges per node:/);

        wizard.branchingInput.value = "2";
        el(wizard.branchingInput).dispatch("input");

        assert.equal(wizard.generateButton.disabled, false);
    });
});

test("the number inputs carry the chooser bounds from K", () => {
    withWizard(({ wizard }) => {
        assert.equal(el(wizard.orderInput).getAttribute("min"), String(K.chooser.minOrder));
        assert.equal(el(wizard.orderInput).getAttribute("max"), String(K.chooser.maxOrder));
        assert.equal(el(wizard.orderInput).getAttribute("step"), "1");

        assert.equal(el(wizard.branchingInput).getAttribute("min"), String(K.chooser.minBranching));
        assert.equal(el(wizard.branchingInput).getAttribute("max"), String(K.chooser.maxBranching));
        assert.equal(el(wizard.branchingInput).getAttribute("step"), "1");
    });
});

test("an order above interactiveOrder shows a hint without disabling generate", () => {
    withWizard(({ wizard }) => {
        wizard.open("random");
        assert.equal(wizard.hintLabel.innerHTML, "", "the seeded default is below the threshold");

        const large = K.chooser.interactiveOrder + 1;
        wizard.orderInput.value = String(large);
        wizard.branchingInput.value = "2";
        el(wizard.orderInput).dispatch("input");

        assert.equal(wizard.generateButton.disabled, false, "the hint must not block generate");
        assert.match(wizard.hintLabel.innerHTML, new RegExp(`^${large} nodes:`));
        assert.equal(wizard.validationLabel.innerHTML, "", "the hint is not a validation message");
    });
});

test("the hint clears at or below interactiveOrder and on a parse error", () => {
    withWizard(({ wizard }) => {
        wizard.open("random");

        wizard.orderInput.value = String(K.chooser.maxOrder);
        el(wizard.orderInput).dispatch("input");
        assert.notEqual(wizard.hintLabel.innerHTML, "", "the large order must warn first");

        wizard.orderInput.value = String(K.chooser.interactiveOrder);
        el(wizard.orderInput).dispatch("input");
        assert.equal(wizard.hintLabel.innerHTML, "", "the threshold itself must not warn");
        assert.equal(wizard.generateButton.disabled, false);

        wizard.orderInput.value = "0";
        el(wizard.orderInput).dispatch("input");
        assert.equal(wizard.hintLabel.innerHTML, "", "a parse error clears the hint");
        assert.equal(wizard.generateButton.disabled, true);
    });
});

test("generate calls onComplete once with the parsed numbers and closes", () => {
    withWizard(({ wizard, completed, counts }) => {
        wizard.open("random");

        generateRandom(wizard, 9, 4);

        assert.deepEqual(completed, [{ kind: "random", order: 9, branching: 4 }]);
        assert.equal(wizard.isOpen, false);
        assert.equal(counts.dismisses, 1);
    });
});

test("an invalid generate submits nothing", () => {
    withWizard(({ wizard, completed }) => {
        wizard.open("random");

        wizard.orderInput.value = "0";
        el(wizard.generateButton).dispatch("click");

        assert.deepEqual(completed, []);
        assert.equal(wizard.isOpen, true);
    });
});

test("the molecules step shows every tag, sorted, with the count", () => {
    withWizard(({ wizard }) => {
        wizard.open("molecules");

        assert.equal(wizard.tags.length, CATALOG.length);
        assert.equal(wizard.countLabel.innerHTML, `${CATALOG.length} of ${CATALOG.length}`);

        const names = wizard.tags.map(tag => tag.entry.commonName);
        assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));

        assert.ok(
            wizard.tags.every(tag => el(tag.element).style.display !== "none"),
            "every tag is visible before a query"
        );
        assert.equal(el(wizard.emptyLabel).style.display, "none");
    });
});

test("the search box is focused when the molecules step opens", () => {
    withWizard(({ wizard }) => {
        wizard.open("molecules");

        assert.equal(el(wizard.searchInput).focused, true);
    });
});

test("typing in the search box filters the tags, the count and the empty state", () => {
    withWizard(({ wizard }) => {
        wizard.open("molecules");

        wizard.searchInput.value = "ibogaine";
        el(wizard.searchInput).dispatch("input");

        const visible = wizard.tags.filter(tag => el(tag.element).style.display !== "none");

        assert.ok(visible.length > 0, "the query should match something");
        assert.ok(visible.length < wizard.tags.length, "the query should hide something");
        assert.ok(visible.some(tag => tag.entry.id === "ibogaine"));
        assert.equal(wizard.countLabel.innerHTML, `${visible.length} of ${wizard.tags.length}`);
        assert.equal(el(wizard.emptyLabel).style.display, "none");

        wizard.searchInput.value = "zzzznotamolecule";
        el(wizard.searchInput).dispatch("input");

        assert.equal(wizard.countLabel.innerHTML, `0 of ${wizard.tags.length}`);
        assert.equal(el(wizard.emptyLabel).style.display, "block");
        assert.match(wizard.emptyLabel.innerHTML, /no molecule matches/);
    });
});

test("clearing the search box shows the whole cloud again", () => {
    withWizard(({ wizard }) => {
        wizard.open("molecules");

        wizard.searchInput.value = "harmine";
        el(wizard.searchInput).dispatch("input");
        assert.ok(wizard.tags.some(tag => el(tag.element).style.display === "none"));

        wizard.searchInput.value = "";
        el(wizard.searchInput).dispatch("input");

        assert.ok(wizard.tags.every(tag => el(tag.element).style.display !== "none"));
        assert.equal(wizard.countLabel.innerHTML, `${CATALOG.length} of ${CATALOG.length}`);
    });
});

test("the filter hides tags without removing them or their listeners", () => {
    withWizard(({ wizard, completed }) => {
        wizard.open("molecules");

        const tag = wizard.tags.find(candidate => candidate.entry.id === "ibogaine")!;
        const element = el(tag.element);
        const parent = element.parentElement!;
        const childrenBefore = parent.children.length;
        const listenersBefore = element.listenerCount("click");

        wizard.searchInput.value = "harmine";
        el(wizard.searchInput).dispatch("input");

        assert.equal(element.style.display, "none", "the tag is hidden, not removed");
        assert.equal(parent.children.length, childrenBefore);
        assert.equal(element.listenerCount("click"), listenersBefore);

        element.dispatch("click");
        assert.deepEqual(completed, [{ kind: "molecule", id: "ibogaine" }]);
    });
});

test("a tag click completes once with the molecule id and closes", () => {
    withWizard(({ wizard, completed, counts }) => {
        wizard.open("molecules");

        const tag = wizard.tags.find(candidate => candidate.entry.id === "harmine")!;
        el(tag.element).dispatch("click");

        assert.deepEqual(completed, [{ kind: "molecule", id: "harmine" }]);
        assert.equal(wizard.isOpen, false);
        assert.equal(counts.dismisses, 1);
    });
});

test("Enter in the search box completes with the first visible tag", () => {
    withWizard(({ wizard, completed }) => {
        wizard.open("molecules");

        wizard.searchInput.value = "iboga";
        el(wizard.searchInput).dispatch("input");

        const firstVisible = wizard.tags.find(tag => el(tag.element).style.display !== "none")!;

        el(wizard.searchInput).dispatch("keydown", keyEvent({ key: "Enter" }));

        assert.deepEqual(completed, [{ kind: "molecule", id: firstVisible.entry.id }]);
        assert.equal(wizard.isOpen, false);
    });
});

test("Enter in the search box with no match submits nothing", () => {
    withWizard(({ wizard, completed }) => {
        wizard.open("molecules");

        wizard.searchInput.value = "zzzznotamolecule";
        el(wizard.searchInput).dispatch("input");
        el(wizard.searchInput).dispatch("keydown", keyEvent({ key: "Enter" }));

        assert.deepEqual(completed, []);
        assert.equal(wizard.isOpen, true);
    });
});

test("the chip title and aria-label carry the systematic name", () => {
    withWizard(({ wizard }) => {
        for (const tag of wizard.tags) {
            const element = el(tag.element);
            const tooltip = moleculeTooltip(tag.entry);

            assert.equal(element.getAttribute("title"), tooltip);
            assert.equal(element.getAttribute("aria-label"), tooltip);
            assert.ok(element.getAttribute("title")!.includes(tag.entry.systematicName));
        }
    });
});

test("a chip's inline font size is its tagScale", () => {
    withWizard(({ wizard }) => {
        for (const tag of wizard.tags)
            assert.equal(el(tag.element).style.fontSize, `${tag.entry.tagScale}em`);
    });
});

test("a chip carries its molecule id and its family caption", () => {
    withWizard(({ wizard }) => {
        for (const tag of wizard.tags) {
            const element = el(tag.element);

            assert.equal(element.getAttribute("data-molecule"), tag.entry.id);
            assert.equal(element.children.length, 1, "a chip has one family caption");
            assert.equal(element.children[0].className, "wizardTagFamily");
            assert.equal(element.children[0].innerHTML, tag.entry.family);
        }
    });
});

test("the wizard accepts a custom catalog", () => {
    withWizard(({ wizard }) => {
        wizard.open("molecules");

        assert.equal(wizard.tags.length, 1);
        assert.equal(wizard.tags[0].entry.id, CATALOG[0].id);
        assert.equal(wizard.countLabel.innerHTML, "1 of 1");
    }, { catalog: [CATALOG[0]] });
});

test("back returns to the first step and submits nothing", () => {
    withWizard(({ wizard, completed }) => {
        wizard.open("molecules");

        el(wizard.backButton).dispatch("click");

        assert.equal(wizard.step, "choose");
        assert.deepEqual(completed, []);
        assert.equal(wizard.isOpen, true);
    });
});

test("Escape cancels a dismissible wizard without submitting", () => {
    withWizard(({ wizard, completed, counts }) => {
        wizard.open();

        el(wizard.element).dispatch("keydown", keyEvent({ key: "Escape" }));

        assert.equal(counts.cancels, 1);
        assert.equal(wizard.isOpen, false);
        assert.deepEqual(completed, []);
    });
});

test("Escape is ignored on a non-dismissible wizard", () => {
    withWizard(({ wizard, completed, counts }) => {
        wizard.open();

        el(wizard.element).dispatch("keydown", keyEvent({ key: "Escape" }));

        assert.equal(counts.cancels, 0);
        assert.equal(wizard.isOpen, true, "a wizard with no graph to return to cannot be dismissed");
        assert.deepEqual(completed, []);
    }, { dismissible: false });
});

test("cancel is hidden when the wizard is not dismissible", () => {
    withWizard(({ wizard }) => {
        assert.equal(el(wizard.cancelButton).style.display, "none");
    }, { dismissible: false });
});

test("the cancel button cancels a dismissible wizard", () => {
    withWizard(({ wizard, counts }) => {
        wizard.open();

        assert.notEqual(el(wizard.cancelButton).style.display, "none");

        el(wizard.cancelButton).dispatch("click");

        assert.equal(counts.cancels, 1);
        assert.equal(wizard.isOpen, false);
    });
});

test("onComplete is never called without a choice", () => {
    withWizard(({ wizard, completed }) => {
        wizard.open();

        el(wizard.backButton).dispatch("click");
        el(wizard.element).dispatch("keydown", keyEvent({ key: "Tab" }));
        el(wizard.element).dispatch("keydown", keyEvent({ key: "ArrowDown" }));
        wizard.close();

        assert.deepEqual(completed, []);
    });
});

/** Record focus order for [name, element] controls; the array can be cleared between gestures. */
function trackFocus(controls: Array<[string, HTMLElement]>): string[] {
    const order: string[] = [];

    for (const [name, control] of controls) {
        const element = el(control);
        const original = element.focus.bind(element);
        element.focus = () => {
            order.push(name);
            original();
        };
    }

    return order;
}

test("the first control is focused when a step opens", () => {
    withWizard(({ wizard }) => {
        wizard.open("choose");
        assert.equal(el(wizard.choiceButtons[0].element).focused, true);

        el(wizard.element).dispatch("keydown", keyEvent({ key: "Tab" }));
        assert.equal(el(wizard.choiceButtons[1].element).focused, true);
    });
});

test("focusing a control directly resyncs the wizard's Tab index", () => {
    withWizard(({ wizard }) => {
        wizard.open("molecules");

        // A native focus move bypasses the Tab handler, so focus must resync the roving index.
        el(wizard.tags[2].element).focus();

        el(wizard.element).dispatch("keydown", keyEvent({ key: "Tab" }));

        assert.equal(
            el(wizard.tags[3].element).focused,
            true,
            "Tab must continue from the chip the user focused, not from index 0"
        );
    });
});

test("each number field's caption names the input it labels", () => {
    withWizard(({ wizard }) => {
        const fields: Array<[string, HTMLInputElement]> = [
            ["nodes", wizard.orderInput],
            ["new edges per node", wizard.branchingInput],
        ];

        for (const [name, input] of fields) {
            const field = el(input).parentElement;

            assert.ok(field, `${name}: the input must sit in a field`);

            const caption = field!.children.find(child => child.tagName === "LABEL");

            assert.ok(caption, `${name}: the field must carry a caption`);
            assert.ok(el(input).id, `${name}: the input must carry the id the caption names`);
            assert.equal(caption!.getAttribute("for"), el(input).id, `${name}: the caption must name its input`);
        }
    });
});

test("Tab wraps at both ends of the visible controls", () => {
    withWizard(({ wizard }) => {

        const controls: Array<[string, HTMLElement]> = [
            ["random", wizard.choiceButtons[0].element],
            ["molecules", wizard.choiceButtons[1].element],
            ["back", wizard.backButton],
            ["cancel", wizard.cancelButton],
        ];

        const seen = trackFocus(controls);

        wizard.open("choose");
        assert.deepEqual(seen, ["random"], "opening focuses the first control");

        seen.length = 0;
        for (let i = 0; i < controls.length; i++)
            el(wizard.element).dispatch("keydown", keyEvent({ key: "Tab" }));

        assert.deepEqual(seen, ["molecules", "back", "cancel", "random"], "Tab wraps forward");

        seen.length = 0;
        el(wizard.element).dispatch("keydown", keyEvent({ key: "Tab", shiftKey: true }));

        assert.deepEqual(seen, ["cancel"], "Shift+Tab wraps backwards from the first control");
    });
});

test("the search text is data, never markup", () => {
    withWizard(({ wizard }) => {
        const payload = "<img src=x onerror=alert(1)>";

        wizard.open("molecules");
        wizard.searchInput.value = payload;
        el(wizard.searchInput).dispatch("input");

        // The filter still runs, but the user's text must never reach any element's markup.
        assert.equal(wizard.countLabel.innerHTML, `0 of ${wizard.tags.length}`);
        assert.equal(wizard.emptyLabel.style.display, "block");
        assert.ok(
            subtree(el(wizard.element)).every(element => !element.innerHTML.includes(payload)),
            "the search text must never reach markup"
        );
    });
});

test("Tab skips the disabled generate button", () => {
    withWizard(({ wizard }) => {
        wizard.open("random");

        wizard.orderInput.value = "0";
        el(wizard.orderInput).dispatch("input");
        assert.equal(wizard.generateButton.disabled, true);

        const order = trackFocus([
            ["generate", wizard.generateButton],
            ["back", wizard.backButton],
        ]);

        el(wizard.element).dispatch("keydown", keyEvent({ key: "Tab" }));
        el(wizard.element).dispatch("keydown", keyEvent({ key: "Tab" }));

        assert.deepEqual(order, ["back"]);
    });
});

test("Tab skips the hidden cancel button on a non-dismissible wizard", () => {
    withWizard(({ wizard }) => {
        const order = trackFocus([
            ["random", wizard.choiceButtons[0].element],
            ["molecules", wizard.choiceButtons[1].element],
            ["back", wizard.backButton],
        ]);

        wizard.open("choose");
        order.length = 0;

        for (let i = 0; i < 3; i++)
            el(wizard.element).dispatch("keydown", keyEvent({ key: "Tab" }));

        assert.deepEqual(order, ["molecules", "back", "random"]);
    }, { dismissible: false });
});
