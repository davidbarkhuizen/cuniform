import { K } from "./K";
import { GraphSpec, parseRandomSpec } from "./GraphSpec";
import {
    CATALOG,
    CatalogEntry,
    filterCatalog,
    moleculeTooltip,
    sortCatalog,
} from "./Molecules";

export type WizardStep = "choose" | "random" | "molecules";

export interface GraphWizardOptions {
    /** Called once with the chosen spec; the wizard has already closed. */
    onComplete: (spec: GraphSpec) => void;
    /** Called when the user dismisses without choosing. */
    onCancel?: () => void;
    /** False on first run: there is no previous graph to keep. */
    dismissible: boolean;
    /** Returns focus to the canvas, as the context menu does. */
    onDismiss?: () => void;
    catalog?: CatalogEntry[];
    /** Pre-fills the random step with the last random choice. */
    initialSpec?: GraphSpec | null;
}

/**
 * The graph chooser: one modal dialog with a chooser step and one step per
 * branch.
 *
 * Built from plain DOM calls and appended to the body element it is handed -
 * the `ContextMenu` precedent - so there is no `document.body` lookup and the
 * test DOM needs nothing new. A plain `div[role=dialog][aria-modal]` rather
 * than a native `<dialog>` keeps the focus trap and the Escape handling in
 * `src/`, where they are testable.
 *
 * The tag buttons are created once for the whole catalog; filtering only
 * toggles `style.display`. Twenty static buttons mean twenty stable listeners
 * and a filter that cannot leak one or lose focus mid-typing.
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

    private readonly body: HTMLElement;
    private readonly options: GraphWizardOptions;
    private readonly panel: HTMLElement;
    private readonly steps: Record<WizardStep, HTMLElement>;
    private readonly sortedCatalog: CatalogEntry[];

    private currentStep: WizardStep = "choose";
    private openFlag = false;

    /**
     * The position of the last focused control in the visible control list, so
     * the Tab trap never needs `document.activeElement` (the `ContextMenu`
     * roving-index precedent).
     */
    private focusIndex = 0;

    constructor(body: HTMLElement, options: GraphWizardOptions) {

        this.body = body;
        this.options = options;
        this.sortedCatalog = sortCatalog(options.catalog ?? CATALOG);

        this.element = document.createElement("div");
        this.element.className = "graphWizard";
        this.element.setAttribute("role", "dialog");
        this.element.setAttribute("aria-modal", "true");
        this.element.setAttribute("aria-labelledby", "wizardTitle");

        this.panel = document.createElement("div");
        this.panel.className = "wizardPanel";
        this.element.appendChild(this.panel);

        this.titleLabel = document.createElement("div");
        this.titleLabel.className = "wizardTitle";
        this.titleLabel.setAttribute("id", "wizardTitle");
        this.panel.appendChild(this.titleLabel);

        const choose = this.buildStep("choose");
        const random = this.buildStep("random");
        const molecules = this.buildStep("molecules");

        this.steps = { choose, random, molecules };

        // ------------------------------------------------------ choose step
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

        // ------------------------------------------------------ random step
        this.orderInput = this.numberField(random, "nodes");
        this.branchingInput = this.numberField(random, "edges per node");

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

        // --------------------------------------------------- molecules step
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

        // ---------------------------------------------------------- footer
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

        // The first run has no previous graph to keep, so there is nothing to
        // cancel back to.
        if (!options.dismissible)
            this.cancelButton.style.display = "none";

        this.registerFocus(this.backButton);
        this.registerFocus(this.cancelButton);

        footer.appendChild(this.backButton);
        footer.appendChild(this.cancelButton);
        this.panel.appendChild(footer);

        // A keydown listener on the dialog catches the bubbled events from
        // every control, which is where Escape and Tab are handled.
        this.element.addEventListener("keydown", this.onKeyDown);
    }

    get step(): WizardStep {
        return this.currentStep;
    }

    get isOpen(): boolean {
        return this.openFlag;
    }

    /** Append the dialog to the body and show `step`. */
    open(step: WizardStep = "choose"): void {

        if (!this.openFlag) {
            this.body.appendChild(this.element);
            this.openFlag = true;
        }

        this.showStep(step);
    }

    /** Remove the dialog from the body. Idempotent. */
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

    private numberField(parent: HTMLElement, label: string): HTMLInputElement {

        const field = document.createElement("div");
        field.className = "wizardField";

        const caption = document.createElement("label");
        caption.innerHTML = label;

        const input = document.createElement("input");
        input.className = "wizardInput";
        input.setAttribute("type", "number");

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

        // The tooltip and the accessible name carry the full systematic name,
        // so the short chip never loses the technical identity (D5).
        const tooltip = moleculeTooltip(entry);
        button.setAttribute("title", tooltip);
        button.setAttribute("aria-label", tooltip);

        // The word cloud is decoration with a rule: the chip's size is its
        // heavy-atom count, normalised over the whole catalog.
        button.style.fontSize = `${entry.tagScale}em`;

        button.addEventListener("click", () => this.finish({ kind: "molecule", id: entry.id }));

        this.registerFocus(button);

        return button;
    }

    /** Keep the roving index in step when focus moves without the Tab handler. */
    private registerFocus(element: HTMLElement): void {

        element.addEventListener("focus", () => {
            const index = this.focusableControls().indexOf(element);

            if (index >= 0)
                this.focusIndex = index;
        });
    }

    /** The controls reachable right now, in visual order. */
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

        // A hidden control - the cancel button on a mandatory wizard, or a tag
        // the filter has hidden - is not reachable by Tab, and neither is a
        // disabled one (a generate button over an invalid form).
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

    /** Seed the parameter form from the last random choice, else the default. */
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
            return;
        }

        this.generateButton.disabled = true;
        this.validationLabel.innerHTML = result.message;
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
            this.emptyLabel.innerHTML = query.trim() === ""
                ? "no molecules"
                : `no molecule matches "${query}"`;
            this.emptyLabel.style.display = "block";
        }
        else {
            this.emptyLabel.style.display = "none";
        }

        // A hidden tag must not leave the roving index pointing past the end.
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

        // Escape has exactly one meaning: cancel a dismissible wizard. It never
        // steps backwards, so the mandatory first run cannot be dismissed by
        // reflex onto a graph that was never chosen.
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
        let index = this.focusIndex;

        if (index < 0 || index >= controls.length)
            index = event.shiftKey ? 0 : -1;

        index = (index + delta + controls.length) % controls.length;

        this.focusIndex = index;
        controls[index].focus();
    };
}
