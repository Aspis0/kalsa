// Screenshot driver for the Advanced surface's two panels — the launch knobs
// and the sampling knobs — at the size the app actually opens in. There is no
// Tauri here, so a stub answers `brain_advanced` (and the home page's
// `brain_state` / `brain_capability`) from a fixed fixture per state.
//
// Every state must show its own words: a state that does not show what it must
// saves its evidence as `<name>-FAILED.png` and the run exits non-zero. The
// f16 state is the whole cache/context interaction in one check — it must show
// the f16 maximum and must NOT show the q8_0 one. The popover state is
// measured, not looked at: its bounding box must be inside the window, and a
// hit test at its corners proves it is not clipped by an ancestor.
//
// Usage: npm run dev (port 5173), then node scripts/advanced-shots.mjs [name ...]
//
// Every fixture is checked against advanced-contract.json — the exact field
// names the Rust serde contract test pins — before any shot is taken, so a
// fixture that drifts from the backend's shape fails here rather than in a
// picture.
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { LAUNCH_KNOBS } from "../src/lib/knobs/launch.ts";

const CONTRACT = JSON.parse(readFileSync(new URL("./advanced-contract.json", import.meta.url), "utf8"));
const CONTRACT_KEYS = Object.keys(CONTRACT.sample).sort();

const APP = "http://localhost:5173";
// The window the app opens in, and its declared minimum — src-tauri/tauri.conf.json.
const WINDOW = { width: 1000, height: 720 };
// The app's declared minimum (tauri.conf.json), and a frame tighter than the
// app allows: the popover's viewport clamp only engages below ~500px, so the
// tight frame is what puts it against the right edge to be measured.
const NARROW = { width: 720, height: 480 };
const TIGHT = { width: 540, height: 640 };

const OFF_SENTENCE =
  "The internet road is turned off. The phone reaches this computer the Tailscale way.";

// The resting shape: nothing decided, no server. Every fixture below is this
// one with the fields the state is about changed.
const BASE = {
  context_tokens: null,
  context_max: null,
  context_max_f16: null,
  context_automatic: null,
  context_automatic_f16: null,
  kv_bytes_per_token: null,
  kv_bytes_per_token_f16: null,
  kv_bytes_fixed: null,
  kv_bytes_fixed_f16: null,
  context_override: null,
  idle_unload_seconds: 300,
  idle_override: null,
  batch_size: 2048,
  ubatch_size: 512,
  batch_override: null,
  ubatch_override: null,
  batch_automatic: 2048,
  ubatch_automatic: 512,
  kv_cache_type: "q8_0",
  kv_cache_override: null,
  kv_cache_automatic: "q8_0",
  flash_attention: "on",
  gpu_layers: null,
  threads: null,
  threads_batch: null,
  door_port: null,
  iroh_sentence: OFF_SENTENCE,
  internet_road: false,
  running: false,
};

const RUNNING = { ...BASE, running: true, door_port: 8130 };
// q8_0 in force: the maximum the machine funds for the smaller cache, and the
// figure the bigger cache would fund for the same machine.
const RUNNING_Q8 = {
  ...RUNNING,
  context_tokens: 65315,
  context_max: 65315,
  context_max_f16: 32657,
  // The launcher's automatic pick under each cache — the chat default capped
  // by the machine's maximum — and its own two KV terms, so the help line can
  // name the figure and price it.
  context_automatic: 65315,
  context_automatic_f16: 32657,
  kv_bytes_per_token: 40960,
  kv_bytes_per_token_f16: 81920,
  kv_bytes_fixed: 65863680,
  kv_bytes_fixed_f16: 65863680,
};
// f16 chosen for the next start while q8_0 is still in force: the same maxima
// as above, and the context the server happens to run at (32657 — below the
// q8_0 maximum) so the test can say the q8_0 figure appears nowhere. The
// override makes the context help line read the f16 maximum.
const RUNNING_F16 = {
  ...RUNNING_Q8,
  context_tokens: 32657,
  kv_cache_override: "f16",
};
// Stopped, with the owner's own next-start values saved — including an idle
// time that is none of the panel's three choices, typed into the number field
// this control replaced. Saving must keep it, and must carry every other value
// back: `brain_set_advanced` rebuilds the whole launch record from its
// arguments, so an argument left out is a knob reset to automatic.
const OVERRIDDEN = {
  ...BASE,
  context_tokens: 8192,
  context_override: 8192,
  idle_unload_seconds: 600,
  idle_override: 600,
  ubatch_size: 1024,
  ubatch_override: 1024,
};

const STATES = [
  {
    name: "advanced-stopped",
    file: "shots/80-advanced-stopped.png",
    advanced: BASE,
    showAdvanced: true,
    scrollTo: ".advanced-panel",
    marker: "Next start: context automatic",
    forbid: ["null", "undefined", "NaN"],
  },
  {
    name: "advanced-running-q8",
    file: "shots/81-advanced-running-q8.png",
    advanced: RUNNING_Q8,
    showAdvanced: true,
    scrollTo: ".advanced-panel",
    marker: "In force: context 65315",
    require: ["Automatic is 63.8k (65315 tokens). Up to 63.8k on this computer."],
  },
  {
    name: "advanced-f16-chosen",
    file: "shots/82-advanced-f16-chosen.png",
    advanced: RUNNING_F16,
    showAdvanced: true,
    scrollTo: ".advanced-panel",
    // The f16 maximum must be shown, and the q8_0 maximum must appear nowhere:
    // the cache/context interaction in one check. The marker is the in-force
    // context (stable across the mutation), so a wrong help line lands in the
    // problems list and writes a FAILED png instead of timing out the wait.
    marker: "In force: context 32657",
    require: ["Automatic is 31.9k (32657 tokens). Up to 31.9k on this computer."],
    forbid: ["65315"],
  },
  {
    name: "advanced-overridden",
    file: "shots/83-advanced-overridden.png",
    advanced: OVERRIDDEN,
    showAdvanced: true,
    scrollTo: ".advanced-panel",
    marker: "micro-batch 1024",
    require: ["Next start: context 8192"],
    check: idleSaveProblems,
  },
  {
    name: "sampling-collapsed",
    file: "shots/84-sampling-collapsed.png",
    advanced: BASE,
    scrollTo: ".sampling-panel",
    marker: "Sampling",
    check: async (page) =>
      (await page.locator(".sampling-group-body").count()) === 0
        ? []
        : ["a sampling group is open at rest"],
  },
  {
    name: "sampling-expanded",
    file: "shots/85-sampling-expanded.png",
    advanced: BASE,
    scrollTo: ".sampling-panel",
    group: "Randomness",
    marker: "Temperature",
    check: async (page) =>
      (await page.locator(".sampling-group-body").count()) === 1
        ? []
        : ["the opened sampling group did not render its fields"],
  },
  {
    name: "knob-info-open",
    file: "shots/86-knob-info-open.png",
    advanced: BASE,
    scrollTo: ".sampling-panel",
    group: "Randomness",
    popover: true,
    // `.knob-info-heading` is uppercased in CSS, and innerText is the rendered
    // text — so the marker is the uppercased form.
    marker: "WHAT IT IS",
    check: popoverProblems,
  },
];

/**
 * Every fixture must carry exactly the fields the Rust contract declares. The
 * names come from the sample the serde contract test prints
 * (advanced-contract.json); a missing or invented field fails here, before a
 * picture can make an invented shape look true.
 */
function contractProblems(fixture) {
  const keys = Object.keys(fixture.advanced).sort();
  if (keys.join(",") !== CONTRACT_KEYS.join(",")) {
    return [
      `${fixture.name}: the fixture carries [${keys}] where the contract declares [${CONTRACT_KEYS}]`,
    ];
  }
  return [];
}

/** Fail-loud marker: the state's own words must be on screen. */
async function mustText(page, needle, label) {
  await page.waitForFunction((text) => document.body.innerText.includes(text), needle, {
    timeout: 8000,
    polling: 100,
  });
  console.log("  saw:", label);
}

/**
 * The popover, measured. The box must be inside the window, and a point test
 * just inside each corner must land on the popover itself — a box can be
 * inside the viewport and still be clipped away by an ancestor's overflow,
 * which is exactly the bug this shot exists to hold shut.
 */
async function popoverProblems(page) {
  return page.evaluate(() => {
    const popover = document.querySelector(".knob-info-popover");
    if (!popover) return ["no knob explanation popover is open"];
    const rect = popover.getBoundingClientRect();
    const problems = [];
    const inside =
      rect.left >= 0 &&
      rect.top >= 0 &&
      rect.right <= window.innerWidth + 0.5 &&
      rect.bottom <= window.innerHeight + 0.5;
    if (!inside) {
      problems.push(
        `the popover is outside the window: ${Math.round(rect.left)},${Math.round(rect.top)}..` +
          `${Math.round(rect.right)},${Math.round(rect.bottom)} in ${window.innerWidth}x${window.innerHeight}`,
      );
    }
    for (const [x, y] of [
      [rect.left + 3, rect.top + 3],
      [rect.right - 3, rect.top + 3],
      [rect.left + 3, rect.bottom - 3],
      [rect.right - 3, rect.bottom - 3],
    ]) {
      const onTop = document.elementFromPoint(x, y);
      if (!onTop || !onTop.closest(".knob-info-popover")) {
        problems.push(
          `the popover is clipped at ${Math.round(x)},${Math.round(y)}: ` +
            `${onTop ? onTop.className || onTop.tagName : "nothing"} is on top`,
        );
      }
    }
    return problems;
  });
}

/**
 * The idle clock, in one gesture: read what the file holds, choose a different
 * duration, press Save, and read the arguments back off the bridge.
 *
 * This is the trap the whole check exists for. `brain_set_advanced` is not a
 * patch — it rebuilds the launch record from the call's parameters and carries
 * nothing over but the model and the internet road — so a control that sent
 * only its own value would reset context, batch, micro-batch and cache to
 * automatic with no error to show for it. The owner's 8192-token context and
 * 1024 micro-batch must come back on the wire, and the idle choice must arrive
 * as the number of seconds it stands for.
 */
async function idleSaveProblems(page) {
  const problems = [];
  const select = page.locator("#advanced-idle");
  const chosenBefore = await select.inputValue();
  if (chosenBefore !== "600") {
    problems.push(
      `the idle control shows ${chosenBefore === "" ? "nothing" : chosenBefore} where the settings file says 600 seconds`,
    );
  }
  const labels = await select.locator("option").allTextContents();
  const expected = ["1 minute", "5 minutes", "10 minutes", "1 hour"];
  if (labels.join(" | ") !== expected.join(" | ")) {
    problems.push(`the idle choices are [${labels.join(" | ")}], not [${expected.join(" | ")}]`);
  }
  // Every duration the control offers must be one the backend accepts. That
  // range lives in kalsa-launch (`MIN_IDLE_UNLOAD_SECONDS` ..
  // `MAX_IDLE_UNLOAD_SECONDS`, which `validate` enforces) and is mirrored by
  // this knob's own bounds; the choices name the ends a third time. A range
  // change in either place must not leave the control offering a duration the
  // backend refuses, so the seconds the select really renders are read back
  // against the knob's min and max. (The label check above already fails if the
  // select rendered nothing, so this cannot pass by having no options.)
  const knob = LAUNCH_KNOBS.find((candidate) => candidate.wire === "sleep-idle-seconds");
  const offered = await select
    .locator("option")
    .evaluateAll((options) => options.map((option) => Number(option.value)));
  if (knob === undefined) {
    problems.push("the launch knob table no longer carries the idle clock");
  } else if (typeof knob.min !== "number" || typeof knob.max !== "number") {
    problems.push("the idle knob declares no range for its choices to be checked against");
  } else {
    for (const seconds of offered) {
      if (seconds < knob.min || seconds > knob.max) {
        problems.push(
          `the idle control offers ${seconds} seconds, outside the knob's own range ${knob.min}..${knob.max}`,
        );
      }
    }
  }
  await select.selectOption("3600");
  await page.locator(".advanced-panel .btn-primary").click();
  await page.waitForFunction(
    () => (window.__INVOKES__ ?? []).some(([command]) => command === "brain_set_advanced"),
  );
  const call = await page.evaluate(() =>
    (window.__INVOKES__ ?? []).find(([command]) => command === "brain_set_advanced"),
  );
  const args = call?.[1] ?? {};
  const wanted = {
    contextTokens: 8192,
    idleUnloadSeconds: 3600,
    internetRoad: false,
    batchSize: null,
    ubatchSize: 1024,
    kvCache: null,
  };
  for (const [key, value] of Object.entries(wanted)) {
    if (!(key in args)) {
      problems.push(`the save sent no ${key}, which resets that setting to automatic`);
    } else if (args[key] !== value) {
      problems.push(
        `the save sent ${key}=${JSON.stringify(args[key])} where the panel showed ${JSON.stringify(value)}`,
      );
    }
  }
  return problems;
}

/** The trigger closest to the window's right edge: the worst case for a popover. */
async function rightmostTrigger(page) {
  return page.evaluate(() => {
    const triggers = [...document.querySelectorAll(".knob-info-trigger")];
    let best = 0;
    let bestRight = -1;
    triggers.forEach((trigger, index) => {
      const rect = trigger.getBoundingClientRect();
      if (rect.right > bestRight) {
        bestRight = rect.right;
        best = index;
      }
    });
    return best;
  });
}

/** Stubs the Tauri bridge the way brain-shots.mjs does: answers, no bus. Every
    call is kept on the page, so a check can read the arguments a gesture sent. */
function installStub({ advanced, brain }) {
  window.__INVOKES__ = [];
  window.__TAURI__ = {
    core: {
      invoke: (command, args) => {
        window.__INVOKES__.push([command, args]);
        return Promise.resolve(
          command === "brain_advanced" || command === "brain_set_advanced"
            ? advanced
            : command === "brain_state"
              ? brain
              : command === "brain_capability"
                ? { kind: "unmeasured" }
                : null,
        );
      },
    },
    event: {
      listen: () => Promise.resolve(() => {}),
    },
  };
}

// The destination anchored to this script, not to the process's working
// directory: `node scripts/advanced-shots.mjs` from the repo root resolved
// "shots/..." against the root and grew the stray shots/ tree there.
const shotFile = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

async function shot(page, path) {
  await page.screenshot({ path: shotFile(path) });
  console.log("  saved", path);
}

async function main() {
  const only = new Set(process.argv.slice(2));
  const failures = [];

  const drifted = STATES.flatMap(contractProblems);
  if (drifted.length > 0) {
    console.error(`FIXTURES DRIFTED FROM ${CONTRACT._source}:\n  ${drifted.join("\n  ")}`);
    process.exit(1);
  }

  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  for (const fixture of STATES) {
    if (only.size > 0 && !only.has(fixture.name)) continue;
    const page = await browser.newPage({ viewport: WINDOW, locale: "en-US" });
    await page.addInitScript(installStub, {
      advanced: fixture.advanced,
      brain: fixture.advanced.running
        ? { kind: "running", endpoint: "http://127.0.0.1:8080/v1", model: "Arcee Trinity Nano" }
        : { kind: "stopped" },
    });
    await page.goto(APP);
    await page.locator(".brain-settings-item", { hasText: "Advanced" }).click();
    if (fixture.group) {
      await page.locator(".sampling-group-toggle", { hasText: fixture.group }).click();
    }
    if (fixture.popover) {
      const index = await rightmostTrigger(page);
      await page.locator(".knob-info-trigger").nth(index).click();
    }
    await mustText(page, fixture.marker, fixture.name);

    const problems = [];
    // The launch fields are this page's content, not something behind a
    // "Show settings" button: a settings page, a panel called Server settings
    // and a button to reveal them was a third nesting. The check moved with
    // them — there is nothing to click, and no such button anywhere.
    if ((await page.locator(".advanced-toggle").count()) > 0) {
      problems.push("the panel still hides its fields behind a button");
    }
    if (fixture.showAdvanced && !(await page.locator("#advanced-context").first().isVisible())) {
      problems.push("the launch fields are not visible without a click");
    }
    const text = await page.locator("body").innerText();
    for (const word of fixture.forbid ?? []) {
      if (text.includes(word)) problems.push(`the page shows "${word}"`);
    }
    for (const word of fixture.require ?? []) {
      if (!text.includes(word)) problems.push(`the page does not show "${word}"`);
    }
    if (fixture.check) problems.push(...(await fixture.check(page)));

    if (fixture.scrollTo) await page.locator(fixture.scrollTo).scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const file =
      problems.length === 0 ? fixture.file : fixture.file.replace(/\.png$/, "-FAILED.png");
    await shot(page, file);
    if (problems.length > 0) {
      failures.push(`${fixture.name}: ${problems.join("; ")}`);
    } else {
      // The same convention brain-shots uses: a stale failure picture must not
      // survive the run that proves it fixed.
      rmSync(shotFile(fixture.file.replace(/\.png$/, "-FAILED.png")), { force: true });
    }

    // The popover is the one state whose bug only appears when the window is
    // tight, so it is re-measured in the app's minimum frame and in a frame
    // tight enough to engage the right-edge clamp.
    if (fixture.popover) {
      for (const [label, size] of [
        ["narrow", NARROW],
        ["tight", TIGHT],
      ]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(250);
        const frameProblems = await fixture.check(page);
        const frameFile = fixture.file.replace(/\.png$/, `-${label}.png`);
        await shot(
          page,
          frameProblems.length === 0 ? frameFile : frameFile.replace(/\.png$/, "-FAILED.png"),
        );
        if (frameProblems.length > 0) {
          failures.push(`${fixture.name} (${label}): ${frameProblems.join("; ")}`);
        } else {
          rmSync(shotFile(frameFile.replace(/\.png$/, "-FAILED.png")), { force: true });
        }
      }
    }
    await page.close();
  }

  await browser.close();
  if (failures.length > 0) {
    console.error(`\nFAILED: ${failures.join("; ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
