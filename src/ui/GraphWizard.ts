import { advanceIndex } from "./FocusRing";
import { K } from "../core/K";
import { BRANCHING_FIELD, GraphSpec, ORDER_FIELD, parseRandomSpec } from "../graph/GraphSpec";
import {
    CATALOG,
    CatalogEntry,
    filterCatalog,
    moleculeTooltip,
    sortCatalog,
} from "../graph/Molecules";

export type WizardStep = "choose" | "random" | "molecules";

/** The dialog's accessible name: the title element carries this id and the
 * dialog points at it, so the two references cannot disagree. */
const WIZARD_TITLE_ID = "wizardTitle";

// Unique per number field, so a caption can name its input even across rebuilds.
let nextFieldId = 0;

export interface GraphWizardOptions {
    /** Called once with the chosen spec; the wizard has already closed. */
    onComplete: (spec: GraphSpec) => void;
    onCancel?: () => void;
    /** False when there is no previous graph to keep, so the dialog cannot be dismissed. */
    dismissible: boolean;
    /** Returns focus to the canvas. */
    onDismiss?: () => void;
    catalog?: CatalogEntry[];
    /** Pre-fills the random step with the last random choice. */
    initialSpec?: GraphSpec | null;
}

/**
 * The graph chooser: one modal dialog with a chooser step and one step per branch. Tag buttons are
 * built once and filtering only toggles `style.display`, so listeners stay stable and cannot leak.
 */
export class GraphWizard {

    readonly element: HTMLElement;
    readonly choiceButtons: Array<{ kind: "random" | "molecules"; element: HTMLButtonElement }> = [];
    readonly searchInput: HTMLInputElement;
    readonly orderInput: HTMLInputElement;
    readonly branchingInput: HTMLInputElement;
    readonly generateButton: HTMLButtonElement;
    readonly backButton: HTMLButtonElement;
    readonly cancelButton: HTMLButtonElement;
    readonly tags: Array<{ entry: CatalogEntry; element: HTMLButtonElement }> = [];
    readonly titleLabel: HTMLElement;
    readonly countLabel: HTMLElement;
    readonly emptyLabel: HTMLElement;
    readonly validationLabel: HTMLElement;
    /** A non-blocking large-graph hint, separate from validation semantics. */
    readonly hintLabel: HTMLElement;

    private readonly body: HTMLElement;
    private readonly options: GraphWizardOptions;
    private readonly panel: HTMLElement;
    private readonly steps: Record<WizardStep, HTMLElement>;
    private readonly sortedCatalog: CatalogEntry[];

    private currentStep: WizardStep = "choose";
    private openFlag = false;

    // The roving index of the last focused control, so the Tab trap never has to
    // read the live activeElement.
    private focusIndex = 0;

    constructor(body: HTMLElement, options: GraphWizardOptions) {

        this.body = body;
        this.options = options;
        this.sortedCatalog = sortCatalog(options.catalog ?? CATALOG);

        this.element = document.createElement("div");
        this.element.className = "graphWizard";
        this.element.setAttribute("role", "dialog");
        this.element.setAttribute("aria-modal", "true");
        this.element.setAttribute("aria-labelledby", WIZARD_TITLE_ID);

        this.panel = document.createElement("div");
        this.panel.className = "wizardPanel";
        this.element.appendChild(this.panel);

        this.titleLabel = document.createElement("div");
        this.titleLabel.className = "wizardTitle";
        this.titleLabel.setAttribute("id", WIZARD_TITLE_ID);
        this.panel.appendChild(this.titleLabel);

        const choose = this.buildStep("choose");
        const random = this.buildStep("random");
        const molecules = this.buildStep("molecules");

        this.steps = { choose, random, molecules };

        const choices: Array<"random" | "molecules"> = ["random", "molecules"];

        for (const kind of choices) {
            const button = document.createElement("button");
            button.setAttribute("type", "button");
            button.className = "wizardChoice";
            button.setAttribute("data-choice", kind);
            button.innerHTML = kind;
            button.addEventListener("click", () => this.showStep(kind));

            this.registerFocus(button);
            choose.appendChild(button);
            this.choiceButtons.push({ kind, element: button });
        }

        this.orderInput = this.numberField(random, ORDER_FIELD, K.chooser.minOrder, K.chooser.maxOrder);
        this.branchingInput = this.numberField(
            random,
            BRANCHING_FIELD,
            K.chooser.minBranching,
            K.chooser.maxBranching
        );

        // A hint, not a validation message: it never disables generate, so it is
        // a separate element from validationLabel.
        this.hintLabel = document.createElement("p");
        this.hintLabel.className = "wizardHint";
        random.appendChild(this.hintLabel);

        this.validationLabel = document.createElement("p");
        this.validationLabel.className = "wizardValidation";
        random.appendChild(this.validationLabel);

        this.generateButton = document.createElement("button");
        this.generateButton.setAttribute("type", "button");
        this.generateButton.className = "wizardPrimary";
        this.generateButton.innerHTML = "generate";
        this.generateButton.addEventListener("click", this.onGenerate);
        random.appendChild(this.generateButton);

        this.orderInput.addEventListener("input", this.onRandomInput);
        this.branchingInput.addEventListener("input", this.onRandomInput);

        this.searchInput = document.createElement("input");
        this.searchInput.className = "wizardInput";
        this.searchInput.setAttribute("type", "text");
        this.searchInput.setAttribute("aria-label", "search molecules");
        this.searchInput.addEventListener("input", this.onSearchInput);
        this.searchInput.addEventListener("keydown", this.onSearchKeyDown);
        molecules.appendChild(this.searchInput);

        this.countLabel = document.createElement("div");
        this.countLabel.className = "wizardCount";
        molecules.appendChild(this.countLabel);

        const tagList = document.createElement("div");
        tagList.className = "wizardTags";
        molecules.appendChild(tagList);

        this.emptyLabel = document.createElement("p");
        this.emptyLabel.className = "wizardEmpty";
        molecules.appendChild(this.emptyLabel);

        for (const entry of this.sortedCatalog) {
            const chip = this.buildTag(entry);
            tagList.appendChild(chip);
            this.tags.push({ entry, element: chip });
        }

        const footer = document.createElement("div");
        footer.className = "wizardFooter";

        this.backButton = document.createElement("button");
        this.backButton.setAttribute("type", "button");
        this.backButton.className = "wizardBack";
        this.backButton.innerHTML = "back";
        this.backButton.addEventListener("click", () => this.showStep("choose"));

        this.cancelButton = document.createElement("button");
        this.cancelButton.setAttribute("type", "button");
        this.cancelButton.className = "wizardCancel";
        this.cancelButton.innerHTML = "cancel";
        this.cancelButton.addEventListener("click", this.onCancelClick);

        // Nothing to cancel back to when there is no previous graph.
        if (!options.dismissible)
            this.cancelButton.style.display = "none";

        this.registerFocus(this.backButton);
        this.registerFocus(this.cancelButton);

        footer.appendChild(this.backButton);
        footer.appendChild(this.cancelButton);
        this.panel.appendChild(footer);

        // One listener on the dialog catches bubbled keydowns from every control.
        this.element.addEventListener("keydown", this.onKeyDown);
    }

    get step(): WizardStep {
        return this.currentStep;
    }

    get isOpen(): boolean {
        return this.openFlag;
    }

    open(step: WizardStep = "choose"): void {

        if (!this.openFlag) {
            this.body.appendChild(this.element);
            this.openFlag = true;
        }

        this.showStep(step);
    }

    /** Removes the dialog. Idempotent. */
    close(): void {

        if (!this.openFlag)
            return;

        this.body.removeChild(this.element);
        this.openFlag = false;
        this.options.onDismiss?.();
    }

    private buildStep(step: WizardStep): HTMLElement {

        const element = document.createElement("div");
        element.className = "wizardStep";
        element.setAttribute("data-step", step);

        this.panel.appendChild(element);

        return element;
    }

    // The input's native min/max/step mirror parseRandomSpec()'s bounds, from the
    // same K constants, so the spinner and the validation can never drift.
    private numberField(parent: HTMLElement, label: string, min: number, max: number): HTMLInputElement {

        const field = document.createElement("div");
        field.className = "wizardField";

        const caption = document.createElement("label");

        const input = document.createElement("input");
        input.className = "wizardInput";
        input.setAttribute("type", "number");
        input.setAttribute("min", String(min));
        input.setAttribute("max", String(max));
        input.setAttribute("step", "1");

        // A bare sibling <label> is neither click-through nor announced; naming
        // the input ties the caption to the field it labels.
        const id = `wizardField${++nextFieldId}`;
        caption.setAttribute("for", id);
        input.id = id;

        caption.innerHTML = label;

        field.appendChild(caption);
        field.appendChild(input);
        parent.appendChild(field);

        this.registerFocus(input);

        return input;
    }

    private buildTag(entry: CatalogEntry): HTMLButtonElement {

        const button = document.createElement("button");
        button.setAttribute("type", "button");
        button.className = "wizardTag";
        button.setAttribute("data-molecule", entry.id);
        button.innerHTML = entry.commonName;

        const caption = document.createElement("span");
        caption.className = "wizardTagFamily";
        caption.innerHTML = entry.family;
        button.appendChild(caption);

        // The tooltip and aria-label carry the full systematic name behind the short chip.
        const tooltip = moleculeTooltip(entry);
        button.setAttribute("title", tooltip);
        button.setAttribute("aria-label", tooltip);

        // Chip size encodes heavy-atom count, normalised over the whole catalog.
        button.style.fontSize = `${entry.tagScale}em`;

        button.addEventListener("click", () => this.finish({ kind: "molecule", id: entry.id }));

        this.registerFocus(button);

        return button;
    }

    // Keep the roving index in step when focus moves outside the Tab handler.
    private registerFocus(element: HTMLElement): void {

        element.addEventListener("focus", () => {
            const index = this.focusableControls().indexOf(element);

            if (index >= 0)
                this.focusIndex = index;
        });
    }

    private focusableControls(): HTMLElement[] {

        const controls: HTMLElement[] = [];

        if (this.currentStep === "choose") {
            for (const choice of this.choiceButtons)
                controls.push(choice.element);
        }
        else if (this.currentStep === "random") {
            controls.push(this.orderInput, this.branchingInput, this.generateButton);
        }
        else {
            controls.push(this.searchInput);

            for (const tag of this.tags)
                controls.push(tag.element);
        }

        controls.push(this.backButton);

        if (this.options.dismissible)
            controls.push(this.cancelButton);

        // Hidden and disabled controls are not reachable by Tab.
        return controls.filter(control => this.isFocusable(control));
    }

    private isFocusable(control: HTMLElement): boolean {

        if (control.style.display === "none")
            return false;

        return !(control as HTMLButtonElement | HTMLInputElement).disabled;
    }

    private showStep(step: WizardStep): void {

        this.currentStep = step;

        for (const key of Object.keys(this.steps) as WizardStep[])
            this.steps[key].style.display = key === step ? "block" : "none";

        if (step === "random") {
            this.titleLabel.innerHTML = "random graph";
            this.seedRandomStep();
        }
        else if (step === "molecules") {
            this.titleLabel.innerHTML = "molecules";
            this.searchInput.value = "";
            this.applyFilter();
        }
        else {
            this.titleLabel.innerHTML = "choose a graph";
        }

        this.focusIndex = 0;

        const controls = this.focusableControls();

        if (controls.length > 0)
            controls[0].focus();
    }

    private seedRandomStep(): void {

        const spec = this.options.initialSpec;
        const seed = spec && spec.kind === "random" ? spec : null;

        this.orderInput.value = String(seed ? seed.order : K.initialConditions.order);
        this.branchingInput.value = String(seed ? seed.branching : K.initialConditions.branching);

        this.validateRandomStep();
    }

    private validateRandomStep(): void {

        const result = parseRandomSpec(this.orderInput.value, this.branchingInput.value);

        if (result.ok) {
            this.generateButton.disabled = false;
            this.validationLabel.innerHTML = "";

            // Above the interactive size the layout still runs, just below 20 Hz;
            // the hint says so without disabling generate.
            this.hintLabel.innerHTML = result.spec.order > K.chooser.interactiveOrder
                ? `${result.spec.order} nodes: layout advances below 20 Hz`
                : "";
            return;
        }

        this.generateButton.disabled = true;
        this.validationLabel.innerHTML = result.message;

        // A parse error is not a size warning; the hint stays empty.
        this.hintLabel.innerHTML = "";
    }

    private applyFilter(): void {

        const query = this.searchInput.value;
        const matching = new Set(filterCatalog(query, this.sortedCatalog));

        let visible = 0;

        for (const tag of this.tags) {
            const shown = matching.has(tag.entry);
            tag.element.style.display = shown ? "" : "none";

            if (shown)
                visible++;
        }

        this.countLabel.innerHTML = `${visible} of ${this.tags.length}`;

        if (visible === 0) {
            // Deliberately static: the search text is never echoed into markup.
            this.emptyLabel.innerHTML = "no molecule matches that search";
            this.emptyLabel.style.display = "block";
        }
        else {
            this.emptyLabel.style.display = "none";
        }

        // A hidden tag must not leave the roving index past the end.
        if (this.focusIndex >= this.focusableControls().length)
            this.focusIndex = 0;
    }

    private finish(spec: GraphSpec): void {

        this.close();
        this.options.onComplete(spec);
    }

    private cancel(): void {

        if (!this.options.dismissible)
            return;

        this.options.onCancel?.();
        this.close();
    }

    onCancelClick = () => {
        this.cancel();
    };

    onGenerate = () => {

        const result = parseRandomSpec(this.orderInput.value, this.branchingInput.value);

        if (!result.ok)
            return;

        this.finish(result.spec);
    };

    onRandomInput = () => {
        this.validateRandomStep();
    };

    onSearchInput = () => {
        this.applyFilter();
    };

    onSearchKeyDown = (event: KeyboardEvent) => {

        if (event.key !== "Enter")
            return;

        const first = this.tags.find(tag => tag.element.style.display !== "none");

        if (!first)
            return;

        event.preventDefault();
        this.finish({ kind: "molecule", id: first.entry.id });
    };

    onKeyDown = (event: KeyboardEvent) => {

        // Escape only cancels a dismissible wizard; it never steps back, so a
        // chooser with no graph to return to cannot be dismissed by reflex.
        if (event.key === "Escape") {
            this.cancel();
            return;
        }

        if (event.key !== "Tab")
            return;

        const controls = this.focusableControls();

        if (controls.length === 0)
            return;

        event.preventDefault();

        const delta = event.shiftKey ? -1 : 1;
        const index = advanceIndex(this.focusIndex, delta, controls.length);

        this.focusIndex = index;
        controls[index].focus();
    };
}
