// Rust's coded sentences reach the page through `lib/rustText.ts`: a group may
// name its codes by the path under it (`road.open`) or by the whole dotted code
// (`invite.no_road`). This pins both shapes in Italian, the fallback to the
// backend's own text for an unknown code and for malformed codes that name
// Object properties, and that every code Rust emits has a row in the English
// table.
//
// Run: node scripts/rust-codes.mjs   (from chat/)

import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../node_modules/esbuild/lib/main.js";

// Every group the `rust` table carries a row for. `chat.*`, `door.*` and
// `catalog.*` Rust also emits, but those never reach rustSentence (the thread,
// the machine card and internal paths own them), so they are neither checked
// nor wanted here.
const GROUPS = new Set(["app", "browser", "choice", "files", "invite", "pairing", "road", "startup", "update", "vision", "web"]);

// Dotted literals that share a group's name but are not error codes: a stored
// settings file, and the two telemetry event names.
// `browser.browser_open` and its five siblings are the tool pins in
// `src-tauri/src/browser/tool_pins.json`: a tool the sidecar declares, not a
// sentence that reaches the page. They are dotted and share a group's name, so
// they are named here rather than left to fail every run.
const TOOL_PINS = [
  "browser_click",
  "browser_find",
  "browser_open",
  "browser_read",
  "browser_screenshot",
  "browser_type",
];

// `browser.browser_preview` is a host-only tool name — one the host reaches and no model is offered (`crates/kalsa-mcp/src/host.rs` HOST_ONLY) — and never a sentence the page reads.
const HOST_ONLY = ["browser.browser_preview"];

const NOT_CODES = new Set([
  "pairing.json",
  "web.search",
  "web.fetch",
  ...TOOL_PINS.map((tool) => `browser.${tool}`),
  ...HOST_ONLY,
]);

/** The codes the Rust source carries, derived — not transcribed. Every dotted
    lowercase string literal under src-tauri/src and crates/, kept when its
    group is one the table has. The match is deliberately wider than the emit
    sites (they come in too many shapes to grep), so a code Rust adds fails
    this script until a row exists for it. */
function emittedCodes() {
  const root = new URL("../..", import.meta.url);
  const files = [
    ...readdirSync(new URL("src-tauri/src", root), { recursive: true }),
    ...readdirSync(new URL("crates", root), { recursive: true }),
  ]
    .filter((name) => String(name).endsWith(".rs"))
    .map((name) => {
      for (const base of ["src-tauri/src/", "crates/"]) {
        try {
          return readFileSync(new URL(base + name, root), "utf8");
        } catch {
          // Not under this base — the other one has it.
        }
      }
      return "";
    });
  const codes = new Set();
  for (const source of files) {
    for (const match of source.matchAll(/"([a-z_]+\.[a-z_]+)"/g)) {
      const code = match[1];
      if (GROUPS.has(code.split(".")[0]) && !NOT_CODES.has(code)) codes.add(code);
    }
  }
  return [...codes].sort();
}
const EMITTED = emittedCodes();

// The codes the chat itself puts on a refusal. They reach the page through the
// same `rust` table — the browser's row and the web's row ask it by code — so
// they are checked with the rest: a code the app emits without a row is a code
// the person reads as the app's one-line shrug.
const APP_CODES = ["web.armed", "web.link_unseen", "web.switch_off"];

let fail = 0;
function check(label, condition, detail) {
  if (!condition) fail++;
  console.log(`${condition ? "ok  " : "FAIL"} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}

let dir = null;
try {
  dir = await mkdtemp(join(tmpdir(), "kalsa-rust-codes-"));
  const outfile = join(dir, "app.mjs");
  await build({
    stdin: {
      contents: `
        export { rustSentence, codeSentence } from "../src/lib/rustText.ts";
        export { TABLES } from "../src/i18n/index.ts";
      `,
      resolveDir: fileURLToPath(new URL(".", import.meta.url)),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "silent",
  });
  const { rustSentence, codeSentence, TABLES } = await import(pathToFileURL(outfile).href);
  const it = TABLES.it.rust;

  const noRoad = rustSentence(it, { code: "invite.no_road", text: "English text" }, "it");
  check("a dotted-key group resolves (invite.no_road, IT)", noRoad === it.invite["invite.no_road"]({}, "it") && noRoad.includes("Collegamento via internet"), noRoad);
  const hostForget = rustSentence(it, { code: "pairing.host_forget", text: "English text" }, "it");
  check("a dotted-key group resolves (pairing.host_forget, IT)", hostForget === "La connessione di questo computer non può essere rimossa.", hostForget);
  const open = rustSentence(it, { code: "road.open", text: "Internet connection is on." }, "it");
  check("a nested group resolves (road.open, IT)", open === "Il collegamento via internet è attivo.", open);
  const unknown = rustSentence(it, { code: "road.not_a_code", text: "The backend's own words" }, "it");
  check("an unknown code falls back to the backend text", unknown === "The backend's own words", unknown);
  check("an unknown group is null, not a throw", codeSentence(it, "nothing.here", {}, "it") === null);

  // A malformed or future IPC code must never call an inherited property or
  // hand JSX a non-string: the backend's own text stands in.
  for (const code of ["app.constructor", "invite.__proto__", "app.toString", "constructor", ""]) {
    const said = rustSentence(it, { code, text: "The backend's own words", params: { gb: 1 } }, "it");
    check(`a malformed code falls back: ${JSON.stringify(code)}`, said === "The backend's own words", String(said));
    check(`a malformed code is not a row: ${JSON.stringify(code)}`, codeSentence(it, code, { gb: 1 }, "it") === null);
  }

  const missing = [...EMITTED, ...APP_CODES].filter((code) => codeSentence(TABLES.en.rust, code, { gb: 1, limit: "10 MB" }, "en") === null);
  check("every code Rust emits has an English row", missing.length === 0, missing.join(", "));
  for (const lang of ["it", "es", "fr", "zh"]) {
    const lacking = [...EMITTED, ...APP_CODES].filter((code) => codeSentence(TABLES[lang].rust, code, { gb: 1, limit: "10 MB" }, lang) === null);
    check(`every code Rust emits has a ${lang} row`, lacking.length === 0, lacking.join(", "));
  }

  // **The unseen link's row names the host the open was asked for, and
  // nothing else.** A host, so the person knows which page failed; no path, no
  // query, and no address that is not public http(s) — the app's own reading
  // of its own argument is what names it, and it is a host.
  for (const lang of ["en", "it", "es", "fr", "zh"]) {
    const said = codeSentence(TABLES[lang].rust, "web.link_unseen", { host: "shop.example", path: "products/one" }, lang) ?? "";
    check(`the unseen link's row names the host and nothing else (${lang})`, said.includes("shop.example") && !said.includes("products"), said);
    const plain = codeSentence(TABLES[lang].rust, "web.link_unseen", {}, lang) ?? "";
    check(`the unseen link's row says something without a host (${lang})`, plain.trim() !== "" && !plain.includes("undefined"), plain);
  }

  // **A refused click, a read or a picture is not a refused open.** The open is
  // the one action that names a host and says "couldn't open"; every other
  // action gets the plain lead, because a row that calls a refused click a
  // failed open is a row about something that never happened.
  const LEADS = {
    en: { open: "couldn't open", step: "can't do that here" },
    it: { open: "non è riuscita ad aprire", step: "non può farlo qui" },
    es: { open: "no pudo abrir", step: "no puede hacer eso aquí" },
    fr: { open: "n'a pas pu ouvrir", step: "ne peut pas faire ça ici" },
    zh: { open: "无法打开", step: "不能在这里做这件事" },
  };
  for (const lang of ["en", "it", "es", "fr", "zh"]) {
    for (const code of ["web.armed", "web.switch_off"]) {
      for (const action of ["browser_click", "browser_type", "browser_read", "browser_screenshot"]) {
        const step = codeSentence(TABLES[lang].rust, code, { action, host: "shop.example" }, lang) ?? "";
        check(
          `a refused ${action} is not an open (${code}, ${lang})`,
          step.includes(LEADS[lang].step) && !step.includes(LEADS[lang].open) && !step.includes("shop.example"),
          step,
        );
      }
      const opened = codeSentence(TABLES[lang].rust, code, { action: "browser_open", host: "shop.example" }, lang) ?? "";
      check(`a refused open names the host (${code}, ${lang})`, opened.includes(LEADS[lang].open) && opened.includes("shop.example"), opened);
    }
  }
} finally {
  if (dir) await rm(dir, { recursive: true, force: true });
}

console.log(fail === 0 ? "\nall checks passed" : `\n${fail} check(s) failed`);
process.exit(fail === 0 ? 0 : 1);
