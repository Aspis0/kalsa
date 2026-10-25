// Home's own start and Home's notices, in a stubbed window:
//  - a normal start (a model already chosen) walks deciding → choosing →
//    starting on Home's busy ring, never on the first run's tree; a step that
//    moves bytes still grows the tree, so the gate is proven able to fail;
//  - a walk that drew the tree and failed keeps its failure screen, and the
//    plain start that Try again begins draws the ring, not that tree;
//  - a model switch confirmed on Your AI lands on Home, and a switch whose
//    start is refused says why there;
//  - a notice over the top of the page and the update sheet at its bottom
//    never lie over Home: Home's own box sits between them (it scrolls when
//    the window is short), at the window's default, the owner's, a small and
//    the declared minimum size;
//  - with the top notice and the update banner both showing, Chat's and
//    Room's composers stay in the window and usable at every size.
//
// Run: node scripts/home-start.mjs   (from chat/, Vite on :5173)

import { chromium } from "@playwright/test";

const APP = "http://localhost:5173";
const SIZES = [
  { width: 1160, height: 830 },
  { width: 1024, height: 700 },
  { width: 1000, height: 720 },
  // src-tauri/tauri.conf.json minWidth × minHeight.
  { width: 720, height: 480 },
];
const CHOSEN = { kind: "unmeasured", chosen: true, chosen_model: "Liquid LFM 2.5" };
// Two measured choices for Your AI, copied from verify.mjs's switch fixture:
// the strings are the product's copy, so a change there should go red here.
const SWITCH_OPTION = { quant: "Q4_K_M", context_tokens: 65_536, speed_context_tokens: 8192, measured: null, details: "the working" };
const SWITCH_CAPABILITY = {
  kind: "measured",
  chosen: true,
  chosen_model: "Alibaba Qwen 3.6",
  chosen_id: "tok-big",
  machine: {
    ram_bytes: 64 * 1024 ** 3,
    budget_bytes: 48 * 1024 ** 3,
    gpu_accounted_for: true,
    runs_on: "the graphics chip",
    bandwidth_bytes_per_second: 400e9,
    bandwidth_basis: "measured",
  },
  model: {
    ...SWITCH_OPTION,
    id: "tok-big",
    name: "Alibaba Qwen 3.6",
    download_bytes: 20_600_000_000,
    speed: { shape: "range", low: 31, high: 46 },
    reason: "Kalsa picked this because it runs well on this computer.",
    reason_code: "model.reason.pick",
  },
  quicker: {
    ...SWITCH_OPTION,
    id: "tok-light",
    name: "Google Gemma 4 E4B",
    download_bytes: 4_600_000_000,
    speed: { shape: "range", low: 70, high: 92 },
    reason: "Smaller and much faster: it starts answering sooner. The one above is the more capable of the two.",
    reason_code: "model.reason.quicker",
  },
  refusal: null,
};

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** A door whose answers the test can change, and whose events it can send
    the way Tauri does (the `{ event, id, payload }` envelope). */
function door(answers) {
  window.__answers = answers;
  window.__listeners = {};
  window.__calls = [];
  window.__TAURI__ = {
    core: {
      // A start stays open until the test settles it, the way a real walk does.
      invoke: (command) => {
        window.__calls.push(command);
        if (command === "brain_start") {
          return new Promise((resolve, reject) => {
            window.__startSettle = { resolve, reject };
          });
        }
        return Promise.resolve(Object.hasOwn(window.__answers, command) ? window.__answers[command] : null);
      },
    },
    event: {
      listen: (name, handler) => {
        (window.__listeners[name] ??= []).push(handler);
        return Promise.resolve(() => {});
      },
    },
  };
  window.__emit = (name, payload) => {
    for (const handler of window.__listeners[name] ?? []) handler({ event: name, id: 1, payload });
  };
  window.__step = (payload) => window.__emit("brain_progress", payload);
}

async function open(browser, size, answers) {
  const page = await browser.newPage({ viewport: size });
  await page.addInitScript(() => localStorage.setItem("crescent-chat.theme.v1", "light"));
  await page.addInitScript(door, {
    window_hidden: false,
    brain_app_version: "0.0.3",
    brain_capability: CHOSEN,
    brain_previous_session_crashed: false,
    ...answers,
  });
  await page.goto(APP);
  return page;
}

/** Two boxes share no point (touching edges are apart). */
const apart = (a, b) => a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left;

/** A control a person can use: its box lies inside the window, and the point
    at its centre belongs to it. A scroll or a clip that pushes it out fails
    the first; something drawn over it fails the second. */
async function reachable(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { inside: false, hit: false };
    const r = el.getBoundingClientRect();
    const inside = r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
    const hit = el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    return { inside, hit };
  }, selector);
}

// Room's fixture, the shape verify.mjs's room case uses: an open room with its AI idle.
const ROOM_INFO = {
  epoch: "home-start-room",
  open: true,
  room_name: "Studio",
  you: 4294967295,
  members: [
    { member_id: 4294967295, name: "", kind: "host", former: false },
    { member_id: 4294967294, name: "Kalsa", kind: "ai", former: false },
  ],
  ai: { state: "idle", running: null, queue: [], you_pending: false },
};

const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  // A normal start: Kalsa reads stopped, Home starts it at once, and the
  // walk's quick steps arrive before the engine loads.
  {
    const page = await open(browser, SIZES[0], {
      brain_state: { kind: "stopped" },
      brain_telemetry_status: { enabled: true, noticeSeen: true },
    });
    await page.locator(".power").waitFor({ timeout: 10000 });
    const trees = [];
    for (const kind of ["measuring", "deciding", "choosing"]) {
      await page.evaluate((step) => window.__step({ kind: step }), kind);
      await page.waitForTimeout(250);
      trees.push({ kind, tree: await page.locator("svg.tree").count(), busy: await page.locator(".power.power-busy").count() });
    }
    check(
      "a normal start's quick steps stay on Home's busy ring, never the tree",
      trees.every((at) => at.tree === 0 && at.busy === 1),
      JSON.stringify(trees),
    );
    await page.evaluate(() => {
      window.__answers.brain_state = { kind: "starting" };
    });
    await page.waitForTimeout(1500);
    check(
      "the engine loading is Home's busy ring too",
      (await page.locator("svg.tree").count()) === 0 && (await page.locator(".power.power-busy").count()) === 1,
    );
    // The control: bytes moving are a download, and a download is the tree.
    await page.evaluate(() => window.__step({ kind: "model_bytes", done: 1_000_000, total: 3_000_000_000 }));
    await page.waitForTimeout(300);
    check("a later download still grows the tree", (await page.locator("svg.tree").count()) === 1);
    await page.close();
  }

  // The alpha notice over Home: at every size the power button stands below it.
  for (const size of SIZES) {
    const page = await open(browser, size, {
      brain_state: { kind: "running", endpoint: "http://127.0.0.1:18081/ok", model: "Liquid LFM 2.5" },
      brain_host_credential: "t",
      brain_telemetry_status: { enabled: true, noticeSeen: false },
    });
    await page.locator(".power").waitFor({ timeout: 10000 });
    await page.locator(".stage-notices .notice-banner").waitFor({ timeout: 10000 });
    const boxes = await page.evaluate(() => {
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      // The notice as a person sees it: the part inside its slot. A notice taller
      // than the slot scrolls, and the part scrolled away is not on the page.
      const slot = rect(document.querySelector(".stage-notices"));
      const banner = rect(document.querySelector(".stage-notices .notice-banner"));
      return {
        notice: { ...banner, top: Math.max(banner.top, slot.top), bottom: Math.min(banner.bottom, slot.bottom) },
        power: rect(document.querySelector(".power")),
        home: rect(document.querySelector(".brain-home")),
      };
    });
    const { notice, power, home } = boxes;
    const powerReach = await reachable(page, ".power");
    check(
      `${size.width}×${size.height}: the notice lies above Home, never over the power button`,
      apart(notice, home) && apart(notice, power) && power.top >= home.top && powerReach.inside && powerReach.hit,
      JSON.stringify({ boxes, powerReach }),
    );

    // The update sheet, notes open as Home draws them, below the same page.
    await page.evaluate(() =>
      window.__emit("brain_update_available", {
        version: "0.4.0",
        notes: "Answers start sooner after you turn Kalsa on.\nIf Kalsa won't write a story, it now tries again.\nFixed: a download could stop at 99%.",
      }),
    );
    await page.locator(".update-sheet").waitFor({ timeout: 5000 });
    // Measured at rest: the sheet's rise is a transform, and a box read
    // mid-rise sits below where it lands.
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.animationName === "update-sheet-rise").map((a) => a.finished)));
    const sheet = await page.evaluate(() => {
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      return { sheet: rect(document.querySelector(".update-sheet")), home: rect(document.querySelector(".brain-home")) };
    });
    check(
      `${size.width}×${size.height}: the update sheet lies below Home, inside the window`,
      apart(sheet.sheet, sheet.home) && sheet.home.bottom - sheet.home.top > 0 && sheet.sheet.top >= 0 && sheet.sheet.bottom <= size.height + 1,
      JSON.stringify(sheet),
    );
    await page.close();
  }

  // A walk that failed after drawing the tree keeps its failure screen; the
  // plain start that Try again begins draws the ring, never that old tree.
  {
    const page = await open(browser, SIZES[0], {
      brain_state: { kind: "stopped" },
      brain_telemetry_status: { enabled: true, noticeSeen: true },
    });
    await page.waitForFunction(() => window.__startSettle !== undefined, null, { timeout: 10000 });
    await page.evaluate(() => window.__step({ kind: "model_bytes", done: 1_000_000, total: 3_000_000_000 }));
    await page.waitForTimeout(300);
    const grew = await page.locator("svg.tree").count();
    await page.evaluate(() =>
      window.__startSettle.reject({ code: "startup.download_failed", text: "Kalsa couldn't finish downloading. Try again later." }),
    );
    await page.getByRole("button", { name: "Try again" }).waitFor({ timeout: 5000 });
    check(
      "a walk that drew the tree and failed keeps its failure screen",
      grew === 1 && (await page.locator(".power").count()) === 0,
      `tree=${grew}`,
    );
    await page.getByRole("button", { name: "Try again" }).click();
    await page.waitForFunction(() => window.__calls.filter((call) => call === "brain_start").length === 2, null, { timeout: 5000 });
    await page.evaluate(() => window.__step({ kind: "measuring" }));
    await page.waitForTimeout(300);
    check(
      "a plain start after a failed tree walk shows the ring, not the tree",
      (await page.locator("svg.tree").count()) === 0 && (await page.locator(".power.power-busy").count()) === 1,
    );
    await page.close();
  }

  // A model switch confirmed on Your AI lands on Home, where its walk shows.
  {
    const page = await open(browser, SIZES[0], {
      brain_state: { kind: "running", endpoint: "http://127.0.0.1:18081/ok", model: "Alibaba Qwen 3.6" },
      brain_host_credential: "t",
      brain_capability: SWITCH_CAPABILITY,
      brain_telemetry_status: { enabled: true, noticeSeen: true },
    });
    await page.locator(".brain-home").getByRole("button", { name: "Details" }).click();
    await page.locator(".ai-page").waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Switch to Quickest" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Switch Kalsa to Gemma 4 E4B" }).click();
    await page.waitForFunction(() => window.__calls.includes("brain_start"), null, { timeout: 5000 });
    await page.waitForTimeout(300);
    check(
      "a model switch confirmed on Your AI lands on Home",
      (await page.locator(".ai-page").count()) === 0 && (await page.locator(".brain-home .power").count()) === 1,
    );
    await page.close();
  }

  // A switch whose start is refused says why after it lands on Home.
  {
    const page = await open(browser, SIZES[0], {
      brain_state: { kind: "running", endpoint: "http://127.0.0.1:18081/ok", model: "Alibaba Qwen 3.6" },
      brain_host_credential: "t",
      brain_capability: SWITCH_CAPABILITY,
      brain_telemetry_status: { enabled: true, noticeSeen: true },
    });
    await page.locator(".brain-home").getByRole("button", { name: "Details" }).click();
    await page.locator(".ai-page").waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Switch to Quickest" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Switch Kalsa to Gemma 4 E4B" }).click();
    await page.waitForFunction(() => window.__calls.includes("brain_start"), null, { timeout: 5000 });
    // The switch's stop has landed: the brain reads stopped while its start is held.
    await page.evaluate(() => {
      window.__answers.brain_state = { kind: "stopped" };
    });
    await page.waitForTimeout(2500);
    await page.evaluate(() =>
      window.__startSettle.reject({ code: "startup.download_failed", text: "Kalsa couldn't finish downloading. Try again later." }),
    );
    await page
      .locator(".brain-sentence")
      .filter({ hasText: "couldn't finish downloading" })
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    const headline = await page.locator(".brain-headline").textContent();
    const sentence = await page.locator(".brain-sentence").textContent();
    check(
      "a switch whose start fails says why on Home",
      (await page.locator(".ai-page").count()) === 0 && headline.includes("couldn't start") && sentence.includes("couldn't finish downloading"),
      `${headline} / ${sentence}`,
    );
    await page.close();
  }

  // Chat and Room with both notices showing: the composer stays in the window
  // and usable at every size; the notices may shrink, scroll or collapse.
  for (const target of [
    { surface: "chat", name: "Chat" },
    { surface: "room", name: "Room" },
  ]) {
    for (const size of SIZES) {
      const page = await open(browser, size, {
        brain_state: { kind: "running", endpoint: "http://127.0.0.1:18081/ok", model: "Liquid LFM 2.5" },
        brain_host_credential: "t",
        brain_room: ROOM_INFO,
        brain_room_history: [],
        brain_telemetry_status: { enabled: true, noticeSeen: false },
      });
      await page.locator(".power").waitFor({ timeout: 10000 });
      await page.locator(`.rail-item[data-surface="${target.surface}"]`).click();
      await page.locator(".composer-input").waitFor({ timeout: 10000 });
      await page.evaluate(() =>
        window.__emit("brain_update_available", {
          version: "0.4.0",
          notes: "Answers start sooner after you turn Kalsa on.\nIf Kalsa won't write a story, it now tries again.",
        }),
      );
      await page.locator(".update-banner").waitFor({ timeout: 5000 });
      const notices = await page.locator(".stage-notices .notice-banner").count();
      const composer = await reachable(page, ".composer-input");
      const send = await reachable(page, ".composer-send");
      check(
        `${target.name} ${size.width}×${size.height}: with both notices, the composer stays in the window and usable`,
        notices === 1 && composer.inside && composer.hit && send.inside && send.hit,
        JSON.stringify({ notices, composer, send }),
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
