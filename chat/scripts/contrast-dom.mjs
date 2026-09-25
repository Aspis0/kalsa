// Contrast verification against the REAL rendered app — not literals.
// For each check the script reads getComputedStyle() in a live page (light
// and dark): the foreground color from the element, the background from the
// first opaque ancestor. An undefined token (the --white bug) fails here
// because the computed value is what the user gets, not what we meant.
// Run: dev server on 5173, then `node scripts/contrast-dom.mjs`.
// Exit 1 on any pair below 4.5 (normal text, AA).
import { chromium } from "@playwright/test";
import { installBrainStub } from "./lib/brain-stub.mjs";

const APP = "http://localhost:5173";

function luminance([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function parseRgb(s) {
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (!m) throw new Error(`unparseable color ${s}`);
  return m[1].split(",").map((x) => parseFloat(x.trim()));
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const SEEDED = [
  {
    id: "seed-1",
    title: "Seeded thread",
    createdAt: 1,
    updatedAt: 1,
    messages: [
      { id: "m1", role: "user", content: "What does it look like?", createdAt: 1 },
      {
        id: "m2",
        role: "assistant",
        content:
          "Like this: a [link](https://example.com), some `inline code`, and a block:\n\n```python\ndef greet(name: str) -> str:\n    return f\"Hello, {name}!\"\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n",
        createdAt: 2,
      },
    ],
  },
  {
    id: "seed-2",
    title: "Interrupted thread",
    createdAt: 0,
    updatedAt: 0,
    messages: [
      { id: "m3", role: "user", content: "Are you still there?", createdAt: 0 },
      { id: "m4", role: "assistant", content: "", createdAt: 0 },
    ],
  },
  {
    id: "seed-3",
    title: "Tracker model",
    createdAt: 2,
    updatedAt: 2,
    messages: [
      { id: "m5", role: "user", content: "Show me a picture.", createdAt: 2 },
      {
        id: "m6",
        role: "assistant",
        content: "Here:\n\n![tracker](https://tracker.example/pixel.gif)\n",
        createdAt: 3,
      },
    ],
  },
  {
    id: "seed-4",
    title: "Thinking model",
    createdAt: 3,
    updatedAt: 3,
    messages: [
      { id: "m7", role: "user", content: "Count the sheep.", createdAt: 3 },
      {
        id: "m8",
        role: "assistant",
        content: "The answer is 8 sheep left.",
        reasoning: "First, strip the question. Then count twice.",
        reasoningMs: 2400,
        createdAt: 4,
      },
    ],
  },
];

// [label, fgSelector, bgSelector-or-null(walk from fg), setup]
const CHECKS = [
  ["assistant prose", ".assistant-body", null, "thread"],
  ["user bubble", ".user-bubble", ".user-bubble", "thread"],
  ["assistant link", ".markdown a", null, "thread"],
  ["inline code", ".inline-code", ".inline-code", "thread"],
  ["code language", ".codeblock-lang", ".codeblock-head", "thread"],
  ["code copy button", ".codeblock-copy", ".codeblock-head", "thread"],
  ["code body", ".codeblock-pre code", ".codeblock", "thread"],
  ["table header", ".markdown th", ".markdown th", "thread"],
  ["error title", ".error-title", null, "failed"],
  ["error body", ".error-body", null, "failed"],
  ["primary button", ".error-block .btn-primary", ".error-block .btn-primary", "failed"],
  ["quiet button", ".error-block .btn-quiet", null, "failed"],
  ["composer text", ".composer-input", ".composer-box", "thread"],
  ["composer hint", ".composer-hint", null, "thread"],
  ["topbar title", ".topbar-title h1", null, "thread"],
  ["topbar button", ".topbar-actions .topbar-btn", null, "thread"],
  ["empty title", ".empty-title", null, "empty"],
  ["empty copy", ".empty-copy", null, "empty"],
  ["settings label", ".settings-field span", null, "settings"],
  ["settings input", ".settings-field input", ".settings-field input", "settings"],
  ["active nav point", ".nav-point-active .nav-point-circle", ".nav-point-active .nav-point-circle", "nav"],
  ["nav label", ".nav-point-label", null, "nav"],
  ["sidebar search", ".sidebar-search input", ".sidebar-search input", "thread"],
  ["sidebar title", ".sidebar-title", null, "thread"],
  ["sidebar preview", ".sidebar-preview", null, "thread"],
  ["sidebar group", ".sidebar-group", null, "thread"],
  ["sidebar new", ".sidebar-new", ".sidebar-new", "thread"],
  ["blocked image", ".blocked-image", null, "img"],
  ["thought face", ".thought-face", null, "think"],
  ["thought toggle", ".thought-toggle", null, "think"],
  ["thought body", ".thought-body", null, "thinkopen"],
  ["budget terms", ".budget-terms", null, "panel"],
  ["budget unknown", ".budget-unknown", null, "panelunknown"],
];

async function setupPage(browser, theme, mode) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(
    ({ convos, theme }) => {
      localStorage.clear();
      localStorage.setItem("crescent-chat.theme.v1", theme);
      if (document.documentElement) document.documentElement.dataset.theme = theme;
      localStorage.setItem("crescent-chat.conversations.v1", JSON.stringify(convos));
      localStorage.setItem(
        "crescent-chat.settings.v1",
        JSON.stringify({ model: "x", webTools: true }),
      );
      localStorage.setItem(
        "crescent-chat.attach.seed-1.v2",
        JSON.stringify([
          { id: "att1", name: "notes.txt", kind: "txt", chars: 400, tokens: 100, text: "Seeded notes.", attachedAt: 1, active: true },
        ]),
      );
    },
    { convos: SEEDED, theme },
  );
  // The remote-server fields are not settings anymore: the endpoint and
  // token this page needs arrive as the brain's own answers.
  await page.addInitScript(installBrainStub, {
    state: { kind: "running", endpoint: "http://127.0.0.1:18081/ok", model: "x" },
    credential: "t",
  });
  await page.goto(APP);
  await page.waitForTimeout(1200);
  if (
    mode === "thread" ||
    mode === "failed" ||
    mode === "img" ||
    mode === "think" ||
    mode === "thinkopen" ||
    mode === "panel" ||
    mode === "panelunknown"
  ) {
    const target =
      mode === "thread"
        ? "Seeded thread"
        : mode === "failed"
          ? "Interrupted thread"
          : mode === "img"
            ? "Tracker model"
            : mode === "panelunknown"
              ? "Interrupted thread"
              : mode === "panel"
                ? "Seeded thread"
                : "Thinking model";
    await page
      .locator(".sidebar")
      .getByRole("button", { name: new RegExp(target, "i") })
      .first()
      .click();
    await page.waitForTimeout(400);
    if (mode === "thinkopen") {
      await page.getByRole("button", { name: /Show thinking/ }).click();
      await page.waitForTimeout(400);
    }
    if (mode === "panel" || mode === "panelunknown") {
      await page.getByRole("button", { name: "Toggle attachments panel" }).click();
      await page.waitForTimeout(800);
    }
  } else if (mode === "nav") {
    await page
      .locator(".sidebar")
      .getByRole("button", { name: /Seeded thread/i })
      .first()
      .click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /Show sections/ }).click();
    await page.waitForTimeout(500);
  } else if (mode === "settings") {
    await page.getByRole("button", { name: /Show sections/ }).click();
    await page.getByRole("button", { name: "Open Settings" }).click();
    await page.waitForTimeout(400);
  }
  return page;
}

async function readPair(page, fgSel, bgSel) {
  return page.evaluate(
    ({ fgSel, bgSel }) => {
      const fg = document.querySelector(fgSel);
      if (!fg) return { error: `missing ${fgSel}` };
      const fgColor = getComputedStyle(fg).color;
      let bg = bgSel ? document.querySelector(bgSel) : fg;
      if (!bg) return { error: `missing bg ${bgSel}` };
      let el = bg;
      let bgColor = "rgba(0, 0, 0, 0)";
      while (el && el !== document.documentElement) {
        const c = getComputedStyle(el).backgroundColor;
        const a = parseFloat(c.split(",")[3] ?? "1");
        if (a >= 0.99) {
          bgColor = c;
          break;
        }
        el = el.parentElement;
      }
      if (bgColor === "rgba(0, 0, 0, 0)") {
        bgColor = getComputedStyle(document.body).backgroundColor;
      }
      return { fgColor, bgColor };
    },
    { fgSel, bgSel },
  );
}

let failures = 0;
const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const theme of ["light", "dark"]) {
  console.log(`\n== ${theme} (computed styles) ==`);
  const pages = {};
  for (const [, , , mode] of CHECKS) {
    if (!pages[mode]) pages[mode] = await setupPage(browser, theme, mode);
  }
  for (const [label, fgSel, bgSel, mode] of CHECKS) {
    const page = pages[mode];
    let status;
    try {
      const read = await readPair(page, fgSel, bgSel);
      if (read.error) {
        status = `ERROR ${read.error}`;
        failures++;
      } else {
        const r = ratio(parseRgb(read.fgColor), parseRgb(read.bgColor));
        status = `${r.toFixed(2)}  ${r >= 4.5 ? "PASS" : "FAIL"}  ${label}  (${read.fgColor} on ${read.bgColor})`;
        if (r < 4.5) failures++;
      }
    } catch (e) {
      status = `ERROR ${label}: ${e.message}`;
      failures++;
    }
    console.log(status);
  }
  for (const p of Object.values(pages)) await p.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL COMPUTED PAIRS PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
