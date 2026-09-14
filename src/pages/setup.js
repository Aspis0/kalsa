// The first run, rendered: everything between "install" and the switch saying
// On — read the machine, choose, fetch the engine and then the model, start,
// wait for an answer (PLAN.md 4e). Minutes on a home connection, so the page
// says what is happening, why the computer needs it, and that it happens
// once; a failure partway through is a different sentence from a failure at
// the start, because what is already downloaded stays and resumes.
//
// The backend contract this page is written against — one setup state,
// polled like brain_state, that replaces the normal status view until it is
// done. The words are the page's; the backend hands over reasons, never
// sentences:
//
//   {
//     kind: "setup",
//     phase: "reading" | "choosing" | "fetching" | "starting" | "failed",
//     fetching: null | {
//       what: "engine" | "model",
//       done_bytes,                // always known
//       total_bytes,               // number, or null: no size was announced
//       resumed,                   // true when this continues an earlier one
//     },
//     failure: null | "no-engine" | "not-worth-it" | "disk-full" | "network"
//            | "damaged",
//   }
//
// Until that command exists, dev/states.html drives this page with stubs.

// The words for each failure. An unknown reason lands on the generic
// sentence — fail closed, never show raw detail.
const FAILURES = {
  network: {
    head: "Stopped",
    sentence:
      "The connection dropped partway through. What is already here stays, so trying again picks up where it stopped.",
    action: "Try again",
  },
  "disk-full": {
    head: "Stopped",
    sentence:
      "This computer has run out of room. Making some space and trying again usually works.",
    action: "Try again",
  },
  damaged: {
    head: "Stopped",
    sentence:
      "The download arrived damaged, which happens once in a while. Trying again gets a clean copy.",
    action: "Try again",
  },
  "no-engine": {
    head: "Stopped",
    sentence:
      "We could not get an engine going on this computer. Trying again usually works; if it keeps failing, this computer cannot help your phone.",
    action: "Try again",
  },
  "not-worth-it": {
    head: "Cannot help here",
    sentence:
      "This computer is not worth using as a second brain. Nothing here would be better than what your phone already runs.",
    action: null,
  },
};

const GENERIC_FAILURE = {
  head: "Stopped",
  sentence:
    "Something on this computer stopped the setup from finishing. Trying again usually works.",
  action: "Try again",
};

// Why the computer is downloading, per part. "unknown" is what a fetching
// payload with a `what` nobody sent degrades to.
const GENERIC_FETCH =
  "This computer is getting the parts it needs. This happens once.";

const DOWNLOAD_COPY = {
  engine: {
    sentence:
      "Your computer needs its own copy of the engine that does the thinking. This happens once.",
  },
  model: {
    sentence:
      "Now the model itself — the part that knows things. It is the bigger download, and it also happens only once.",
  },
  unknown: {
    sentence: GENERIC_FETCH,
  },
};

// The DTO is wire input from another process, not a promise: every field is
// treated as untrusted, and anything unusable degrades to the honest state —
// unknown size, zero progress, the generic words — instead of throwing in
// the middle of a render.
function normalizeFetching(fetching) {
  if (fetching === null || typeof fetching !== "object") return null;
  const count = (value, min) =>
    typeof value === "number" && Number.isFinite(value) && value >= min ? value : null;
  return {
    what:
      fetching.what === "engine" || fetching.what === "model"
        ? fetching.what
        : "unknown",
    done: count(fetching.done_bytes, 0) ?? 0,
    // A total of zero is no total: it is the shape of a size nobody sent.
    total: count(fetching.total_bytes, 1),
    resumed: fetching.resumed === true,
  };
}

// One rounding, one source: the percentage is computed from the same
// displayed numbers the line shows, so the line cannot disagree with itself
// and no string is ever parsed back. With no usable total there is no
// percentage and no proportional bar — how much has arrived is all there
// honestly is.
function display(done, total) {
  if (total !== null && done <= total) {
    const shown =
      total >= 1e9
        ? [(done / 1e9).toFixed(1), (total / 1e9).toFixed(1), "GB"]
        : [String(Math.round(done / 1e6)), String(Math.round(total / 1e6)), "MB"];
    const pct = Math.floor((Number(shown[0]) / Number(shown[1])) * 100);
    return { text: `${shown[0]} of ${shown[1]} ${shown[2]} · ${pct}%`, pct };
  }
  if (done <= 0) return { text: "Receiving — the size was not announced.", pct: null };
  const received =
    done >= 1e9 ? `${(done / 1e9).toFixed(1)} GB` : `${Math.round(done / 1e6)} MB`;
  return { text: `${received} received so far.`, pct: null };
}

export function mountSetup(root, { onRetry = () => {} } = {}) {
  root.innerHTML = `
    <p class="verdict" data-el="headline">Getting ready</p>
    <p class="sentence" data-el="sentence"></p>
    <p class="progress" data-el="progress" hidden></p>
    <div class="bar" data-el="bar" hidden></div>
    <button type="button" class="primary" data-el="action" hidden></button>
  `;
  const el = (name) => root.querySelector(`[data-el="${name}"]`);
  const headline = el("headline");
  const sentence = el("sentence");
  const progress = el("progress");
  const bar = el("bar");
  const action = el("action");

  function set(head, text, button) {
    headline.textContent = head;
    sentence.textContent = text;
    if (!button) {
      action.hidden = true;
      return;
    }
    action.hidden = false;
    action.textContent = button;
    action.disabled = false;
  }

  // The bar's fill is the accent share of the track, sized by --pct. With no
  // total there is no honest share, so pct of null means no bar at all.
  function showBytes(text, pct) {
    progress.hidden = false;
    progress.textContent = text;
    bar.hidden = pct === null;
    if (pct !== null) {
      bar.style.setProperty("--pct", `${pct}%`);
    }
  }

  function hideProgress() {
    progress.hidden = true;
    bar.hidden = true;
  }

  // One view per phase. The sentence always answers "why does my computer
  // need this", and the downloading ones always say it happens once. The
  // fetching phase is handled in update, because it carries the bytes.
  const PHASES = {
    reading: () => {
      hideProgress();
      set(
        "Getting ready",
        "Looking at what this computer has to work with — how much memory it has, and what is inside it.",
        null,
      );
    },
    choosing: () => {
      hideProgress();
      set(
        "Getting ready",
        "Deciding which model fits this computer and knows more than the one on your phone.",
        null,
      );
    },
    starting: () => {
      hideProgress();
      set(
        "Starting",
        "Getting ready. On an older computer this can take a minute.",
        null,
      );
    },
  };

  function update(setup) {
    if (setup.failure) {
      hideProgress();
      const failure = FAILURES[setup.failure] ?? GENERIC_FAILURE;
      set(failure.head, failure.sentence, failure.action);
      return;
    }
    if (setup.phase === "fetching") {
      const f = normalizeFetching(setup.fetching);
      if (!f) {
        hideProgress();
        set("Downloading", GENERIC_FETCH, null);
        return;
      }
      set("Downloading", DOWNLOAD_COPY[f.what].sentence, null);
      const prefix = f.resumed && f.done > 0 ? "Picking up where it stopped — " : "";
      const shown = display(f.done, f.total);
      showBytes(prefix + shown.text, shown.pct);
      return;
    }
    hideProgress();
    (PHASES[setup.phase] ?? PHASES.starting)();
  }

  action.addEventListener("click", () => onRetry());

  return { update };
}
