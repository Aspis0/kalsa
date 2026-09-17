// Functional assertions the screenshots cannot make. Every failure exits 1
// with a loud message — a passing run prints one line per check.
// Run: dev server on 5173 (+ mock on 18081 for stream tests),
// then `node scripts/verify.mjs [test ...]`.
import { chromium } from "@playwright/test";
import { appendTail } from "../src/lib/tail.ts";

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
  await page.waitForFunction(
    (m) => document.querySelector(".thread")?.textContent?.includes(m),
    marker,
    { timeout },
  );
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
    await page.getByRole("textbox", { name: "Message" }).fill("Persist me.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("line is open"),
      null,
      { timeout: 20000 },
    );
    // Storage trails memory by design now: wait for the stream to end
    // (Stop gone) before reading the disk.
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
    await p2.waitForFunction(() => document.querySelectorAll(".sidebar-row").length === 1, null, {
      timeout: 10000,
    });
    check("multiwindow: p2 sees the new row", true);
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
    await page.getByRole("textbox", { name: "Message" }).fill("Nowhere to write.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("line is open"),
      null,
      { timeout: 20000 },
    );
    // The stream itself works (memory); the banner must admit disk refused.
    const banner = page.locator(".storage-banner");
    check("quota: banner shown", (await banner.count()) === 1);
    check("quota: banner names storage", ((await banner.textContent()) ?? "").includes("storage is full"));
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
    await page.waitForFunction(() => document.querySelectorAll(".sidebar-row").length === 1, null, {
      timeout: 10000,
    });
    const ms = Date.now() - t0;
    check("search1000: narrows to one", true, `${ms}ms`);
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
    await page.waitForFunction(
      () => document.querySelector(".thought-face")?.textContent?.includes("Thought for"),
      null,
      { timeout: 20000 },
    );
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
    await page.waitForFunction(
      () => document.querySelector(".thought-face")?.textContent?.includes("Thought for"),
      null,
      { timeout: 20000 },
    );
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
    await page.waitForFunction(
      () => document.querySelector(".thought-face")?.textContent?.includes("Thought for"),
      null,
      { timeout: 20000 },
    );
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
    await page.waitForFunction(
      () => document.querySelector(".thought-face")?.textContent?.includes("Thought for"),
      null,
      { timeout: 20000 },
    );
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
    await page.waitForFunction(
      () => document.querySelector(".thought-face")?.textContent?.includes("Thought for"),
      null,
      { timeout: 20000 },
    );
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
    await page.waitForFunction(
      () => document.querySelector(".thought-face")?.textContent?.includes("Thought for"),
      null,
      { timeout: 20000 },
    );
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
