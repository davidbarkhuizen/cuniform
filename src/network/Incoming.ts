// How a component's units read their inputs, for the unit level's weight edges (workplan D7 L1): a matrix
// (row r is unit r, column c input feature c), a diagonal (unit r reads input r alone), or nothing. The
// views read the reader's Float32Arrays in place; nothing is copied.

import { Component, Entry, Parameter } from "./NetworkModel";

export type Incoming =
    | { kind: "matrix"; rows: number; cols: number; at(r: number, c: number): number }
    | { kind: "diagonal"; rows: number; at(r: number): number };

function parameter(component: Component, name: string): Parameter | undefined {
    return component.parameters.find(p => p.name === name);
}

/** The value of largest magnitude among `values`, sign kept. */
function strongest(a: number, b: number, c: number = 0): number {
    const x = Math.abs(a) >= Math.abs(b) ? a : b;
    return Math.abs(x) >= Math.abs(c) ? x : c;
}

function matrix(p: Parameter | undefined): Incoming | null {
    if (p === undefined || p.shape.length !== 2)
        return null;

    const [rows, cols] = p.shape;
    const data = p.data;

    return { kind: "matrix", rows, cols, at: (r, c) => data[r * cols + c] };
}

function diagonal(rows: number, at: (r: number) => number): Incoming {
    return { kind: "diagonal", rows, at };
}

export function incomingOf(entry: Entry, component: Component): Incoming | null {

    const units = component.units;

    switch (component.kind) {

        case "dense":
        case "attention_output":
            return matrix(component.kind === "dense" ? parameter(component, "W") : parameter(component, "Wo"));

        case "codes":
            return matrix(parameter(component, "E"));

        case "head": {
            // A head's unit reads the tokens through its query, key and value rows; the strongest of the three.
            const [wq, wk, wv] = ["Wq", "Wk", "Wv"].map(name => parameter(component, name));

            if (!wq || !wk || !wv || wq.shape.length !== 2)
                return null;

            const cols = wq.shape[1];

            return {
                kind: "matrix",
                rows: units,
                cols,
                at: (r, c) => strongest(wq.data[r * cols + c], wk.data[r * cols + c], wv.data[r * cols + c]),
            };
        }

        case "conv": {
            // Output channel r reads input channel c through a k x k kernel; its strongest tap.
            const w = parameter(component, "W");
            const k = typeof entry.spec.kernel_size === "number" ? entry.spec.kernel_size : 0;

            if (!w || w.shape.length !== 2 || k === 0)
                return null;

            const fanIn = w.shape[1];
            const taps = k * k;

            return {
                kind: "matrix",
                rows: units,
                cols: fanIn / taps,
                at: (r, c) => {
                    let best = 0;

                    for (let t = 0; t < taps; t++)
                        best = strongest(best, w.data[r * fanIn + c * taps + t]);

                    return best;
                },
            };
        }

        case "cell": {
            // State feature r is gated by rows r, s + r and 2s + r of W (reset, update, candidate).
            const w = parameter(component, "W");

            if (!w || w.shape.length !== 2)
                return null;

            const cols = w.shape[1];

            return {
                kind: "matrix",
                rows: units,
                cols,
                at: (r, c) => strongest(w.data[r * cols + c], w.data[(units + r) * cols + c], w.data[(2 * units + r) * cols + c]),
            };
        }

        case "layer_norm":
        case "batch_norm": {
            const gamma = parameter(component, "gamma");
            return gamma ? diagonal(units, r => gamma.data[r]) : null;
        }

        case "pooling": {
            const q = parameter(component, "q");
            return q ? diagonal(units, r => q.data[r]) : null;
        }

        case "position":
        case "state_input":
        case "add":
        case "merge":
        case "token_mean":
        case "pool":
            // Each feature passes through (added to, normalised, or pooled over positions): a unit diagonal.
            return diagonal(units, () => 1);

        default:
            // An embedding, patches and an initial state read no units; an unknown kind's reading is unknown.
            return null;
    }
}
