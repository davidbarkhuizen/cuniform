// Where a model comes from (workplan D3): every source hands the reader a parsed JSON object, so a server
// source joins later behind the same interface without touching the reader or the graph. A server's view
// payload (format 2 without optimizer_state and rng) needs no reader change: the reader ignores both.

export interface ModelSource {
    /** What the panel calls the model: a file name or a URL's last segment. */
    readonly name: string;
    load(): Promise<unknown>;
}

/** The slice of a `File` a source reads; a test passes a stand-in. */
export interface TextFile {
    readonly name: string;
    text(): Promise<string>;
}

/** A local file, from the picker or a drop onto the canvas. */
export function fileSource(file: TextFile): ModelSource {
    return {
        name: file.name,
        load: async () => JSON.parse(await file.text()),
    };
}

/** The slice of `fetch` a URL source needs; injected so tests run without a network. */
export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** A URL, for `?model=<url>` against a local static server during development. */
export function urlSource(url: string, fetcher: Fetcher = (u: string) => fetch(u)): ModelSource {
    const segments = url.split(/[?#]/)[0].split("/").filter(segment => segment.length > 0);

    return {
        name: segments[segments.length - 1] ?? url,
        load: async () => {
            const response = await fetcher(url);

            if (!response.ok)
                throw new Error(`fetching ${url} answered HTTP ${response.status}`);

            return response.json();
        },
    };
}

/** The `model` query parameter of a location's search string, or null. */
export function modelParameter(search: string): string | null {
    const value = new URLSearchParams(search).get("model");

    return value === null || value.trim() === "" ? null : value;
}
