import { ChatRequestError, completionsUrl } from "./chat";
import type { StreamOptions, ToolPhrases, WireMessage } from "./chat";
import { runRound } from "./streamRound";
import type { Round } from "./streamRound";
import { readArguments } from "./toolCalls";
import type { ToolCall } from "./toolCalls";
import type { ToolRun } from "./types";
import type { Miniapp } from "./miniapp/types";

/**
 * Answer, calling tools for as long as the model asks for them.
 *
 * The round that must answer is the last one: a model that keeps calling tools
 * is asked for words (`tool_choice: "none"`) rather than cut off with an error.
 * The conversation the rounds share is built here and never touches the
 * transcript — the transcript keeps the assistant's answer with the tool runs
 * beside it (see `ToolRun`), and the wire is rebuilt from that next turn.
 */

/** How many times a turn may go back to the model with tool results. The
    phone allows three (LlamaService.ts:607); four is enough for a search that
    needs a page read afterwards, and one more round is always kept in reserve
    for the answer itself. */
const MAX_TOOL_ROUNDS = 4;
/**
 * Answer, calling tools for as long as the model asks for them.
 *
 * The round that must answer is the last one: a model that keeps calling tools
 * is asked for words (`tool_choice: "none"`) rather than cut off with an
 * error. The conversation the rounds share is built here and never touches the
 * transcript — the transcript keeps the assistant's answer with the tool runs
 * beside it (see `ToolRun`), and the wire is rebuilt from that next turn.
 */
/** The phrases every caller without a table hears. */
const ENGLISH_PHRASES: ToolPhrases = {
  noRoundLeft: "Kalsa couldn't finish checking. Ask again.",
  turnEnded: "Kalsa couldn't finish checking. Ask again.",
  nameNeverArrived: "Kalsa couldn't finish checking. Ask again.",
  stopped: "You stopped this before Kalsa finished.",
  argumentsTooLong: "That was too long for Kalsa to check. Try a shorter search or address.",
  argumentsNotValid: "Kalsa couldn't finish checking. Ask again.",
  notOffered: "That tool is not available now. Answer without it.",
};

export async function streamChatCompletion(options: StreamOptions): Promise<void> {
  const { signal } = options;
  const tools = options.tools ?? [];
  const runTool = options.runTool;
  const say: ToolPhrases = options.toolPhrases ?? ENGLISH_PHRASES;
  const url = completionsUrl(options.endpoint);
  const conversation = [...options.messages];
  const toolRounds = tools.length > 0 && runTool ? MAX_TOOL_ROUNDS : 0;
  // The token room the wire may spend, when the caller knows the window: the
  // engine's size less the answer's own reserve, which is what the first wire
  // was built to fit. Round 0 is already fit by the caller; the rounds after
  // it are this loop's to check, because the tool exchange grows the
  // conversation after that fit was answered.
  const fit = options.contextFit ?? null;

  // One round, with the engine's refusal-for-size handled the way the Room
  // handles it (crates/kalsa-door/src/room/turn.rs:364): shed the older half
  // of the history and ask again, down to the current turn alone. Only an
  // overflow is retried — every other failure, and an overflow with nothing
  // left to shed, leaves as it came, and the caller shows the oversize
  // sentence for that one.
  async function askRound(toolChoice: "auto" | "none", hideInventedCalls: boolean): Promise<Round> {
    for (;;) {
      try {
        return await runRound(options, conversation, tools, toolChoice, hideInventedCalls);
      } catch (error) {
        if (!(error instanceof ChatRequestError) || error.kind !== "oversize") throw error;
        if (!shedOlderHalf(conversation)) throw error;
      }
    }
  }

  let forceWords = false;
  for (let round = 0; round <= toolRounds; round += 1) {
    const last = forceWords || round >= toolRounds;
    // Hiding invented markup is for the capped round alone: the round that asks
    // a silent model for words can be answering "show me the tags", and eating
    // that is how the answer disappeared in the first place.
    const hideInventedCalls = tools.length > 0 && round >= toolRounds;
    // The current turn's own tool results stay: a page the model reads in a
    // silently truncated form is worse than a smaller window, so only the
    // history before this turn's last user message falls. The engine remains
    // the authority on what fits — this only spares the round trip when the
    // estimator already knows the answer.
    if (round > 0 && fit !== null) {
      while (fit.size(conversation) > fit.budget && shedOlderHalf(conversation)) {
        // Each pass re-measures what is left.
      }
    }
    const answered = await askRound(last ? "none" : "auto", hideInventedCalls);
    // The server numbers its calls per response, so round two can hand back the
    // id round one used. The transcript replaces a run by id and the wire pairs
    // a result to its call by id, so an id has to be unique for the whole turn:
    // the round is the only thing here that makes it so.
    const calls = answered.toolCalls.map((call) => ({ ...call, id: `${round}-${call.id}` }));
    // A round that said nothing in words leaves the reader with an empty turn,
    // whether it spent itself on calls or simply stopped after thinking. Ask
    // once for words, in a round that cannot call anything. Live, 2026-09-19:
    // one run produced forty calls and no answer to "show me the <tool_call>
    // format", another stopped after 150 characters of thinking. The phone has
    // had this fallback since the beginning (LlamaService.ts:5208); only a turn
    // that offered tools can take it, so a plain chat is untouched.
    const askForWords = !answered.gotContent && !last;
    if (calls.length === 0) {
      if (askForWords) {
        forceWords = true;
        continue;
      }
      return;
    }

    // Either the server sent calls and ended the round for some other reason —
    // `length`, `stop` — or the turn is out of rounds. Running a call under
    // `length` would hand a tool half a sentence, so they are recorded as
    // refused: the thread says what happened.
    if (!forTools(answered.finishReason) || last) {
      refuse(
        options,
        calls,
        forTools(answered.finishReason)
          ? say.noRoundLeft
          : say.turnEnded,
      );
      if (askForWords) {
        forceWords = true;
        continue;
      }
      return;
    }

    // A call the stream never named cannot be run and must not go back on the
    // wire: `function.name: ""` is a malformed request. It is still recorded,
    // so the thread says what happened rather than showing nothing.
    const named = calls.filter((call) => call.name !== "");
    refuse(options, calls.filter((call) => call.name === ""), say.nameNeverArrived);
    if (named.length === 0) return;

    // Only a tool this request offered may run. A model can ask for one from
    // its training priors — `web_search` with the switch off — and running it
    // would send the very query the switch withholds. Such a call is answered
    // with the reason instead of dropped, so the round after it is a whole
    // exchange (and a real engine accepts it).
    const offered = new Set(tools.map((tool) => tool.function.name));

    // Serial on purpose, like the phone (LlamaService.ts:5030): two searches at
    // once would cost more for no answer a model can use, and the results have
    // to be paired with their calls in order anyway.
    const results: string[] = [];
    for (const call of named) {
      if (!offered.has(call.name)) {
        options.onToolRun?.({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
          result: say.notOffered,
          state: "refused",
        });
        results.push(say.notOffered);
        continue;
      }
      const { args, problem } = readArguments(call.name, call.arguments, call.cut, {
        tooLong: say.argumentsTooLong,
        notValid: () => say.argumentsNotValid,
      });
      const started: ToolRun = {
        id: call.id,
        name: call.name,
        arguments: call.arguments,
        result: "",
        state: "running",
      };
      options.onToolRun?.(started);

      let state: ToolRun["state"] = problem === null ? "ok" : "failed";
      let result = problem ?? "";
      let resultCode: string | undefined;
      let miniapp: Miniapp | undefined;
      if (problem === null) {
        const answered = await untilStopped(() => runTool!(call.name, args, signal), signal);
        if (answered === null) {
          options.onToolRun?.({ ...started, result: say.stopped, state: "failed" });
          throw new ChatRequestError("aborted", "Stopped", undefined, url);
        }
        result = answered.text;
        resultCode = answered.resultCode;
        miniapp = answered.miniapp;
        state = answered.ok ? "ok" : "failed";
      }
      options.onToolRun?.({ ...started, result: kept(result), resultCode, state, ...(miniapp ? { miniapp } : {}) });
      results.push(result);
    }

    // What the model asked for, then what it got. Both go back on the wire as
    // an ordinary turn, matched by id, before it is asked again. `named` is
    // what the assistant message carries: a call the app did not answer must
    // not appear there, or the server is sent a call with no result.
    conversation.push({
      role: "assistant",
      content: "",
      tool_calls: named.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    });
    named.forEach((call, index) => {
      conversation.push({ role: "tool", content: results[index], tool_call_id: call.id });
    });
  }
}

/**
 * The working conversation shrinks when the engine refuses the prompt as too
 * large: the older half of the history before this turn's last user message
 * goes, so the current turn and its own tool results are never the thing
 * dropped. The Room's recovery halves its budget the same way
 * (crates/kalsa-door/src/room/turn.rs:364); here the unit is a turn, not a
 * message.
 *
 * The cut walks forward to the next `user` message, which keeps two
 * invariants in one rule: the kept history starts at a user (an assistant
 * with no user prompt is refused by templates that require alternation —
 * Gemma's family), and a tool exchange travels whole (an `assistant`
 * tool_calls and its `tool` results are inside the same turn, so the walk
 * past them never leaves an orphan). False means there is nothing left to
 * shed: the newest user message alone is the floor, and a prompt that cannot
 * fit it cannot shrink.
 */
function shedOlderHalf(conversation: WireMessage[]): boolean {
  let lastUser = -1;
  for (let at = conversation.length - 1; at >= 1; at -= 1) {
    if (conversation[at].role === "user") {
      lastUser = at;
      break;
    }
  }
  if (lastUser <= 1) return false;
  let drop = Math.max(1, Math.floor((lastUser - 1) / 2));
  while (drop < lastUser - 1 && conversation[1 + drop]?.role !== "user") drop += 1;
  conversation.splice(1, drop);
  return true;
}

/**
 * Record calls that will not run, so the thread says why rather than showing a
 * call that quietly did nothing.
 */
function refuse(options: StreamOptions, calls: ToolCall[], reason: string): void {
  for (const call of calls) {
    options.onToolRun?.({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      result: reason,
      // Never an exchange on the wire, so never rebuilt as one.
      state: "refused",
    });
  }
}

/**
 * Whether the server ended the round in order to have a tool run. `tool_calls`
 * is the contract and `function_call` is the spelling older servers use; a
 * missing reason is accepted because a stream cut before the last frame still
 * carried whole calls. Any other reason is the server saying the turn was over.
 */
function forTools(finishReason: string | null): boolean {
  return (
    finishReason === null || finishReason === "tool_calls" || finishReason === "function_call"
  );
}

/** What the transcript keeps of a tool's answer. */
const KEPT_RESULT_CHARS = 1_200;

/**
 * The turn that ran the tool reads all of it. The record that outlives the turn
 * keeps the beginning: a page's text should not sit in browser storage for the
 * life of the conversation, and it should not be sent again on every later
 * turn either.
 */
function kept(result: string): string {
  if (result.length <= KEPT_RESULT_CHARS) return result;
  return `${result.slice(0, KEPT_RESULT_CHARS)}\n\n[The rest of this result was not kept after the turn.]`;
}

/**
 * Wait for the tool unless the user stops first. The work is started by a
 * thunk, not handed over as a promise: an already-stopped turn must not run
 * the tool at all.
 *
 * A Tauri command cannot be withdrawn from the page, so what this guarantees is
 * that Stop stops the turn rather than leaving it waiting. Setting the call's
 * stop flag (which the caller's own abort hook does) is what ends the request
 * in Rust, at its next step.
 */
function untilStopped<T>(start: () => Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<T | null>((resolve, reject) => {
    const stop = () => resolve(null);
    signal.addEventListener("abort", stop, { once: true });
    start().then(
      (value) => {
        signal.removeEventListener("abort", stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", stop);
        reject(error);
      },
    );
  });
}
