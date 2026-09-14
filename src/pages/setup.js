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
//       total_bytes, done_bytes,   // done_bytes may start above zero
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

// Sizes are shown the way downloads are advertised: MB below a gigabyte,
// GB above, both ends of the comparison in the same unit.
function fmtPair(done, total) {
  if (total >= 1e9) {
    return `${(done / 1e9).toFixed(1)} of ${(total / 1e9).toFixed(1)} GB`;
  }
  return `${Math.round(done / 1e6)} of ${Math.round(total / 1e6)} MB`;
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

  function showProgress(text, pct) {
    progress.hidden = false;
    progress.textContent = text;
    bar.hidden = false;
    bar.style.setProperty("--pct", `${pct}%`);
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
    fetching: () => {},
  };

  function update(setup) {
    if (setup.failure) {
      hideProgress();
      const failure = FAILURES[setup.failure] ?? GENERIC_FAILURE;
      set(failure.head, failure.sentence, failure.action);
      return;
    }
    if (setup.phase === "fetching" && setup.fetching) {
      const { what, total_bytes, done_bytes, resumed } = setup.fetching;
      const pair = fmtPair(done_bytes, total_bytes);
      // The percentage is computed from the numbers as shown, so the line
      // cannot disagree with itself.
      const [, doneShown, totalShown] = pair.match(/^([\d.]+) of ([\d.]+)/);
      const pct = Math.floor((parseFloat(doneShown) / parseFloat(totalShown)) * 100);
      const line = `${pair} · ${pct}%`;
      if (what === "engine") {
        set(
          "Downloading",
          "Your computer needs its own copy of the engine that does the thinking. This happens once.",
          null,
        );
      } else {
        set(
          "Downloading",
          "Now the model itself — the part that knows things. It is the bigger download, and it also happens only once.",
          null,
        );
      }
      showProgress(resumed ? `Picking up where it stopped — ${line}` : line, pct);
      return;
    }
    hideProgress();
    (PHASES[setup.phase] ?? PHASES.starting)();
  }

  action.addEventListener("click", () => onRetry());

  return { update };
}
