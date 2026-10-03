// The real chat app on a completion stream the test releases chunk by chunk.
//
// A mid-stream assertion needs a known boundary, so the app's own server
// answers here and does not write the next chunk until the test asks for it
// (`release`); `until(n)` waits until n chunks have been written. Nothing in
// the stream is timed, so "what does the message look like between token three
// and token four" is a question with an answer instead of a race.
//
// The page is the real `vite build`, served under the app's own CSP (read from
// src-tauri/tauri.conf.json): the blocked-image and no-foreign-fetch checks
// only mean something under the policy the desktop app ships. `__TAURI__` is
// the same shim turn-failures.mjs uses — the app asks Rust for the brain's
// endpoint and this harness answers with its own server.

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "@playwright/test";
import { build } from "vite";

export const ENGINES = { chromium, webkit };
const CHAT_DIR = fileURLToPath(new URL("../..", import.meta.url));
const OUT_DIR = join(CHAT_DIR, ".stream-app-dist");

let failed = 0;

export function check(label, condition, detail) {
  if (!condition) failed += 1;
  console.log(
    `${condition ? "ok  " : "FAIL"} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`,
  );
}

export function failedChecks() {
  return failed;
}

/** Bounded wait for a page condition: false instead of a thrown timeout, so a
    failed check is reported with its own detail rather than ending the run. */
export async function probe(page, condition, arg, timeout = 5000) {
  try {
    await page.waitForFunction(condition, arg, { timeout });
    return true;
  } catch {
    return false;
  }
}

/** The completions endpoint, driven by the test instead of by a clock. */
export function scriptedEndpoint() {
  let planned = [];
  let written = 0;
  let released = 0;
  const waiters = [];
  const notify = () => {
    for (const wake of waiters.splice(0)) wake();
  };
  const waitFor = async (done) => {
    while (!done()) await new Promise((wake) => waiters.push(wake));
  };
  return {
    /** The chunks the next turn answers with. Releases made before the turn's
        request arrives count for it, so the two counters start here. */
    plan(chunks) {
      planned = chunks;
      written = 0;
      released = 0;
    },
    written: () => written,
    /** Waits for the nth chunk; a stream that stops is a loud failure, not a
        harness that never returns. */
    async until(n, timeoutMs = 20000) {
      const deadline = Date.now() + timeoutMs;
      while (written < n) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`the brain wrote ${written} of the ${n} chunks awaited`);
        await Promise.race([
          new Promise((wake) => waiters.push(wake)),
          new Promise((wake) => setTimeout(wake, left)),
        ]);
      }
    },
    /** Let the server write its next chunk. */
    release() {
      released += 1;
      notify();
    },
    /** One turn, one chunk at a time. */
    async answer(response) {
      const chunks = planned;
      planned = [];
      for (let at = 0; at < chunks.length; at += 1) {
        if (at > 0) await waitFor(() => released >= at);
        const delta = { choices: [{ delta: { content: chunks[at] } }] };
        response.write(`data: ${JSON.stringify(delta)}\n\n`);
        written = at + 1;
        notify();
      }
      response.write("data: [DONE]\n\n");
      response.end();
    },
  };
}

/** The app's shipped policy, verbatim. */
export function appCsp() {
  const conf = JSON.parse(
    readFileSync(join(CHAT_DIR, "..", "src-tauri", "tauri.conf.json"), "utf8"),
  );
  return conf.app.security.csp;
}

/** Builds the real frontend; the caller owns removing `.stream-app-dist`. */
export async function buildApp() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  await build({
    root: CHAT_DIR,
    configFile: false,
    base: "./",
    logLevel: "silent",
    build: { outDir: OUT_DIR, emptyOutDir: true, target: "es2022" },
  });
  return OUT_DIR;
}

/** Serves the build the way the Tauri webview receives it. */
export async function serveDist(outDir, csp) {
  const MIME = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
  };
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0]).replace(/^\/+/, "");
    const file = join(outDir, normalize(path.endsWith("/") || path === "" ? `${path}index.html` : path));
    if (!file.startsWith(outDir) || !existsSync(file)) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Content-Security-Policy": csp,
    });
    response.end(readFileSync(file));
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close(),
  };
}

/** The brain behind the app: `/props` as a blind model with a fixed window,
    the slot routes silent, and the driven completion above. */
export async function startBrain(brain) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
  };
  const server = createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, CORS);
      response.end();
      return;
    }
    if ((request.url ?? "").includes("/props")) {
      response.writeHead(200, { "Content-Type": "application/json", ...CORS });
      response.end(
        JSON.stringify({
          default_generation_settings: { n_ctx: 4096 },
          modalities: { vision: false, audio: false, video: false },
          chat_template: "",
        }),
      );
      return;
    }
    if ((request.url ?? "").includes("/kalsa/chat/")) {
      response.writeHead(204, CORS);
      response.end();
      return;
    }
    if ((request.url ?? "").includes("/chat/completions")) {
      request.resume();
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...CORS });
      void brain.answer(response);
      return;
    }
    response.writeHead(404, CORS);
    response.end("not found");
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    endpoint: `${origin}/v1`,
    close: () => server.close(),
  };
}

/** One engine, the chat open, the brain answered by this harness. */
export async function launchChat(engineName, { origin, endpoint }) {
  const browser = await ENGINES[engineName].launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const requests = [];
  const errors = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript((brainEndpoint) => {
    window.__TAURI__ = {
      core: {
        invoke: async (command) => {
          if (command === "brain_state")
            return { kind: "running", endpoint: brainEndpoint, model: "m" };
          if (command === "brain_host_credential") return "t";
          if (command === "brain_capability") return { kind: "unmeasured", chosen: true };
          if (command === "brain_previous_session_crashed") return false;
          if (command === "brain_log_event") return null;
          throw new Error(`stub missing ${command}`);
        },
      },
      event: { listen: () => Promise.resolve(() => {}) },
    };
  }, endpoint);
  await page.goto(`${origin}/`);
  await page.waitForSelector(".brain-bar-chat, .composer textarea");
  const chip = page.locator(".brain-bar-chat");
  if ((await chip.count()) > 0) await chip.first().click();
  await page.waitForSelector(".composer textarea");
  return {
    page,
    requests,
    errors,
    async send(text) {
      const box = page.locator(".composer textarea");
      await box.fill(text);
      await box.press("Enter");
    },
    /** False while the answer is still arriving — the app's own word for it. */
    async settled() {
      return probe(page, () => document.querySelector(".thread")?.getAttribute("aria-busy") === "false", null, 15000);
    },
    async close() {
      await browser.close();
    },
  };
}
