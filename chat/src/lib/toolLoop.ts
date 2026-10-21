import { ChatRequestError, completionsUrl } from "./chat";
import type { StreamOptions, ToolPhrases, WireMessage } from "./chat";
import { runRound } from "./streamRound";
import type { Round } from "./streamRound";
import { isToolRefusal } from "./refusal";
import { createAnswerHold, createReasoningHold } from "./answerHold";
import type { ReasoningHold } from "./answerHold";
import { BROWSER_CALLS_PER_TURN } from "./callLedger";
import { accumulate } from "./toolCalls";
import type { ToolCall } from "./toolCalls";
import { canonicalToolName } from "./repairToolCall";
import { recoverToolCall } from "./recoverToolCall";
import { runToolCall } from "./runToolCall";
import { logUiEvent } from "./uiLog";
import { denseTokens, definitionsTokens, HOUSE_CHARS_PER_TOKEN } from "./density";
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

/** A browser turn may spend the whole call budget, one call at a time: the two
    limits are the same number, so the calls stop a turn, not the round count. */
const MAX_BROWSER_ROUNDS = BROWSER_CALLS_PER_TURN;

/** What the last request says about the turn's own state: the calls are done,
    so the answer comes now, from what arrived, and promises nothing more. */
export const FINAL_STATUS =
  "[Kalsa execution status] No tool calls remain in this turn. Give the final answer now using the results already received. State what is unverified or incomplete, and do not promise another action.";

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
  notOfferedBrowser: "The person asked you to browse for them this turn. Use the browser tools.",
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
  //
  // **The closing request may not shed and may not retry.** Its body is the
  // one the engine has already read; a retry would send a different one, or
  // none at all, and the turn would answer from a thread the model never
  // saw. So the recovery is off on that path, and the body that goes out is
  // the body that was read.
  async function askRound(
    messages: WireMessage[],
    offer: ToolDefinition[],
    toolChoice: "auto" | "none",
    hideInventedCalls: boolean,
    hold: ReturnType<typeof createAnswerHold> | null,
    reason: ReasoningHold | null = null,
    /** Whether an oversize may be recovered by shedding the older half and
        asking again. Off for the closing request. */
    mayShed = true,
  ): Promise<Round> {
    const sinks =
      hold === null && reason === null
        ? options
        : { ...options, onToken: hold?.push ?? options.onToken, onReasoning: reason?.push ?? options.onReasoning };
    for (;;) {
      try {
        return await runRound(sinks, messages, offer, toolChoice, hideInventedCalls);
      } catch (error) {
        if (!(error instanceof ChatRequestError) || error.kind !== "oversize") throw error;
        if (!mayShed || !shedOlderHalf(messages)) throw error;
      }
    }
  }

  // The current turn's own tool results stay: a page the model reads in a
  // silently truncated form is worse than a smaller window, so only the
  // history before this turn's last user message falls. The engine remains
  // the authority on what fits — this only spares the round trip when the
  // estimator already knows the answer.
  //
  // **What the shed costs is written down here.** It rewrites the history
  // the engine has already read, so the engine's cached prefix is gone and
  // the prompt is prefilled again from the new start. That is the app's
  // trade for making room in prose: the tool results of the turn are worth
  // more than the older half of the conversation. When the turn closes for
  // space instead (below), nothing is rewritten at all — the closing
  // request carries the thread the engine really read.
  function fitHistory(): void {
    if (fit === null) return;
    while (fit.size(conversation) > fit.budget) {
      const before = fit.size(conversation);
      if (!shedOlderHalf(conversation)) break;
      // What the shed took out is not in the wire any more, and the engine's
      // count of it is inside `measured`: the estimate has to give it back.
      shedTokens += before - fit.size(conversation);
    }
  }

  /**
   * What the prompt carries besides the conversation: the tool definitions.
   *
   * They travel with every request and the house estimator weighs only the
   * messages, so they are counted here as well — with the dense rule, on the
   * same text the engine reads. **Without this the density is wrong:**
   * the engine's count of a prompt includes the definitions and the estimate
   * of it does not, so the ratio between the two reads the definitions'
   * weight as if it were the conversation's density, and every turn stops
   * thousands of tokens early.
   *
   * The caller may hand the number in (`contextFit.definitions`): it is the
   * one that fitted the first wire, and the two have to be the same number.
   * Absent, the loop weighs the definitions it sends itself.
   */
  function definitionsSize(): number {
    if (tools.length === 0) return 0;
    const weighed = fit?.definitions;
    return weighed ?? definitionsTokens(tools);
  }

  /**
   * The house estimate of a whole request: the conversation plus the tool
   * definitions that travel with it. The engine's count and this estimate
   * have to weigh the same things, or their ratio says nothing.
   */
  function wireEstimate(messages: WireMessage[]): number {
    if (fit === null) return 0;
    return fit.size(messages) + definitionsSize();
  }

  /**
   * The density this model has shown: the engine's own count of the prompt
   * it read against what this app's estimator said that same prompt weighed.
   *
   * Never below one. A ratio under one would make the estimate of the new
   * content smaller than the words it weighs, and the estimate is the only
   * thing standing between a turn and a request the engine refuses.
   */
  function densityRatio(): number {
    if (measured === null || measuredBase <= 0) return 1;
    return Math.max(1, measured / measuredBase);
  }

  /** What the tool results cost above the house rule's count of them: the
      difference between the pessimistic rule and the house rule on the same
      characters. */
  function denseExcess(chars: number): number {
    if (chars <= 0) return 0;
    return denseTokens(chars) - Math.ceil(chars / HOUSE_CHARS_PER_TOKEN);
  }

  /**
   * What has been added to the wire since the engine read it, in the
   * engine's tokens: the tool results' own bodies counted the pessimistic
   * way, and everything else with the house rule scaled by the density the
   * engine showed.
   */
  function addedTokens(): number {
    const ratio = densityRatio();
    return Math.round(denseTokens(addedToolChars) + (addedOtherChars / HOUSE_CHARS_PER_TOKEN) * ratio);
  }

  /**
   * What the request about to be sent weighs, in the engine's tokens.
   *
   * **Two ways of saying it, and the heavier one is the honest one.**
   *
   * The first is the engine's own density carried over the whole wire: the
   * engine's count of the prompt it read, times what this app's estimate
   * says the wire weighs now against what it said then. It is right when
   * the new content is like the old, and it is the only one of the two that
   * knows about a history the shed has shortened.
   *
   * The second is the engine's count of what it read, plus what has been
   * added since — the tool results' bodies counted the pessimistic way,
   * everything else with the house rule scaled by the density the engine
   * showed. It is right when the new content is denser than the old, which
   * is the case that killed the turn of 21 October 2026: a page of 6000
   * characters (3409 tokens the engine counted, 1500 the house rule said)
   * after a prompt of prose, where the first way read the page at the
   * prompt's density and said 1500 more tokens where there were 3409.
   *
   * The estimate alone says a wire fits long after it stopped fitting: a
   * page's own text is denser than prose by a factor no character count
   * knows. The turn of 21 October 2026 died that way — 63828 tokens of a
   * 65536 window behind an estimate of 25000, the engine refusing the next
   * request (a 400) and the turn dying with a thought cut in half.
   *
   * **The cost of this check, said plainly.** The arithmetic is constant:
   * a few numbers, added and multiplied. The estimate is not: it reads the
   * whole wire, every message and every character of it, once per round.
   * So one round's check costs the size of the conversation — linear in the
   * thread, not in the window — and the number of rounds is bounded by the
   * call budget (four, or the browser's own). Nothing is fetched and
   * nothing is measured to get it: these are this app's own numbers, read
   * from the wire it is about to send.
   */
  function projectedSize(): number {
    if (fit === null) return 0;
    const estimate = wireEstimate(conversation);
    if (measured === null || measuredBase <= 0) {
      // No engine count yet: the house estimate of the wire, with the tool
      // results counted the pessimistic way.
      return estimate + denseExcess(addedToolChars);
    }
    const averaged = Math.round((measured * estimate) / measuredBase);
    // What the shed took away is not in the wire any more, and the engine's
    // count of it was part of `measured`: the estimate has to give it back.
    const counted = measured - Math.round(shedTokens * densityRatio()) + addedTokens();
    return Math.max(averaged, counted);
  }

  /** Whether the request about to be sent fits the window the caller knows. */
  function nextRoundFits(): boolean {
    if (fit === null) return true;
    return projectedSize() <= fit.budget;
  }

  /**
   * The wire the engine has already read, kept as it was.
   *
   * A copy, and the only copy the closing request is built from: the
   * conversation itself moves — the tool results join it, and a shed may
   * take the older half of it away — and the closing request must carry the
   * thread the model really read, not the one that happens to be in the
   * array when the turn runs out of room. Nothing already sent is cut, so
   * the engine's cache still holds the prefix, and the model is answered
   * from what it has really read.
   */
  function acceptedWire(): WireMessage[] {
    return accepted ?? conversation;
  }

  /**
   * Whether the closing wire can carry the execution status: the body the
   * engine read, plus the status, has to fit the window the caller knows.
   *
   * If it does not — the thread was already at the limit — the status is
   * left out. The closing request is then the very body the engine
   * accepted, which fits by definition and keeps the whole prefix, and the
   * answer still comes from what the turn read.
   */
  function closingCarriesStatus(marked: WireMessage[]): boolean {
    if (fit === null) return true;
    const statusSize = fit.size([{ role: "user", content: FINAL_STATUS }]);
    if (measured !== null) return measured + statusSize <= fit.budget;
    return wireEstimate(marked) <= fit.budget;
  }

  let forceWords = false;
  // Whether this turn called a tool, and whether the final status has gone out
  // already: both are facts of this turn alone.
  let calledTool = false;
  let statusSent = false;
  // **The wire the engine has read, as it was.** Copied when a round is
  // accepted, and never written again: the closing request is built from
  // this copy, so the thread the model is answered from is the thread it
  // read.
  let accepted: WireMessage[] | null = null;
  // **The size of the wire, as the engine measures it.** `measured` is the
  // engine's own count of the prompt of the last request, `measuredBase` is
  // what this app's estimator said that same prompt weighed, and the two
  // together are this model's own density.
  let measured: number | null = null;
  let measuredBase = 0;
  // What has been added to the wire since the engine read it: the tool
  // results' own bodies, and everything else that came with them. The
  // counters are emptied when a round is accepted and the engine's count
  // of that round's prompt arrives; without a count they keep what the
  // turn has added, which is what the pessimistic rule weighs.
  let addedToolChars = 0;
  let addedOtherChars = 0;
  // Whether anything has been added since the last accepted body: a request
  // that carries nothing new is the one the engine already read, and it
  // fits by definition.
  let pending = 0;
  // What the shed took out of the history since the engine read it, by the
  // house estimate: the engine's count of that part is inside `measured`
  // and the wire no longer carries it.
  let shedTokens = 0;
  // Whether the app has already drawn what this turn asked for. A mail list the
  // person can see is not a half-finished check, so a model that then rambles,
  // re-lists the mails or asks for tools again cannot end the turn as a failure.
  let drewMail = false;
  const noteRun: NonNullable<StreamOptions["onToolRun"]> = (run) => {
    if (MAIL_NAMES.has(run.name) && run.state === "ok" && run.mail !== undefined) drewMail = true;
    options.onToolRun?.(run);
  };
  for (let round = 0; round <= toolRounds; round += 1) {
    // **The turn closes for space before it sends a request that would not
    // fit.** The engine refuses such a request (a 400), the turn dies there
    // with its thought cut in half, and everything the turn had read goes
    // with it. Instead the turn answers from what it has: one last request,
    // on the wire the engine has already read, with the calls forbidden.
    let closingForSpace = false;
    if (round === 0) {
      // **The first body is checked too.** The caller fit the wire to the
      // window, but the body it sends carries the tool definitions as well,
      // and a fit that does not know them sends a request the engine
      // refuses — a 400, before there is any measurement of the engine's own
      // to go by. The older half of the history goes first, the way the
      // Room recovers (crates/kalsa-door/src/room/turn.rs:364), and a wire
      // that still does not fit is refused here rather than sent.
      while (fit !== null && !nextRoundFits() && shedOlderHalf(conversation)) {
        // Each pass re-measures what is left.
      }
      if (fit !== null && !nextRoundFits()) {
        throw new ChatRequestError("oversize", "Context exceeded", undefined, url);
      }
    } else {
      fitHistory();
      if (!nextRoundFits() && pending > 0) {
        closingForSpace = true;
        // Words, not calls: the round that closes the turn answers.
        forceWords = true;
        logUiEvent("chat.turn_closed_for_space");
        // The closing request is the body the engine has already read: the
        // copy kept of the last accepted round. Nothing is shed and nothing
        // is retried on this path — the thread the model reads is the
        // thread it read, and the only thing added to it is the execution
        // status (and only if that still fits).
      }
    }
    const last = forceWords || round >= toolRounds;
    // Hiding invented markup is for the capped round alone: the round that asks
    // a silent model for words can be answering "show me the tags", and eating
    // that is how the answer disappeared in the first place.
    const hideInventedCalls = tools.length > 0 && (round >= toolRounds || closingForSpace);
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
    // The final request needs execution state as well as tool_choice.
    // **A turn closing for space carries the wire the engine has already
    // read**, not the exchange it has not: that exchange is the one that did
    // not fit, and the model is answered from what it really saw.
    //
    // **And the status is a message of its own, at the end.** The engine keeps
    // the prefix of what it has read only when the new prompt changes none of
    // it: measured on the engine (Qwen3.6, the turn of 21 October 2026), a
    // request that rewrites a message the engine had read comes back with
    // `cache 0` — the whole thread to read again, 62558 tokens in 205 seconds
    // — and its answer arrives after the door has stopped waiting for it. A
    // status folded into the last tool result rewrites exactly such a
    // message. Appended, the status leaves everything the engine read where
    // it was: the prefix is kept (56036 of 56084 tokens reused, 0.58 s of
    // prefill instead of 147 s), and the model still reads the sentence that
    // tells it the calls are over.
    let messages = closingForSpace ? acceptedWire() : conversation;
    if (last && !statusSent && calledTool) {
      const marked = withFinalStatus(messages);
      if (marked !== null && (!closingForSpace || closingCarriesStatus(marked))) {
        messages = marked;
        statusSent = true;
      }
    }
    let answered: Round;
    try {
      answered = await askRound(
        messages,
        tools,
        last ? "none" : "auto",
        hideInventedCalls,
        hold,
        reason,
        !closingForSpace,
      );
    } catch (error) {
      // The round died on the way out, so it never stands: nothing it held is
      // sent. The answer text still settles as it always has.
      reason?.drop();
      hold?.settle(false);
      throw error;
    }
    // The request that carried the conversation is the one the engine read:
    // its size is now known, and everything added from here on is unsent.
    if (answered.promptTokens !== null) {
      measured = answered.promptTokens;
      measuredBase = wireEstimate(messages);
      // The engine's count covers what was added since the last count: the
      // pessimistic counters start again from nothing.
      addedToolChars = 0;
      addedOtherChars = 0;
      shedTokens = 0;
    }
    // **The body the engine accepted, kept as it was.** This is the copy the
    // closing request is built from: the conversation moves on, this does
    // not.
    accepted = messages.map((message) => ({ ...message }));
    pending = 0;
    // The turn was closed for space: the person is told, in a line of their
    // own language, that the answer is what the turn found before it stopped.
    if (closingForSpace) options.onClosedForSpace?.();
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
      await askRound(conversation, [], "none", false, null);
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
        // The capped round is the last one: a round that showed nothing would
        // end the turn blank.
        if (last && answered.text.trim() === "") {
          options.onToken(say.noRoundLeft);
          logUiEvent("chat.cap_no_answer");
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
        { say, runTool: runTool!, onToolRun: noteRun, signal, url, conversation, browse: options.browse === true },
      );
      results.push(answer.result);
      wireTexts.push(answer.wire);
    }
    calledTool = true;

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
    // The exchange is on the conversation but has not been sent: the engine has
    // not read it, so it is what a turn closing for space leaves out.
    pending += 1 + named.length;
    // **What the exchange adds, in characters.** The tool results' own bodies
    // are the part a character count gets most wrong — a page is denser than
    // prose by a factor no house rule knows — so they are counted apart from
    // the rest, and the pessimistic rule weighs them.
    for (const result of results) addedToolChars += result.length;
    for (const text of wireTexts) addedOtherChars += text.length;
  }
}

/**
 * The execution status, as a message of its own at the end of the wire.
 *
 * **It used to be folded into the last tool result, and that is what cost the
 * closing request its prefix.** The engine keeps what it has read only while
 * the new prompt changes none of it: a request that rewrites a message the
 * engine had read comes back with `cache 0` — the whole thread to read again
 * (62558 tokens, 205 seconds) — and its answer arrives after the door has
 * stopped waiting for it. The fold rewrote exactly such a message: the last
 * tool result, which the engine had read.
 *
 * As a message of its own the status leaves everything the engine read where
 * it was: the wire it gets is the wire it had, plus one sentence at the end.
 * The prefix is kept — 56036 of 56084 tokens reused, 0.58 s of prefill where
 * the fold cost 147 s — and the model still reads the sentence that tells it
 * the calls are over.
 */
function withFinalStatus(conversation: WireMessage[]): WireMessage[] | null {
  if (conversation.length === 0) return null;
  return [...conversation, { role: "user", content: FINAL_STATUS }];
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
