// The walk's face, shot: the sprout at the four moments the owner sees it —
// nothing measured yet, a candidate running under a countable plan, the
// tune's own close, and a phase with no fraction at all — in both themes,
// plus the reduced-motion reading of the same screen. There is no Tauri
// here: a stub keeps the brain on `starting` and the `brain_progress`
// handlers the app registers (the envelope shape Tauri really hands them,
// the one brain-shots.mjs delivers too), and this script delivers each
// report by hand.
//
// Beyond the pictures it asserts what a picture cannot: the indeterminate
// bar WALKS (its stripe transform sampled twice, strictly different), the
// plant's sway is running, the determinate bar never reads 100 before the
// closing report and does grow inside a running candidate, the estimate's
// words appear only once a candidate finished, both themes paint the bar in
// the page's own accent, and under reduced motion no sprout animation
// exists at all while the clock still ticks.
//
// The strings are copied on purpose, the way verify.mjs keeps its own: a
// copied sentence goes red the day the product's copy changes.
//
// Usage: npm run dev (port 5173), then node scripts/walk-shots.mjs
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const APP = "http://localhost:5173";
const WINDOW = { width: 1000, height: 720 };
const GB = 1024 ** 3;

// The theme tokens the walk must paint with, read from styles/tokens.css —
// the same --accent the topbar's leaf mark is filled with.
const ACCENT = { light: "rgb(31, 95, 78)", dark: "rgb(117, 179, 160)" };
const SILENCE = { light: "rgb(88, 97, 91)", dark: "rgb(151, 165, 156)" };

// The brain state behind the walk: `starting` is walking from the hook's
// point of view and needs nothing else, and it never fires the automatic
// start a `stopped` page would (that would clear the step out from under
// this script).
const STATE = { kind: "starting" };

// A real measured machine, the shape brain-shots.mjs pins against
// capability-contract.json: the brain page's first paint carries the
// machine card before the walk takes the screen over, so the fixture has
// to survive exactly that paint. No model and no refusal are both legal
// fields of a measured capability (MachineCard types them nullable), and
// the card renders neither while the walk owns the page.
const CAPABILITY = {
  kind: "measured",
  chosen: true,
  machine: {
    ram_bytes: 17 * GB,
    budget_bytes: 12.75 * GB,
    gpu_accounted_for: true,
    runs_on: "the graphics chip",
    bandwidth_bytes_per_second: 110e9,
    bandwidth_basis: "chip",
  },
  model: null,
  quicker: null,
  refusal: null,
};

const shotFile = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function shot(page, path) {
  await page.screenshot({ path: shotFile(path) });
  console.log("  saved", path);
}

/** One `brain_progress` envelope, exactly as the real bus hands it over. */
async function deliver(page, payload) {
  await page.evaluate((step) => {
    for (const handler of window.__kbListeners?.brain_progress ?? []) {
      handler({ event: "brain_progress", id: 1, payload: step });
    }
  }, payload);
}

/** What the walk is showing, in numbers no screenshot can argue with. */
async function read(page) {
  return page.evaluate(() => {
    const bar = document.querySelector(".sprout-bar");
    const fill = document.querySelector(".sprout-bar-fill");
    const caption = document.querySelector(".sprout-caption");
    const plant = document.querySelector(".sprout-plant");
    const stem = document.querySelector(".sprout-stem");
    const leaf = document.querySelector(".sprout-leaf");
    const box = (element) => (element ? element.getBoundingClientRect() : null);
    const barBox = box(bar);
    const fillBox = box(fill);
    return {
      head: document.querySelector(".surface-verdict")?.textContent ?? "",
      caption: caption?.textContent ?? "",
      // The percent the bar really paints, measured off the DOM: the rule
      // lives in the width, not in a number the component reports about itself.
      percent: bar && fillBox ? Math.round((fillBox.width / barBox.width) * 100) : null,
      determinate: Boolean(fill),
      indeterminate: bar?.classList.contains("is-indeterminate") ?? false,
      done: document.querySelector(".sprout-svg")?.classList.contains("is-done") ?? false,
      fillColor: fill ? getComputedStyle(fill).backgroundColor : null,
      captionColor: caption ? getComputedStyle(caption).color : null,
      sway: plant ? getComputedStyle(plant).animationName : null,
      stripes: bar ? getComputedStyle(bar, "::after").transform : null,
      stripeAnimation: bar ? getComputedStyle(bar, "::after").animationName : null,
      stemTransition: stem ? getComputedStyle(stem).transitionDuration : null,
      leafTransition: leaf ? getComputedStyle(leaf).transitionDuration : null,
      running: document
        .getAnimations()
        .filter((animation) => animation.playState === "running")
        .map((animation) => animation.animationName ?? animation.constructor.name),
    };
  });
}

/** The four states, in the order the owner will meet them. */
async function walk(page, theme) {
  const suffix = theme === "dark" ? "-dark" : "";

  // A phase with no fraction: the plant is young and sways, the stripes
  // walk, and the line is the time alone.
  await deliver(page, { kind: "measuring" });
  await page.waitForTimeout(900);
  const checking = await read(page);
  check(`${theme}: the check says its own line`, checking.head === "Checking your computer…", checking.head);
  check(`${theme}: a phase with no fraction has no fill`, checking.determinate === false && checking.indeterminate);
  check(`${theme}: the time alone is on the line`, /^\d+:\d\d$/.test(checking.caption), checking.caption);
  check(`${theme}: the plant sways`, checking.sway === "sprout-sway", checking.sway);
  const stripesA = checking.stripes;
  await page.waitForTimeout(500);
  const walking = await read(page);
  check(
    `${theme}: the indeterminate bar keeps walking`,
    walking.stripes !== null && walking.stripes !== stripesA,
    `${stripesA} → ${walking.stripes}`,
  );
  check(`${theme}: the clock ticks`, walking.caption !== checking.caption, `${checking.caption} → ${walking.caption}`);
  await shot(page, `shots/90-walk-checking${suffix}.png`);

  // The tune at nothing: a seed on the soil, test 1 of 4, no estimate —
  // there is nothing finished to average yet.
  await deliver(page, { kind: "tuning", done: 0, total: 4, candidate: 1 });
  await page.waitForTimeout(500);
  const seed = await read(page);
  check(`${theme}: the tune's own line is up`, seed.head === "Finding what runs fastest on your computer…", seed.head);
  check(`${theme}: test 1 of 4`, seed.caption.startsWith("Test 1 of 4 ·"), seed.caption);
  check(`${theme}: nothing to estimate yet`, !/min left/.test(seed.caption), seed.caption);
  check(`${theme}: 0% is 0%`, seed.percent === 0, `${seed.percent}`);
  check(`${theme}: the bar is the page's own green`, seed.fillColor === ACCENT[theme], seed.fillColor);
  check(`${theme}: the line is the page's muted ink`, seed.captionColor === SILENCE[theme], seed.captionColor);
  await shot(page, `shots/91-walk-tune-start${suffix}.png`);

  // Two candidates measured, two and a half seconds apiece — the pace the
  // bar and the estimate will read as the average.
  for (const done of [1, 2]) {
    await deliver(page, { kind: "tuning", done: done - 1, total: 4, candidate: done });
    await page.waitForTimeout(2500);
    await deliver(page, { kind: "tuning", done, total: 4, candidate: done });
    await page.waitForTimeout(150);
    await deliver(page, { kind: "tuning", done, total: 4, candidate: done + 1 });
  }

  // Halfway: two of four closed, the third just started — 50% with the
  // estimate now that one candidate has finished, and never 100.
  await page.waitForTimeout(400);
  const mid = await read(page);
  check(`${theme}: test 3 of 4`, mid.caption.startsWith("Test 3 of 4 ·"), mid.caption);
  check(`${theme}: one candidate finished, so an estimate appears`, /about \d+ min left/.test(mid.caption), mid.caption);
  check(`${theme}: two of four is half`, mid.percent !== null && mid.percent >= 49 && mid.percent <= 60, `${mid.percent}`);
  const before = mid.percent;
  await page.waitForTimeout(1400);
  const inside = await read(page);
  check(
    `${theme}: the running candidate fills its own slot`,
    inside.percent !== null && inside.percent > before && inside.percent < 100,
    `${before} → ${inside.percent}`,
  );
  check(`${theme}: the plant is still alive while it waits`, inside.running.includes("sprout-sway"), inside.running.join(","));
  await shot(page, `shots/92-walk-tune-mid${suffix}.png`);

  // The tune's own report: the bar eases to full, the top leaf is open
  // and the bow is mid-flight — and there is nothing left to estimate.
  await deliver(page, { kind: "tuning", done: 4, total: 4, candidate: 4 });
  await page.waitForTimeout(350);
  const bowing = await read(page);
  check(`${theme}: the plant takes its bow`, bowing.done);
  check(`${theme}: test 4 of 4`, bowing.caption.startsWith("Test 4 of 4 ·"), bowing.caption);
  check(`${theme}: nothing left to estimate`, !/min left/.test(bowing.caption), bowing.caption);
  await shot(page, `shots/93-walk-tune-done${suffix}.png`);
  // The fill grows on its own ease (Sprout.css, 700 ms): the report says
  // 100 and the bar arrives there, once the growth it was asked for is over.
  await page.waitForTimeout(650);
  const full = await read(page);
  check(`${theme}: the closing report fills the bar`, full.percent === 100, `${full.percent}`);
}

/** Reduced motion: no sway, no walking stripes, no growth transition —
    and the clock, which is information, keeps ticking. */
async function reduced(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await deliver(page, { kind: "tuning", done: 0, total: 4, candidate: 1 });
  await page.waitForTimeout(400);
  const still = await read(page);
  check("reduced: the plant does not sway", still.sway === "none", still.sway);
  // base.css's own reduced-motion rule (0.01 ms !important) and Sprout's
  // no-preference gate agree: growth lands at once instead of travelling.
  check(
    "reduced: growth jumps instead of animating",
    Number.parseFloat(still.stemTransition ?? "1") < 0.001,
    still.stemTransition,
  );
  await deliver(page, { kind: "deciding" });
  await page.waitForTimeout(400);
  const stripes = await read(page);
  check("reduced: the stripes stand still", stripes.stripeAnimation === "none", stripes.stripeAnimation);
  check("reduced: no sprout animation runs", !stripes.running.some((name) => name.startsWith("sprout")), stripes.running.join(","));
  check("reduced: the time still ticks", /^\d+:\d\d$/.test(stripes.caption), stripes.caption);
  const before = stripes.caption;
  await page.waitForTimeout(1300);
  const later = await read(page);
  check("reduced: and it keeps ticking", later.caption !== before, `${before} → ${later.caption}`);
  await shot(page, "shots/94-walk-reduced.png");
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: WINDOW, locale: "en-US" });
    await page.addInitScript(
      ({ theme, answers }) => {
        localStorage.setItem("crescent-chat.theme.v1", theme);
        if (document.documentElement) document.documentElement.dataset.theme = theme;
        window.__TAURI__ = {
          core: { invoke: (command) => Promise.resolve(answers[command] ?? null) },
          // The real bus hands the listener an ENVELOPE — { event, id,
          // payload } — and keeps it: this stub stores handlers so the
          // script can deliver one the same shape Tauri does.
          event: {
            listen: (name, handler) => {
              window.__kbListeners = window.__kbListeners || {};
              (window.__kbListeners[name] = window.__kbListeners[name] || []).push(handler);
              return Promise.resolve(() => {});
            },
          },
        };
      },
      { theme, answers: { brain_state: STATE, brain_capability: CAPABILITY } },
    );
    await page.goto(APP);
    await page.waitForSelector(".shell", { timeout: 10000 });
    await page.waitForTimeout(600);
    await walk(page, theme);
    if (theme === "light") await reduced(page);
    await page.close();
  }
  await browser.close();
  if (failures > 0) {
    console.error(`\nFAILED: ${failures} check(s)`);
    process.exit(1);
  }
  console.log("walk-shots: all checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
