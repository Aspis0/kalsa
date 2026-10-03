// Two failed turns in one conversation, each with its own sentence. The app's
// thread used to carry one failure per conversation: the first failed turn
// showed the banner and every later failed turn rendered as an empty row that
// still carried the first turn's sentence above it. This harness builds the
// real app, stalls two completions so each turn fails on the client's own idle
// bound, and asserts both rows carry their own error block.
//
// Run: node scripts/turn-failures.mjs   (from chat/)

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build } from "vite";

const CHAT_DIR = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(CHAT_DIR, ".turn-failures-dist");

let fail = 0;
function check(label, condition, detail) {
  const ok = condition ? "ok  " : "FAIL";
  if (!condition) fail++;
  console.log(`${ok} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await build({
  root: CHAT_DIR,
  configFile: false,
  base: "./",
  logLevel: "silent",
  build: { outDir, emptyOutDir: true, target: "es2022" },
});

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };
const server = createServer((request, response) => {
  const path = decodeURIComponent((request.url ?? "/").split("?")[0]).replace(/^\/+/, "");
  const file = join(outDir, normalize(path.endsWith("/") || path === "" ? `${path}index.html` : path));
  if (!file.startsWith(outDir) || !existsSync(file)) {
    response.writeHead(404);
    response.end("not found");
    return;
  }
  response.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  response.end(readFileSync(file));
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.addInitScript(() => {
  localStorage.clear();
  // The idle bound is a minute; shrink it so the harness can watch it fire.
  const real = window.setTimeout.bind(window);
  window.setTimeout = ((fn, ms, ...rest) =>
    real(fn, typeof ms === "number" && ms >= 30000 ? 900 : ms, ...rest));
  window.__TAURI__ = {
    core: {
      invoke: async (command) => {
        if (command === "brain_state") return { kind: "running", endpoint: "http://127.0.0.1:18099/v1", model: "m" };
        if (command === "brain_host_credential") return "t";
        if (command === "brain_capability") return { kind: "unmeasured", chosen: true };
        if (command === "brain_previous_session_crashed") return false;
        if (command === "brain_log_event") return null;
        throw new Error(`stub missing ${command}`);
      },
    },
    event: { listen: () => Promise.resolve(() => {}) },
  };
});
await page.route("**/kalsa/chat/**", (route) => route.fulfill({ status: 204, body: "" }));
// A server that answers nothing: each turn ends on the client's idle bound.
await page.route("**/v1/chat/completions", () => {});
await page.goto(`${origin}/`);
await page.waitForTimeout(1200);
const chip = page.locator(".brain-bar-chat");
if ((await chip.count()) > 0) await chip.first().click();
await page.waitForTimeout(400);
const textarea = page.locator(".composer textarea");
await textarea.fill("first question");
await textarea.press("Enter");
await page.waitForTimeout(1800);
await textarea.fill("second question");
await textarea.press("Enter");
await page.waitForTimeout(1800);

const rows = await page.locator(".row-assistant").evaluateAll((els) =>
  els.map((el) => ({
    text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
    error: el.querySelector(".error-block") !== null,
  })),
);
check("two failed turns, two assistant rows", rows.length === 2, JSON.stringify(rows));
check("the first failed row keeps its own sentence", rows[0]?.error === true, JSON.stringify(rows[0] ?? null));
const TIMEOUT_TITLE = "Kalsa stopped answering after a minute without new words.";
check(
  "each row carries its own timeout sentence",
  rows[0]?.text.includes(TIMEOUT_TITLE) === true && rows[1]?.text.includes(TIMEOUT_TITLE) === true,
  JSON.stringify(rows.map((row) => row.text.slice(0, 60))),
);
check(
  "each row offers its own retry",
  (await page.locator(".error-block button").count()) === 2,
  String(await page.locator(".error-block button").count()),
);
const stored = await page.evaluate(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("crescent-chat.msgs.")) out[key] = JSON.parse(localStorage.getItem(key) ?? "[]");
  }
  return Object.values(out).flat();
});
const assistants = stored.filter((m) => m.role === "assistant");
check(
  "the store keeps both failed turns",
  assistants.length === 2 && assistants.every((m) => m.content === ""),
  JSON.stringify(assistants.map((m) => ({ role: m.role, len: m.content.length }))),
);

await browser.close();
server.close();
await rm(outDir, { recursive: true, force: true });

if (fail > 0) {
  console.log(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
