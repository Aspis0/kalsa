// Screenshot driver for Home and the machine card on Your AI, at the size the
// app actually opens in. There is no Tauri here, so a stub answers
// `brain_state` and `brain_capability` from a fixed table per state.
//
// Every state must show its own words on Home AND hold Home's shape without
// scrolling: the round button, Details and the footer all on screen. The card
// is then read on Your AI, reached through Details. A failing state saves its
// evidence as `<name>-FAILED.png` and the run exits non-zero.
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

// The words a refused turn-off says on Home.
const STOP_REFUSED = "Kalsa didn't turn off";

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
  name: "Liquid LFM 2.5",
  quant: "Q8_0",
  download_bytes: 2_874_779_648,
  reason_code: "model.reason.catalog",
  context_tokens: 65_536,
  speed_context_tokens: 8192,
  speed: { shape: "range", low: 12, high: 21 },
  measured: null,
  reason: "This is a clear step up from what your phone runs: a bigger, stronger model.",
  details:
    "budget 12.75 GiB of 17.0 GiB — 4.25 GiB kept for the system\n" +
    "weights 2.7 GiB at Q8_0, inside that with room for the cache\n" +
    "bandwidth 110 GB/s measured on the processor: a floor, not the Metal figure\n" +
    "speed 12–21 tokens/s, predicted from that floor and 2.7 GiB of weights",
};

// The same row on a machine that cannot fund a window: weights plus the 512 MiB
// of compute buffers leave ~100 KB, the prompt-cache roof takes a quarter of
// that, and what is left is under the 96 KiB one token of context costs — so
// `funded_context` answers None and the DTO carries `context_tokens: null`.
const NO_CONTEXT_MODEL = {
  ...MODEL,
  download_bytes: 4_831_720_000,
  reason_code: "model.reason.catalog",
  context_tokens: null,
};

// The second option, where a machine has one: a row the catalog predicts at
// least twice as fast as the pick above it, carrying a rate measured on the
// real path — the shape the page must render without ever having seen it.
const QUICK_MODEL = {
  // The backend's opaque token for the row. The page sends it back on a click
  // and never learns what it is made of.
  id: "6f1c0a4b2d9e7315",
  name: "Google Gemma 4 E4B",
  quant: "Q4_K_M",
  download_bytes: 4_977_171_584,
  reason_code: "model.reason.quicker",
  context_tokens: 65_315,
  speed_context_tokens: 8192,
  speed: { shape: "measured", value: 62.7, machine: "an M1 Max" },
  measured: null,
  reason:
    "Smaller and much faster: it starts answering sooner. The one above is the more capable of the two.",
  details:
    "budget 12.75 GiB of 17.0 GiB — 4.25 GiB kept for the system\n" +
    "weights 4.6 GiB at Q4_K_M\n" +
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
  download_bytes: 22_134_528_992,
  reason_code: "model.reason.catalog",
  context_tokens: 547_503,
  speed_context_tokens: 8192,
  speed: { shape: "range", low: 31.0, high: 46.4 },
  measured: null,
  reason:
    "This is the biggest model this computer runs well. Pair your phone and the app can tell you whether it beats what the phone runs.",
  details: "the full working",
};

const BIG_QUICK = {
  ...QUICK_MODEL,
  context_tokens: 414_767,
  speed: { shape: "measured", value: 62.7, machine: "M1 Max" },
  measured: null,
};

// Raised by the catalog before anything else when no phone is paired
// (kalsa_catalog::choice, RefusalReason::PhoneUnknown).
const PHONE_UNKNOWN =
  "No decision yet: we do not know which model your phone runs, and a computer is only " +
  "worth it if it beats what you already have. Pair the phone first.";

// Every code `reason_message` (capability.rs) can put on an option.
const REASON_CODES = [
  "model.reason.pick",
  "model.reason.chosen",
  "model.reason.quicker",
  "model.reason.quicker_smaller",
  "model.reason.bigger",
  "model.reason.more_capable",
  "model.reason.sized_for_memory",
  "model.reason.catalog",
];

// The second option as the backend words it for each comparison it makes
// (capability.rs, the four second-card sentences).
const SECOND = {
  quicker_smaller: "Smaller: it needs less memory. The one above is the more capable of the two.",
  bigger: "Bigger, so it can be more capable. The one above is the smaller of the two.",
  more_capable: "More capable, but slower on this computer. The one above starts answering sooner.",
};
const asSecond = (option, code) => ({ ...option, reason: SECOND[code], reason_code: `model.reason.${code}` });
// capability.rs CHOSEN_REASON: the English an option carries when the owner picked it.
const CHOSEN_GEMMA = {
  ...QUICK_MODEL,
  reason: "You chose this model, so it is the one this computer runs. Choose another, or let this computer choose again, from the same page.",
  reason_code: "model.reason.chosen",
};

/** A running machine whose stored choice is `chosen`, with these two options. */
function twoCards(name, file, chosen, model, quicker, cards, marker) {
  return {
    name,
    file,
    state: { kind: "running", endpoint: "http://127.0.0.1:8080/v1", model: chosen.name },
    capability: { kind: "measured", chosen: true, chosen_model: chosen.name, chosen_id: chosen.id, machine: BIG_MAC, model, quicker, refusal: null },
    cards,
    marker,
    presence: "Ready to chat.",
  };
}

const STATES = [
  {
    name: "pick",
    file: "shots/70-brain-pick.png",
    state: { kind: "running", endpoint: "http://127.0.0.1:8080/v1", model: "Liquid LFM 2.5" },
    capability: {
      kind: "measured",
      chosen: true,
      chosen_model: "Liquid LFM 2.5",
      chosen_id: MODEL.id,
      machine: MAC,
      model: MODEL,
      quicker: QUICK_MODEL,
      refusal: null,
    },
    cards: [["Smartest", "LFM 2.5 by Liquid"], ["Quickest", "Gemma 4 E4B by Google"]],
    marker: "Switch to Quickest",
    presence: "Ready to chat.",
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
      model: "Liquid LFM 2.5",
      asleep: true,
    },
    capability: {
      kind: "measured",
      chosen: true,
      chosen_model: "Liquid LFM 2.5",
      chosen_id: MODEL.id,
      machine: MAC,
      model: MODEL,
      quicker: QUICK_MODEL,
      refusal: null,
    },
    cards: [["Smartest", "LFM 2.5 by Liquid"], ["Quickest", "Gemma 4 E4B by Google"]],
    marker: "Kalsa is using this one",
    presence: "Kalsa is resting to free up memory. Your next message wakes it in a few seconds.",
  },
  {
    name: "refusal",
    file: "shots/71-brain-refusal.png",
    state: { kind: "stopped" },
    capability: { kind: "measured", machine: UNREADABLE_CARD, chosen: true, chosen_model: "Liquid LFM 2.5", chosen_id: MODEL.id, model: null, quicker: null, refusal: PHONE_UNKNOWN },
    marker: "Pair the phone first.",
    presence: "Press the button to turn it on.",
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
      model: "Liquid LFM 2.5",
      metrics: { decode_tokens_per_second: 21.4, active_devices: [{ id: 1 }] },
    },
    capability: { kind: "measured", machine: CPU_ONLY, chosen: true, chosen_model: "Liquid LFM 2.5", chosen_id: MODEL.id, model: MODEL, quicker: null, refusal: null },
    cards: [["LFM 2.5", "LFM 2.5 by Liquid"]],
    marker: "Phones connected now",
    presence: "Your phone is using this computer.",
  },
  {
    name: "no-context",
    file: "shots/74-brain-no-context.png",
    state: { kind: "running", endpoint: "http://127.0.0.1:8080/v1", model: "Liquid LFM 2.5" },
    capability: { kind: "measured", machine: CPU_ONLY, chosen: true, chosen_model: "Liquid LFM 2.5", chosen_id: MODEL.id, model: NO_CONTEXT_MODEL, quicker: null, refusal: null },
    cards: [["LFM 2.5", "LFM 2.5 by Liquid"]],
    marker: "12.0–21.0 tokens/s",
    presence: "Ready to chat.",
  },
  {
    name: "crowded",
    file: "shots/75-brain-crowded.png",
    state: { kind: "running", endpoint: "http://127.0.0.1:8080/v1", model: "Alibaba Qwen 3.6" },
    capability: {
      kind: "measured",
      chosen: true,
      chosen_model: "Alibaba Qwen 3.6",
      chosen_id: BIG_MODEL.id,
      machine: BIG_MAC,
      model: BIG_MODEL,
      quicker: BIG_QUICK,
      refusal: null,
    },
    cards: [["Smartest", "Qwen 3.6 by Alibaba"], ["Quickest", "Gemma 4 E4B by Google"]],
    marker: "Needs 23 GB of space",
    presence: "Ready to chat.",
  },
  // One machine per comparison the backend makes, so each code's titles are seen.
  twoCards("smaller-not-faster", "shots/84-brain-smaller-not-faster.png", BIG_MODEL, BIG_MODEL, asSecond(BIG_QUICK, "quicker_smaller"),
    [["Smartest", "Qwen 3.6 by Alibaba"], ["Gemma 4 E4B", "Gemma 4 E4B by Google"]], "Switch Kalsa to Gemma 4 E4B"),
  twoCards("bigger-and-faster", "shots/85-brain-bigger-and-faster.png", CHOSEN_GEMMA, CHOSEN_GEMMA, asSecond(BIG_MODEL, "bigger"),
    [["Gemma 4 E4B", "Gemma 4 E4B by Google"], ["Qwen 3.6", "Qwen 3.6 by Alibaba"]], "Switch Kalsa to Qwen 3.6"),
  twoCards("more-capable", "shots/86-brain-more-capable.png", CHOSEN_GEMMA, CHOSEN_GEMMA, asSecond(BIG_MODEL, "more_capable"),
    [["Smartest", "Qwen 3.6 by Alibaba"], ["Quickest", "Gemma 4 E4B by Google"]], "Switch to Smartest"),
  {
    // The first run: a machine with no choice stored owns the page — one
    // round button and its one line, nothing else. Then the check, the
    // pick, the download confirm and the walk's progress are shot too.
    name: "start",
    file: "shots/77-brain-start.png",
    firstRun: true,
    state: { kind: "stopped" },
    capability: {
      kind: "measured",
      machine: MAC,
      chosen: false,
      chosen_model: null,
      chosen_id: null,
      model: MODEL,
      quicker: QUICK_MODEL,
      refusal: null,
    },
    marker: "Start",
    presence: "A private assistant that runs on this computer. Your messages and answers stay on it.",
    brainTest: {
      options: [
        { id: MODEL.id, name: MODEL.name, download_bytes: MODEL.download_bytes, drafter: false, on_disk: false, reason_code: MODEL.reason_code },
        { id: QUICK_MODEL.id, name: QUICK_MODEL.name, download_bytes: QUICK_MODEL.download_bytes, drafter: false, on_disk: true, reason_code: QUICK_MODEL.reason_code },
      ],
      refusal: null,
    },
    // Long enough to see: the check measures, the walk downloads.
    delays: { brain_test: 1500, brain_start: 60_000 },
  },
  {
    // An install from before the stored choice, while its model is checked
    // in the background.
    name: "migrating",
    file: "shots/83-brain-migrating.png",
    firstRun: true,
    state: { kind: "stopped" },
    capability: { kind: "migrating" },
    marker: "Checking the AI already on your computer…",
    presence: "Checking the AI already on your computer…",
  },
  {
    // Unmeasured IS the real fresh install — the probe has never run — and
    // it owns the same Start screen a measured first run gets.
    name: "unmeasured",
    file: "shots/73-brain-unmeasured.png",
    firstRun: true,
    state: { kind: "stopped" },
    capability: { kind: "unmeasured", chosen: false, chosen_model: null },
    marker: "Start",
    presence: "A private assistant that runs on this computer. Your messages and answers stay on it.",
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
  if (capability.kind === "migrating") {
    keysAre("capability", Object.keys(capability), ["kind"]);
    return problems;
  }
  // The backend derives these from one stored row: a name exactly when chosen.
  if (capability.chosen !== (capability.chosen_model !== null)) {
    problems.push(`${fixture.name}: chosen is ${capability.chosen} but chosen_model is ${JSON.stringify(capability.chosen_model)}`);
  }
  if (capability.kind === "unmeasured") {
    keysAre("capability", Object.keys(capability), ["kind", "chosen", "chosen_model"]);
    return problems;
  }
  keysAre("capability", Object.keys(capability), Object.keys(SAMPLE));
  if (capability.chosen !== (capability.chosen_id !== null)) {
    problems.push(`${fixture.name}: chosen is ${capability.chosen} but chosen_id is ${JSON.stringify(capability.chosen_id)}`);
  }

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
    if (!REASON_CODES.includes(option.reason_code)) {
      problems.push(`${fixture.name}: ${where}.reason_code "${option.reason_code}" is not one capability.rs emits`);
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

/** What Home must hold at rest, measured. */
async function layout(page) {
  return page.evaluate(() => {
    const at = (n) => Math.round(n);
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: at(r.left), right: at(r.right), top: at(r.top), bottom: at(r.bottom) };
    };
    const within = (b) => b !== null && b.left >= 0 && b.top >= 0 && b.right <= window.innerWidth && b.bottom <= window.innerHeight;
    // Home's round button, not the first run's Start, which wears its look.
    const power = box(document.querySelector(".power:not(.first-run-start)"));
    const details = box(document.querySelector(".brain-details"));
    const foot = box(document.querySelector(".brain-foot"));
    return {
      scrollTop: document.scrollingElement.scrollTop,
      scrollHeight: document.documentElement.scrollHeight,
      power,
      details,
      foot,
      allInside: [power, details, foot].every(within),
    };
  });
}

// The destination anchored to this script, not to the process's working
// directory: `node scripts/brain-shots.mjs` from the repo root resolved
// "shots/..." against the root and grew the stray shots/ tree there.
const shotFile = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

async function shot(page, path) {
  await page.screenshot({ path: shotFile(path) });
  console.log("  saved", path);
}

/** A speed's figure as Details prints it: one decimal on an estimate's ends,
    the reading itself on a measurement. */
function speedFigure(speed) {
  if (speed.shape === "range") return `${speed.low.toFixed(1)}–${speed.high.toFixed(1)} tokens/s`;
  return `${speed.value.toFixed(1).replace(/\.0$/, "")} tokens/s`;
}
const wholeGb = (bytes) => `${Math.max(1, Math.ceil(bytes / 1e9))} GB`;

/** The cards on Your AI and their Details, held to the backend's options. */
async function cardChecks(page, fixture) {
  const problems = [];
  const options = fixture.capability.kind === "measured" ? [fixture.capability.model, fixture.capability.quicker].filter(Boolean) : [];
  if (options.length > 0) {
    await page.locator(".ai-cards").first().waitFor({ timeout: 8000 });
  }
  const seen = await page.evaluate(() => {
    const row = document.querySelector(".ai-cards");
    return {
      cards: [...(row?.querySelectorAll(".ai-card") ?? [])].map((card) => [
        card.querySelector(".ai-card-title")?.firstChild?.textContent?.trim() ?? "",
        card.querySelector(".ai-card-model")?.textContent?.trim() ?? null,
      ]),
      text: row?.innerText ?? "",
      details: document.querySelector(".ai-details")?.innerText ?? "",
      page: document.querySelector(".ai-page")?.innerText ?? "",
    };
  });
  if (options.length === 0) {
    if (seen.cards.length > 0) problems.push("cards drawn with no option to show");
    return problems;
  }
  // Each card claims what the second option's reason code says, and only that.
  if (JSON.stringify(seen.cards) !== JSON.stringify(fixture.cards)) {
    problems.push(`cards are ${JSON.stringify(seen.cards)} not ${JSON.stringify(fixture.cards)}`);
  }
  // Every option says which side of the choice it is on: the one in use says
  // so, and each of the others offers to switch.
  const up = (seen.text.match(/Kalsa is using this one/g) ?? []).length;
  const offered = (seen.text.match(/Switch to (Smartest|Quickest)|Switch Kalsa to /g) ?? []).length;
  if (up + offered !== options.length) {
    problems.push(`${options.length} options but ${up} in use and ${offered} offered to switch`);
  }
  if (/tokens\/s/.test(seen.text)) problems.push("a card carries a speed");
  if (/GiB|MiB/.test(seen.page)) problems.push("Your AI says a second unit beside GB");
  // Details holds the in-use model's own figures and no other model's.
  const inUse = options.find((option) => option.id === fixture.capability.chosen_id);
  if (!inUse) {
    problems.push("the fixture's stored choice is none of its options");
  } else {
    if (!seen.details.includes(speedFigure(inUse.measured != null ? { shape: "measured", value: inUse.measured } : inUse.speed))) {
      problems.push(`Details does not give the in-use speed ${speedFigure(inUse.speed)}: ${seen.details}`);
    }
    if (!seen.details.includes(wholeGb(inUse.download_bytes))) {
      problems.push(`Details does not give the in-use size ${wholeGb(inUse.download_bytes)}: ${seen.details}`);
    }
    for (const other of options.filter((option) => option !== inUse)) {
      if (speedFigure(other.speed) !== speedFigure(inUse.speed) && seen.details.includes(speedFigure(other.speed))) {
        problems.push("Details prints another model's speed");
      }
    }
  }
  // The growth note sits under the speeds on Details, and a context size only
  // in For experts (from brain_advanced): Your AI prints none.
  if (!seen.details.includes("Answers get slower as a conversation grows longer.")) {
    problems.push("Details does not say that answers slow down in a long conversation");
  }
  if (/tokens of context/.test(seen.page)) problems.push("Your AI prints a context size");
  return problems;
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
      ({ answers, seeded, refuse, delays }) => {
        if (seeded) localStorage.setItem("crescent-chat.conversations.v1", JSON.stringify(seeded));
        window.__TAURI__ = {
          core: {
            invoke: (command) =>
              refuse.includes(command)
                ? Promise.reject(new Error("refused"))
                : new Promise((resolve) =>
                    setTimeout(() => resolve(answers[command] ?? null), delays[command] ?? 0),
                  ),
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
        answers: {
          brain_state: fixture.state,
          brain_capability: fixture.capability,
          ...(fixture.brainTest ? { brain_test: fixture.brainTest } : {}),
        },
        seeded: fixture.name === "pick" ? SEEDED : null,
        refuse: fixture.refuse ?? [],
        delays: fixture.delays ?? {},
      },
    );
    await page.goto(APP);
    // The first run's own words are on Home; every other marker is the card's,
    // read on Your AI below.
    if (fixture.firstRun) await mustText(page, fixture.marker, fixture.name);
    await mustText(page, fixture.presence, `${fixture.name} presence`);
    if (fixture.firstRun && (await page.locator(".ai-card, .ai-details").count()) > 0) {
      throw new Error(`${fixture.name}: the first run printed the card before Allow`);
    }

    await page.waitForTimeout(500);
    const held = await layout(page);
    const problems = [];
    if (fixture.firstRun) {
      // Only the button and its line: no power button, no Details. The
      // migrating check is Home's own face (14-home-states-checking-ai): its
      // ring is the point there, and Details is still not.
      const start = fixture.capability.kind !== "migrating";
      if (held.details !== null || (start && held.power !== null)) problems.push("the first run shows more than Start");
    } else if (!held.allInside) {
      problems.push(`Home's button, Details or footer is off screen: ${JSON.stringify(held)}`);
    }
    if (held.scrollHeight > WINDOW.height || held.scrollTop !== 0) {
      problems.push(`the page scrolls: ${held.scrollHeight} tall in ${WINDOW.height}`);
    }
    if (!fixture.firstRun) console.log(`  ${fixture.name}: power ${JSON.stringify(held.power)}, details bottom ${held.details?.bottom}/${WINDOW.height}`);

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
    if (!fixture.firstRun) console.log(
      `  ${fixture.name} at ${SMALL.width}x${SMALL.height}: ${small.allInside ? "inside" : "OFF SCREEN"}, ` +
        `page ${small.scrollHeight} tall, scrollTop ${small.scrollTop}`,
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

    // A turn-off the backend refuses must be said on Home, where it was pressed.
    if (fixture.stopRefused === true) {
      await page.setViewportSize(WINDOW);
      await page.click(".power");
      await mustText(page, STOP_REFUSED, `${fixture.name} refused turn-off`);
    }
    // The first run past Start: the check, the pick (details closed), the
    // download confirm, and the walk's two long phases.
    if (fixture.brainTest) {
      await page.setViewportSize(WINDOW);
      await page.click(".first-run-start");
      await mustText(page, "Checking your computer…", `${fixture.name} checking`);
      await shot(page, "shots/78-brain-checking.png");
      for (const words of ["Choose one.", "Smartest", "Quickest", "Recommended", "Needs 3 GB of space", "Already on your computer", "Continue"]) {
        await mustText(page, words, `${fixture.name} pick: ${words}`);
      }
      const pickText = await page.locator(".first-run").innerText();
      for (const hidden of ["tokens/s", "Q8_0", "Memory", "GiB"]) {
        if (pickText.includes(hidden)) failures.push(`${fixture.name}: the pick shows "${hidden}"`);
      }
      const radios = await page.getByRole("radio").evaluateAll((cards) => cards.map((card) => card.getAttribute("aria-checked")));
      if (JSON.stringify(radios) !== JSON.stringify(["true", "false"])) {
        failures.push(`${fixture.name}: the pick's radios are ${JSON.stringify(radios)}, the recommended one not alone selected`);
      }
      await shot(page, "shots/79-brain-pick.png");
      await page.getByRole("button", { name: "Continue" }).click();
      await mustText(page, "Download 2.9 GB?", `${fixture.name} confirm`);
      await mustText(page, "Kalsa needs this file to answer with LFM 2.5.", `${fixture.name} confirm sentence`);
      await shot(page, "shots/80-brain-confirm.png");
      await page.getByRole("button", { name: "Download" }).click();
      await mustText(page, "Getting ready…", `${fixture.name} working`);
      // The pick clears the previous walk's step once its choice is saved;
      // a step delivered before that would be wiped with it.
      await page.waitForTimeout(300);
      const deliver = (payload) =>
        page.evaluate((step) => {
          for (const handler of window.__kbListeners?.brain_progress ?? []) {
            handler({ event: "brain_progress", id: 8, payload: step });
          }
        }, payload);
      await deliver({ kind: "model_bytes", done: 0, total: MODEL.download_bytes });
      await deliver({ kind: "model_bytes", done: 1_200_000_000, total: MODEL.download_bytes });
      await mustText(page, "Downloading Kalsa's AI…", `${fixture.name} downloading`);
      await mustText(page, "1.2 of 2.9 GB", `${fixture.name} download bytes`);
      await shot(page, "shots/81-brain-download.png");
      await deliver({ kind: "tuning", done: 1, total: 4 });
      await mustText(page, "Finding the fastest settings for this computer…", `${fixture.name} tuning`);
      await shot(page, "shots/82-brain-tuning.png");
    }
    // Last, because it leaves Home: the machine card on Your AI.
    if (!fixture.firstRun) {
      await page.setViewportSize(WINDOW);
      await page.click(".brain-details");
      await mustText(page, fixture.marker, fixture.name);
      const cardProblems = await cardChecks(page, fixture);
      await shot(page, fixture.file.replace(/\.png$/, "-ai.png"));
      if (cardProblems.length > 0) failures.push(`${fixture.name} (Your AI): ${cardProblems.join("; ")}`);
    }
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
