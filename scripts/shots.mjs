// Screenshot driver: seeds localStorage per state, drives the real UI
// against the mock endpoint, saves PNGs into shots/.
// Usage: npm run dev (port 5173) + node scripts/mock-server.mjs running,
// then: node scripts/shots.mjs [name ...]  (default: all)
import { chromium } from "@playwright/test";

const APP = "http://localhost:5173";
const CONV_KEY = "crescent-chat.conversations.v1";
const SET_KEY = "crescent-chat.settings.v1";
const THEME_KEY = "crescent-chat.theme.v1";

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

async function seed(page, { settings = null, convos = [], theme = "light" }) {
  await page.addInitScript(
    ({ cKey, sKey, tKey, settings, convos, theme }) => {
      localStorage.clear();
      localStorage.setItem(tKey, theme);
      // Init scripts can run before documentElement exists; the throw used
      // to abort the whole script and silently drop the settings seeding.
      if (document.documentElement) document.documentElement.dataset.theme = theme;
      if (settings) localStorage.setItem(sKey, JSON.stringify(settings));
      if (convos.length) localStorage.setItem(cKey, JSON.stringify(convos));
    },
    { cKey: CONV_KEY, sKey: SET_KEY, tKey: THEME_KEY, settings, convos, theme },
  );
}

async function shot(page, path, selector) {
  await page.waitForTimeout(600);
  if (selector) await page.locator(selector).waitFor({ timeout: 5000 }).catch(() => {});
  await page.screenshot({ path });
  console.log("saved", path);
}

async function main() {
  const only = new Set(process.argv.slice(2));
  const want = (name) => only.size === 0 || only.has(name);
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  // 1 — empty, first run, nothing configured
  if (want("empty")) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await seed(page, {});
    await page.goto(APP);
    await shot(page, "shots/01-empty.png");
    await page.close();
  }

  // 2 — empty, dark
  if (want("empty-dark")) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await seed(page, { theme: "dark" });
    await page.goto(APP);
    await shot(page, "shots/01-empty-dark.png");
    await page.close();
  }

  // 3 — streaming, mid-answer, crescent open: layout interplay frame.
  // Slow model (~6s answer) so the shot lands mid-stream: stop button up,
  // partial markdown on the page.
  if (want("streaming")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("slow-demo"), theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("textbox", { name: "Message" }).fill("Show me the snippets.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForTimeout(1100);
    await page.getByRole("button", { name: "Show conversations" }).click();
    await shot(page, "shots/02-streaming.png");
    await page.close();
  }

  // 5 — heavy markdown showcase (lists, table, quote, link, headings)
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

  // 6 — 401: wrong token. Human sentence + path to settings, no trace.
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

  // 7 — stopped midway: partial text kept, honest note, stop button gone.
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
    await shot(page, "shots/06-stopped.png");
    await page.close();
  }
  // 8 — twenty conversations on the arc: paging, long titles, keyboard
  if (want("crescent20")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: twentyConvos(), theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Show conversations" }).click();
    await shot(page, "shots/07-crescent20.png");
    await page.getByRole("button", { name: "Show next conversations" }).click();
    await page.waitForTimeout(500);
    await shot(page, "shots/07b-crescent20-p2.png");
    await page.close();
  }

  // 9 — two hundred messages: must scroll fluidly, tail visible on open
  if (want("long")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: longConvo(), theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Show conversations" }).click();
    await page.getByRole("button", { name: /Open conversation/ }).first().click();
    await shot(page, "shots/08-long.png");
    await page.close();
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

  // 10 — narrow window (700px): thread, composer, topbar must hold
  if (want("narrow")) {
    const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: SEEDED_THREAD, theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Show conversations" }).click();
    await page.getByRole("button", { name: /Open conversation/ }).first().click();
    await shot(page, "shots/09-narrow.png");
    await page.close();
  }

  // 11 — wide window (1800px): measure must stay narrow, never full-bleed
  if (want("wide")) {
    const page = await browser.newPage({ viewport: { width: 1800, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: SEEDED_THREAD, theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Show conversations" }).click();
    await page.getByRole("button", { name: /Open conversation/ }).first().click();
    await shot(page, "shots/10-wide.png");
    await page.close();
  }

  // 12 — dark thread: link accent, code block, table next to dark surfaces
  if (want("darkthread")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: SEEDED_THREAD, theme: "dark" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Show conversations" }).click();
    await page.getByRole("button", { name: /Open conversation/ }).first().click();
    await shot(page, "shots/11-dark-thread.png");
    await page.close();
  }

  // 13 — waiting for the first token: dots, no idle spinner
  if (want("thinking")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("patient-demo"), theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("textbox", { name: "Message" }).fill("Take your time.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForTimeout(700);
    await shot(page, "shots/12-thinking.png");
    await page.close();
  }

  // 14 — 401 in the dark theme: desaturated red on dark surfaces
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

  // 15 — copy confirmation on a code block
  if (want("copyconfirm")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: SEEDED_THREAD, theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Show conversations" }).click();
    await page.getByRole("button", { name: /Open conversation/ }).first().click();
    await page.getByRole("button", { name: "Copy" }).click();
    await shot(page, "shots/14-copied.png");
    await page.close();
  }

  // 16 — five thousand pasted lines: composer caps and scrolls, never jumps
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

  // 17 — reduced motion: streaming must read fine with transitions frozen
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
  // 18 — settings dialog, first impression
  if (want("settings")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, {});
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await shot(page, "shots/17-settings.png");
    await page.close();
  }

  // 19 — settings validation speaks plain language, not regex
  if (want("settingserror")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, {});
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByPlaceholder("https://my-server:8000").fill("not a url");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await shot(page, "shots/18-settings-error.png");
    await page.close();
  }

  // 20 — delete asks once, in place, without a modal
  if (want("deleteconfirm")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("x"), convos: SEEDED_THREAD, theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Show conversations" }).click();
    await page.getByRole("button", { name: /Open conversation/ }).first().click();
    await page.getByRole("button", { name: "Delete" }).click();
    await shot(page, "shots/19-delete.png");
    await page.close();
  }

  // 22 — recover: 401 -> fix address in settings -> try again -> streams
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
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByPlaceholder("https://my-server:8000").fill("http://127.0.0.1:18081/ok");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Try again" }).click();
    await page.waitForFunction(
      () => document.querySelector(".thread")?.textContent?.includes("scrolls horizontally"),
      null,
      { timeout: 20000 },
    );
    await shot(page, "shots/21-recover.png");
    await page.close();
  }

  // 23 — switch conversations mid-stream: thread swaps, stream survives
  if (want("switch")) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await seed(page, { settings: okSettings("slow-demo"), convos: SEEDED_THREAD, theme: "light" });
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Show conversations" }).click();
    await page.getByRole("button", { name: /Open conversation/ }).first().click();
    await page.getByRole("button", { name: "New chat" }).click();
    await page.getByRole("textbox", { name: "Message" }).fill("Second topic, slowly.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Show conversations" }).click();
    await page.getByRole("button", { name: "Open conversation: Seeded thread" }).click();
    await shot(page, "shots/22-switch.png");
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

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
