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

  // 4 — code answer complete, nav closed: color interplay frame
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
