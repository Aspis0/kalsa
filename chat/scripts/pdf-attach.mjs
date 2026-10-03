// PDF attachment, against the real build config: `vite build` emits the
// `pdf.worker.min.mjs?url` asset exactly as the app ships it, and the page is
// served under the app's own CSP (read from src-tauri/tauri.conf.json). The
// page then extracts a generated text PDF through the real `extractAttachment`.
//
// Two things are pinned here. The cause: pdf.js considers a tauri:// page
// cross-origin (the URL API gives a custom scheme an opaque origin), wraps its
// worker in a blob:, and the CSP refuses that blob. The fix: the worker is
// handed over as a port, so no blob is ever minted and the file reads.
//
// Run: node scripts/pdf-attach.mjs   (from chat/)

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build } from "vite";

const CHAT_DIR = fileURLToPath(new URL("..", import.meta.url));
const probeDir = join(CHAT_DIR, ".pdf-attach-probe");
const outDir = join(CHAT_DIR, ".pdf-attach-dist");

let fail = 0;
function check(label, condition, detail) {
  const ok = condition ? "ok  " : "FAIL";
  if (!condition) fail++;
  console.log(`${ok} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}

/** A one-page text PDF, the smallest the picker would ever see. */
function makePdf(text) {
  const enc = (s) => Buffer.from(s, "latin1");
  const stream = enc(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`);
  return Buffer.concat([
    enc("%PDF-1.4\n"),
    enc("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
    enc("2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n"),
    enc("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"),
    enc("4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>\nendobj\n"),
    enc(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n`),
    stream,
    enc("\nendstream\nendobj\n"),
    enc("trailer\n<< /Size 6 /Root 1 0 R >>\n%%EOF"),
  ]);
}

const csp = JSON.parse(
  await readFile(join(CHAT_DIR, "..", "src-tauri", "tauri.conf.json"), "utf8"),
).app.security.csp;

await rm(probeDir, { recursive: true, force: true });
await rm(outDir, { recursive: true, force: true });
await mkdir(probeDir, { recursive: true });
await writeFile(
  join(probeDir, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><title>pdf probe</title></head><body><script type="module" src="./main.ts"></script></body></html>`,
);
await writeFile(
  join(probeDir, "main.ts"),
  `import * as pdfjsLib from "pdfjs-dist";
import { extractAttachment } from "../src/lib/attachments";
(window as unknown as { __PDF__: unknown }).__PDF__ = { extractAttachment, pdfjsLib };
`,
);
await build({
  root: CHAT_DIR,
  configFile: false,
  base: "./",
  logLevel: "silent",
  build: {
    outDir,
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: { input: join(probeDir, "index.html") },
  },
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
  response.writeHead(200, {
    "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    "Content-Security-Policy": csp,
  });
  response.end(readFileSync(file));
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();
const messages = [];
page.on("console", (message) => messages.push(message.text()));
page.on("pageerror", (error) => messages.push(String(error)));
await page.addInitScript(() => {
  window.__workers = [];
  window.__blobs = [];
  window.__sameOriginCalls = 0;
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    constructor(url, options) {
      window.__workers.push(String(url));
      super(url, options);
    }
  };
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (object) => {
    const url = create(object);
    window.__blobs.push(url);
    return url;
  };
});
await page.goto(`${origin}/.pdf-attach-probe/`);

// 1. The cause, in pdf.js's own decision: a tauri:// URL is "cross-origin" to
//    the URL API, so pdf.js wraps the worker in a blob — and the app's CSP
//    refuses that blob.
const decision = await page.evaluate(async () => {
  const { pdfjsLib } = window.__PDF__;
  const base = "tauri://localhost/index.html";
  const worker = "tauri://localhost/assets/pdf.worker.min-test.mjs";
  const sameOrigin = pdfjsLib.PDFWorker._isSameOrigin(base, worker);
  const wrapped = pdfjsLib.PDFWorker._createCDNWrapper(worker);
  const blocked = await new Promise((resolve) => {
    try {
      const probe = new Worker(wrapped, { type: "module" });
      probe.addEventListener("error", () => resolve(true), { once: true });
      setTimeout(() => resolve(false), 400);
    } catch {
      resolve(true);
    }
  });
  return { sameOrigin, wrappedIsBlob: wrapped.startsWith("blob:"), blocked };
});
check("pdf.js calls a tauri:// worker cross-origin", decision.sameOrigin === false, JSON.stringify(decision));
check("the wrapper is a blob: worker", decision.wrappedIsBlob);
check("the app's CSP refuses that blob worker", decision.blocked);
check(
  "the refusal is the CSP's own words",
  messages.some((line) => line.includes("Content Security Policy") && line.includes("blob:")),
  messages.slice(-2).join(" | "),
);

// 2. The fix, under the tauri decision the page cannot have: force pdf.js's
//    cross-origin answer, then extract. The port path must not consult it, and
//    no blob may be minted.
const before = messages.length;
const extraction = await page.evaluate(async (base64) => {
  const { extractAttachment, pdfjsLib } = window.__PDF__;
  // Step 1's deliberate probe keeps its own worker and blob out of the fix's
  // numbers.
  window.__workers = [];
  window.__blobs = [];
  window.__sameOriginCalls = 0;
  pdfjsLib.PDFWorker._isSameOrigin = () => {
    window.__sameOriginCalls += 1;
    return false;
  };
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const file = new File([bytes], "mini.pdf", { type: "application/pdf" });
  try {
    const attachment = await extractAttachment(file);
    return { ok: true, text: attachment.text, pages: attachment.pages };
  } catch (error) {
    return { ok: false, failure: error.failure, reason: error.reason, message: error.message };
  }
}, makePdf("Mini report says the sky is blue.").toString("base64"));

check("a text PDF attaches", extraction.ok === true, JSON.stringify(extraction));
check(
  "with its text and page count",
  extraction.text === "Mini report says the sky is blue." && extraction.pages === 1,
  JSON.stringify(extraction),
);
const state = await page.evaluate(() => ({
  workers: window.__workers,
  blobs: window.__blobs,
  sameOriginCalls: window.__sameOriginCalls,
  port: window.__PDF__.pdfjsLib.GlobalWorkerOptions.workerPort !== null,
}));
check("no blob: worker is minted", state.blobs.length === 0, JSON.stringify(state.blobs));
check(
  "the worker is built from the emitted asset",
  state.workers.length === 1 && state.workers[0].endsWith(".mjs") && !state.workers[0].startsWith("blob:"),
  JSON.stringify(state.workers),
);
check("the port is set", state.port);
check("the cross-origin decision is never consulted", state.sameOriginCalls === 0, String(state.sameOriginCalls));
check(
  "the extraction adds no CSP refusal",
  !messages.slice(before).some((line) => line.includes("Content Security Policy")),
  messages.slice(before).join(" | "),
);

await browser.close();
server.close();
await rm(probeDir, { recursive: true, force: true });
await rm(outDir, { recursive: true, force: true });

if (fail > 0) {
  console.log(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
