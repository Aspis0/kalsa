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

const tests = {
  // Corrupt messages are dropped, valid ones render, never a white screen.
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
