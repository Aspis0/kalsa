// The first run, rendered: the walk's progress, live (PLAN.md 4e).
//
// The backend contract is the Progress event `brain_progress`, serialised in
// src-tauri/src/startup.rs with the tag "kind":
//
//   { kind: "measuring" }
//   { kind: "deciding" }
//   { kind: "runtime_bytes", done, total }   // the engine's bytes moving
//   { kind: "choosing" }
//   { kind: "model_bytes", done, total }     // the chosen model's bytes
//
// This view replaces the switch while the walk runs; the walk's failures
// arrive as brain_start rejections and are spoken by the Status page. The
// words are this page's.

const GENERIC_SENTENCE = "Getting this computer ready. This happens once.";

// Why the computer is doing this, per phase. A `kind` nobody sent degrades
// to the neutral sentence — fail closed, never a blank screen.
const COPY = {
  measuring: {
    head: "Getting ready",
    sentence:
      "Looking at what this computer has to work with — how much memory it has, and what is inside it.",
  },
  deciding: {
    head: "Getting ready",
    sentence: "Finding the version of the engine that fits this computer.",
  },
  runtime_bytes: {
    head: "Downloading",
    sentence:
      "Your computer needs its own copy of the engine that does the thinking. This happens once.",
  },
  choosing: {
    head: "Getting ready",
    sentence:
      "Deciding which model fits this computer and knows more than the one on your phone.",
  },
  model_bytes: {
    head: "Downloading",
    sentence:
      "Now the model itself — the part that knows things. It is the bigger download, and it also happens only once.",
  },
  unknown: {
    head: "Getting ready",
    sentence: GENERIC_SENTENCE,
  },
};

// One rounding, one source: the percentage is computed from the same
// displayed numbers the line shows, so the line cannot disagree with itself.
// With no usable total there is no percentage and no bar — how much has
// arrived is all there honestly is.
function display(done, total) {
  if (total !== null && done <= total) {
    const shown =
      total >= 1e9
        ? [(done / 1e9).toFixed(1), (total / 1e9).toFixed(1), "GB"]
        : [String(Math.round(done / 1e6)), String(Math.round(total / 1e6)), "MB"];
    // A total that rounds away to zero in its own unit is no total: there
    // is no percentage of nothing.
    const totalShown = Number(shown[1]);
    if (totalShown > 0) {
      const pct = Math.floor((Number(shown[0]) / totalShown) * 100);
      return { text: `${shown[0]} of ${shown[1]} ${shown[2]} · ${pct}%`, pct };
    }
  }
  if (done <= 0) return { text: "Receiving — the size was not announced.", pct: null };
  const received =
    done >= 1e9 ? `${(done / 1e9).toFixed(1)} GB` : `${Math.round(done / 1e6)} MB`;
  return { text: `${received} received so far.`, pct: null };
}

export function mountSetup(root) {
  root.innerHTML = `
    <p class="verdict" data-el="headline">Getting ready</p>
    <p class="sentence" data-el="sentence"></p>
    <p class="progress" data-el="progress" hidden></p>
    <div class="bar" data-el="bar" hidden></div>
  `;
  const el = (name) => root.querySelector(`[data-el="${name}"]`);
  const headline = el("headline");
  const sentence = el("sentence");
  const progress = el("progress");
  const bar = el("bar");

  // The walk resumes where it stopped: a phase whose first event already
  // carries bytes is a continuation, and the line says so once.
  let lastKind = null;

  function update(step) {
    if (!step || typeof step !== "object") step = { kind: "unknown" };

    const bytesPhase = step.kind === "runtime_bytes" || step.kind === "model_bytes";
    const phaseStart = step.kind !== lastKind;
    lastKind = step.kind;
    const resumed = phaseStart && bytesPhase && (step.done ?? 0) > 0;

    const copy = COPY[step.kind] ?? COPY.unknown;
    headline.textContent = copy.head;
    sentence.textContent = copy.sentence;

    if (!bytesPhase) {
      progress.hidden = true;
      bar.hidden = true;
      return;
    }

    const count = (value, min) =>
      typeof value === "number" && Number.isFinite(value) && value >= min ? value : null;
    const done = count(step.done, 0) ?? 0;
    const total = count(step.total, 1); // a total of zero is no total

    progress.hidden = false;
    if (total === null || done > total) {
      // No size announced, or a resumed download past the total it was
      // given: how much has arrived is all there honestly is.
      const received =
        done >= 1e9 ? `${(done / 1e9).toFixed(1)} GB` : `${Math.round(done / 1e6)} MB`;
      progress.textContent = done > 0 ? `${received} received so far.` : "Receiving.";
      bar.hidden = true;
      return;
    }
    const shown = display(done, total);
    progress.textContent = resumed
      ? `Picking up where it stopped — ${shown.text}`
      : shown.text;
    bar.hidden = false;
    bar.style.setProperty("--pct", `${shown.pct}%`);
  }

  return { update };
}
