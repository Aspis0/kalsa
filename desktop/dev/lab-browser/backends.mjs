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

  // The held writes, held the way the product holds them: a submission is caught
  // in the page before the request exists, and anything else the page sends by
  // itself is caught by a route. **The node backend has to hold too**, or the two
  // backends would be measuring different products — the rs one holds, and a
  // task that fills a form would sit unanswered there and sail through here.
  const held = new Map();
  let heldSerial = 0;

  // Installed as an init script so it is there again after every navigation: a
  // listener on one document dies with that document.
  await page.addInitScript(() => {
    if (window.__kalsa) return;
    const catcher = { armed: false, mark: 0, caught: [] };
    window.__kalsa = catcher;
    addEventListener("submit", (event) => {
      const form = event.target;
      if (!catcher.armed || !form) return;
      catcher.armed = false;
      const submitter = event.submitter;
      const method = String((submitter?.getAttribute?.("formmethod")) || form.getAttribute("method") || "").toUpperCase() || "GET";
      if (method === "GET" || method === "DIALOG") return;
      event.preventDefault();
      let pairs = [];
      let hasFile = false;
      try {
        for (const [name, value] of new FormData(form, submitter)) {
          if (typeof value === "string") pairs.push([name, value]);
          else hasFile = true;
        }
      } catch {
        hasFile = true;
      }
      let where = location.href;
      try {
        where = new URL(form.getAttribute("action") || location.href, location.href).href;
      } catch {}
      catcher.caught.push({ method, url: where, pairs, hasFile, form, submitter: submitter || null });
    }, true);
  });

  const arm = () => page.evaluate(() => {
    const catcher = window.__kalsa;
    catcher.armed = true;
    catcher.mark = catcher.caught.length;
  });
  const caught = () => page.evaluate(() => {
    const catcher = window.__kalsa;
    catcher.armed = false;
    const one = catcher.caught[catcher.mark];
    return one ? { at: catcher.mark, method: one.method, url: one.url, pairs: one.pairs, hasFile: one.hasFile } : null;
  });

  /** Puts a caught submission on the window, with a card a person can read. */
  async function holdSubmission(where, method, pairs, hasFile) {
    if (hasFile) return "the request carries a file, and a card cannot show a file";
    if (pairs.map(([n, v]) => n.length + v.length + 1).reduce((a, b) => a + b, 0) > 16 * 1024) {
      return "the request carries a body too large to be shown";
    }
    const id = `c${++heldSerial}`;
    held.set(id, { method, url: where, pairs, at: held.size });
    return `awaiting confirm ${id}: this request is held and nothing has been sent. The person is shown what it carries and will decide. Nothing else is needed; the next call says what became of it.`;
  }

  /** The person's yes, and the request going for real. */
  async function answerOne(id, allow) {
    const one = held.get(String(id ?? "").trim());
    if (!one) return "there is no request waiting with that id";
    // The id is spent before anything is dispatched, so a second press finds
    // nothing and nothing is ever attempted twice.
    held.delete(String(id).trim());
    if (!allow) return "The person declined it. Nothing was sent and the page was left as it was.";
    // The ticket lets this one write past the route below, spent on first use.
    passNext.value = `${one.method} ${one.url}`;
    const fired = page
      .evaluate((at) => {
      const catcher = window.__kalsa;
      const record = catcher.caught[at];
      if (!record) return false;
      catcher.caught.splice(at, 1);
      if (!record.form?.isConnected) return false;
      try {
        if (record.submitter?.isConnected) record.form.requestSubmit(record.submitter);
        else record.form.requestSubmit();
        return true;
      } catch {
        return false;
      }
    }, one.at).catch(() => false);
    if (!sent) return "It was answered yes and could not be sent: the page had moved on. It is not retried.";
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    url = page.url();
    return "The person allowed it. It was sent as the card showed it.";
  }

  const locator = (ref) => {
    const id = String(ref ?? "").trim().replace(/^\[|\]$/g, "");
    if (!id) throw new Error("that is not an element ref — snapshot to get the refs on this page");
    return page.locator(`aria-ref=${id}`).first();
  };
  const read = (opts) => snapshot(page, opts);

  // One write the person just answered is let past the route, matched on its
  // method and address and spent on first use.
  const passNext = { value: null };
  await context.route("**/*", async (route) => {
    const request = route.request();
    const key = `${request.method().toUpperCase()} ${request.url()}`;
    if (passNext.value === key) {
      passNext.value = null;
      await route.continue();
      return;
    }
    if (["GET", "HEAD", "OPTIONS"].includes(request.method().toUpperCase())) {
      await route.continue();
      return;
    }
    const raw = request.postDataBuffer();
    const type = request.headers()["content-type"] ?? "";
    if (!raw || (!String(type).startsWith("application/x-www-form-urlencoded") && !String(type).startsWith("multipart/form-data"))) {
      await route.abort();
      return;
    }
    // A write the page made by itself: nothing navigates, so parking it does not
    // freeze the page, and the page's own id is what a card is drawn from.
    const id = `c${++heldSerial}`;
    held.set(id, { method: request.method(), url: request.url(), pairs: [], at: -1 });
    await new Promise(() => {});
  });

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
          await arm();
          await locator(args.ref).click({ timeout: 10000 });
          const taken = await caught();
          if (taken) {
            const sentence = await holdSubmission(taken.url, taken.method, taken.pairs, taken.hasFile);
            if (sentence.startsWith("awaiting")) return sentence;
          }
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
          // A key that submits is a navigation the page has been told not to
          // make, and Playwright waits on one anyway until it times out. The key
          // went in either way; losing the submission to that wait would lose
          // the write the person was about to be asked about.
          // `noWaitAfter` because Enter submits, and a submission is a
          // navigation this page has been told not to make: Playwright waits on
          // one that is never coming and the wait would eat the whole budget.
          // The key went in either way, and the write is read on the next line.
          if (oneLine) await box.press("Enter", { noWaitAfter: true }).catch(() => {});
          const taken = await caught();
          if (taken) {
            const sentence = await holdSubmission(taken.url, taken.method, taken.pairs, taken.hasFile);
            if (sentence.startsWith("awaiting")) return sentence;
          }
          await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
          url = page.url();
          return await read();
        }
        case "browser_confirm":
        case "browser_decline":
          return await answerOne(args.id, name === "browser_confirm");
        case "browser_waiting":
          return JSON.stringify([...held].map(([id, one]) => ({ id, method: one.method, url: one.url })));
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