// Screenshot driver for the brain page's machine card, at the size the app
// actually opens in. There is no Tauri here, so a stub answers `brain_state`
// and `brain_capability` from a fixed table per state.
//
// Every state must show its own words AND hold the home page's shape without
// scrolling: the writing bar is the way into the chat (THE-BRAIN-IS-THE-HOME
// §3) and all five settings must be on screen — a compact row that quietly
// drops one, or pushes the fifth off the edge, is the state failing. A failing
// state saves its evidence as `<name>-FAILED.png` and the run exits non-zero.
//
// Usage: npm run dev (port 5173), then node scripts/brain-shots.mjs [name ...]
//
// Every fixture is checked against capability-contract.json — the exact JSON the
// Rust serde contract test prints — before any shot is taken, so a fixture that
// drifts from the backend's shape fails here rather than in a picture.
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const CONTRACT = JSON.parse(readFileSync(new URL("./capability-contract.json", import.meta.url), "utf8"));
const SAMPLE = CONTRACT.sample;

const APP = "http://localhost:5173";
// The window the app opens in, and its declared minimum — src-tauri/tauri.conf.json.
const WINDOW = { width: 1000, height: 720 };
const SMALL = { width: 720, height: 480 };
// A second, taller frame per state, for reading the whole card at once.
const TALL = { width: 1000, height: 1240 };
const GB = 1024 ** 3;

// The home page's row lists this machine — what runs on it, who can reach it,
// how it is launched — and nothing else. The app's own settings are not on it:
// a row called "Settings" holding an entry called "Settings" said neither, and
// appearance, the connection and the web-search switch mean something with the
// brain switched off. Pinned here because every word must survive any change of
// density: same words, same order.
// The words a refused turn-off says, pinned so they cannot drift apart from
// the Server page's copy of the same fact.
const STOP_REFUSED = "The assistant did not turn off. Closing this window will stop it.";

const MACHINE = ["Models", "Server", "Devices", "Advanced"];

// A rate is stubbed in the same binary gigabytes the card divides by, so the
// fixture's bytes and the number on screen agree.
// Decimal, like every published memory-bandwidth figure and like the card
// now prints them. This used to multiply by 1024^3, and the crowded fixture
// carried 183.5 so the card would show 183.5 for a 197 GB/s machine.
const rate = (gigabytes) => gigabytes * 1e9;

// The AppKit path, on a 17 GiB Mac: the machine every owner of one sees.
// A model that decodes on the graphics chip ALWAYS has a floor here — the
// probe streams from the CPU, Metal is several times faster — so this fixture
// carries `bandwidth_basis: "chip"`, the case that actually happens.
const MAC = {
  ram_bytes: 17 * GB,
  budget_bytes: 12.75 * GB, // usable_bytes(17 GiB): minus a quarter
  gpu_accounted_for: true,
  runs_on: "the graphics chip",
  bandwidth_bytes_per_second: rate(110),
  bandwidth_basis: "chip",
};

// A discrete card whose memory could not be read: the budget fell back to
// system RAM and the card is NOT accounted for (kalsa_catalog::footprint).
const UNREADABLE_CARD = {
  ram_bytes: 32 * GB,
  budget_bytes: 24 * GB, // usable_bytes(32 GiB)
  gpu_accounted_for: false,
  runs_on: "the graphics card",
  bandwidth_bytes_per_second: rate(110),
  bandwidth_basis: "chip",
};

// No usable GPU: the measured path is the path the model takes, so there is
// no floor to claim.
const CPU_ONLY = {
  ram_bytes: 8 * GB,
  budget_bytes: 5 * GB, // usable_bytes(8 GiB)
  gpu_accounted_for: true,
  runs_on: "the processor",
  bandwidth_bytes_per_second: rate(24),
  bandwidth_basis: "measured",
};

// A conversation with one message, so the chat's message column (the column
// the bar's first message lands in) exists to be measured.
const SEEDED = [
  {
    id: "seed-thread",
    title: "Seeded thread",
    createdAt: 1,
    updatedAt: 1,
    messages: [{ id: "seed-message", role: "user", content: "Hello.", createdAt: 1 }],
  },
];

const MODEL = {
  id: "0f3e5d7c9b1a2468",
  name: "IBM Granite 4 Tiny",
  quant: "Q4_K_M",
  weights_bytes: 4_000_000_000,
  context_tokens: 4584,
  speed_context_tokens: 8192,
  speed: { shape: "range", low: 12, high: 21 },
  reason: "This is a clear step up from what your phone runs: a bigger, stronger model.",
  details:
    "budget 12.75 GiB of 17.0 GiB — 4.25 GiB kept for the system\n" +
    "weights 3.7 GiB at Q4_K_M, inside that with room for the cache\n" +
    "bandwidth 110 GB/s measured on the processor: a floor, not the Metal figure\n" +
    "speed 12–21 tokens/s, predicted from that floor and 3.7 GiB of weights",
};

// The same row on a machine that cannot fund a window: weights plus the 512 MiB
// of compute buffers leave ~100 KB, the prompt-cache roof takes a quarter of
// that, and what is left is under the 96 KiB one token of context costs — so
// `funded_context` answers None and the DTO carries `context_tokens: null`.
const NO_CONTEXT_MODEL = {
  ...MODEL,
  weights_bytes: 4_831_720_000,
  context_tokens: null,
};

// The second option, where a machine has one: a row the catalog predicts at
// least twice as fast as the pick above it, carrying a rate measured on the
// real path — the shape the page must render without ever having seen it.
const QUICK_MODEL = {
  // The backend's opaque token for the row. The page sends it back on a click
  // and never learns what it is made of.
  id: "6f1c0a4b2d9e7315",
  name: "Arcee Trinity Nano",
  quant: "Q4_K_M",
  weights_bytes: 3_786_957_088,
  context_tokens: 65_315,
  speed_context_tokens: 8192,
  speed: { shape: "measured", value: 62.7, machine: "an M1 Max" },
  reason:
    "Smaller and much faster: it starts answering sooner. The one above is the more capable of the two.",
  details:
    "budget 12.75 GiB of 17.0 GiB — 4.25 GiB kept for the system\n" +
    "weights 3.5 GiB at Q4_K_M\n" +
    "speed 62.7 tokens/s, measured on an M1 Max through Metal",
};

// The real machine, at its most crowded: 64 GiB funds a context of half a
// million tokens, whose digits are the longest string the detail line can
// carry, and both options are on the page at once. Taken from a live run on an
// M1 Max, where the writing bar fell below the window and the shorter fixtures
// above had not noticed.
const BIG_MAC = {
  ram_bytes: 64 * GB,
  budget_bytes: 48 * GB,
  gpu_accounted_for: true,
  runs_on: "the graphics chip",
  bandwidth_bytes_per_second: rate(197),
  bandwidth_basis: "chip",
};

const BIG_MODEL = {
  id: "1a2b3c4d5e6f7081",
  name: "Alibaba Qwen 3.6",
  quant: "Q4_K_M",
  weights_bytes: 22_134_528_992,
  context_tokens: 547_503,
  speed_context_tokens: 8192,
  speed: { shape: "range", low: 31.0, high: 46.4 },
  reason:
    "This is the biggest model this computer runs well. Pair your phone and the app can tell you whether it beats what the phone runs.",
  details: "the full working",
};

const BIG_QUICK = {
  ...QUICK_MODEL,
  context_tokens: 414_767,
  speed: { shape: "measured", value: 62.7, machine: "M1 Max" },
};

// Raised by the catalog before anything else when no phone is paired
// (kalsa_catalog::choice, RefusalReason::PhoneUnknown).
const PHONE_UNKNOWN =
  "No decision yet: we do not know which model your phone runs, and a computer is only " +
  "worth it if it beats what you already have. Pair the phone first.";

const STATES = [
  {
    name: "pick",
    file: "shots/70-brain-pick.png",
    state: { kind: "running", endpoint: "http://127.0.0.1:8080/v1", model: "IBM Granite 4 Tiny" },
    capability: {
      kind: "measured",
      machine: MAC,
      model: MODEL,
      quicker: QUICK_MODEL,
      refusal: null,
    },
    marker: "62.7 tokens/s",
    presence: "This computer is ready for you.",
    refuse: ["brain_stop"],
    stopRefused: true,
  },
  {
    name: "asleep",
    // The model is out of memory and the server is still up: the presence must
    // say both, because "On — this computer is ready for you" is what the owner
    // would read while the first message of the day pays to load the model
    // back. The machine card behind it is unchanged, which is the point: this
    // state differs from `pick` only in the sentences.
    file: "shots/76-brain-asleep.png",
    state: {
      kind: "running",
      endpoint: "http://127.0.0.1:8080/v1",
      model: "IBM Granite 4 Tiny",
      asleep: true,
    },
    capability: {
      kind: "measured",
      machine: MAC,
      model: MODEL,
      quicker: QUICK_MODEL,
      refusal: null,
    },
    marker: "On, asleep",
    presence: "The model is not in memory right now. Your next message brings it back, which takes a few seconds.",
  },
  {
    name: "refusal",
    file: "shots/71-brain-refusal.png",
    state: { kind: "stopped" },
    capability: { kind: "measured", machine: UNREADABLE_CARD, model: null, quicker: null, refusal: PHONE_UNKNOWN },
    marker: "Pair the phone first.",
    presence: "This computer is not running anything right now.",
    walkStep: true,
  },
  {
    name: "cpu",
    // One device connected, so the presence keeps saying so: a connected phone
    // is information of its own, and must not be flattened away.
    file: "shots/72-brain-cpu.png",
    state: {
      kind: "running",
      endpoint: "http://127.0.0.1:8080/v1",
      model: "IBM Granite 4 Tiny",
      metrics: { decode_tokens_per_second: 21.4, active_devices: [{ id: 1 }] },
    },
    capability: { kind: "measured", machine: CPU_ONLY, model: MODEL, quicker: null, refusal: null },
    marker: "the path a model would use",
    presence: "Your phone is using this computer right now.",
  },
  {
    name: "no-context",
    file: "shots/74-brain-no-context.png",
    state: { kind: "running", endpoint: "http://127.0.0.1:8080/v1", model: "IBM Granite 4 Tiny" },
    capability: { kind: "measured", machine: CPU_ONLY, model: NO_CONTEXT_MODEL, quicker: null, refusal: null },
    marker: "12.0–21.0 tokens/s",
    presence: "This computer is ready for you.",
    noContext: true,
  },
  {
    name: "crowded",
    file: "shots/75-brain-crowded.png",
    state: { kind: "running", endpoint: "http://127.0.0.1:8080/v1", model: "Alibaba Qwen 3.6" },
    capability: {
      kind: "measured",
      machine: BIG_MAC,
      model: BIG_MODEL,
      quicker: BIG_QUICK,
      refusal: null,
    },
    marker: "547,503 tokens of context",
    presence: "This computer is ready for you.",
  },
  {
    name: "unmeasured",
    file: "shots/73-brain-unmeasured.png",
    state: { kind: "stopped" },
    capability: { kind: "unmeasured" },
    marker: "has not been measured yet",
    presence: "This computer is not running anything right now.",
  },
];

/**
 * Every fixture must carry exactly the fields the Rust contract declares, and
 * values the backend's own rules allow. The key sets come from the sample the
 * serde contract test prints (capability-contract.json); only the speed shapes
 * and the runs_on/floor rule are declared by hand, because one sample cannot
 * show the other shapes and Rust's path rules are not in the JSON.
 *
 * It catches: a fixture missing or inventing a field, a speed object whose keys
 * belong to another shape, a `runs_on` the probe's words do not contain, a
 * machine claiming a floor it cannot have (or hiding one it must have), and a
 * sentence field that is a stub or cut off. It does NOT catch a plausible but
 * invented value — a reason that reads like a sentence but is not the catalog's
 * — because nothing in the frontend knows what the catalog would have said.
 */
function contractProblems(fixture) {
  const problems = [];
  const same = (a, b) => [...a].sort().join(",") === [...b].sort().join(",");
  /** The fields must be exactly these — no extra, none missing. */
  const keysAre = (path, fields, expected) => {
    if (!same(fields, expected)) {
      problems.push(`${fixture.name}: ${path} carries [${fields}] where the contract declares [${expected}]`);
    }
  };
  const isSentence = (text) =>
    typeof text === "string" && text.trim().length >= 20 && /[.!?]$/.test(text.trim());

  const capability = fixture.capability;
  if (capability.kind === "unmeasured") {
    keysAre("capability", Object.keys(capability), ["kind"]);
    return problems;
  }
  keysAre("capability", Object.keys(capability), Object.keys(SAMPLE));

  const machine = capability.machine;
  keysAre("capability.machine", Object.keys(machine), Object.keys(SAMPLE.machine));
  const allowed = CONTRACT.runs_on[machine.runs_on];
  if (allowed === undefined) {
    problems.push(`${fixture.name}: capability.machine.runs_on is "${machine.runs_on}", not one of [${Object.keys(CONTRACT.runs_on)}]`);
  } else if (!allowed.includes(machine.bandwidth_basis)) {
    problems.push(
      `${fixture.name}: a machine running on ${machine.runs_on} says bandwidth_basis "${machine.bandwidth_basis}", and the path rule allows [${allowed}]`,
    );
  }

  // Both options, by the same rule. Only `model` used to be checked, so a
  // `quicker` whose measured speed had lost its `machine` passed the gate and
  // the page printed "measured on undefined" with the harness green.
  const checkOption = (where, option) => {
    keysAre(where, Object.keys(option), Object.keys(SAMPLE.model));
    const speed = option.speed;
    const speedKeys = CONTRACT.speed_keys[speed.shape];
    const carried = Object.keys(speed).filter((key) => key !== "shape");
    if (!speedKeys) {
      problems.push(`${fixture.name}: ${where} speed.shape is "${speed.shape}", not one of [${Object.keys(CONTRACT.speed_keys)}]`);
    } else {
      keysAre(`a ${speed.shape} speed on ${where}`, carried, speedKeys);
    }
    if (!isSentence(option.reason)) {
      problems.push(`${fixture.name}: ${where}.reason is not a whole sentence: ${JSON.stringify(option.reason)}`);
    }
  };

  const model = capability.model;
  if (model) {
    checkOption("capability.model", model);
    if (capability.quicker) checkOption("capability.quicker", capability.quicker);
  } else if (!isSentence(capability.refusal)) {
    problems.push(`${fixture.name}: capability.refusal is not a whole sentence: ${JSON.stringify(capability.refusal)}`);
  }
  return problems;
}

/** Fail-loud marker: the state's own words must be on screen. */
async function mustText(page, needle, label) {
  await page.waitForFunction((text) => document.body.innerText.includes(text), needle, {
    timeout: 8000,
    polling: 100,
  });
  console.log("  saw:", label);
}

/** What the page must hold at rest, measured. */
async function layout(page) {
  return page.evaluate((expected) => {
    const at = (n) => Math.round(n);
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: at(r.left), right: at(r.right), top: at(r.top), bottom: at(r.bottom) };
    };
    const items = [...document.querySelectorAll(".brain-settings-item")];
    const labelled = items.map((button) => button.textContent.trim());
    const boxes = items.map(box);
    const within = (b) => b.left >= 0 && b.top >= 0 && b.right <= window.innerWidth && b.bottom <= window.innerHeight;
    const nav = document.querySelector(".brain-settings");
    // How many lines the labels took, and how wide the widest of them is:
    // the row wraps rather than overflow, and this is how that is seen.
    const rows = new Set(boxes.map((b) => b.top)).size;
    const rowWidth = boxes.length > 0 ? Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.left)) : 0;
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollTop: document.scrollingElement.scrollTop,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      bar: box(document.querySelector(".brain-bar-input")),
      nav: box(nav),
      labelled,
      boxes,
      rows,
      rowWidth,
      sameWords: labelled.length === expected.length && labelled.every((word, i) => word === expected[i]),
      allInside: boxes.length > 0 && boxes.every(within),
    };
  }, MACHINE);
}

// The destination anchored to this script, not to the process's working
// directory: `node scripts/brain-shots.mjs` from the repo root resolved
// "shots/..." against the root and grew the stray shots/ tree there.
const shotFile = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

async function shot(page, path) {
  await page.screenshot({ path: shotFile(path) });
  console.log("  saved", path);
}

/**
 * The morph's seam (THE-BRAIN-IS-THE-HOME §3): the writing bar becomes the
 * first message, so the width the bar starts at should already be close to the
 * column that message lands in. Measured, not assumed — the bar sits inside the
 * page's padding and the chat's column has its own, and the chat's column is
 * further capped by the sidebar the surfaces do not have.
 */
async function morph(page) {
  const width = (selector) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { outer: Math.round(r.width), inner: Math.round(r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) };
    }, selector);

  const bar = await width(".brain-bar");
  await page.locator(".brain-bar-chat").click();
  await page.waitForTimeout(600);
  // Open the seeded conversation: with nothing open there is no message column
  // at all, only the empty state.
  const row = page.locator(".sidebar").getByRole("button", { name: /Seeded thread/ }).first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(400);
  }
  const column = await width(".thread-column");
  const composer = await width(".composer");
  const target = column ?? composer;
  const which = column ? ".thread-column" : ".composer";
  const delta = Math.abs(bar.outer - target.outer);
  console.log(
    `  morph: .brain-bar ${bar.outer}px vs ${which} ${target.outer}px ` +
      `(${target.inner} inner) -> ${delta}px ${bar.outer > target.outer ? "wider" : "narrower"}`,
  );
}

async function main() {
  const only = new Set(process.argv.slice(2));
  const failures = [];

  // The fixtures first: a state the backend cannot produce must never reach a
  // picture, because a convincing picture is what gets reasoned from.
  const drifted = STATES.flatMap(contractProblems);
  if (drifted.length > 0) {
    console.error(`FIXTURES DRIFTED FROM ${CONTRACT._source}:\n  ${drifted.join("\n  ")}`);
    process.exit(1);
  }

  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  for (const fixture of STATES) {
    if (only.size > 0 && !only.has(fixture.name)) continue;
    // The locale is pinned because the assertions below build their expected
    // strings with `toLocaleString("en-US")` while the page calls it with no
    // argument: on a machine set to anything else the harness failed a
    // correct page.
    const page = await browser.newPage({ viewport: WINDOW, locale: "en-US" });
    await page.addInitScript(
      ({ answers, seeded, refuse }) => {
        if (seeded) localStorage.setItem("crescent-chat.conversations.v1", JSON.stringify(seeded));
        window.__TAURI__ = {
          core: {
            invoke: (command) =>
              refuse.includes(command)
                ? Promise.reject(new Error("refused"))
                : Promise.resolve(answers[command] ?? null),
          },
          // The real bus hands the listener an ENVELOPE -- { event, id,
          // payload } -- not the payload. A stub that delivers nothing let
          // the whole walk display rot unnoticed: the brain's only listener
          // stored the envelope, every step arrived with `kind` undefined,
          // and a twenty-gigabyte download rendered as "Getting this
          // computer ready" with no bytes. This stub keeps the handlers so a
          // test can deliver one the same shape Tauri does.
          event: {
            listen: (name, handler) => {
              window.__kbListeners = window.__kbListeners || {};
              (window.__kbListeners[name] = window.__kbListeners[name] || []).push(handler);
              return Promise.resolve(() => {});
            },
          },
        };
      },
      {
        answers: { brain_state: fixture.state, brain_capability: fixture.capability },
        seeded: fixture.name === "pick" ? SEEDED : null,
        refuse: fixture.refuse ?? [],
      },
    );
    await page.goto(APP);
    await mustText(page, fixture.marker, fixture.name);
    // The presence sentence is this page's own copy: pinned here so it cannot
    // drift back to saying the phone is the reason the computer is on.
    await mustText(page, fixture.presence, `${fixture.name} presence`);
    const tiles = await page.evaluate(() => {
      const card = document.querySelector(".machine-card");
      if (!card) return null;
      return {
        names: [...card.querySelectorAll(".machine-option-name")].map((n) => n.textContent.trim()),
        speeds: [...card.querySelectorAll(".machine-option-speed")].map((n) => n.textContent.trim()),
        text: card.innerText,
      };
    });
    if (fixture.capability.kind === "measured") {
      await page.locator(".machine-card").first().waitFor({ timeout: 8000 });
    } else if (tiles) {
      throw new Error(`${fixture.name}: unmeasured state printed numbers`);
    }

    await page.waitForTimeout(500);
    const held = await layout(page);
    const problems = [];
    if (fixture.capability.model) {
      // One block per option, in the order the backend sent them: the pick
      // first, the faster alternative — when the machine has one — under it.
      // A machine with a single speed class must show exactly one block.
      const expected = [fixture.capability.model, fixture.capability.quicker]
        .filter(Boolean)
        .map((option) => option.name);
      if (tiles.names.join(" | ") !== expected.join(" | ")) {
        problems.push(`options are [${tiles.names}] not [${expected}]`);
      }
      if (tiles.speeds.length !== expected.length) {
        problems.push(`${tiles.speeds.length} speeds for ${expected.length} options`);
      }
      // Every option says which side of the choice it is on: the one that is
      // running says so, and each of the others offers to switch — never a
      // control on a model that is already up, because that click would do
      // nothing.
      const up = (tiles.text.match(/Running now\./g) ?? []).length;
      const offered = (tiles.text.match(/Use this model/g) ?? []).length;
      if (up + offered !== expected.length) {
        problems.push(`${expected.length} options but ${up} running and ${offered} offered to choose`);
      }
      // The length every speed is priced at, in the drawer now rather than on
      // the card. Without it the figures read as general claims, and the cache
      // makes them false the moment a conversation starts; the reason it was
      // written still holds, so the check moved with it. `textContent` reads
      // the drawer closed, so no screenshot or geometry check moves with it.
      const priced = `These speeds are for a conversation of about ${fixture.capability.model.speed_context_tokens.toLocaleString("en-US")} tokens`;
      const working = await page.evaluate(() => {
        const card = document.querySelector(".machine-card");
        const drawer = card?.querySelector(".machine-working");
        return drawer ? { drawer: drawer.textContent ?? "", card: card.innerText } : null;
      });
      if (working === null) {
        problems.push("there is no drawer to hold the sentence the speeds are priced at");
      } else if (!working.drawer.includes(priced)) {
        problems.push(`the drawer does not say what the speeds are priced at ("${priced}")`);
      } else if (working.card.includes("Predicted speeds are for a")) {
        problems.push("the card still carries the priced-at footnote the drawer was given");
      }
      const showsContext = /up to [\d,]+ tokens of context/.test(tiles.text);
      if (fixture.noContext === true && showsContext) {
        problems.push("a machine funding no context still printed one");
      }
      if (fixture.noContext !== true && !showsContext) {
        problems.push("a funded context printed none");
      }
    }
    if (held.bar.bottom > WINDOW.height || held.scrollTop !== 0) {
      problems.push(`writing bar bottom ${held.bar.bottom} > ${WINDOW.height}`);
    }
    // And the page itself, not just the bar: `.surface-page`'s bottom padding
    // can hold an overflow underneath a bar that is still above the fold, so
    // the bar's own geometry cannot see a page that scrolls.
    if (held.scrollHeight > WINDOW.height) {
      problems.push(`the page scrolls: ${held.scrollHeight} tall in ${WINDOW.height}`);
    }
    if (!held.sameWords) {
      problems.push(`the home row is [${held.labelled}] not [${MACHINE}]`);
    } else if (!held.allInside) {
      problems.push(`settings outside the viewport: ${JSON.stringify(held.boxes)}`);
    }
    console.log(
      `  ${fixture.name}: bar ${held.bar.bottom}/${WINDOW.height}, ` +
        `machine items ${held.labelled.length}/4 in ${held.rows} row(s) ${held.rowWidth}px wide inside a ` +
        `${held.nav.bottom - held.nav.top}px nav (${held.nav.top}-${held.nav.bottom}), ` +
        `scrollTop ${held.scrollTop}`,
    );

    const file = problems.length === 0 ? fixture.file : fixture.file.replace(/\.png$/, "-FAILED.png");
    await shot(page, file);
    if (problems.length > 0) failures.push(`${fixture.name}: ${problems.join("; ")}`);
    else rmSync(shotFile(fixture.file.replace(/\.png$/, "-FAILED.png")), { force: true });

    // The same state in a taller frame, so the whole card can be read.
    await page.setViewportSize(TALL);
    await page.waitForTimeout(300);
    await shot(page, fixture.file.replace(/\.png$/, "-tall.png"));

    // And at the window's declared minimum, which is not asserted: this is
    // where the page is expected to scroll, and the question is only whether
    // it degrades sanely.
    await page.setViewportSize(SMALL);
    await page.waitForTimeout(300);
    const small = await layout(page);
    console.log(
      `  ${fixture.name} at ${SMALL.width}x${SMALL.height}: bar bottom ${small.bar.bottom}, ` +
        `machine items ${small.labelled.length}/4 in ${small.rows} row(s) ${small.rowWidth}px wide ` +
        `${small.allInside ? "inside" : "OFF SCREEN"} (nav ${small.nav.top}-${small.nav.bottom}), ` +
        `page ${small.scrollHeight}x${small.scrollWidth} tall/wide, scrollTop ${small.scrollTop}`,
    );
    await shot(page, fixture.file.replace(/\.png$/, "-small.png"));
    // A walk step delivered through the real envelope shape. The phase's own
    // sentence and its bytes must reach the page; the neutral fallback
    // ("Getting this computer ready") means the payload did not survive.
    if (fixture.walkStep === true) {
      await page.setViewportSize(WINDOW);
      await page.evaluate(() => {
        for (const handler of window.__kbListeners?.brain_progress ?? []) {
          handler({ event: "brain_progress", id: 7, payload: { kind: "model_bytes", done: 1_100_000_000, total: 22_134_528_992 } });
        }
      });
      await mustText(page, "of 22.1 GB", `${fixture.name} download bytes`);
      const neutral = await page.locator("body").innerText();
      if (neutral.includes("Getting this computer ready")) {
        failures.push(`${fixture.name}: the walk fell back to the neutral sentence, so the payload did not arrive`);
      }
    }

    // A turn-off the backend refuses. The hook has produced `stopFailure`
    // since it was written and only the Server page read it, so the owner
    // pressed Turn off HERE, nothing happened, and here said nothing about
    // it. Driven last on the brain page, after the shots.
    if (fixture.stopRefused === true) {
      await page.setViewportSize(WINDOW);
      await page.click(".brain-presence .btn-primary");
      await mustText(page, STOP_REFUSED, `${fixture.name} refused turn-off`);
    }
    // Last, because it leaves the brain page: the morph's two widths, back at
    // the window size the app opens in.
    await page.setViewportSize(WINDOW);
    await page.waitForTimeout(300);
    if (fixture.name === "pick") await morph(page);
    await page.close();
  }

  await browser.close();
  if (failures.length > 0) {
    console.error(`\nFAILED: ${failures.join("; ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
