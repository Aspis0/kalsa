import { isLongerThanRefusal, openingSentence, opensWithRefusal } from "./refusal";

/** Holds a round's answer text until its opening says whether the round is a
    refusal, so a refusal the retry replaces is never shown. */
export interface AnswerHold {
  push: (text: string) => void;
  /** The round is over. `refused` keeps a refusal unshown — the retry
      replaces it, including when the retry then dies: what was replaced is
      not brought back. Otherwise everything held is shown: a refusal-shaped
      text whose round was stopped before it could be judged, or a
      call-shaped text the recovery did not take. A dropped hold shows
      nothing. */
  settle: (refused: boolean) => void;
  /** The round's whole text is being replaced (a recovered call: the answer
      was only the call, and the tool's run is the visible act). Nothing more
      is shown; what already streamed cannot be taken back. */
  drop: () => void;
}

/** Text is shown once the first sentence has ended, or once it is too long to
    be a refusal. A round that is not a refusal is shown with nothing lost. */
export function createAnswerHold(show: (text: string) => void): AnswerHold {
  let all = "";
  // "refused" is provisional: settle(false) may still show it. "dropped" is
  // final — the text is being replaced, not retried.
  let state: "undecided" | "shown" | "refused" | "dropped" = "undecided";

  function decide(): void {
    const shaped = all.trimStart();
    if (callShapedPrefix(shaped)) return;
    if (shaped.startsWith("{") || shaped.startsWith("<")) {
      // It opened like a call and can no longer be one — so it is also not a
      // refusal, and it streams like any other answer.
      state = "shown";
      show(all);
      return;
    }
    if (isLongerThanRefusal(all)) {
      state = "shown";
    } else {
      if (!openingSentence(all).complete) return;
      state = opensWithRefusal(all) ? "refused" : "shown";
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
      if (state === "dropped") return;
      if (refused) {
        state = "refused";
        return;
      }
      if (state !== "shown") {
        state = "shown";
        show(all);
      }
    },
    drop() {
      state = "dropped";
    },
  };
}

/** Holds a round's reasoning until the round says whether it stands, for a
    wire that cannot take text back once it has sent it (the phone's). The
    answer text is held for the same reason and settles the same way; this is
    its reasoning. */
export interface ReasoningHold {
  push: (text: string) => void;
  /** The round stands: everything held goes out now, and later text as it
      arrives. Called before the round's answer is shown, so the reasoning
      reads before it. */
  release: () => void;
  /** The round will not stand — it was refused, or it died — and nothing it
      held goes out, nor anything that arrives after it. */
  drop: () => void;
}

export function createReasoningHold(show: (text: string) => void): ReasoningHold {
  let held = "";
  let state: "held" | "open" | "dropped" = "held";
  return {
    push(text) {
      if (state === "dropped") return;
      if (state === "open") show(text);
      else held += text;
    },
    release() {
      if (state !== "held") return;
      state = "open";
      if (held !== "") show(held);
      held = "";
    },
    drop() {
      state = "dropped";
      held = "";
    },
  };
}

/** The keys the recovery reads a tool's name from (recoverToolCall.ts). */
const CALL_KEYS = ["name", "tool", "tool_name", "toolName", "function"];

/**
 * Whether the prefix streamed so far could still be a whole-answer call —
 * the shapes recoverToolCall.ts accepts, mid-stream. The moment it cannot
 * (`<div…`, `{"a"…`), the text is an ordinary answer and streams; while it
 * can (`<function=`, `<tool_call`, a JSON object whose first key is a call
 * key), it is held whole, because the recovery may drop it.
 */
function callShapedPrefix(shaped: string): boolean {
  if (shaped === "") return true;
  if (shaped.startsWith("<")) {
    // A completed `<function=` opener or `<tool_call` wrapper can be followed
    // by anything; an incomplete one is still being written.
    if (shaped.startsWith("<function=") || "<function=".startsWith(shaped)) return true;
    if (shaped.startsWith("<tool_call") || "<tool_call".startsWith(shaped)) return true;
    return false;
  }
  if (shaped.startsWith("{")) return jsonCallShaped(shaped);
  return false;
}

/** Whether a `{`-opened prefix could still be one call-shaped object: its
    first key must be one the recovery reads a name from. Any other first key
    (`{"a": 1…`) is a JSON answer the person asked for, and it streams. */
function jsonCallShaped(shaped: string): boolean {
  let i = 1;
  while (i < shaped.length && /\s/.test(shaped[i]!)) i += 1;
  if (i >= shaped.length) return true;
  if (shaped[i] !== '"') return false;
  let key = "";
  i += 1;
  while (i < shaped.length) {
    const ch = shaped[i]!;
    if (ch === '"') return CALL_KEYS.includes(key);
    if (ch === "\\") {
      i += 2;
      continue;
    }
    key += ch;
    i += 1;
  }
  return CALL_KEYS.some((k) => k.startsWith(key));
}
