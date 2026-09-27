import test from "node:test";
import assert from "node:assert/strict";

import { GraphFactory } from "../src/graph/GraphFactory";
import { defaultGraphSpec, specLabel } from "../src/graph/GraphSpec";
import { UIController } from "../src/app/UIController";
import { moleculeById } from "../src/graph/Molecules";
import { catalogEntry } from "./support/catalog";
import {
    CANVAS_EVENTS,
    el,
    generateRandom,
    keyEvent,
    mouseEvent,
    withUIController,
} from "./support/dom";

/** A comparable snapshot of the live camera, which a reset must not disturb. */
function cameraState(controller: UIController) {
    const camera = controller.state.camera;

    return {
        orientation: [...camera.orientation],
        target: { ...camera.target },
        distance: camera.distance,
    };
}

function chooseMolecule(controller: UIController, id: string): void {
    const wizard = controller.wizard!;

    const molecules = wizard.choiceButtons.find(choice => choice.kind === "molecules")!;
    el(molecules.element).dispatch("click");

    const tag = wizard.tags.find(candidate => candidate.entry.id === id);
    assert.ok(tag, `no chip for ${id}`);

    el(tag!.element).dispatch("click");
}

// ---------------------------------------------------------------- opening

test("onReset opens the chooser and leaves the running graph identical", () => {
    withUIController(({ controller }) => {
        const before = controller.solver.graph;

        controller.onReset();

        assert.ok(controller.wizard, "reset opens the chooser");
        assert.equal(controller.wizard!.isOpen, true);
        assert.equal(controller.wizard!.step, "choose");
        assert.equal(controller.solver.graph, before, "the graph is untouched until a choice");
    });
});

test("onReset suppresses the link's default navigation", () => {
    withUIController(({ controller }) => {
        const event = mouseEvent({});

        const result = controller.onReset(event);

        assert.equal(event.defaultPrevented, true);
        assert.equal(result, false);
    });
});

test("the first-run chooser is mandatory and cannot be cancelled", () => {
    withUIController(({ controller }) => {
        controller.onReset();

        const wizard = controller.wizard!;

        assert.equal(el(wizard.cancelButton).style.display, "none", "cancel is hidden");

        el(wizard.element).dispatch("keydown", keyEvent({ key: "Escape" }));

        assert.equal(wizard.isOpen, true, "Escape is a no-op on the first run");
        assert.ok(controller.wizard === wizard, "the chooser stays with the controller");
    });
});

test("a chooser after a choice is dismissible and seeded from that choice", () => {
    withUIController(({ controller }) => {
        controller.onReset();

        const first = controller.wizard!;
        generateRandom(first, 7, 3);

        controller.onReset();

        const second = controller.wizard!;

        assert.notEqual(el(second.cancelButton).style.display, "none", "a reset is dismissible");

        const random = second.choiceButtons.find(choice => choice.kind === "random")!;
        el(random.element).dispatch("click");

        assert.equal(second.orderInput.value, "7", "the last random choice seeds the form");
        assert.equal(second.branchingInput.value, "3");
    });
});

// ------------------------------------------------------------- completing

test("completing with a random spec swaps the graph and re-registers nothing", () => {
    withUIController(({ dom, elements, canvas, controller }) => {
        // Move the camera first, so a reset that churned it would be visible.
        controller.state.camera.orbit(40, 10);
        controller.state.camera.dolly(1);

        const cameraBefore = cameraState(controller);
        const framesBefore = dom.animationFrames.length;

        controller.onReset();

        const wizard = controller.wizard!;
        generateRandom(wizard, 6, 1);

        assert.equal(controller.solver.graph.vertices.length, 6);
        assert.ok(controller.wizard === null, "the chooser closes on completion");
        assert.equal(controller.spec?.kind, "random");

        assert.equal(dom.animationFrames.length, framesBefore, "the simulation loop must not be churned");
        assert.equal(elements.body.children.length, 1, "no second context menu");

        for (const type of CANVAS_EVENTS)
            assert.equal(canvas.listenerCount(type), 1, `canvas must still listen for ${type} once`);

        assert.equal(elements.reset_link.listenerCount('click'), 1, "reset still listens exactly once");
        assert.deepEqual(cameraState(controller), cameraBefore, "the camera survives a reset");
    });
});

test("completing with a molecule spec builds that molecule's graph", () => {
    withUIController(({ controller }) => {
        const entry = catalogEntry("ibogaine");

        controller.state.camera.orbit(25, 0);
        const cameraBefore = cameraState(controller);

        controller.onReset();
        chooseMolecule(controller, "ibogaine");

        assert.equal(controller.solver.graph.vertices.length, entry.heavyAtoms);
        assert.equal(controller.solver.graph.edges.length, entry.topology.bonds.length);
        assert.deepEqual(controller.spec, { kind: "molecule", id: "ibogaine" });
        assert.ok(controller.wizard === null);
        assert.deepEqual(cameraState(controller), cameraBefore, "the camera survives a molecule swap");
    });
});

test("the panel's graph line names the loaded graph", () => {
    withUIController(({ elements, controller }) => {
        assert.equal(
            elements.currentGraphLabel.innerHTML,
            specLabel(defaultGraphSpec()),
            "the placeholder's default label is technical"
        );

        controller.onReset();
        chooseMolecule(controller, "ibogaine");

        assert.equal(
            elements.currentGraphLabel.innerHTML,
            moleculeById("ibogaine").systematicName,
            "the line carries the systematic name, not the chip"
        );
        assert.notEqual(
            elements.currentGraphLabel.innerHTML,
            moleculeById("ibogaine").commonName
        );

        controller.onReset();
        const wizard = controller.wizard!;
        generateRandom(wizard, 5, 2);

        assert.equal(
            elements.currentGraphLabel.innerHTML,
            specLabel({ kind: "random", order: 5, branching: 2 })
        );
    });
});

// -------------------------------------------------------------- cancelling

test("cancelling leaves the graph, timer, listeners and camera untouched", () => {
    withUIController(({ dom, elements, canvas, controller }) => {
        // A first choice makes the next chooser dismissible.
        controller.onReset();
        const first = controller.wizard!;
        generateRandom(first, 6, 2);

        controller.state.camera.orbit(30, 10);

        const graph = controller.solver.graph;
        const cameraBefore = cameraState(controller);
        const framesBefore = dom.animationFrames.length;

        controller.onReset();
        const wizard = controller.wizard!;
        assert.notEqual(el(wizard.cancelButton).style.display, "none", "a reset is dismissible");

        el(wizard.cancelButton).dispatch("click");

        assert.equal(controller.solver.graph, graph, "the graph object is identical");
        assert.ok(controller.wizard === null, "the chooser is closed");
        assert.equal(dom.animationFrames.length, framesBefore, "the simulation loop is untouched");
        assert.deepEqual(cameraState(controller), cameraBefore, "the camera is untouched");

        for (const type of CANVAS_EVENTS)
            assert.equal(canvas.listenerCount(type), 1, `canvas still listens for ${type} once`);

        assert.equal(elements.reset_link.listenerCount('click'), 1);
        assert.equal(canvas.focused, true, "focus returns to the canvas through onDismiss");
    });
});

// ------------------------------------------------------------ composition

test("openGraphWizard closes an open context menu", () => {
    withUIController(({ canvas, controller }) => {
        canvas.dispatch('mousedown', mouseEvent({ button: 2, clientX: 250, clientY: 150 }));
        canvas.dispatch('contextmenu', mouseEvent({ clientX: 250, clientY: 150 }));

        assert.equal(controller.contextMenu!.isOpen, true);

        controller.openGraphWizard();

        assert.equal(controller.contextMenu!.isOpen, false, "the two overlays never share the screen");
        assert.equal(controller.wizard!.isOpen, true);
    });
});

test("terminate removes an open chooser", () => {
    withUIController(({ elements, controller }) => {
        controller.onReset();
        assert.ok(controller.wizard);
        assert.equal(elements.body.children.length, 2, "the menu and the chooser");

        controller.terminate();

        assert.ok(controller.wizard === null);
        assert.equal(elements.body.children.length, 0, "both overlays are gone");
    });
});

test("initialize with a chosen spec rebuilds that spec", () => {
    withUIController(({ controller }) => {
        controller.onReset();

        const wizard = controller.wizard!;
        generateRandom(wizard, 6, 2);

        const chosen = controller.spec;
        assert.deepEqual(chosen, { kind: "random", order: 6, branching: 2 });

        controller.initialize();

        assert.deepEqual(controller.spec, chosen, "the choice survives initialize()");
        assert.equal(controller.solver.graph.vertices.length, 6, "initialize rebuilds the chosen spec");
        assert.ok(controller.wizard === null, "initialize does not reopen the chooser");
    });
});

test("loadGraph swaps the graph in place and clears the pointer flags", () => {
    withUIController(({ controller }) => {
        controller.state.b0Down = true;
        controller.state.b1Down = true;
        controller.state.b2Down = true;

        const graph = new GraphFactory().generateMolecule("harmine");
        controller.loadGraph(graph);

        assert.equal(controller.solver.graph, graph);
        assert.equal(controller.state.b0Down, false);
        assert.equal(controller.state.b1Down, false);
        assert.equal(controller.state.b2Down, false);
        assert.equal(controller.state.lastMiddleDragPos, null);
    });
});
