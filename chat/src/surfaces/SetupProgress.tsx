import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/useLanguage";
import { GrowingTree } from "./GrowingTree";
import { WalkBar } from "./WalkBar";
import { useElapsed } from "./useElapsed";
import { tuneAttempt, tuneDone, tuneFace, tunePercent, tuneShare, tuneWait } from "./tuneProgress";
import { LONGEST_MINUTES, downloadMinutesLeft, growthOf, walkPercent } from "./walkFigures";
import { advance, begin, clockKey, waitWord } from "./walkState";
import type { ProgressStep, Walk } from "./walkState";

// The walk, rendered: the growing tree (RULES.md "Tree progress"), a
// headline, one bar and one plain line, from the step state in walkState.ts.

// The weights and the first run's own wait happen once; the engine may be
// fetched again by a later start, so its download makes no such promise.
const ONCE_KINDS = new Set(["working", "model_bytes"]);

/** The walk's own view: one step on screen, honest about bytes and time.
    `growing` is the full screen, where the tree and the bar both show the
    whole walk as one value; without it, the compact form a wait inside
    another page uses, whose bar is that phase's own. `reach` is how far the
    walk had already come, so a later step with no fraction cannot shrink it.
    A `failure` holds the walk where it stopped and says why. */
export function SetupProgress({
  step,
  growing = false,
  reach = 0,
  failure = null,
}: {
  step: ProgressStep;
  growing?: boolean;
  reach?: number;
  failure?: string | null;
}) {
  const { table, tag } = useLanguage();
  const t = table.setup;
  const face = tuneFace(step);
  const key = clockKey(step, face);
  const seconds = useElapsed(key);
  // The clock restarts with the key, but only after this render commits —
  // so the render that changes the key still carries the previous phase's
  // seconds, and this one says zero until the tick catches up.
  const [clocked, setClocked] = useState(key);
  useEffect(() => setClocked(key), [key]);
  const restarted = clocked !== key;

  const [walk, setWalk] = useState<Walk>(() => begin(step, face, 0, t, tag));
  let current = walk;
  if (current.step !== step || current.table !== t || current.tag !== tag) {
    // React's render-time adjustment: the derived state is recomputed from
    // the previous step before this render commits, and thrown away with
    // the render if it never does — a ref written here would keep the half
    // of a step that failed.
    current = advance(walk, step, face, seconds, t, tag);
    setWalk(current);
  }

  const elapsed = current.frozen ?? (restarted ? 0 : seconds);
  const durations = current.durations;
  const average = durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
  const share = face !== null ? tuneShare(face, elapsed, average) : 0;
  const pct = face !== null ? (face.total > 0 ? tunePercent(face, share) : null) : current.view.pct;
  const done = face !== null && tuneDone(face);
  const growth = Math.max(reach, current.growth, growthOf(current.kind, pct, done));
  // On the full screen the bar shows the walk, as the tree does: a phase with
  // no fraction keeps the moving segment, unless the walk has stopped.
  const barPct = !growing ? pct : failure !== null || pct !== null ? walkPercent(growth) : null;
  // The whole tune's clock: everything measured under it, plus the running
  // candidate's own seconds — at a close those seconds are already inside
  // the sum, so nothing counts twice.
  const whole =
    durations.reduce((sum, value) => sum + value, 0) +
    (face !== null && !face.closing ? elapsed : 0);
  const wait = face !== null ? tuneWait(face, share, whole, durations.length, step.budget_seconds, current.waitMinutes) : null;
  const shownMinutes = wait !== null && (wait.kind === "minutes" || wait.kind === "planned") ? wait.minutes : null;
  if (shownMinutes !== current.waitMinutes && shownMinutes !== null) {
    // The wait's last figure, kept in the same render-time state. It falls
    // with each fresher figure and rises only by a clear jump (`held` in
    // tuneProgress.ts): a slow candidate may raise it, a tick may not.
    current = { ...current, waitMinutes: shownMinutes };
    setWalk(current);
  }
  if (growth !== current.growth) {
    current = { ...current, growth };
    setWalk(current);
  }
  const attempt = face !== null ? tuneAttempt(face) : null;

  // The line under the bar: the tune's wait (or the stop's own line), the
  // download's bytes and its minutes, nothing on a phase with no fraction —
  // the tree's lean and the moving segment say it is alive. The test count
  // rides small under the line.
  let line: string | null = null;
  if (failure !== null) {
    line = failure;
  } else if (wait !== null) {
    line = waitWord(wait, t);
  } else if (current.view.progress !== null) {
    const bytes = current.view.bytes;
    const minutes = bytes !== null ? downloadMinutesLeft(current.from, bytes.done, bytes.total, elapsed) : null;
    line =
      minutes === null
        ? current.view.progress
        : minutes > LONGEST_MINUTES
          ? t.withLongWait(current.view.progress)
          : t.withMinutesLeft(current.view.progress, minutes);
  }
  const small = attempt !== null && failure === null ? t.attempt(attempt.index, attempt.total) : null;
  // The bar's aria-valuetext: the line and the test count, words that move
  // only when the walk does.
  const valueText = [line, small].filter((part) => part !== null).join(" · ") || null;
  // "Only once" is not said of a tune that stopped owing the next start.
  const owed = face !== null && face.cut && face.retryNext;
  const note = failure !== null || owed ? null : face !== null ? t.tuneOnce : growing && ONCE_KINDS.has(current.kind) ? t.once : null;
  const head = failure !== null ? t.couldNotGetReady : growing && current.kind === "model_bytes" ? t.downloadingAi : current.view.head;

  return (
    <div className="surface-walk">
      {growing ? <GrowingTree p={growth} failed={failure !== null} /> : null}
      <p className="surface-verdict">{head}</p>
      <WalkBar pct={barPct} label={head} valueText={valueText} failed={failure !== null} />
      {/* Words are announced; a byte count is not, or a download would speak
          on every reading — the bar's value text carries it for whoever asks. */}
      {line !== null ? (
        <p className="walk-line" aria-live={current.view.bytes !== null && failure === null ? undefined : "polite"}>
          {line}
        </p>
      ) : null}
      {small !== null ? <p className="walk-small">{small}</p> : null}
      {note !== null ? <p className="walk-once">{note}</p> : null}
    </div>
  );
}
