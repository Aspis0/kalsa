// The first page's walk step: a step held from a finished walk must not come
// back on a later stop, and a fresh step during a walk must still show.
//
// `surfaces/walkStep.ts` holds the rules `useBrain` applies to the step it
// keeps, and to when a progress event may write it. The hook needs React and
// the Tauri bus, so the rules are what this
// harness can falsify. Drop the clear in `heldStepAfter` and the first check
// fails: the stopped page shows the last walk's step.
//
// Run: node scripts/walk-step.mjs

import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const finished = { phase: "test 3 of 3" };
const fresh = { phase: "test 1 of 3" };

const { app, dir } = await loadApp();

try {
  // The walk ran to running, then stopped. Its last step must not come back.
  {
    const afterRunning = app.heldStepAfter("starting", "running", finished);
    const afterStop = app.heldStepAfter("running", "stopped", afterRunning);
    check(
      "a step held from a finished walk is not shown after running -> stopped",
      app.walkStepShown("stopped", null, afterStop) === null,
      JSON.stringify(app.walkStepShown("stopped", null, afterStop)),
    );
    check(
      "...and without the clear the same step would be shown",
      app.walkStepShown("stopped", null, finished) === finished,
      JSON.stringify(app.walkStepShown("stopped", null, finished)),
    );
  }

  // A walk in progress shows its own steps, from starting and from stopped.
  {
    check(
      "a fresh step during a starting walk is shown",
      app.walkStepShown("starting", null, fresh) === fresh,
      JSON.stringify(app.walkStepShown("starting", null, fresh)),
    );
    check(
      "a fresh step while stopped is shown",
      app.walkStepShown("stopped", null, fresh) === fresh,
      JSON.stringify(app.walkStepShown("stopped", null, fresh)),
    );
    check(
      "a held start failure takes the page back from the step",
      app.walkStepShown("stopped", "did not start", fresh) === null,
      JSON.stringify(app.walkStepShown("stopped", "did not start", fresh)),
    );
    check(
      "a running brain shows no walk step",
      app.walkStepShown("running", null, fresh) === null,
      JSON.stringify(app.walkStepShown("running", null, fresh)),
    );
  }

  // A running brain keeps its step: the shell's vision download reads it there.
  {
    check(
      "a step read while already running is kept",
      app.heldStepAfter("running", "running", fresh) === fresh,
      JSON.stringify(app.heldStepAfter("running", "running", fresh)),
    );
  }

  // The listener takes a progress event only while the walk is armed. Each
  // replay is the signals `useBrain` sends, in the order they arrive.
  {
    const replay = (signals) => signals.reduce((arm, signal) => app.walkArmedAfter(arm, signal), "off") !== "off";
    const state = (previous, next) => ({ kind: "state", previous, next });
    const begin = { kind: "begin" };
    const end = { kind: "end" };

    check(
      "an event after Turn off is ignored",
      replay([begin, end]) === false && replay([begin, end, state("stopping", "stopped")]) === false,
    );
    check(
      "an event after the brain reached running is ignored",
      replay([begin, state("starting", "running")]) === false,
    );
    check(
      "an event during a new start is shown",
      replay([begin, end, begin]) === true && replay([end, state("stopped", "starting")]) === true,
    );
    check(
      "an event while the brain is still starting is shown",
      replay([begin, state("starting", "starting")]) === true,
    );
    check(
      "a failed start ends the walk",
      replay([begin, state("starting", "failed")]) === false,
    );
    check(
      "the vision download is taken while the engine runs",
      replay([state("stopped", "starting"), state("starting", "running"), begin, state("running", "running")]) === true,
    );
    check(
      "a crash from running ends the walk",
      replay([state("starting", "running"), state("running", "stopped")]) === false,
    );
    check(
      "a late event after running and a stop is ignored, even with a stale start",
      replay([begin, state("starting", "running"), state("running", "stopping"), state("stopping", "stopped")]) === false,
    );
    // A model switch stops the engine, and a poll can still read running for
    // that stop after the walk has begun. The walk must stay armed through it.
    check(
      "a stale running -> stopped reading after the owner began a walk keeps it armed",
      replay([state("running", "running"), begin, state("running", "stopped")]) === true &&
        replay([state("running", "running"), begin, state("running", "stopping"), state("stopping", "stopped")]) === true,
    );
    check(
      "...and the walk's own start after that stays armed",
      replay([state("running", "running"), begin, state("running", "stopped"), state("stopped", "starting")]) === true,
    );
    check(
      "an owned walk that reaches running is disarmed",
      replay([begin, state("running", "running"), state("stopped", "starting"), state("starting", "running")]) === false,
    );
    check(
      "an owned walk that fails is disarmed",
      replay([begin, state("stopped", "failed")]) === false,
    );
    check(
      "an owned walk that leaves starting without starting is disarmed",
      replay([begin, state("stopped", "starting"), state("starting", "stopped")]) === false,
    );
    check(
      "an owner stop disarms an owned walk",
      replay([begin, state("stopped", "starting"), end]) === false,
    );
    // A switch refused by a vision walk that holds the claim: the switch's own
    // arm is ended, and the stopped reading that follows must not re-arm it.
    check(
      "a refused switch ends its arm, and a later stopped reading does not re-arm it",
      replay([begin, state("running", "stopping"), state("stopping", "stopped"), begin, end, state("stopped", "stopped")]) === false,
    );
    // The vision download's own end, success or failure, is an explicit end.
    check(
      "a vision download that fails ends its arm even while the engine runs",
      replay([state("running", "running"), begin, end, state("running", "running")]) === false,
    );
    check(
      "a vision download that succeeds ends its arm; the engine's own stop does not re-arm it",
      replay([state("running", "running"), begin, end, state("running", "stopping"), state("stopping", "stopped")]) === false,
    );
    check(
      "a crash from running still ends a walk the brain began on its own",
      replay([state("stopped", "starting"), state("starting", "running"), state("running", "stopped")]) === false,
    );
    check(
      "an event before the state is first read is taken",
      app.progressTaken("off", false) === true,
    );
    check(
      "an event once the state is known and unarmed is ignored",
      app.progressTaken("off", true) === false && app.progressTaken("owned", true) === true,
    );
    check(
      "a new start from stopped takes its own steps",
      app.walkStepShown("starting", null, fresh) === fresh && replay([state("stopped", "starting")]) === true,
    );
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "walk-step: all checks passed" : `walk-step: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
