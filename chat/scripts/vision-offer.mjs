// The "let Kalsa see images" offer, against the real build.
//
// A stubbed brain answers `brain_state` with the launch's own `vision` field
// (`src-tauri/src/vision.rs`): `{"state":"none"}`, `{"state":"offer",
// "bytes":N}` or `{"state":"on"}`. The rules pinned here: nothing shows for
// `none` or `on`; the affordance shows for `offer`, with the download's own
// figure; one press asks once and downloads once; the bytes render through
// the same walk view the model download uses; the restart says so, `/props`
// is read again — under the same model name and endpoint, which is the case
// a model-keyed read misses — and the composer's picker then offers
// pictures; the memory plan's refusal is a sentence, a failed download is a
// sentence with a retry, and no card is ever left spinning.
//
// `brain_vision_enable` is held open by the test, so the download's progress
// and the restart happen while the command is still in the air, exactly as
// they do in the app.
//
// Run: node scripts/vision-offer.mjs [chromium|webkit ...]   (from chat/)

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENGINES,
  appCsp,
  buildApp,
  check,
  failedChecks,
  probe,
  serveDist,
} from "./lib/stream-app.mjs";

const CHAT_DIR = fileURLToPath(new URL("..", import.meta.url));
const OFFER_BYTES = 655_360_000;
const SMALL_BYTES = 300_000_000;

/** Two animation frames: React has committed, the page has not painted. */
const frames = (page) =>
  page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))));

/** One poll of `brain_state` (2 s) plus a frame: enough for a change in the
    stub to reach the page, for the checks that nothing shows. */
async function polled(page) {
  await page.waitForTimeout(2600);
  await frames(page);
}

async function runEngine(engineName, origin) {
  console.log(`\n--- ${engineName} ---`);
  const browser = await ENGINES[engineName].launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  let propsHits = 0;
  await page.route("**/props", async (route) => {
    propsHits += 1;
    const vision = await page.evaluate(() => window.__propsVision);
    await route.fulfill({
      json: {
        default_generation_settings: { n_ctx: 4096 },
        modalities: { vision, audio: false, video: false },
        chat_template: "",
      },
    });
  });
  await page.route("**/kalsa/chat/**", (route) => route.fulfill({ status: 204, body: "" }));

  await page.addInitScript(() => {
    window.__vision = { state: "none" };
    window.__propsVision = false;
    window.__kind = "running";
    window.__invokes = 0;
    window.__handlers = new Map();
    let settle = null;
    // The enable command stays in the air until the test answers it: the
    // download's progress and the engine's restart both happen before it.
    window.__enableAnswer = (error) => {
      const answer = settle;
      settle = null;
      if (answer) answer(error ?? null);
    };
    // Tauri's envelope, which lib/tauri.ts unwraps for the app.
    window.__emit = (event, payload) => {
      for (const handler of window.__handlers.get(event) ?? []) handler({ event, id: 1, payload });
    };
    window.__TAURI__ = {
      core: {
        invoke: (command) => {
          if (command === "brain_state")
            return Promise.resolve({
              kind: window.__kind,
              endpoint: "http://127.0.0.1:18099/v1",
              model: "m",
              asleep: false,
              vision: window.__vision,
              metrics: {},
            });
          if (command === "brain_host_credential") return Promise.resolve("t");
          if (command === "brain_capability") return Promise.resolve({ kind: "unmeasured", chosen: true });
          if (command === "brain_previous_session_crashed") return Promise.resolve(false);
          if (command === "brain_log_event") return Promise.resolve(null);
          if (command === "brain_vision_enable") {
            window.__invokes += 1;
            return new Promise((resolve, reject) => {
              settle = (error) => (error ? reject(error) : resolve(window.__vision));
            });
          }
          return Promise.reject(new Error(`stub missing ${command}`));
        },
      },
      event: {
        listen: (event, handler) => {
          const list = window.__handlers.get(event) ?? [];
          list.push(handler);
          window.__handlers.set(event, list);
          return Promise.resolve(() => {});
        },
      },
    };
  });

  const vision = (state) => page.evaluate((next) => { window.__vision = next; }, state);
  const kind = (next) => page.evaluate((value) => { window.__kind = value; }, next);
  const emit = (step) => page.evaluate((payload) => window.__emit("brain_progress", payload), step);
  const invokes = () => page.evaluate(() => window.__invokes);
  const answer = (error) => page.evaluate((next) => window.__enableAnswer(next), error ?? null);
  const text = async (selector) => (await page.locator(selector).first().textContent()) ?? "";

  try {
    await page.goto(`${origin}/`);
    await page.waitForSelector(".brain-bar-chat, .composer textarea");
    const chip = page.locator(".brain-bar-chat");
    if ((await chip.count()) > 0) await chip.first().click();
    await page.waitForSelector(".composer textarea");

    // 1. Nothing is offered for a row with no projector, or one already on.
    await polled(page);
    const quiet = {
      offer: await page.locator(".composer-vision").count(),
      card: await page.locator(".vision-offer").count(),
    };
    check("a model with no projector offers nothing", quiet.offer === 0 && quiet.card === 0, JSON.stringify(quiet));

    await vision({ state: "offer", bytes: OFFER_BYTES });
    const offered = await probe(page, () => document.querySelector(".composer-vision") !== null, null, 8000);
    const label = await text(".composer-vision");
    check(
      "the offer appears with the download's own figure",
      offered && label === "Let Kalsa see images (downloads 655 MB)",
      JSON.stringify({ offered, label }),
    );

    // 2. One press asks once, in words that say what it costs and what follows.
    await page.locator(".composer-vision").click();
    const asked = await probe(page, () => document.querySelector("#vision-ask") !== null);
    const question = await text("#vision-ask");
    check(
      "the press asks once, with the figure and the restart",
      asked && question === `Download 655 MB so Kalsa can see images? Kalsa restarts when it's done.`,
      JSON.stringify({ asked, question }),
    );
    const answers = {
      download: await page.locator(".vision-offer .vision-download").count(),
      notNow: await page.locator(".vision-offer .vision-not-now").count(),
    };
    check("the ask carries both answers", answers.download === 1 && answers.notNow === 1, JSON.stringify(answers));
    await page.locator(".vision-not-now").click();
    const declined = await probe(
      page,
      () => document.querySelector(".vision-offer") === null && document.querySelector(".composer-vision") !== null,
    );
    check("Not now puts it back on the shelf, with nothing downloaded", declined && (await invokes()) === 0, JSON.stringify({ declined, invokes: await invokes() }));

    // 3. The download: one invoke, the walk's own view, then the restart.
    await page.locator(".composer-vision").click();
    await page.waitForSelector(".vision-download");
    const box = await page.locator(".vision-download").boundingBox();
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    const running = await probe(page, () => document.querySelector(".vision-running") !== null);
    check("the download takes the card, once", running && (await invokes()) === 1, JSON.stringify({ running, invokes: await invokes() }));

    // A picture picked while the download runs must not take the card back.
    await page.evaluate(() => {
      const input = document.querySelector('.composer input[type="file"]');
      const file = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
      const list = new DataTransfer();
      list.items.add(file);
      input.files = list.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await frames(page);
    check(
      "a picture picked mid-download does not ask again",
      (await page.locator(".vision-running").count()) === 1 && (await page.locator(".vision-offer .vision-download").count()) === 0,
      JSON.stringify({ running: await page.locator(".vision-running").count(), ask: await page.locator(".vision-offer").count() }),
    );

    await emit({ kind: "model_bytes", done: 100_000_000, total: OFFER_BYTES });
    const first = await probe(page, () => (document.querySelector(".vision-running")?.textContent ?? "").includes("100 of 655 MB"));
    const head = await text(".vision-running .surface-verdict");
    check("the bytes render through the walk's own view", first && head === "Downloading…", JSON.stringify({ first, head }));
    await emit({ kind: "model_bytes", done: 300_000_000, total: OFFER_BYTES });
    const moving = await probe(page, () => (document.querySelector(".vision-running")?.textContent ?? "").includes("300 of 655 MB"));
    check("the number follows the events", moving, await text(".vision-running"));

    await kind("starting");
    const restarting = await probe(page, () => document.querySelector(".vision-restarting") !== null, null, 9000);
    const restartWords = await text(".vision-restarting");
    check(
      "the restart says what is happening while the engine is away",
      restarting && restartWords === "Restarting Kalsa…",
      JSON.stringify({ restarting, restartWords }),
    );

    // 4. The new engine's /props is read again — same endpoint, same model.
    const before = propsHits;
    const accept = () => page.evaluate(() => document.querySelector('.composer input[type="file"]')?.getAttribute("accept") ?? "");
    const blind = await accept();
    await page.evaluate(() => {
      window.__propsVision = true;
      window.__vision = { state: "on" };
      window.__kind = "running";
    });
    await answer(null);
    const cleared = await probe(page, () => document.querySelector(".vision-offer") === null, null, 9000);
    const seeing = await probe(
      page,
      () => (document.querySelector('.composer input[type="file"]')?.getAttribute("accept") ?? "").includes(".png"),
      null,
      9000,
    );
    check(
      "after the restart the facts are read again",
      propsHits > before && blind.includes(".png") === false,
      JSON.stringify({ before, after: propsHits, blind }),
    );
    check(
      "and the picker offers pictures, with the offer gone",
      seeing && cleared && (await accept()).includes(".png"),
      JSON.stringify({ seeing, cleared, accept: await accept() }),
    );

    // 5. The memory plan's refusal: a sentence, and the way back.
    await vision({ state: "offer", bytes: SMALL_BYTES });
    const again = await probe(page, () => document.querySelector(".composer-vision") !== null, null, 8000);
    check(
      "a smaller projector is offered with its own figure",
      again && (await text(".composer-vision")) === "Let Kalsa see images (downloads 300 MB)",
      JSON.stringify({ again, label: await text(".composer-vision") }),
    );
    await page.locator(".composer-vision").click();
    await page.locator(".vision-download").click();
    await answer({
      code: "vision.does_not_fit",
      params: { bytes: SMALL_BYTES },
      text: "The vision projector does not fit this computer's memory beside the model.",
    });
    const refused = await probe(page, () => document.querySelector(".vision-failed p") !== null);
    const sentence = await text(".vision-failed p");
    check(
      "memory that cannot hold it is a sentence, not a code",
      refused && sentence === "This computer doesn't have room in memory for image support with this AI.",
      JSON.stringify({ refused, sentence }),
    );
    check(
      "the refusal is an alert with one way forward",
      (await page.locator(".vision-failed").getAttribute("role")) === "alert" &&
        (await page.locator(".vision-failed .vision-download").count()) === 1,
      JSON.stringify({ role: await page.locator(".vision-failed").getAttribute("role") }),
    );

    // 6. A download that failed: its own sentence, then a retry that ends.
    await page.locator(".vision-failed .vision-download").click();
    await answer({ code: "startup.download_failed", text: "Kalsa couldn't finish downloading. Try again later." });
    const failed = await probe(page, () => (document.querySelector(".vision-failed p")?.textContent ?? "").includes("finish downloading"));
    check(
      "a download that failed says so",
      failed && (await text(".vision-failed p")) === "Kalsa couldn't finish downloading. Try again later.",
      JSON.stringify({ failed, sentence: await text(".vision-failed p") }),
    );
    await page.locator(".vision-failed .vision-download").click();
    await answer(null);
    const ended = await probe(page, () => document.querySelector(".vision-offer") === null, null, 8000);
    check(
      "the retry ends with nothing left spinning",
      ended && (await invokes()) === 4,
      JSON.stringify({ ended, invokes: await invokes() }),
    );

    check("the page logged no error through the whole offer", errors.length === 0, JSON.stringify(errors));
  } finally {
    await browser.close();
  }
}

let server = null;
try {
  const outDir = await buildApp();
  const served = await serveDist(outDir, appCsp());
  server = served;
  const engines = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(ENGINES);
  for (const engineName of engines) await runEngine(engineName, served.origin);
} finally {
  if (server) server.close();
  await rm(join(CHAT_DIR, ".stream-app-dist"), { recursive: true, force: true });
}

if (failedChecks() > 0) {
  console.log(`\n${failedChecks()} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
