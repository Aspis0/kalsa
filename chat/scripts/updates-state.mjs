// The update state the Settings block and the startup notice both read. The
// rules: a check never overwrites a download in progress, progress counts only
// while a download runs, a failed step says so, and the startup notice stays
// until the owner dismisses it.
//
// `src/lib/updateState.ts` is the one place those rules live; the hook and the
// components only feed it actions. This compiles that file with esbuild and
// runs the transitions. Drop the download guard in `checkStarted` and the
// first check fails.
//
// Run: node scripts/updates-state.mjs

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../node_modules/esbuild/lib/main.js";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const CHAT_DIR = fileURLToPath(new URL("..", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "kalsa-updates-state-"));
const outfile = join(dir, "updateState.mjs");
try {
  await build({
    entryPoints: [join(CHAT_DIR, "src/lib/updateState.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    logLevel: "silent",
  });
  const { INITIAL_UPDATE, reduceUpdate } = await import(pathToFileURL(outfile).href);
  const run = (state, ...actions) => actions.reduce(reduceUpdate, state);
  const error = { code: "update.download_failed", text: "x" };

  {
    const found = run(INITIAL_UPDATE, { type: "checkStarted" }, {
      type: "checkFinished",
      status: { current: "0.0.2", available: { version: "0.0.3", notes: null } },
    });
    check(
      "a check that finds a newer version offers it",
      found.phase.kind === "available" && found.phase.version === "0.0.3",
      JSON.stringify(found.phase),
    );
    const none = run(INITIAL_UPDATE, { type: "checkStarted" }, {
      type: "checkFinished",
      status: { current: "0.0.2", available: null },
    });
    check("a check with nothing newer says up to date", none.phase.kind === "current", JSON.stringify(none.phase));
  }

  {
    const notice = { type: "announced", update: { version: "0.0.3", notes: null } };
    const gone = run(INITIAL_UPDATE, notice, { type: "checkStarted" }, {
      type: "checkFinished",
      status: { current: "0.0.2", available: null },
    });
    check(
      "a check that finds nothing newer clears the startup notice",
      gone.notice === null && gone.phase.kind === "current",
      JSON.stringify({ notice: gone.notice, phase: gone.phase }),
    );
    const still = run(INITIAL_UPDATE, notice, {
      type: "checkFinished",
      status: { current: "0.0.2", available: { version: "0.0.3", notes: null } },
    });
    check("a check that still finds the release keeps the notice", still.notice?.version === "0.0.3");
    const superseded = run(INITIAL_UPDATE, notice, {
      type: "checkFinished",
      status: { current: "0.0.2", available: { version: "0.0.4", notes: "newer" } },
    });
    check(
      "a newer release moves the notice to its version",
      superseded.notice?.version === "0.0.4" && superseded.notice?.notes === "newer",
      JSON.stringify(superseded.notice),
    );
    const dismissedThenNewer = run(INITIAL_UPDATE, notice, { type: "noticeDismissed" }, {
      type: "checkFinished",
      status: { current: "0.0.2", available: { version: "0.0.4", notes: null } },
    });
    check(
      "a newer release does not bring back a dismissed notice",
      dismissedThenNewer.notice === null,
      JSON.stringify(dismissedThenNewer.notice),
    );
  }

  {
    // The install was refused because the release moved: the page must
    // reach a result, not stay on the download it never started.
    const moved = run(
      INITIAL_UPDATE,
      { type: "installStarted", version: "0.0.3" },
      { type: "failed", error: { code: "update.changed", text: "x" } },
      { type: "checkStarted" },
      { type: "checkFinished", status: { current: "0.0.2", available: { version: "0.0.4", notes: null } } },
    );
    check(
      "a moved release is checked again and offered, not left downloading",
      moved.phase.kind === "available" && moved.phase.version === "0.0.4",
      JSON.stringify(moved.phase),
    );
  }

  {
    const downloading = run(INITIAL_UPDATE, { type: "installStarted", version: "0.0.3" });
    const during = reduceUpdate(downloading, { type: "checkStarted" });
    check("a check during a download leaves the download on screen", during === downloading);
    const finishedDuring = reduceUpdate(downloading, {
      type: "checkFinished",
      status: { current: "0.0.2", available: null },
    });
    check("a check result during a download is ignored", finishedDuring === downloading);
  }

  {
    const started = run(INITIAL_UPDATE, { type: "installStarted", version: "0.0.3" });
    const half = reduceUpdate(started, { type: "progress", done: 50, total: 100 });
    check(
      "progress is kept while a download runs",
      half.phase.kind === "downloading" && half.phase.done === 50 && half.phase.total === 100,
      JSON.stringify(half.phase),
    );
    check(
      "progress with no download running is ignored",
      reduceUpdate(INITIAL_UPDATE, { type: "progress", done: 5, total: 10 }) === INITIAL_UPDATE,
    );
  }

  {
    const failed = run(
      INITIAL_UPDATE,
      { type: "installStarted", version: "0.0.3" },
      { type: "failed", error, version: "0.0.3" },
    );
    check(
      "a failed install shows its error code",
      failed.phase.kind === "failed" && failed.phase.error.code === "update.download_failed",
      JSON.stringify(failed.phase),
    );
    check(
      "a refused install keeps its release so it can be pressed again",
      failed.phase.kind === "failed" && failed.phase.version === "0.0.3",
      JSON.stringify(failed.phase),
    );
    const checkFailed = run(INITIAL_UPDATE, { type: "failed", error });
    check(
      "a failed check keeps no release",
      checkFailed.phase.kind === "failed" && checkFailed.phase.version === null,
      JSON.stringify(checkFailed.phase),
    );
  }

  {
    const announced = run(INITIAL_UPDATE, { type: "announced", update: { version: "0.0.3", notes: null } });
    check("the startup check sets the notice", announced.notice?.version === "0.0.3");
    check("the notice leaves the page's own phase alone", announced.phase.kind === "idle");
    const dismissed = reduceUpdate(announced, { type: "noticeDismissed" });
    check("the owner's dismiss clears the notice", dismissed.notice === null);
  }

  {
    const notes = "Faster start.\nFixed the calculator.";
    const announced = run(INITIAL_UPDATE, { type: "announced", update: { version: "0.0.3", notes } });
    check("the startup notice keeps its notes", announced.notice?.notes === notes, JSON.stringify(announced.notice));
    const corrected = "Faster start.\nFixed the calculator and the timer.";
    const same = run(announced, {
      type: "checkFinished",
      status: { current: "0.0.2", available: { version: "0.0.3", notes: corrected } },
    });
    check(
      "a check that finds the same release with corrected notes updates the notice",
      same.notice?.version === "0.0.3" && same.notice?.notes === corrected,
      JSON.stringify(same.notice),
    );
    const dismissedSame = run(announced, { type: "noticeDismissed" }, {
      type: "checkFinished",
      status: { current: "0.0.2", available: { version: "0.0.3", notes: corrected } },
    });
    check("a dismissed notice stays dismissed when the same release is checked again", dismissedSame.notice === null);
    const offered = run(INITIAL_UPDATE, {
      type: "checkFinished",
      status: { current: "0.0.2", available: { version: "0.0.3", notes } },
    });
    check(
      "the Settings phase carries the notes",
      offered.phase.kind === "available" && offered.phase.notes === notes,
      JSON.stringify(offered.phase),
    );
    const newer = run(announced, {
      type: "checkFinished",
      status: { current: "0.0.2", available: { version: "0.0.4", notes: null } },
    });
    check(
      "a newer release without notes replaces the old notes",
      newer.notice?.version === "0.0.4" && newer.notice?.notes === null,
      JSON.stringify(newer.notice),
    );
  }

  {
    const versioned = reduceUpdate(INITIAL_UPDATE, { type: "version", version: "0.0.2" });
    check("the running version is kept for the Settings line", versioned.current === "0.0.2");
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
