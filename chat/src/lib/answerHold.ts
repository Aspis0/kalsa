import { isLongerThanRefusal, openingSentence, opensWithRefusal } from "./refusal";

/** Holds a round's answer text until its opening says whether the round is a
    refusal, so a refusal that the retry replaces is never shown. */
export interface AnswerHold {
  push: (text: string) => void;
  /** The round is over. A refusal the retry replaces is dropped; anything else
      is shown, including what was held. */
  settle: (refused: boolean) => void;
}

/** Text is shown once the first sentence has ended, or once it is too long to be
    a refusal. A round that is not a refusal is shown with nothing lost. */
export function createAnswerHold(show: (text: string) => void): AnswerHold {
  let all = "";
  let state: "undecided" | "shown" | "dropped" = "undecided";

  function decide(): void {
    if (isLongerThanRefusal(all)) {
      state = "shown";
    } else {
      if (!openingSentence(all).complete) return;
      state = opensWithRefusal(all) ? "dropped" : "shown";
    }
    if (state === "shown") show(all);
  }

  return {
    push(text) {
      all += text;
      if (state === "shown") show(text);
      else if (state === "undecided") decide();
    },
    settle(refused) {
      if (refused) return;
      if (state !== "shown") {
        state = "shown";
        show(all);
      }
    },
  };
}
