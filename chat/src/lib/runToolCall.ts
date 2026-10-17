import { ChatRequestError } from "./chat";
import type { ToolOutcome, ToolPhrases, WireMessage } from "./chat";
import { readArguments, wireArguments } from "./toolCalls";
import { exceedsCodePoints, firstCodePoints } from "./text";
import type { ToolCall } from "./toolCalls";
import { repairToolCall } from "./repairToolCall";
import { guideCut, guideNotValidJson, guideProblem } from "./guideRetry";
import type { ToolDefinition } from "./tools/definitions";
import { TOOL_STOPPED } from "./types";
import type { ToolRun } from "./types";
import type { Miniapp } from "./miniapp/types";
import type { Mail } from "./mail/types";

/**
 * One tool call the model made, run and answered. The arguments are repaired
 * against the tool's schema (repairToolCall.ts); a call that cannot run is
 * answered with the guide (guideRetry.ts) — English, the same text the model
 * reads on the wire, the record stores and a later replay sends. The record
 * keeps the arguments that actually ran, so the card, the wire and history
 * all agree on what the call was.
 */

/** What the loop needs back from one call. */
export interface CallAnswer {
  /** The tool result the model reads: the tool's answer, or the guide. */
  result: string;
  /** The arguments text the wire replays for this call. */
  wire: string;
}

/** The turn's state one call needs. */
export interface CallContext {
  say: ToolPhrases;
  runTool: (
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    conversation: WireMessage[],
  ) => Promise<ToolOutcome>;
  onToolRun?: (run: ToolRun) => void;
  signal: AbortSignal;
  /** Where the request went, so a Stop mid-call fails as that request's. */
  url: string;
  /** The conversation the model is reading, growing round by round; the
      web_fetch provenance rule reads it at call time. */
  conversation: WireMessage[];
}

/**
 * Run one call of the round. `definition` null means the request never
 * offered this tool: the call is answered with the reason and never run, so
 * the round after it is a whole exchange.
 */
export async function runToolCall(
  call: ToolCall,
  definition: ToolDefinition | null,
  ctx: CallContext,
): Promise<CallAnswer> {
  if (definition === null) {
    const record: ToolRun = {
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      result: ctx.say.notOffered,
      state: "refused",
    };
    ctx.onToolRun?.(record);
    return { result: ctx.say.notOffered, wire: wireArguments(call.arguments, call.cut) };
  }
  const name = definition.function.name;

  const { args, problem } = readArguments(call.name, call.arguments, call.cut, {
    tooLong: ctx.say.argumentsTooLong,
    notValid: () => ctx.say.argumentsNotValid,
  });
  const repaired = problem === null ? repairToolCall(args, definition.function.parameters) : null;
  // The guide is what the model reads and what the record stores; cut and
  // unparsable arguments come from readArguments, every surviving field
  // problem from the repairs.
  let guide: string | null = null;
  if (problem !== null) {
    guide = call.cut ? guideCut(definition) : guideNotValidJson(definition);
  } else if (repaired!.problems.length > 0) {
    guide = guideProblem(definition, repaired!.problems);
  }
  // The arguments that actually ran: the repaired object when the repairs
  // fired, the model's own text when they did not, and what was sent when
  // nothing ran. One text for the record, the wire and every replay.
  const effective =
    guide === null && repaired !== null && repaired.repairs.length > 0
      ? JSON.stringify(repaired.args)
      : call.arguments;
  const started: ToolRun = { id: call.id, name, arguments: effective, result: "", state: "running" };
  ctx.onToolRun?.(started);

  let state: ToolRun["state"] = guide === null ? "ok" : "failed";
  let result = guide ?? "";
  let resultCode: string | undefined;
  let miniapp: Miniapp | undefined;
  let mail: Mail | undefined;
  let pagesRead: number | undefined;
  if (guide === null) {
    const answered = await untilStopped(() => ctx.runTool(name, repaired!.args, ctx.signal, ctx.conversation), ctx.signal);
    if (answered === null) {
      // The code, not the sentence: a run is stored, and a run read back in
      // another language has to still read as stopped.
      ctx.onToolRun?.({ ...started, result: TOOL_STOPPED, state: "failed" });
      throw new ChatRequestError("aborted", "Stopped", undefined, ctx.url);
    }
    result = answered.text;
    resultCode = answered.resultCode;
    miniapp = answered.miniapp;
    mail = answered.mail;
    pagesRead = answered.pagesRead;
    state = answered.ok ? "ok" : "failed";
  }
  ctx.onToolRun?.({
    ...started,
    result: kept(result),
    resultCode,
    state,
    ...(miniapp ? { miniapp } : {}),
    ...(mail ? { mail } : {}),
    ...(pagesRead ? { pagesRead } : {}),
  });
  return {
    result,
    wire: repaired !== null && repaired.repairs.length > 0 ? effective : wireArguments(call.arguments, call.cut),
  };
}

/** What the transcript keeps of a tool's answer. */
const KEPT_RESULT_CHARS = 1_200;

/**
 * The turn that ran the tool reads all of it. The record that outlives the
 * turn keeps the beginning: a page's text should not sit in browser storage
 * for the life of the conversation, and it should not be sent again on every
 * later turn either.
 */
function kept(result: string): string {
  if (!exceedsCodePoints(result, KEPT_RESULT_CHARS)) return result;
  // By code points, not by UTF-16 units: this text is replayed to the engine on
  // every later turn, and a slice that ends mid-character would send a lone
  // surrogate in every one of them.
  return `${firstCodePoints(result, KEPT_RESULT_CHARS)}\n\n[The rest of this result was not kept after the turn.]`;
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
