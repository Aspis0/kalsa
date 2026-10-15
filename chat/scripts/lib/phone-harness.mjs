// Plumbing for the phone chat's scripts: the real modules compiled from src/ by
// esbuild, a fake Tauri bridge, a fake desktop loop, and the check counter. The
// scripts own their topics; this file owns none of them.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../../node_modules/esbuild/lib/main.js";

const CHAT_DIR = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPTS_DIR = fileURLToPath(new URL("..", import.meta.url));

let count = 0;
let fail = 0;

export function check(label, condition, detail) {
  count++;
  if (!condition) fail++;
  console.log(`${condition ? "ok  " : "FAIL"} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}

export function equal(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`);
}

export function summary() {
  console.log(`\n${count - fail} of ${count} checks passed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

// The bridge the page talks to. Every invoke is recorded; `answer` scripts what a
// command returns; `handlers` keeps what `listen` registered so a test can emit.
export const bridge = { calls: [], handlers: new Map(), unlistened: 0, answer: async () => undefined };
export const emit = (event, payload) => bridge.handlers.get(event)?.({ payload });
export const phoneEvents = () =>
  bridge.calls.filter((c) => c.command === "brain_phone_chat_event").map((c) => [c.args.event, c.args.data]);

function installEnvironment() {
  globalThis.localStorage = new MemoryStorage();
  globalThis.window = {
    // streamRound's idle timer is a browser one.
    setTimeout,
    clearTimeout,
    __TAURI__: {
      core: {
        invoke: (command, args) => {
          bridge.calls.push({ command, args });
          return Promise.resolve().then(() => bridge.answer(command, args));
        },
      },
      event: {
        listen: async (event, handler) => {
          bridge.handlers.set(event, handler);
          return () => {
            bridge.unlistened++;
            bridge.handlers.delete(event);
          };
        },
      },
    },
  };
}

async function compile(dir) {
  const outfile = join(dir, "phone.mjs");
  await build({
    stdin: {
      contents: `
        export { readPhoneRequest, requestIdOf } from "../src/lib/phone/phoneRequest.ts";
        export { phoneWire } from "../src/lib/phone/phoneWire.ts";
        export { phoneSink } from "../src/lib/phone/phoneEvents.ts";
        export { runPhoneTurn } from "../src/lib/phone/phoneTurn.ts";
        export { runPhoneRead } from "../src/lib/phone/phoneRead.ts";
        export { startPhoneChatRunner } from "../src/lib/phone/phoneRunner.ts";
        export { ChatRequestError } from "../src/lib/chat.ts";
        export { systemPrompt } from "../src/lib/attachments.ts";
        export { sentDatePhrase } from "../src/lib/sentDate.ts";
        export { streamChatCompletion } from "../src/lib/toolLoop.ts";
        export { offeredTools } from "../src/lib/tools/registry.ts";
        export { TABLES } from "../src/i18n/index.ts";
      `,
      resolveDir: SCRIPTS_DIR,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    outfile,
    nodePaths: [join(CHAT_DIR, "node_modules")],
    loader: { ".css": "empty" },
    logLevel: "silent",
    plugins: [
      {
        // attachments.ts imports the pdf.js worker as a `?url` asset; no PDF is read here.
        name: "vite-url-asset",
        setup(b) {
          b.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: "url-asset" }));
          b.onLoad({ filter: /.*/, namespace: "url-asset" }, () => ({ contents: 'export default "";', loader: "js" }));
        },
      },
    ],
  });
  return import(`${pathToFileURL(outfile).href}?cache=${Date.now()}`);
}

/** Compiles the phone modules and hands them to `run`; the temp build is removed after. */
export async function withPhone(run) {
  installEnvironment();
  const dir = await mkdtemp(join(tmpdir(), "kalsa-phone-chat-"));
  try {
    await run(await compile(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const SETTINGS = { endpoint: "http://127.0.0.1:8131", token: "test-token", model: "Gemma 4 E4B", webTools: true };
export const NOW = new Date(2026, 9, 15, 12);
export const USER = (content) => ({ role: "user", content });
export const turnOf = (messages, extra = {}) => ({ messages, replyFor: null, language: "en", ...extra });
const FACTS = { values: {}, status: "reported", chatTemplate: "", modalities: { vision: false, audio: false, video: false }, nctx: 8192 };
export const facts = (over = {}) => async () => ({ ...FACTS, ...over });
export const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

export const CARDS = {
  kind: "cards",
  items: [
    { id: "105", from: { name: "Ann", address: "ann@example.com" }, subject: "Hi", gist: "", date: null, labels: { label: "normal", reasons: [] } },
  ],
  bulk: 0,
};
export const DRAFT = { kind: "draft", replyToId: "105", to: "ann@example.com", toName: "", subject: "Re: Hi", body: "Ciao" };

/** A stand-in for the desktop loop: it keeps the options it was called with and plays `script`. */
export function fakeLoop(script) {
  const seen = { options: null };
  return {
    seen,
    loop: async (options) => {
      seen.options = options;
      await script(options);
    },
  };
}

/** A sink that writes into a log instead of the bridge. */
export function recorder(app) {
  const log = [];
  return { log, sink: app.phoneSink((event, data) => log.push([event, data])) };
}

export const terminals = (log) => log.filter(([event]) => event === "done" || event === "error").length;
