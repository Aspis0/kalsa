// The walk's face, shot: the growing tree at the four moments the owner sees
// it — nothing measured yet, a candidate running under a countable plan, the
// tune's own close, and a phase with no fraction at all — in both themes,
// plus the reduced-motion reading of the same screen. There is no Tauri
// here: a stub keeps the brain on `starting` and the `brain_progress`
// handlers the app registers (the envelope shape Tauri really hands them,
// the one brain-shots.mjs delivers too), and this script delivers each
// report by hand.
//
// Beyond the pictures it asserts what a picture cannot: the indeterminate
// bar's segment TRAVELS (its transform sampled twice, strictly different),
// the tree's lean is running, the determinate bar never reads 100 before the
// closing report and does grow inside a running candidate, the tree grows
// with the walk and blossoms only on a finished tune, the estimate's words
// appear only once a candidate finished, both themes paint the bar in the
// page's own accent, a measuring step is the tree's own line on a first run
// and Home's ring on a normal start, and under reduced motion nothing on the
// walk moves.
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

// The theme tokens the walk must paint with, copied from styles/tokens.css:
// --ac (the rail's leaf mark) and --tx2.
const ACCENT = { light: "rgb(63, 107, 58)", dark: "rgb(169, 207, 142)" };
const LINE_INK = { light: "rgb(83, 88, 74)", dark: "rgb(190, 191, 176)" };

// The walk's one scale (chat/src/surfaces/walkFigures.ts), copied as its
// strings are: the tune runs the bar and the tree from 60 to 92, and only a
// finished tune reaches 100.
const tuneBar = (tunePercent) => Math.floor(60 + 32 * (tunePercent / 100));

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
  chosen_model: "Liquid LFM 2.5",
  chosen_id: "0f3e5d7c9b1a2468",
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

// What the first run's check answers: one model already on disk, so the pick
// goes straight to the walk.
const FIRST_RUN_PICK = {
  options: [{ id: "0f3e5d7c9b1a2468", name: "Liquid LFM 2.5", download_bytes: 2 * GB, drafter: false, on_disk: true, reason_code: null }],
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
    const bar = document.querySelector(".walk-bar");
    const fill = document.querySelector(".walk-bar-fill");
    const line = document.querySelector(".walk-line");
    const sway = document.querySelector(".tree-sway");
    const box = (element) => (element ? element.getBoundingClientRect() : null);
    const barBox = box(bar);
    const fillBox = box(fill);
    const indeterminate = bar?.classList.contains("is-indeterminate") ?? false;
    return {
      head: document.querySelector(".surface-verdict")?.textContent ?? "",
      line: line?.textContent ?? "",
      small: document.querySelector(".walk-small")?.textContent ?? "",
      // The percent the bar really paints, measured off the DOM: the rule
      // lives in the width, not in a number the component reports about itself.
      percent: bar && fillBox && !indeterminate ? Math.round((fillBox.width / barBox.width) * 100) : null,
      indeterminate,
      // How tall the tree stands, in its own drawing's units: it grows with p.
      treeHeight: sway ? Math.round(sway.getBBox().height) : null,
      blossoms: document.querySelectorAll(".tree-bloom").length,
      // The bar's own contract with assistive tech: a progressbar that
      // names its range and value (and has no value when the phase carries
      // none), its value spoken in the line's words, and a polite live line.
      aria: {
        role: bar?.getAttribute("role") ?? null,
        min: bar?.getAttribute("aria-valuemin"),
        max: bar?.getAttribute("aria-valuemax"),
        now: bar?.getAttribute("aria-valuenow"),
        valuetext: bar?.getAttribute("aria-valuetext"),
        live: line?.getAttribute("aria-live") ?? null,
      },
      fillColor: fill && !indeterminate ? getComputedStyle(fill).backgroundColor : null,
      lineColor: line ? getComputedStyle(line).color : null,
      swayName: sway ? getComputedStyle(sway).animationName : null,
      segment: indeterminate && fill ? getComputedStyle(fill).transform : null,
      segmentAnimation: fill ? getComputedStyle(fill).animationName : null,
      fillTransition: fill ? getComputedStyle(fill).transitionDuration : null,
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

  // A phase with no fraction inside a walk that downloads: the engine came
  // down (runtime_bytes), then choosing — the tree at rest and leaning, the
  // segment travelling, and no line, there is no number to say. A start
  // that only measures or decides is Home's ring, never the tree
  // (home-start.mjs).
  await deliver(page, { kind: "runtime_bytes", done: 0, total: 120_000_000 });
  await page.waitForTimeout(300);
  await deliver(page, { kind: "choosing" });
  await page.waitForTimeout(900);
  const checking = await read(page);
  check(`${theme}: the phase says its own line`, checking.head === "Getting ready…", checking.head);
  check(`${theme}: a phase with no fraction has no fill`, checking.percent === null && checking.indeterminate);
  check(`${theme}: and no line it has no number for`, checking.line === "", checking.line);
  await page.waitForTimeout(1200);
  const quiet = await read(page);
  check(`${theme}: and no ticking number appears there later`, quiet.line === "", quiet.line);
  check(`${theme}: the tree leans`, checking.swayName === "tree-sway", checking.swayName);
  check(
    `${theme}: the bar is a progressbar with no value it does not have`,
    checking.aria.role === "progressbar" &&
      checking.aria.min === "0" &&
      checking.aria.max === "100" &&
      checking.aria.now === null &&
      checking.aria.valuetext === null,
    JSON.stringify(checking.aria),
  );
  const segmentA = checking.segment;
  await page.waitForTimeout(500);
  const travelling = await read(page);
  check(
    `${theme}: the indeterminate segment keeps travelling`,
    travelling.segment !== null && travelling.segment !== segmentA,
    `${segmentA} → ${travelling.segment}`,
  );
  await shot(page, `shots/90-walk-checking${suffix}.png`);

  // The tune at nothing: test 1 of 4, no estimate — there is nothing
  // finished to average yet.
  await deliver(page, { kind: "tuning", done: 0, total: 4, candidate: 1 });
  await page.waitForTimeout(1300);
  const seed = await read(page);
  check(`${theme}: the tune's own line is up`, seed.head === "Finding the fastest settings for this computer…", seed.head);
  check(`${theme}: test 1 of 4`, seed.small === "Test 1 of 4", seed.small);
  check(`${theme}: nothing to estimate yet`, !/minutes? left/i.test(seed.line), seed.line);
  check(`${theme}: the tune starts where the download left the walk`, seed.percent === tuneBar(0), `${seed.percent}`);
  check(`${theme}: the bar is the page's own green`, seed.fillColor === ACCENT[theme], seed.fillColor);
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
  check(`${theme}: test 3 of 4`, mid.small === "Test 3 of 4", mid.small);
  // The harness runs on compressed time: two candidates of ~2.5 s leave
  // seconds, not minutes, and "Almost done." is the honest wait for that —
  // the minutes path itself is pinned in verify.mjs's walkProgress.
  check(`${theme}: one candidate finished, so the wait line appears`, /minutes? left|Almost done/.test(mid.line), mid.line);
  check(`${theme}: the line is the page's quiet ink`, mid.lineColor === LINE_INK[theme], mid.lineColor);
  check(
    `${theme}: two of four is half the tune`,
    mid.percent !== null && mid.percent >= tuneBar(49) && mid.percent <= tuneBar(60),
    `${mid.percent}`,
  );
  const before = mid.percent;
  await page.waitForTimeout(1400);
  const inside = await read(page);
  check(
    `${theme}: the running candidate fills its own slot`,
    inside.percent !== null && inside.percent > before && inside.percent < 100,
    `${before} → ${inside.percent}`,
  );
  check(
    `${theme}: the bar's value is the line's words`,
    mid.aria.now !== null && mid.aria.valuetext !== null && mid.aria.valuetext.includes("Test 3 of 4") && mid.aria.live === "polite",
    JSON.stringify(mid.aria),
  );
  check(`${theme}: the tree is still alive while it waits`, inside.running.includes("tree-sway"), inside.running.join(","));
  check(`${theme}: the tune grew the tree past the seedling`, (inside.treeHeight ?? 0) > (seed.treeHeight ?? 0), `${seed.treeHeight} → ${inside.treeHeight}`);
  check(`${theme}: no blossom before the tune is done`, inside.blossoms === 0, `${inside.blossoms}`);
  await shot(page, `shots/92-walk-tune-mid${suffix}.png`);

  // The tune's own report: the bar is full and the tree, stepping up a few
  // times a second, reaches its blossom.
  await deliver(page, { kind: "tuning", done: 4, total: 4, candidate: 4 });
  await page.waitForTimeout(3000);
  const finished = await read(page);
  check(`${theme}: test 4 of 4`, finished.small === "Test 4 of 4", finished.small);
  check(`${theme}: nothing left to estimate`, !/(minutes? left|Almost done)/.test(finished.line), finished.line);
  check(`${theme}: the closing report fills the bar`, finished.percent === 100, `${finished.percent}`);
  check(`${theme}: the finished tune blossoms`, finished.blossoms > 0, `${finished.blossoms} blossoms`);
  await shot(page, `shots/93-walk-tune-done${suffix}.png`);
}

/** Reduced motion: no lean, no travelling segment, no fill transition, and
    the tree lands where the walk is at once instead of stepping there. */
async function reduced(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await deliver(page, { kind: "tuning", done: 0, total: 4, candidate: 1 });
  await page.waitForTimeout(400);
  const still = await read(page);
  check("reduced: the tree does not lean", still.swayName === "none", still.swayName);
  check("reduced: the fill does not glide", Number.parseFloat(still.fillTransition ?? "1") < 0.001, still.fillTransition);
  await deliver(page, { kind: "tuning", done: 4, total: 4, candidate: 4 });
  await page.waitForTimeout(150);
  const landed = await read(page);
  check("reduced: the tree lands at once", landed.blossoms > 0, `${landed.blossoms} blossoms after 150 ms`);
  await deliver(page, { kind: "deciding" });
  await page.waitForTimeout(400);
  const resting = await read(page);
  check("reduced: the segment rests", resting.segmentAnimation === "none", resting.segmentAnimation);
  check(
    "reduced: nothing on the walk animates",
    !resting.running.some((name) => name.startsWith("tree") || name.startsWith("walk")),
    resting.running.join(","),
  );
  await shot(page, "shots/94-walk-reduced.png");
}

/** A budget cut: the stop keeps the bar where the tune reached, the tree
    does not blossom for a finish it did not earn, and the line says the next
    start does the rest. */
async function cut(page, theme) {
  const suffix = theme === "dark" ? "-dark" : "";
  // The reduced pass left the page quiet; this is the ordinary walk again,
  // from a fresh page so the tree has not already blossomed.
  await page.emulateMedia({ reducedMotion: null });
  await page.reload();
  await page.waitForSelector(".shell", { timeout: 30000 });
  await deliver(page, { kind: "tuning", done: 2, total: 4, candidate: 2, cut: true, retry_next: true });
  await page.waitForTimeout(1400);
  const stopped = await read(page);
  check(`${theme}: the bar holds at the height the tune reached`, stopped.percent === tuneBar(50), `${stopped.percent}`);
  check(`${theme}: a cut does not blossom`, stopped.blossoms === 0, `${stopped.blossoms}`);
  check(`${theme}: the line says the next start finishes it`, stopped.line === "Kalsa will finish testing next time it starts.", stopped.line);
  check(
    `${theme}: the stop names its value in its words`,
    stopped.aria.live === "polite" &&
      stopped.aria.now === String(tuneBar(50)) &&
      stopped.aria.valuetext !== null &&
      stopped.aria.valuetext.includes("Kalsa will finish testing next time it starts."),
    JSON.stringify(stopped.aria),
  );
  await shot(page, `shots/95-walk-tune-cut${suffix}.png`);

  // The second stop: this start WAS the retry, so its verdict was saved as
  // a record — the line says what was kept instead of promising a
  // measurement that will never come.
  await deliver(page, { kind: "tuning", done: 2, total: 4, candidate: 2, cut: true, retry_next: false, kept_winner: true });
  await page.waitForTimeout(400);
  const kept = await read(page);
  check(`${theme}: the second stop with a winner says what was kept`, kept.line === "Kalsa kept the best settings it found." && kept.blossoms === 0, kept.line);

  // …and a stop whose verdict ended with no winner: the rule stands, so
  // the line says what will be used rather than what was kept.
  await deliver(page, { kind: "tuning", done: 2, total: 4, candidate: 2, cut: true, retry_next: false, kept_winner: false });
  await page.waitForTimeout(400);
  const standard = await read(page);
  check(`${theme}: the stop with no winner says what will be used`, standard.line === "Kalsa will use its standard settings." && standard.blossoms === 0, standard.line);
}

/** A page on the walk's stub brain, showing the given capability. */
async function openWalkPage(browser, theme, capability, state = STATE) {
  const page = await browser.newPage({ viewport: WINDOW, locale: "en-US" });
  await page.addInitScript(
    ({ theme, answers }) => {
      localStorage.setItem("crescent-chat.theme.v1", theme);
      if (document.documentElement) document.documentElement.dataset.theme = theme;
      window.__TAURI__ = {
        // A start stays open, as a real walk does: the walk stays armed for its steps.
        core: {
          invoke: (command) => (command === "brain_start" ? new Promise(() => {}) : Promise.resolve(answers[command] ?? null)),
        },
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
    { theme, answers: { brain_state: state, brain_capability: capability, brain_test: FIRST_RUN_PICK } },
  );
  await page.goto(APP);
  await page.waitForSelector(".shell", { timeout: 30000 });
  await page.waitForTimeout(600);
  return page;
}

/** The measuring step has no fraction and no number. On a first run it is the
    tree's own line; on a normal start it is Home's ring, never the tree. */
async function measuring(browser, theme) {
  // A first run is stopped until a model is picked. The pick arms the walk, and
  // only an armed walk's steps reach the page.
  const firstRun = await openWalkPage(
    browser,
    theme,
    { ...CAPABILITY, chosen: false, chosen_model: null, chosen_id: null },
    { kind: "stopped" },
  );
  await firstRun.locator("button.first-run-start").click();
  await firstRun.locator(".first-run-continue").click();
  await deliver(firstRun, { kind: "measuring" });
  await firstRun.waitForTimeout(900);
  const checking = await read(firstRun);
  check(`${theme}: a first run's measuring step says its own line`, checking.head === "Checking your computer…", checking.head);
  check(`${theme}: and draws the tree`, checking.treeHeight !== null);
  check(`${theme}: with no fraction there is no fill and no line`, checking.percent === null && checking.indeterminate && checking.line === "");
  await firstRun.close();

  const normal = await openWalkPage(browser, theme, CAPABILITY);
  await deliver(normal, { kind: "measuring" });
  await normal.waitForTimeout(900);
  const home = await normal.evaluate(() => ({
    ring: document.querySelectorAll(".power-busy").length,
    tree: document.querySelectorAll(".tree-sway").length,
  }));
  check(`${theme}: a normal start's measuring step shows the ring, not the tree`, home.ring === 1 && home.tree === 0, JSON.stringify(home));
  await normal.close();
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  for (const theme of ["light", "dark"]) {
    await measuring(browser, theme);
    const page = await openWalkPage(browser, theme, CAPABILITY);
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
