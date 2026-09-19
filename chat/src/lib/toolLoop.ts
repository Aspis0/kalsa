import { ChatRequestError, completionsUrl } from "./chat";
import type { StreamOptions } from "./chat";
import { runRound } from "./streamRound";
import { readArguments } from "./toolCalls";
import type { ToolCall } from "./toolCalls";
import type { ToolRun } from "./types";

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
export async function streamChatCompletion(options: StreamOptions): Promise<void> {
  const { signal } = options;
  const tools = options.tools ?? [];
  const runTool = options.runTool;
  const url = completionsUrl(options.endpoint);
  const conversation = [...options.messages];
  const toolRounds = tools.length > 0 && runTool ? MAX_TOOL_ROUNDS : 0;

  for (let round = 0; round <= toolRounds; round += 1) {
    const final = round >= toolRounds;
    const answered = await runRound(options, conversation, tools, final ? "none" : "auto");
    if (answered.toolCalls.length === 0) return;
    // The server numbers its calls per response, so round two can hand back the
    // id round one used. The transcript replaces a run by id and the wire pairs
    // a result to its call by id, so an id has to be unique for the whole turn:
    // the round is the only thing here that makes it so.
    const calls = answered.toolCalls.map((call) => ({ ...call, id: `${round}-${call.id}` }));
    if (!forTools(answered.finishReason)) {
      // The server sent tool calls and then said the turn was over for some
      // other reason — `length`, `stop`. Running one would hand a tool half a
      // sentence, so the calls are recorded as refused instead.
      refuse(options, calls, `The server sent a tool call but ended the turn as “${answered.finishReason}”, so nothing was run.`);
      return;
    }
    if (final) {
      // Out of rounds: a server that ignored `tool_choice: "none"` has left
      // these nowhere to run, and the thread still has to say what happened.
      refuse(options, calls, "There was no round left to run this, so the answer had to be in words.");
      return;
    }

    // A call the stream never named cannot be run and must not go back on the
    // wire: `function.name: ""` is a malformed request. It is still recorded,
    // so the thread says what happened rather than showing nothing.
    const runnable = calls.filter((call) => call.name !== "");
    refuse(
      options,
      calls.filter((call) => call.name === ""),
      "The stream ended before this call's name arrived, so nothing was run.",
    );
    if (runnable.length === 0) return;

    // Serial on purpose, like the phone (LlamaService.ts:5030): two searches at
    // once would cost more for no answer a model can use, and the results have
    // to be paired with their calls in order anyway.
    const results: string[] = [];
    for (const call of runnable) {
      const { args, problem } = readArguments(call.name, call.arguments, call.cut);
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
      if (problem === null) {
        const answered = await untilStopped(() => runTool!(call.name, args, signal), signal);
        if (answered === null) {
          options.onToolRun?.({ ...started, result: "Stopped before this finished.", state: "failed" });
          throw new ChatRequestError("aborted", "Stopped", undefined, url);
        }
        result = answered.text;
        state = answered.ok ? "ok" : "failed";
      }
      options.onToolRun?.({ ...started, result: kept(result), state });
      results.push(result);
    }

    // What the model asked for, then what it got. Both go back on the wire as
    // an ordinary turn, matched by id, before it is asked again.
    conversation.push({
      role: "assistant",
      content: "",
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    });
    runnable.forEach((call, index) => {
      conversation.push({ role: "tool", content: results[index], tool_call_id: call.id });
    });
  }
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
