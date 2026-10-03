// The viewport under a long answer, pinned mid-stream.
//
// Streamdown's twin change (`src/lib/stickToBottom.ts`, lifted from
// assistant-ui, MIT) is the thread's scroll rule, and this harness drives it
// from the real thing: a 24-chunk answer the test releases one chunk at a
// time. The rules pinned: the view follows the end while words arrive; the
// moment the reader scrolls up it stops under them and the way back appears;
// new words arriving below do not move it; a block growing above the fold —
// the stand-in used here for a picture finishing its load — does not pull the
// reader to the end; and both roads back (the button, and a scroll of their
// own) resume following.
//
// Run: node scripts/stick-to-bottom.mjs [chromium|webkit ...]   (from chat/)

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appCsp,
  buildApp,
  check,
  failedChecks,
  launchChat,
  probe,
  scriptedEndpoint,
  serveDist,
  startBrain,
  ENGINES,
} from "./lib/stream-app.mjs";

const CHAT_DIR = fileURLToPath(new URL("..", import.meta.url));

const PARAGRAPHS = Array.from(
  { length: 24 },
  (_, n) =>
    `Paragraph ${n + 1}. The answer keeps arriving so that the view has something to follow, and every sentence of it exists to make the page taller while the reader decides whether to stay at the end of it or to look back at what was said before. Nothing here is worth reading twice, which is exactly why a page longer than the window is the point of the whole exercise. `,
);

/** The thread's own geometry: how far the end is, and whether the way back shows. */
const VIEW = () => {
  const thread = document.querySelector(".thread");
  return {
    top: Math.round(thread.scrollTop),
    height: Math.round(thread.scrollHeight),
    client: thread.clientHeight,
    gap: Math.round(thread.scrollHeight - thread.scrollTop - thread.clientHeight),
    jump: document.querySelector(".jump-bottom") !== null,
    busy: thread.getAttribute("aria-busy"),
  };
};

/** Two animation frames: the observers and React have run, paint has not. */
const frames = (page) =>
  page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))));

/** A block inserted above the fold, the way a picture finishing its load grows
    the page. Returns the height the thread has right after the insertion. */
const growAbove = (page, pixels) =>
  page.evaluate((height) => {
    const spacer = document.createElement("div");
    spacer.style.height = `${height}px`;
    document.querySelector(".thread-column").prepend(spacer);
    return document.querySelector(".thread").scrollHeight;
  }, pixels);

async function runEngine(engineName, origin, brain, brainServer) {
  console.log(`\n--- ${engineName} ---`);
  const chat = await launchChat(engineName, { origin, endpoint: brainServer.endpoint });
  const page = chat.page;
  const view = () => page.evaluate(VIEW);
  /** The view is at the end: nothing of it is below the fold. */
  const atEnd = () =>
    probe(page, () => {
      const thread = document.querySelector(".thread");
      return thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 2;
    });

  try {
    brain.plan(PARAGRAPHS.map((paragraph) => `${paragraph}\n\n`));
    await chat.send("a long answer, please");
    for (let at = 1; at < 6; at += 1) brain.release();
    await brain.until(6);
    // The end is trivially in view while the page is still empty; wait for the
    // answer to be on the page and longer than the viewport before asking.
    const showing = await probe(page, () => {
      const thread = document.querySelector(".thread");
      return (
        document.querySelectorAll(".row-assistant .markdown").length === 1 &&
        thread.scrollHeight > thread.clientHeight + 100
      );
    });
    await atEnd();
    const following = await view();
    check(
      "the view follows the answer while it arrives",
      showing && following.top > 0 && following.gap <= 2 && !following.jump,
      JSON.stringify({ showing, following }),
    );

    const before = await view();
    await growAbove(page, 400);
    await atEnd();
    const grown = await view();
    check(
      "a block growing above the fold leaves a follower at the end",
      grown.gap <= 2 && grown.height >= before.height + 380,
      JSON.stringify({ before, grown }),
    );

    brain.release();
    brain.release();
    brain.release();
    await brain.until(9);
    await atEnd();
    const stillFollowing = await view();
    check(
      "and the next words keep it there",
      stillFollowing.gap <= 2 && stillFollowing.height > grown.height,
      JSON.stringify({ grown, stillFollowing }),
    );

    await page.evaluate(() => {
      document.querySelector(".thread").scrollTop = 0;
    });
    const scrolledUp = await probe(page, () => document.querySelector(".jump-bottom") !== null);
    const away = await view();
    check(
      "the moment the reader scrolls up, the way back appears",
      scrolledUp && away.top === 0 && away.gap > 100 && away.jump,
      JSON.stringify(away),
    );

    brain.release();
    brain.release();
    brain.release();
    await brain.until(12);
    await frames(page);
    const held = await view();
    check(
      "new words no longer move the view",
      Math.abs(held.top - away.top) <= 1 && held.height > away.height && held.jump,
      JSON.stringify({ away, held }),
    );

    await growAbove(page, 400);
    await frames(page);
    const grownAbove = await view();
    check(
      "a block growing above the fold does not pull the reader back to the end",
      grownAbove.gap >= held.gap - 2 && grownAbove.jump,
      JSON.stringify({ held, grownAbove }),
    );

    await page.locator(".jump-bottom").click();
    const back = await probe(page, () => {
      const thread = document.querySelector(".thread");
      return (
        document.querySelector(".jump-bottom") === null &&
        thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 2
      );
    });
    const resumed = await view();
    check("the way back returns the reader and resumes following", back && resumed.gap <= 2, JSON.stringify(resumed));

    await page.evaluate(() => {
      document.querySelector(".thread").scrollTop = 0;
    });
    await probe(page, () => document.querySelector(".jump-bottom") !== null);
    await page.evaluate(() => {
      const thread = document.querySelector(".thread");
      thread.scrollTop = thread.scrollHeight;
    });
    const returned = await probe(page, () => document.querySelector(".jump-bottom") === null);
    await frames(page);
    const manual = await view();
    check(
      "a reader who scrolls back to the end resumes following too",
      returned && manual.gap <= 2 && !manual.jump,
      JSON.stringify(manual),
    );

    for (let at = brain.written(); at < PARAGRAPHS.length; at += 1) brain.release();
    const ended = await chat.settled();
    const last = await view();
    check(
      "the end is still in view when the answer stops",
      ended && last.busy === "false" && last.gap <= 2,
      JSON.stringify(last),
    );

    const foreign = chat.requests.filter(
      (url) =>
        !url.startsWith(origin) &&
        !url.startsWith(brainServer.origin) &&
        !url.startsWith("data:") &&
        !url.startsWith("blob:"),
    );
    check(
      "nothing outside this computer's two endpoints was fetched",
      foreign.length === 0,
      JSON.stringify(foreign),
    );
    check("the page logged no error while the answer streamed", chat.errors.length === 0, JSON.stringify(chat.errors));
  } finally {
    await chat.close();
  }
}

let server = null;
let brainServer = null;
try {
  const outDir = await buildApp();
  const brain = scriptedEndpoint();
  const served = await serveDist(outDir, appCsp());
  server = served;
  const brainServed = await startBrain(brain);
  brainServer = brainServed;
  const engines = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(ENGINES);
  for (const engineName of engines) await runEngine(engineName, served.origin, brain, brainServed);
} finally {
  if (brainServer) brainServer.close();
  if (server) server.close();
  await rm(join(CHAT_DIR, ".stream-app-dist"), { recursive: true, force: true });
}

if (failedChecks() > 0) {
  console.log(`\n${failedChecks()} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
