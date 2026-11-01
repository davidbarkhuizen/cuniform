// Runs bench/render-frame.html in headless Chrome and prints its markdown table: a collector for the
// real-canvas harness, with no dependencies beyond Node 22+ (its WebSocket) and a Chrome on PATH.
//
//   node bench/render-frame-collect.mjs <page url with query> [<page url> ...]
//
// Serve the directory holding cuniform (and, for ?model=, the model's repository) over HTTP first, e.g.
// `python3 -m http.server 8765` from ~/code, after `./cli build`. Each URL runs in a fresh tab; the
// harness sets document.title to "render-frame done" (or "... failed") and leaves its report on window.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "google-chrome";
const PORT = Number(process.env.CDP_PORT ?? 9333);
const TIMEOUT_MS = Number(process.env.FRAME_TIMEOUT_MS ?? 600000);

const urls = process.argv.slice(2);

if (urls.length === 0) {
    console.error("usage: node bench/render-frame-collect.mjs <render-frame.html url> [...]");
    process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), "cuniform-frames-"));
const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--remote-debugging-port=${PORT}`,
    // Node's WebSocket sends an Origin, which Chrome refuses unless allowed.
    "--remote-allow-origins=*",
    `--user-data-dir=${profile}`,
    "--window-size=1280,1000",
    "about:blank",
], { stdio: "ignore" });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function json(path, method = "GET") {
    for (let attempt = 0; attempt < 50; attempt++) {
        try {
            const response = await fetch(`http://127.0.0.1:${PORT}${path}`, { method });
            return await response.json();
        } catch {
            await sleep(200);
        }
    }

    throw new Error(`Chrome's DevTools endpoint never answered on port ${PORT}`);
}

/** One CDP session over a tab's WebSocket, with request/response matching by id. */
function session(webSocketUrl) {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let next = 1;

    socket.addEventListener("error", event => {
        throw new Error(`the DevTools WebSocket failed: ${event.message ?? "no detail"}`);
    });

    socket.addEventListener("message", event => {
        const message = JSON.parse(event.data);

        if (message.id !== undefined && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
        }
    });

    const opened = new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));

    return {
        opened,
        send: (method, params = {}) => new Promise(resolve => {
            const id = next++;
            pending.set(id, resolve);
            socket.send(JSON.stringify({ id, method, params }));
        }),
        close: () => socket.close(),
    };
}

async function evaluate(tab, expression) {
    const reply = await tab.send("Runtime.evaluate", { expression, returnByValue: true });
    return reply.result?.result?.value;
}

async function collect(url) {
    const target = await json(`/json/new?${encodeURIComponent(url)}`, "PUT");
    const tab = session(target.webSocketDebuggerUrl);
    await tab.opened;

    const started = Date.now();

    try {
        for (;;) {
            const title = await evaluate(tab, "document.title");

            if (title === "render-frame done")
                return await evaluate(tab, "window.__renderFrameReport.block");

            if (title === "render-frame failed")
                throw new Error(`${url}: the harness failed (see the page's console)`);

            if (Date.now() - started > TIMEOUT_MS)
                throw new Error(`${url}: no result after ${TIMEOUT_MS} ms`);

            await sleep(500);
        }
    } finally {
        tab.close();
        await json(`/json/close/${target.id}`).catch(() => {});
    }
}

try {
    for (const url of urls) {
        console.log(`\n${url}\n`);
        console.log(await collect(url));
    }
} finally {
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
}
