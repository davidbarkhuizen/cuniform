// The panel's text for a model and for a selected component (workplan D12): plain strings, which the UI
// writes with textContent. Pure, so the wording is tested without a DOM.

import { Component, Entry, InputSpec, NetworkModel, Parameter } from "./NetworkModel";

function number(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toPrecision(3);
}

function inputLabel(input: InputSpec): string {
    return input.kind === "flat"
        ? `dimension ${input.dimension}`
        : `image ${input.height}×${input.width}×${input.channels}`;
}

/** The model panel's lines: implementation, shape, input, width, bands, and the current level's counts. */
export function modelSummary(model: NetworkModel, counts: { bands: number; nodes: number; edges: number }): string[] {
    const lines = [
        `implementation: ${model.implementation}`,
        `shape: ${model.shape}`,
        `input: ${inputLabel(model.input)}`,
        `model width: ${model.width ?? "unknown"}`,
        `bands: ${counts.bands}`,
        `nodes: ${counts.nodes}, edges: ${counts.edges}`,
    ];

    if (model.recurrence !== null)
        lines.splice(4, 0, `factors: ${model.recurrence.factors.map(f => `${f.stateSize}${f.codes ? `/${f.codes.count} codes` : ""}`).join(", ")}${model.recurrence.cross ? ", cross" : ""}`);

    if (model.preset !== null)
        lines.push(`preset: ${model.preset}`);

    return lines;
}

function specValue(value: unknown): string {
    return typeof value === "number" ? number(value) : typeof value === "string" ? value : JSON.stringify(value);
}

function parameterLine(p: Parameter): string {
    const s = p.stats;
    return `${p.name} [${p.shape.join("×")}]: min ${number(s.min)}, max ${number(s.max)}, mean ${number(s.mean)}, rms ${number(s.rms)}`;
}

/** A selected component's lines: where it is, its spec fields, its units, and each weight's statistics. */
export function componentDetails(entry: Entry, component: Component): string[] {
    const lines: string[] = [
        `kind: ${entry.sourceKind === "recurrence" || entry.kind !== "unknown" ? component.kind.replace("_", " ") : `${entry.sourceKind} (unsupported)`}`,
        `at: ${entry.path}`,
        `units: ${component.units}`,
    ];

    for (const [key, value] of Object.entries(entry.spec))
        if (value !== null && value !== undefined)
            lines.push(`${key.replace("_", " ")}: ${specValue(value)}`);

    for (const p of component.parameters)
        lines.push(parameterLine(p));

    return lines;
}
