import { ChatRequestError, completionsUrl } from "./chat";
import type { StreamOptions, ToolPhrases, WireMessage } from "./chat";
import { runRound } from "./streamRound";
import type { Round } from "./streamRound";
import { isToolRefusal } from "./refusal";
import { createAnswerHold, createReasoningHold } from "./answerHold";
import type { ReasoningHold } from "./answerHold";
import { accumulate } from "./toolCalls";
import type { ToolCall } from "./toolCalls";
import { canonicalToolName } from "./repairToolCall";
import { recoverToolCall } from "./recoverToolCall";
import { runToolCall } from "./runToolCall";
import { logUiEvent } from "./uiLog";
import { MAIL_NAMES, MAIL_TOOLS, WEB_TOOLS } from "./tools/definitions";
import { BROWSER_NAMES, BROWSER_TOOLS } from "./tools/browserTools";
import type { ToolDefinition } from "./tools/definitions";

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

/** Opening, reading, filling four fields and clicking Submit takes seven calls,
    so browser turns need room beyond the search budget. */
const MAX_BROWSER_ROUNDS = 8;

function maxToolRounds(offered: string[]): number {
  return offered.some((name) => BROWSER_NAMES.has(name)) ? MAX_BROWSER_ROUNDS : MAX_TOOL_ROUNDS;
}

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
  // The names this request offered, for the case-insensitive match a mangled
  // name needs (repairToolCall.ts) and the recovery's name gate.
  const offeredNames = tools.map((tool) => tool.function.name);
  const toolRounds = tools.length > 0 && runTool ? maxToolRounds(offeredNames) : 0;
  const definitions = new Map(tools.map((tool) => [tool.function.name, tool] as const));

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
  async function askRound(
    offer: ToolDefinition[],
    toolChoice: "auto" | "none",
    hideInventedCalls: boolean,
    hold: ReturnType<typeof createAnswerHold> | null,
    reason: ReasoningHold | null = null,
  ): Promise<Round> {
    const sinks =
      hold === null && reason === null
        ? options
        : { ...options, onToken: hold?.push ?? options.onToken, onReasoning: reason?.push ?? options.onReasoning };
    for (;;) {
      try {
        return await runRound(sinks, conversation, offer, toolChoice, hideInventedCalls);
      } catch (error) {
        if (!(error instanceof ChatRequestError) || error.kind !== "oversize") throw error;
        if (!shedOlderHalf(conversation)) throw error;
      }
    }
  }

  // The current turn's own tool results stay: a page the model reads in a
  // silently truncated form is worse than a smaller window, so only the
  // history before this turn's last user message falls. The engine remains
  // the authority on what fits — this only spares the round trip when the
  // estimator already knows the answer.
  function fitHistory(): void {
    if (fit === null) return;
    while (fit.size(conversation) > fit.budget && shedOlderHalf(conversation)) {
      // Each pass re-measures what is left.
    }
  }

  let forceWords = false;
  // Whether the app has already drawn what this turn asked for. A mail list the
  // person can see is not a half-finished check, so a model that then rambles,
  // re-lists the mails or asks for tools again cannot end the turn as a failure.
  let drewMail = false;
  const noteRun: NonNullable<StreamOptions["onToolRun"]> = (run) => {
    if (MAIL_NAMES.has(run.name) && run.state === "ok" && run.mail !== undefined) drewMail = true;
    options.onToolRun?.(run);
  };
  for (let round = 0; round <= toolRounds; round += 1) {
    const last = forceWords || round >= toolRounds;
    // Hiding invented markup is for the capped round alone: the round that asks
    // a silent model for words can be answering "show me the tags", and eating
    // that is how the answer disappeared in the first place.
    const hideInventedCalls = tools.length > 0 && round >= toolRounds;
    if (round > 0) fitHistory();
    // The first round of a turn that offered tools may be a refusal the retry
    // replaces; a later round that can still call may be one written-out call
    // the recovery replaces. Either way the text is held until the round says
    // which it was, so what gets replaced is never shown.
    // A wire that cannot take text back holds the round's reasoning the same
    // way and for exactly as long: it goes out the instant the answer does, and
    // a round that streams its answer streams its reasoning, because there is
    // nothing left for the reasoning to be held back from.
    const held = tools.length > 0 && (round === 0 || !last);
    const reason: ReasoningHold | null =
      held && options.holdReasoning === true ? createReasoningHold(options.onReasoning) : null;
    const hold = held
      ? createAnswerHold(
          reason === null
            ? options.onToken
            : (text) => {
                reason.release();
                options.onToken(text);
              },
        )
      : null;
    let answered: Round;
    try {
      answered = await askRound(tools, last ? "none" : "auto", hideInventedCalls, hold, reason);
    } catch (error) {
      // The round died on the way out, so it never stands: nothing it held is
      // sent. The answer text still settles as it always has.
      reason?.drop();
      hold?.settle(false);
      throw error;
    }
    // The server numbers its calls per response, so round two can hand back the
    // id round one used. The transcript replaces a run by id and the wire pairs
    // a result to its call by id, so an id has to be unique for the whole turn:
    // the round is the only thing here that makes it so.
    let calls = answered.toolCalls.map((call) => ({ ...call, id: `${round}-${call.id}` }));
    // A refusal while tools were offered is the tool definitions talking, not
    // the question: the same question is asked once more without them. Only
    // before this turn's first tool has run, so no tool exchange of this turn
    // is on the wire without the contract that declares it.
    const refused =
      round === 0 && tools.length > 0 && !signal.aborted && isToolRefusal(answered.text, answered.toolCalls);
    if (refused) {
      hold?.settle(true);
      reason?.drop();
      options.onWithdraw?.(answered.reasoning);
      logUiEvent("chat.retry_without_tools");
      fitHistory();
      await askRound([], "none", false, null);
      return;
    }
    // A round that said nothing in words leaves the reader with an empty turn,
    // whether it spent itself on calls or simply stopped after thinking. Ask
    // once for words, in a round that cannot call anything. Live, 2026-09-19:
    // one run produced forty calls and no answer to "show me the <tool_call>
    // format", another stopped after 150 characters of thinking. The phone has
    // had this fallback since the beginning (LlamaService.ts:5208); only a turn
    // that offered tools can take it, so a plain chat is untouched.
    const askForWords = !answered.gotContent && !last;
    // Recovery: some models write the call out as the whole answer instead of
    // sending it as one (the dialects recoverToolCall.ts reads). Narrow on
    // purpose — answer text is the channel outside content can speak into:
    // the whole answer must be the call, the round must have finished cleanly
    // (`stop`), and no web result may sit anywhere in the conversation the
    // model is reading — this turn's or a previous one's, derived from the
    // messages themselves so nothing short of rebuilding the conversation
    // reopens it. The answer text is then dropped, not shown: the tool's run
    // is the turn's visible act.
    let fromText = false;
    if (calls.length === 0) {
      const recovered =
        last || tools.length === 0 || webResultIn(conversation) || answered.finishReason !== "stop"
          ? null
          : recoverToolCall(answered.text, offeredNames);
      if (recovered === null) {
        hold?.settle(false);
        if (askForWords) {
          forceWords = true;
          continue;
        }
        return;
      }
      // The round stands as a call: its reasoning is the person's to read, and
      // only the text that was written instead of the call goes.
      reason?.release();
      hold?.drop();
      fromText = true;
      logUiEvent("chat.tool_call_recovered");
      // The recovered arguments pass through the same cap as streamed ones:
      // a call too long to hold is cut and answered by the guide, not sent.
      const [held] = accumulate([], [
        { index: 0, function: { name: recovered.name, arguments: JSON.stringify(recovered.arguments) } },
      ]);
      calls = [{ ...held!, id: `${round}-recovered` }];
    }
    hold?.settle(false);

    // Either the server sent calls and ended the round for some other reason —
    // `length`, `stop` — or the turn is out of rounds. Running a call under
    // `length` would hand a tool half a sentence, so they are recorded as
    // refused: the thread says what happened. A recovered call is exempt: it
    // was recovered only from a round that finished `stop`.
    if (!fromText && (!forTools(answered.finishReason) || last)) {
      // The cards are already on screen: whatever the model did after the list
      // is its own business, not a failed check for the reader to answer again.
      if (drewMail) {
        hold?.settle(false);
        return;
      }
      refuse(
        options,
        calls,
        forTools(answered.finishReason)
          ? say.noRoundLeft
          : say.turnEnded,
        "refused_end",
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
    refuse(options, calls.filter((call) => call.name === ""), say.nameNeverArrived, "unnamed");
    if (named.length === 0) return;

    // Serial on purpose, like the phone (LlamaService.ts:5030): two searches at
    // once would cost more for no answer a model can use, and the results have
    // to be paired with their calls in order anyway. Only a tool this request
    // offered may run — a model can ask for one from its training priors
    // (`web_search` with the switch off), and running it would send the very
    // query the switch withholds; a name differing in case alone is the same
    // tool (repairToolCall.ts).
    const results: string[] = [];
    const wireTexts: string[] = [];
    const canonicalNames: string[] = [];
    for (const call of named) {
      const canonical = canonicalToolName(call.name, offeredNames);
      canonicalNames.push(canonical ?? call.name);
      // What was asked for, and nothing else: the name, never the arguments.
      // A name this request never offered was refused rather than run, and
      // says so here rather than borrowing a tool's code for it.
      logUiEvent(`${surface(options)}tool.${canonical ?? "not_offered"}`);
      const answer = await runToolCall(
        call,
        canonical === null ? null : definitions.get(canonical)!,
        { say, runTool: runTool!, onToolRun: noteRun, signal, url, conversation },
      );
      results.push(answer.result);
      wireTexts.push(answer.wire);
    }

    // What the model asked for, then what it got. Both go back on the wire as
    // an ordinary turn, matched by id, before it is asked again. `named` is
    // what the assistant message carries: a call the app did not answer must
    // not appear there, or the server is sent a call with no result.
    conversation.push({
      role: "assistant",
      content: "",
      tool_calls: named.map((call, index) => ({
        id: call.id,
        type: "function" as const,
        function: { name: canonicalNames[index], arguments: wireTexts[index] },
      })),
    });
    named.forEach((call, index) => {
      conversation.push({ role: "tool", content: results[index], tool_call_id: call.id });
    });
  }
}

/**
 * Whether any web tool's result is already in the conversation the model is
 * reading — this turn's or a previous one's. Once outside content has
 * entered the wire, answer text is a channel it can speak into, and recovery
 * stays off; reading it off the messages themselves (rather than remembering
 * a flag) means a page fetched in any earlier turn arms it too.
 */
function webResultIn(conversation: WireMessage[]): boolean {
  const webIds = new Set<string>();
  for (const message of conversation) {
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      if (WEB_NAMES.has(call.function.name)) webIds.add(call.id);
    }
  }
  if (webIds.size === 0) return false;
  return conversation.some(
    (message) => message.role === "tool" && typeof message.tool_call_id === "string" && webIds.has(message.tool_call_id),
  );
}

/** The tools whose results carry outside content into the conversation. Mail
    is outside content: every line of a mail is a stranger's words, fenced by
    the sidecar, and once it is in the wire the answer text is a channel it
    can speak into — the same reason a page is, and the same reason a browser
    tool's fenced page joins them. After any of them, text-to-tool-call
    recovery is off: a recovery reads the conversation for `<|tool_call_start|>`
    and a stranger's page is exactly who would put it there. */
const WEB_NAMES = new Set([...WEB_TOOLS, ...MAIL_TOOLS, ...BROWSER_TOOLS].map((tool) => tool.function.name));

/** The surface a round's tool lines are prefixed with. A phone's turn is
    marked as one: the tools a phone calls are this computer's, and without the
    mark a stranger's phone asking for the owner's mail and the owner's own ask
    are the same log line. */
function surface(options: StreamOptions): string {
  return options.phone === true ? "phone." : "chat.";
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
function refuse(options: StreamOptions, calls: ToolCall[], reason: string, code: string): void {
  for (const call of calls) {
    // A call that never ran is still a tool this round asked for, so it is
    // logged in the same shape the run logs in — with the reason rather than
    // a name: a round that ended under the calls has names but ran nothing,
    // and a nameless call has no name to log at all.
    logUiEvent(`${surface(options)}tool.${code}`);
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
