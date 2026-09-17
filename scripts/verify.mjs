// Functional assertions the screenshots cannot make. Every failure exits 1
// with a loud message — a passing run prints one line per check.
// Run: dev server on 5173 (+ mock on 18081 for stream tests),
// then `node scripts/verify.mjs [test ...]`.
import { chromium } from "@playwright/test";

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
    await page.getByRole("button", { name: /Show.*conversation/ }).click();
    await page.getByRole("button", { name: "Open conversation: First" }).click();
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
    await p2.getByRole("button", { name: /Show.*conversation/ }).click();
    check("multiwindow: p2 starts empty", (await p2.locator(".nav-point").count()) === 0);
    await p1.getByRole("textbox", { name: "Message" }).fill("From window one.");
    await p1.getByRole("textbox", { name: "Message" }).press("Enter");
    await p1.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("line is open"),
      null,
      { timeout: 20000 },
    );
    // Reopen p2's nav: the point must be there with no reload.
    await p2.keyboard.press("Escape");
    await p2.getByRole("button", { name: /Show.*conversation/ }).click();
    await p2.waitForTimeout(400);
    check("multiwindow: p2 sees the new point", (await p2.locator(".nav-point").count()) === 1);
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
      await page.getByRole("button", { name: /Show.*conversation/ }).click();
      await page.getByRole("button", { name: `Open conversation: ${title}` }).click();
      await page.waitForTimeout(300);
    };
    await say("First topic");
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "New chat" }).click();
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
    await page.getByRole("button", { name: /Show.*conversation/ }).click();
    await page.getByRole("button", { name: /Open conversation/ }).first().click();
    await page.waitForTimeout(400);
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
