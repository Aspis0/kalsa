// One browser, two backends (one responsibility: the same handful of methods
// whichever engine is under the lab, so agent.mjs and verifiers.mjs never ask
// which one they are talking to).
//
//   node — Playwright from chat/node_modules, driven in process.
//   rs   — the standalone Rust binary in dev/lab-browser-rs, spoken to over
//          line-delimited JSON. Same tools, same snapshot text, same refs.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { find, snapshot } from "./snapshot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAYWRIGHT = resolve(HERE, "../../chat/node_modules/playwright-core/index.mjs");
export const RS_CRATE = resolve(HERE, "../lab-browser-rs");
export const RS_BINARY = resolve(RS_CRATE, "target/release/lab-browser-rs");

/** Refs go stale when the page moves, so one that no longer resolves is a real
 *  failure the model can recover from. Models echo the brackets we print. */
const brief = (error) => String(error?.message ?? error).split("\n")[0].slice(0, 300);

/** The Rust side takes an expression, not a function, and JSON drops function
 *  values without a word — so the source goes over the wire as text. Playwright
 *  takes the same text either way, which is what lets one verifier read both. */
const source = (expr) => (typeof expr === "function" ? expr.toString() : String(expr ?? ""));


const nodeBackend = async () => {
  const { chromium } = await import(PLAYWRIGHT);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  let url = null;

  const locator = (ref) => {
    const id = String(ref ?? "").trim().replace(/^\[|\]$/g, "");
    if (!id) throw new Error("that is not an element ref — snapshot to get the refs on this page");
    return page.locator(`aria-ref=${id}`).first();
  };
  const read = (opts) => snapshot(page, opts);

  const run = async (name, args = {}) => {
    try {
      switch (name) {
        case "browser_navigate": {
          const raw = String(args.url ?? "").trim();
          const target = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
          const response = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
          url = page.url();
          const warning = response?.ok() ? "" : `warning: the page answered ${response?.status() ?? "?"}\n`;
          return warning + (await read());
        }
        case "browser_snapshot": return await read({ part: args.page });
        case "browser_click": {
          await locator(args.ref).click({ timeout: 10000 });
          await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
          url = page.url();
          return await read();
        }
        case "browser_type": {
          const box = locator(args.ref);
          await box.click({ timeout: 10000 });
          await box.fill(String(args.text ?? ""));
          // Enter is not an argument here, exactly as in the product: it follows
          // a one-line field because the field is one line, form or no form —
          // the same rule the Rust crate applies in `input.rs`. `submit` used to
          // be read here and nowhere else, which is how the node backend and the
          // rs backend came to disagree about the very same page.
          // The list travels **inside** the expression: this runs in the page,
          // where nothing from this module exists, and a `ReferenceError` here
          // would be caught as "not a one-line field" and quietly press nothing.
          const oneLine = await box
            .evaluate((el) => {
              const one = ["text", "search", "email", "url", "tel", "number"];
              return el instanceof HTMLInputElement && one.includes(String(el.type).toLowerCase());
            })
            .catch(() => false);
          if (oneLine) await box.press("Enter");
          await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
          url = page.url();
          return await read();
        }
        default: return `error: there is no tool called ${name}`;
      }
    } catch (error) {
      return `error: ${brief(error)}`;
    }
  };

  return {
    name: "node",
    run,
    eval: (expr) => page.evaluate(expr),
    snapshot: (opts) => read(opts),
    find: (text) => find(page, text),
    get url() { return url; },
    close: async () => { await browser.close().catch(() => {}); },
  };
};

/** The Rust binary: one request per line in, one reply per line out. */
const rsBackend = async () => {
  const child = spawn(RS_BINARY, [], { stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map();
  let nextId = 0;
  let gone = null;
  let url = null;

  createInterface({ input: child.stdout }).on("line", (line) => {
    let reply;
    try {
      reply = JSON.parse(line);
    } catch {
      return; // a partial write is the driver's to retry, not ours to die on
    }
    const settle = waiting.get(reply.id);
    if (!settle) return;
    waiting.delete(reply.id);
    settle(reply);
  });

  child.on("exit", (code) => {
    gone = `the rust backend exited (code ${code})`;
    for (const settle of waiting.values()) settle({ ok: false, error: gone });
    waiting.clear();
  });

  const call = (tool, args = {}) =>
    new Promise((settle) => {
      if (gone) return settle({ ok: false, error: gone });
      const id = ++nextId;
      waiting.set(id, settle);
      child.stdin.write(`${JSON.stringify({ id, tool, args })}\n`);
    });

  // The snapshot's own header says where the page is, which is how the Rust
  // side reports a url without a second round trip on every tool.
  const remember = (text) => {
    const found = /^url: (.*)$/m.exec(String(text ?? ""));
    if (found) url = found[1];
    return text;
  };

  const text = async (tool, args) => {
    const reply = await call(tool, args);
    return reply.ok ? remember(reply.text) : `error: ${String(reply.error).split("\n")[0].slice(0, 300)}`;
  };

  // The binary launches a browser before it answers anything, so wait for the
  // first reply rather than sleeping a guessed number of seconds.
  const first = await text("browser_snapshot", {});
  if (String(first).startsWith("error:")) throw new Error(`the rust backend would not start: ${first}`);

  return {
    name: "rs",
    run: (tool, args) => text(tool, args),
    eval: async (expr) => {
      const reply = await call("page_eval", { expr: source(expr) });
      if (!reply.ok) throw new Error(String(reply.error));
      return JSON.parse(reply.text ?? "null");
    },
    snapshot: (opts) => text("browser_snapshot", opts ?? {}),
    find: (needle) => text("browser_find", { text: needle }),
    get url() { return url; },
    close: () => { child.stdin.end(); child.kill(); },
  };
};

/** Open the backend asked for. `--backend node` is the default. */
export async function openBackend(name = "node") {
  if (name === "node") return await nodeBackend();
  if (name === "rs") return await rsBackend();
  throw new Error(`unknown backend: ${name} (want node or rs)`);
}