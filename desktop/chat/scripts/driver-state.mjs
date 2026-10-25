// The states the browser's driver row can be in, and the rules that move it:
// a computer Kalsa has no driver for is never offered a press, a download
// already running is not started again, a failure keeps its press, a cancel
// stops and keeps its press too, and an event from an attempt nobody is
// watching changes nothing.
//
// `src/lib/driverState.ts` is the one place those rules live; the hook and the
// components only feed it actions. Drop the guard in `downloadStarted` and the
// double press puts two bars over one file. Drop the run check in `progress`
// and a cancel's last event, arriving after the retry began, paints a bar that
// has just started as 99% done.
//
// Run: node scripts/driver-state.mjs

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
const dir = await mkdtemp(join(tmpdir(), "kalsa-driver-state-"));
const outfile = join(dir, "driverState.mjs");
try {
  await build({
    entryPoints: [join(CHAT_DIR, "src/lib/driverState.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    logLevel: "silent",
  });
  const { INITIAL_DRIVER, reduceDriver, percentOf, canPress, sizeLabel } =
    await import(pathToFileURL(outfile).href);
  const run = (state, ...actions) => actions.reduce(reduceDriver, state);
  const NEEDED = { type: "checked", supported: true, installed: false, size: 42353180 };
  const SIZE = 42353180;

  {
    const first = run(INITIAL_DRIVER, NEEDED);
    check(
      "a computer with no driver is offered the press, with the size",
      first.phase.kind === "needed" && sizeLabel(first.size) === "40 MB",
      JSON.stringify(first),
    );
    const ready = run(first, { type: "checked", supported: true, installed: true, size: SIZE });
    check(
      "an installed driver is ready and offers no press",
      ready.phase.kind === "ready" && canPress(ready.phase) === false,
      JSON.stringify(ready.phase),
    );
    const none = run(INITIAL_DRIVER, { type: "checked", supported: false, installed: false, size: 0 });
    check(
      "a computer Kalsa has no driver for never shows the row",
      none.phase.kind === "unsupported" && canPress(none.phase) === false,
      JSON.stringify(none.phase),
    );
  }

  {
    const going = run(run(INITIAL_DRIVER, NEEDED), { type: "downloadStarted" });
    check(
      "a press starts the download",
      going.phase.kind === "downloading" && canPress(going.phase) === false,
      JSON.stringify(going.phase),
    );
    const mine = going.run;
    const half = run(going, { type: "progress", run: mine, done: 21000000, total: SIZE });
    check("progress counts while the download runs", percentOf(half.phase) === 49, `${percentOf(half.phase)}%`);
    // The press while a bar is already showing must change nothing at all:
    // restarting the count would put two bars over one file and show a
    // download that is half done as if it had just begun.
    const again = run(half, { type: "downloadStarted" });
    check(
      "a second press does not restart the count",
      again.phase.kind === "downloading" && again.phase.done === 21000000 && again.run === mine,
      JSON.stringify(again),
    );
    const done = run(half, { type: "finished", supported: true, installed: true, size: SIZE });
    check("the download ends ready", done.phase.kind === "ready", JSON.stringify(done.phase));
    const late = run(done, { type: "progress", run: mine, done: SIZE, total: SIZE });
    check(
      "an event from a run nobody is watching changes nothing",
      late.phase.kind === "ready",
      JSON.stringify(late.phase),
    );
  }

  {
    const unknown = run(
      run(run(INITIAL_DRIVER, NEEDED), { type: "downloadStarted" }),
      { type: "progress", run: 1, done: 512, total: 0 },
    );
    check(
      "a total of zero shows no percentage rather than a division by zero",
      percentOf(unknown.phase) === null,
      `${percentOf(unknown.phase)}`,
    );
    const failed = run(
      run(run(INITIAL_DRIVER, NEEDED), { type: "downloadStarted" }),
      { type: "failed" },
    );
    check("a failed download offers the press again", canPress(failed.phase) === true, JSON.stringify(failed.phase));
    check("a failure is not the same sentence as a cancel", failed.phase.kind === "failed", failed.phase.kind);
    const stale = run(run(INITIAL_DRIVER, NEEDED, { type: "finished", supported: true, installed: true, size: 1 }), {
      type: "failed",
    });
    check(
      "a failure that arrives after the driver is there is stale",
      stale.phase.kind === "ready",
      JSON.stringify(stale.phase),
    );
  }

  // Cancel, and then the overlap the whole run number exists for: the transfer
  // stops on its own thread, so its last event is still queued when the person
  // presses retry, and that event belongs to a bar that no longer exists.
  {
    const going = run(run(INITIAL_DRIVER, NEEDED), { type: "downloadStarted" });
    const first = going.run;
    const half = run(going, { type: "progress", run: first, done: 21000000, total: SIZE });
    const stopped = run(half, { type: "cancelled" });
    check(
      "a cancelled download stops and offers the press again",
      stopped.phase.kind === "cancelled" && canPress(stopped.phase) === true,
      JSON.stringify(stopped.phase),
    );
    check("the size the press costs is still on the row", sizeLabel(stopped.size) === "40 MB", stopped.size);

    const retry = run(stopped, { type: "downloadStarted" });
    check("the retry is a new attempt", retry.run === first + 1, `${first} → ${retry.run}`);
    const stray = run(retry, { type: "progress", run: first, done: 21000000, total: SIZE });
    check(
      "an event from the stopped attempt arriving after a retry changed nothing",
      stray.phase.kind === "downloading" && stray.phase.done === 0,
      JSON.stringify(stray.phase),
    );
    const counted = run(retry, { type: "progress", run: retry.run, done: 1048576, total: SIZE });
    check("the retry counts its own events", percentOf(counted.phase) === 2, `${percentOf(counted.phase)}%`);

    const ready = run(counted, { type: "finished", supported: true, installed: true, size: SIZE });
    const lateCancel = run(ready, { type: "cancelled" });
    check(
      "a cancel that arrives after the driver is there is stale",
      lateCancel.phase.kind === "ready",
      JSON.stringify(lateCancel.phase),
    );
  }

  {
    check("no size reads as nothing rather than as a broken bar", sizeLabel(0) === "0 MB");
    check("a size rounds to whole megabytes", sizeLabel(37989371) === "36 MB");
    check("an unknown size is not invented", sizeLabel(-1) === "0 MB");
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nOK — every driver state behaves" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);