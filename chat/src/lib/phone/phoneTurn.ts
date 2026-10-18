// One phone turn, run by this window's own loop with the desktop's tools and
// its mail. It reads and writes nothing of the desktop chat: no store, no slot
// activation, no thread.

import { ChatRequestError, fetchSamplingDefaultsWithStatus, serverBase } from "../chat";
import type { WireMessage } from "../chat";
import { streamChatCompletion } from "../toolLoop";
import { armedConversation, executeToolCall, offeredTools } from "../tools/registry";
import type { ToolDefinition } from "../tools/definitions";
import { MAIL_NAMES } from "../tools/definitions";
import { browserOutcomesNote, takeOutcomes } from "../browser/confirm";
import { CONTEXT_RESERVE_TOKENS, wireSize } from "../attachments";
import { loadSampling, samplingWire } from "../sampling";
import { loadThinking, thinkingSupport } from "../thinking";
import { TABLES } from "../../i18n";
import type { Language } from "../../i18n";
import type { LiveSettings } from "../types";
import type { PhoneSink } from "./phoneEvents";
import type { PhoneTurn } from "./phoneRequest";
import { phoneWire } from "./phoneWire";

const FACTS_TIMEOUT_MS = 8000;

/**
 * The desktop's tool list, less what this phone may not have: no mini app it
 * cannot draw, and no mail at all unless the owner has that phone switched on
 * in Settings → Mail. The whole mailbox goes, `mail_show` with it — that one
 * draws the cards itself, so a phone that keeps it would still put the
 * owner's mail in front of the person.
 */
/**
 * The tools a phone turn may call.
 *
 * **The browser is one of them, when the turn names its phone.** A paired phone
 * is the owner's own device and it drives the same browser the desktop drives,
 * under the same web switch and the same rules — and a write still needs the card
 * and the answer. What a phone may not have is a card it cannot be shown: without
 * a device there is nobody who could answer, so an unidentified turn is offered
 * the reads and nothing that could hold a request. Better no write than a write
 * nobody is ever asked about.
 *
 * A stranger's phone cannot reach this window at all: the bridge binds a request
 * to a paired device and a credential before the page is told a request exists.
 */
export function phoneTools(
  webTools: boolean,
  language: Language,
  model: string,
  mail: boolean,
  device: string | null,
  /** Whether this conversation holds mail or documents — the desktop's own
   * question, asked the same way. See `armedConversation`. */
  armed = false,
): ToolDefinition[] {
  const writable = device !== null && !armed;
  return offeredTools(webTools, language, model).filter(
    (tool) =>
      tool.function.name !== "create_miniapp" &&
      (writable || !BROWSER_WRITES.has(tool.function.name)) &&
      (mail || !MAIL_NAMES.has(tool.function.name)),
  );
}

/**
 * **A phone that is holding its owner's mail does not type into websites.**
 *
 * The card is not what this rule is about. A card is a request the *person* is
 * asked about, and a page navigation needs no card at all: a click that goes
 * somewhere, or a search box the model fills and presses Enter on, leaves the
 * computer without anything on a screen for the owner to say yes to. So on the
 * desktop the answer is a gate and an ask; a phone has nobody to ask — the person
 * holding the phone is not necessarily the one who reads the mail — so the answer
 * is no, in one plain line, and it is the same line whoever is holding the phone.
 *
 * **Refused, not merely un-offered.** An offer is something the model can write
 * past: a turn can name a tool the list did not have, and this one is called from
 * a phone whose tools the model did not see. So the same sentence answers a call
 * that arrives anyway, at [`runPhoneTurn`]'s own gate.
 */
const ARMED_REFUSAL =
  "Kalsa won't type into a website in a chat that holds your mail or documents.";

/** Whether this phone's conversation holds mail or documents. The same predicate
 * the desktop's gate asks, with the same reason: a phone pins no documents, so
 * the mail half is all there is. */
export function phoneArmed(conversation: WireMessage[] | undefined): boolean {
  // **A turn with no conversation to read is not holding mail.** The loop hands
  // its messages to every tool call, and this is one of the few callers that does
  // not own them; a caller that passed none is not a reason to end the turn with a
  // crash, and it certainly is not a reason to offer a write.
  return Array.isArray(conversation) && armedConversation(conversation);
}

/** The three browser tools that can put something in front of a person and so
    need a phone to put it in front of. The reads drive the browser and are
    offered either way: without a card to answer, reading is harmless. */
const BROWSER_WRITES = new Set(["browser_click", "browser_type"]);

/**
 * The conversation one phone's browser calls are stamped with.
 *
 * **One per device, and the same rule the Rust side uses**, because both halves
 * have to agree on what "this phone's card" means. A desktop conversation is a
 * UUID, so this prefix can never collide with one.
 */
export function phoneConversation(device: string): string {
  return `phone:${device}`;
}

export async function runPhoneTurn(
  turn: PhoneTurn,
  settings: LiveSettings,
  sink: PhoneSink,
  signal: AbortSignal,
  mail: boolean,
  deps = { loop: streamChatCompletion, facts: fetchSamplingDefaultsWithStatus },
): Promise<void> {
  if (!settings.endpoint) return sink.fail("engine");
  // The engine's own facts, read now: a model switch applies to the next turn.
  const facts = await deps.facts(serverBase(settings.endpoint), FACTS_TIMEOUT_MS, settings.token);
  if (signal.aborted) return sink.fail("cancelled");
  const wire = phoneWire(
    turn,
    {
      vision: facts.modalities.vision,
      think: thinkingSupport(facts.chatTemplate).enableThinking,
      nctx: facts.nctx,
    },
    new Date(),
  );
  if (wire.status === "refused") return sink.fail("bad_request");
  const openedFor = turn.replyFor ?? undefined;
  // **This turn is this phone's own conversation**, for the browser: it is what a
  // card is stamped with, what decides the phone that is shown it, and what the
  // outcome comes back under. A turn with no device has no conversation, and so
  // no card and no writes.
  const conversation = turn.device === null ? "" : phoneConversation(turn.device);
  // What became of a request the person was asked about since this phone last
  // spoke, drained **for this phone only** and carried like the mail note, read by
  // the model alone. An outcome belongs to the phone that was asked.
  const browserNote = browserOutcomesNote(takeOutcomes(conversation));
  const said = wire.wire.map((message, at) =>
    at === wire.wire.length - 1 && browserNote !== "" ? { ...message, browserNote } : message,
  );
  // **Whether this chat is holding the owner's mail**, asked of the wire the
  // model is about to be given — so the *offer* is right for a phone that starts
  // the turn holding it.
  //
  // **And it latches.** Asking the conversation again at each call catches the
  // usual way a chat becomes armed, but only while the conversation still says
  // so: a wire trimmed to fit, a mail result cut by the context budget, an answer
  // that arrives as an error instead of fenced mail. None of those un-reads
  // anything — the model has the mail either way, and may well have it in the
  // round it is answering from. So the moment **any** mail tool runs in this turn
  // the flag is set and stays set for the rest of the turn, and a write into a
  // chat that has read the owner's mail is refused whatever the wire now says.
  let armed = phoneArmed(said);
  try {
    await deps.loop({
      endpoint: settings.endpoint,
      token: settings.token,
      model: settings.model,
      messages: said,
      contextFit:
        facts.nctx === null
          ? null
          : { budget: Math.max(0, facts.nctx - CONTEXT_RESERVE_TOKENS), size: wireSize },
      sampling: samplingWire(loadSampling()),
      signal,
      tools: phoneTools(settings.webTools, turn.language, settings.model, mail, turn.device, armed),
      // The phone cannot ask, so its web calls never wait on the gate. What still
      // applies: a search or page whose address the conversation never showed is
      // refused (fetchProvenanceRefusal, searchQueryRefusal). No sensitive-data
      // detection runs on the phone.
      runTool: async (name, args, runSignal, saidByLoop) => {
        // **The latch, first**: a mail tool that runs at all has read the owner's
        // mail, whatever its answer turned out to be. Set before anything else
        // looks at the name, so a mail tool cannot be the call that slips through.
        if (MAIL_NAMES.has(name)) armed = true;
        // **Then the question, of the conversation the loop is reading** — and
        // the latch, so the answer is yes even if the wire no longer shows why.
        //
        // **The offer is not the rule; this is.** A model can name a tool it was
        // never offered, and the list was chosen before this turn read a single
        // mail — which is the usual way a chat becomes armed, one tool call after
        // the tools were fixed. A write into a chat that holds the owner's mail is
        // refused in one plain line, whoever asks and whenever it arrives.
        if ((armed || phoneArmed(saidByLoop)) && BROWSER_WRITES.has(name)) {
          return { text: ARMED_REFUSAL, ok: false, resultCode: "web.armed" };
        }
        return executeToolCall(
          name,
          args,
          runSignal,
          null,
          // The loop's own messages, read by the web_fetch provenance rule: a
          // phone turn has them too, and the rule is the desktop's.
          saidByLoop,
          settings.model,
          openedFor,
          undefined,
          settings.webTools,
          // **This turn is this phone's chat**, for everything the browser stamps
          // with a conversation: a card is raised, drawn and answered under it,
          // and its outcome rides this phone's next turn. Empty when the turn
          // named no phone, which is why such a turn is offered no writes.
          conversation,
        );
      },
      onToolRun: sink.toolRun,
      toolPhrases: TABLES[turn.language].tools,
      thinking: loadThinking(settings.model),
      // The phone cannot take a frame back: a round that turns out to be a
      // refusal must send its reasoning only if the round stands.
      holdReasoning: true,
      onReasoning: sink.reasoning,
      onToken: sink.delta,
      // This turn runs for a phone: the log says `phone.tool.<name>`, so a
      // stranger's phone asking for the owner's mail is not this computer's
      // own turn wearing the same line.
      phone: true,
    });
  } catch (error) {
    return sink.fail(failureCode(error, signal));
  }
  return signal.aborted ? sink.fail("cancelled") : sink.done();
}

/** The protocol's codes (docs/PHONE-CHAT-PROTOCOL.md §3). The chat's own failure
    kinds have no phone code of their own, so anything not named here is `engine`. */
function failureCode(error: unknown, signal: AbortSignal): string {
  if (signal.aborted || (error instanceof ChatRequestError && error.kind === "aborted")) return "cancelled";
  if (error instanceof ChatRequestError && error.kind === "oversize") return "bad_request";
  return "engine";
}
