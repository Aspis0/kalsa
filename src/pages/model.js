// The Model page: what this computer runs for the phone, and why this one.
// The choice is already made for the user; this page explains it, including
// the case where the honest reason is the phone's battery and not capability.
//
// Its only input is a kalsa-catalog Decision. Today that is the placeholder
// refusal (the machine has not been measured); when `brain_choice` exists,
// the import in data/placeholders.js goes away and nothing here changes.

import { decision } from "../data/placeholders.js";

const headline = document.getElementById("model-headline");
const body = document.getElementById("model-body");
const rationale = document.getElementById("model-rationale");

// One plain sentence per RefusalReason. The crate's own explanation is the
// fallback for anything this map has not caught up with.
const REFUSAL_COPY = {
  phoneUnknown:
    "We do not know which model your phone runs yet. Pair the phone first; after that, this page can say which model to run here.",
  machineNotMeasured:
    "This computer has not been measured yet, so no model can be chosen. Nothing on this page is a guess, and nothing will be until the measuring has run.",
  nothingFits:
    "No model that would fit on this computer was found. There is nothing to choose.",
  nothingBetter:
    "Nothing here would be better than what your phone already runs. This computer is not worth it as a second brain.",
  nothingFastEnough:
    "Everything that would fit on this computer would be too slow to use. A slow answer is worse than the one your phone already gives.",
};

const JUSTIFICATION_COPY = {
  capability:
    "It knows more than the model on your phone. That is why it runs here.",
  relief:
    "It is not smarter than the model on your phone. It runs on this computer so your phone's battery lasts longer.",
  expectedButUnmeasured:
    "This model should be better than the one on your phone. We have not tested it on this computer yet.",
};

function render(decision) {
  if (!decision) {
    headline.textContent = "Nothing chosen yet";
    body.textContent =
      "This page will say which model this computer runs for your phone, and why that one.";
    rationale.hidden = true;
    return;
  }

  if (decision.refuse) {
    headline.textContent = "No model chosen";
    body.textContent =
      REFUSAL_COPY[decision.refuse.reason] ?? decision.refuse.explanation;
    rationale.hidden = true;
    return;
  }

  const pick = decision.pick;
  headline.textContent = pick.label;
  body.textContent =
    JUSTIFICATION_COPY[pick.justification] ?? "Why this one is not explained yet.";
  rationale.textContent = pick.rationale;
  rationale.hidden = !pick.rationale;
}

export function initModel() {
  render(decision);
}
