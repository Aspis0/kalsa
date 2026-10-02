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

/** One `brain_progress` envelope, exactly as the real bus hands it over —
    into a page that is actually listening: the app's subscription is async,
    and one slow load once delivered a whole sequence into the void. */
async function deliver(page, payload) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const live = await page.evaluate(() => (window.__kbListeners?.brain_progress ?? []).length > 0);
    if (live) break;
    await page.waitForTimeout(500);
  }
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
      budOpen: document.querySelector(".sprout-bud")?.classList.contains("is-open") ?? false,
      // The hinge itself: the matrix's b/a is the bud's own rotation in its
      // frame — 0 is shut along the stem, 45 is open to the side.
      budAngle: (() => {
        const bud = document.querySelector(".sprout-bud");
        if (!bud) return null;
        const matrix = getComputedStyle(bud).transform;
        const parts = matrix.startsWith("matrix(") ? matrix.slice(7, -1).split(",").map(Number) : [1, 0];
        return Math.round((Math.atan2(parts[1], parts[0]) * 180) / Math.PI);
      })(),
      leavesOpen: document.querySelectorAll(".sprout-leaf.is-open").length,
      // The bar's own contract with assistive tech: a progressbar that
      // names its range and value (and has no value when the phase carries
      // none), its value spoken in the line's words, and a live region whose
      // ticking clock is hidden from it.
      aria: {
        role: bar?.getAttribute("role") ?? null,
        min: bar?.getAttribute("aria-valuemin"),
        max: bar?.getAttribute("aria-valuemax"),
        now: bar?.getAttribute("aria-valuenow"),
        valuetext: bar?.getAttribute("aria-valuetext"),
        live: caption?.getAttribute("aria-live"),
        clockHidden: Boolean(caption?.querySelector('span[aria-hidden="true"]')),
      },
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
  check(
    `${theme}: the bar is a progressbar with no value it does not have`,
    checking.aria.role === "progressbar" &&
      checking.aria.min === "0" &&
      checking.aria.max === "100" &&
      checking.aria.now === null,
    JSON.stringify(checking.aria),
  );
  check(
    `${theme}: the line is polite, its clock unspoken, its words the bar's value`,
    checking.aria.live === "polite" &&
      checking.aria.clockHidden &&
      checking.aria.valuetext === checking.caption,
    JSON.stringify(checking.aria),
  );
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
  // there is nothing finished to average yet. The wait outlasts the resting
  // sprout's retract (its own 700 ms beat), so the picture is the seed and
  // not the last leaf on its way out.
  await deliver(page, { kind: "tuning", done: 0, total: 4, candidate: 1 });
  await page.waitForTimeout(1300);
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
  // The harness runs on compressed time: two candidates of ~2.5 s leave
  // seconds, not minutes, and "almost done" is the honest wait for that —
  // the minutes path itself is pinned in verify.mjs's walkProgress.
  check(
    `${theme}: one candidate finished, so the wait line appears`,
    /min left|almost done/.test(mid.caption),
    mid.caption,
  );
  check(`${theme}: two of four is half`, mid.percent !== null && mid.percent >= 49 && mid.percent <= 60, `${mid.percent}`);
  const before = mid.percent;
  await page.waitForTimeout(1400);
  const inside = await read(page);
  check(
    `${theme}: the running candidate fills its own slot`,
    inside.percent !== null && inside.percent > before && inside.percent < 100,
    `${before} → ${inside.percent}`,
  );
  check(
    `${theme}: the determinate bar names its value in the line's words`,
    mid.aria.now !== null && mid.aria.valuetext === mid.caption,
    JSON.stringify(mid.aria),
  );
  check(`${theme}: the plant is still alive while it waits`, inside.running.includes("sprout-sway"), inside.running.join(","));
  await shot(page, `shots/92-walk-tune-mid${suffix}.png`);

  // The tune's own report: the stem, leaves and bud take their 700 ms
  // beat, then the bow lands over them and the bar is full. Asserted at
  // the bow, shot once everything has settled.
  await deliver(page, { kind: "tuning", done: 4, total: 4, candidate: 4 });
  await page.waitForTimeout(850);
  const bowing = await read(page);
  check(`${theme}: the plant takes its bow`, bowing.done && bowing.running.includes("sprout-bow"), bowing.running.join(","));
  check(`${theme}: test 4 of 4`, bowing.caption.startsWith("Test 4 of 4 ·"), bowing.caption);
  check(
    `${theme}: nothing left to estimate`,
    !/(min left|almost done)/.test(bowing.caption),
    bowing.caption,
  );
  check(`${theme}: the closing report fills the bar`, bowing.percent === 100, `${bowing.percent}`);
  check(
    `${theme}: every leaf and the bud opened`,
    bowing.leavesOpen === 3 && bowing.budOpen,
    `${bowing.leavesOpen} leaves, bud ${bowing.budOpen ? "open" : "shut"}`,
  );
  await page.waitForTimeout(600);
  const settled = await read(page);
  check(`${theme}: the bud swung open on its hinge`, settled.budAngle === 45, `${settled.budAngle}°`);
  await shot(page, `shots/93-walk-tune-done${suffix}.png`);
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

/** A budget cut: the stop keeps the bar where the tune reached, the plant
    does not play the finish it did not earn, the line says the next start
    does the rest, and the clock stops with the tune. */
async function cut(page, theme) {
  const suffix = theme === "dark" ? "-dark" : "";
  // The reduced pass left the page quiet; this is the ordinary walk again.
  await page.emulateMedia({ reducedMotion: null });
  await deliver(page, { kind: "tuning", done: 2, total: 4, candidate: 2, cut: true });
  await page.waitForTimeout(1400); // the plant settles at its real height
  const stopped = await read(page);
  check(`${theme}: the bar holds at the height the tune reached`, stopped.percent === 50, `${stopped.percent}`);
  check(
    `${theme}: a cut does not play the finish`,
    stopped.done === false && stopped.budAngle !== 45,
    `done=${stopped.done} bud=${stopped.budAngle}°`,
  );
  check(
    `${theme}: the line says the next start finishes it`,
    stopped.caption.includes("Kalsa will finish testing next time it starts"),
    stopped.caption,
  );
  check(
    `${theme}: the stop names its value and keeps its live line`,
    stopped.aria.live === "polite" && stopped.aria.valuetext === stopped.caption && stopped.aria.now === "50",
    JSON.stringify(stopped.aria),
  );
  const frozen = stopped.caption;
  await page.waitForTimeout(1300);
  const still = await read(page);
  check(`${theme}: the cut stops the clock`, still.caption === frozen, `${frozen} → ${still.caption}`);
  await shot(page, `shots/95-walk-tune-cut${suffix}.png`);
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
    await page.waitForSelector(".shell", { timeout: 30000 });
    await page.waitForTimeout(600);
    await walk(page, theme);
    if (theme === "light") await reduced(page);
    await cut(page, theme);
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
