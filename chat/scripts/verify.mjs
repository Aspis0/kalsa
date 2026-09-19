// Functional assertions the screenshots cannot make. Every failure exits 1
// with a loud message — a passing run prints one line per check.
// Run: dev server on 5173 (+ mock on 18081 for stream tests),
// then `node scripts/verify.mjs [test ...]`.
import { chromium } from "@playwright/test";
import { appendTail } from "../src/lib/tail.ts";
import { zipSync, strToU8 } from "fflate";

const APP = "http://localhost:5173";
const CONV_KEY = "crescent-chat.conversations.v1";
const SET_KEY = "crescent-chat.settings.v1";
const THEME_KEY = "crescent-chat.theme.v1";

let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function seed(page, { settings = null, convos = [], theme = "light" }) {
  await page.addInitScript(
    ({ cKey, sKey, tKey, settings, convos, theme }) => {
      localStorage.clear();
      localStorage.setItem(tKey, theme);
      if (document.documentElement) document.documentElement.dataset.theme = theme;
      if (settings) localStorage.setItem(sKey, JSON.stringify(settings));
      if (convos.length) localStorage.setItem(cKey, JSON.stringify(convos));
    },
    { cKey: CONV_KEY, sKey: SET_KEY, tKey: THEME_KEY, settings, convos, theme },
  );
}

async function stored(page, key) {
  return page.evaluate((k) => localStorage.getItem(k), key);
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

/**
 * Open the app at the chat. The brain is the home surface now, so a `goto`
 * lands on its writing bar and the composer is one click away — the same
 * conditional click `shots.mjs` has made since that change.
 */
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
            if (command === "brain_web_stop") {
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
  await page.addInitScript((settings) => {
    if (sessionStorage.getItem("verified-seeded")) return;
    sessionStorage.setItem("verified-seeded", "1");
    localStorage.clear();
    localStorage.setItem("crescent-chat.theme.v1", "light");
    localStorage.setItem("crescent-chat.settings.v1", JSON.stringify(settings));
  }, settings);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await p1.goto(APP);
    await p1.waitForTimeout(1000);
    const p2 = await ctx.newPage();
    await p2.goto(APP);
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
    await page.goto(APP);
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
    await page.screenshot({ path: "shots/31-quota.png" });
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
      await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Talk then die.", "stopped halfway");
    const body = await page.locator(".thread").textContent();
    check("cut: partial text kept", (body ?? "").includes("Working through this"));
    await page.screenshot({ path: "shots/33-cut.png" });
    await browser.close();
  },

  async emptycut() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, { settings: okSettings("emptycut-demo") });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Say nothing.", "not as a chat stream");
    check("emptycut: honest diagnosis", true);
    await browser.close();
  },

  async json() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, { settings: okSettings("json-demo") });
    await page.goto(APP);
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
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "A page?", "not as a chat stream");
    const shown = await page.locator(".error-url").textContent();
    check("html: shows called URL", (shown ?? "").includes("/ok/v1/chat/completions"));
    await page.screenshot({ path: "shots/32-html.png" });
    await browser.close();
  },

  async networkurl() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, {
      settings: { endpoint: "http://127.0.0.1:18999", token: "t", model: "x" },
    });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "Nobody home?", "could not be reached");
    const shown = await page.locator(".error-url").textContent();
    check("network: shows called URL", (shown ?? "").includes("127.0.0.1:18999/v1/chat/completions"));
    await page.screenshot({ path: "shots/34-network.png" });
    await browser.close();
  },

  // B6: streams are per-conversation. Stopping B must not touch A.
  async twostream() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("slow-demo") });
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
                "Here:\n\n![tracker](https://tracker.example/pixel.gif?c=secret-talk)\n\nAnd [evil](javascript:alert(1)).",
              createdAt: 2,
            },
          ],
        },
      ],
    });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await openSidebar(page, "Sneaky model");
    check("imgblocked: zero img elements", (await page.locator(".thread img").count()) === 0);
    check("imgblocked: notice shown", (await page.locator(".blocked-image").count()) === 1);
    check(
      "imgblocked: no javascript: hrefs",
      (await page.locator('.thread a[href^="javascript"]').count()) === 0,
    );
    const href = await page.locator(".blocked-image a").getAttribute("href");
    check("imgblocked: address openable by hand", href === "https://tracker.example/pixel.gif?c=secret-talk");
    let external = 0;
    page.on("request", (req) => {
      if (!req.url().startsWith("http://localhost:5173")) external++;
    });
    await page.reload();
    await page.waitForTimeout(1500);
    check("imgblocked: zero external requests", external === 0, `${external} seen`);
    await browser.close();
  },

  // The crescent carries six surfaces and nothing else.
  async surfaces() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x") });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /Show sections/ }).click();
    await page.waitForTimeout(500);
    check("surfaces: six points", (await page.locator(".crescent-nav .nav-point").count()) === 6);
    check("surfaces: no paging arrows", (await page.locator(".crescent-page-arrow").count()) === 0);
    await page.getByRole("button", { name: "Open Models" }).click();
    await page.waitForTimeout(400);
    const body = (await page.locator(".stage").textContent()) ?? "";
    check("surfaces: honest placeholder", body.includes("Model choice will live here"));
    check("surfaces: no fake controls", (await page.locator(".stage button").count()) === 0);
    await browser.close();
  },

  // Thinking separates from answering: same stream, two buffers.
  async think() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("think-demo") });
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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

  // Small context: the oversized file is refused WITH its numbers.
  async refusefit() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: { endpoint: "http://127.0.0.1:18081/small", token: "t", model: "x" } });
    await page.goto(APP);
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
    await page.screenshot({ path: "shots/62-refusal.png" });
    await browser.close();
  },

  // Unknown context: attached, but the panel says the size is unchecked.
  async unknownctx() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: { endpoint: "http://127.0.0.1:18081/denied", token: "t", model: "x" } });
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await page.goto(APP);
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
    await seedOnce(plain, toolSettings("toolsloop-demo"));
    await openChat(plain);
    await plain.waitForTimeout(1200);
    await resetMock(plain);
    await plain.getByRole("textbox", { name: "Message" }).fill("Just answer.");
    await plain.getByRole("textbox", { name: "Message" }).press("Enter");
    await plain.waitForTimeout(3000);

    const offered = (body) => (body?.tools ?? []).length;
    const plainBodies = await allBodies(plain);
    const withDoor = offered(first);
    const switchOff = offered(offBodies.at(-1));
    const noDoor = offered(plainBodies.at(-1));
    // The two negative halves also require that those pages actually sent a
    // request: a page that crashed before sending must not read as "offered
    // nothing", which is what would make this pass for the wrong reason.
    check(
      "tools: offered only when the switch is on and a command can run them",
      withDoor === 2 && switchOff === 0 && noDoor === 0 && plainBodies.length >= 1 && offBodies.length >= 1,
      `on with door ${withDoor}, switch off ${switchOff} (${offBodies.length} sent), no door ${noDoor} (${plainBodies.length} sent)`,
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
                    "1. Local service\n   URL: http://127.0.0.1:8130/v1/models\n   An internal thing.\n\n2. File\n   URL: file:///etc/passwd\n   Not a page.\n\n3. Real page\n   URL: https://example.com/ok\n   A real page.",
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
    const hrefs = await page.locator(".tool-activity a").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
    check(
      "links: only public web addresses are links",
      hrefs.every((href) => href === null || (href.startsWith("https://example.com/") && !href.includes("127.0.0.1"))),
      JSON.stringify(hrefs),
    );
    check("links: the real one is there", hrefs.some((href) => href === "https://example.com/ok"), JSON.stringify(hrefs));
    check("links: the loopback address is not a link", !hrefs.some((href) => (href ?? "").includes("127.0.0.1")), JSON.stringify(hrefs));
    check("links: a script address is not a link", !hrefs.some((href) => (href ?? "").startsWith("javascript:")), JSON.stringify(hrefs));
    const shown = (await page.locator(".tool-activity").textContent()) ?? "";
    check("links: the address the model asked for is still shown as text", shown.includes("javascript:alert(1)"), shown.slice(0, 300));
    await browser.close();
  },
  // A model forbidden a structured tool call can write one out as text. Live,
  // on 2026-09-19, the page printed the markup to the reader as the answer.
  // Both halves are asserted: the words around it arrive, the markup does not.
  async markup() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await seed(page, { settings: okSettings("markup-demo") });
    await openChat(page);
    await page.waitForTimeout(1200);
    await sendAndWait(page, "One more search?", "one more search");
    const thread = (await page.locator(".thread").textContent()) ?? "";
    check("markup: the words around the call are shown", thread.includes("I need one more search to be sure."), thread.slice(0, 200));
    check("markup: no tool-call markup reaches the reader", !thread.includes("tool_call") && !thread.includes("web_search") && !thread.includes("parameter"), thread.slice(0, 300));
    // The thread renders from the live buffer; what is stored trails it by the
    // persist throttle, so wait for it rather than read it too early.
    await page
      .waitForFunction(
        () =>
          Object.keys(localStorage).some(
            (k) => k.startsWith("crescent-chat.msgs.") && (JSON.parse(localStorage.getItem(k) ?? "[]") ?? []).some((m) => m.role === "assistant" && (m.content ?? "") !== ""),
          ),
        null,
        { timeout: 10000 },
      )
      .catch(() => check("markup: the answer reached the disk", false, "never written"));
    const stored = await page.evaluate(() => ({ ...localStorage }));
    const key = Object.keys(stored).find((k) => k.startsWith("crescent-chat.msgs."));
    const saved = JSON.parse(stored[key] ?? "[]").find((m) => m.role === "assistant");
    check("markup: what is stored is what was shown", (saved?.content ?? "").trim() === "I need one more search to be sure.", JSON.stringify(saved?.content));
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
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await openSidebar(page, "Damaged");
    const body = await page.locator(".thread").textContent();
    check("corrupt: valid message renders", body.includes("I survive."));
    check("corrupt: no error boundary", (await page.locator(".error-boundary").count()) === 0);
    check("corrupt: no white screen", (await page.locator("#root").textContent()).length > 100);
    await page.screenshot({ path: "shots/30-corrupt-data.png" });
    await browser.close();
  },
};

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
