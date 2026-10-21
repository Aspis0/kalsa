// One phone turn, run by this window's own loop with the desktop's tools and
// its mail. It reads and writes nothing of the desktop chat: no store, no slot
// activation, no thread.

import { ChatRequestError, fetchSamplingDefaultsWithStatus, serverBase } from "../chat";
import type { WireMessage } from "../chat";
import { streamChatCompletion } from "../toolLoop";
import { armedConversation, executeToolCall, offeredTools } from "../tools/registry";
import type { ToolDefinition } from "../tools/definitions";
import { MAIL_NAMES } from "../tools/definitions";
import { BROWSER_NAMES, BROWSER_SCREENSHOT_NAME } from "../tools/browserTools";
import { closeRecap, sayRuns, takeNote } from "../browser/note";
import { recapLine } from "../browser/recap";
import { isBrowserRun } from "../browser/runs";
import { filed, newLedger } from "../callLedger";
import { ANSWER_RESERVE_TOKENS, wireSize } from "../attachments";
import { loadSampling, samplingWire } from "../sampling";
import { loadThinking, thinkingSupport } from "../thinking";
import { TABLES } from "../../i18n";
import type { Language } from "../../i18n";
import type { LiveSettings, ToolRun } from "../types";
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
 * **The browser is not one of them, and this is a change on purpose.** The
 * desktop's browser turn is armed by a person at the screen, one message at a
 * time, by a control that says so; a phone has no such control, so a phone
 * turn is never a browser turn — and a turn that cannot be armed is a turn
 * that cannot be finished: the browser's tools raise cards, and a card needs
 * somebody to answer it. **The phone stays in web-only mode** until it has a
 * control of its own.
 *
 * What a phone may not have is a card it cannot be shown: without a device
 * there is nobody who could answer, so an unidentified turn is offered the
 * reads and nothing that could hold a request. Better no write than a write
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
  return offeredTools(webTools, language, model, "web").filter(
    (tool) =>
      tool.function.name !== "create_miniapp" &&
      // **No browser on a phone.** The rule is here as well as in the mode the
      // offer is built with, so it survives a change to that offer: the
      // filter below is what a phone may not have, and the browser's tools
      // are not on the list at all.
      !BROWSER_NAMES.has(tool.function.name) &&
      // **And no picture of the page, said in its own words.** The picture is
      // one of the browser's names, so the line above already keeps it off a
      // phone; this one says why, because a picture of the owner's page is
      // the one thing a phone must never be able to ask for.
      tool.function.name !== BROWSER_SCREENSHOT_NAME &&
      // The second line, kept as it was: it is what a phone may not have
      // without a device, and a rule that is not drawn cannot be broken.
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
 * **Which phone chats are holding their owner's mail.** One map, on this
 * computer, keyed by the phone's own conversation.
 *
 * **The wire is not a safe place to keep it, and that is the whole reason this
 * is here.** Asking the turn's messages only reads what the phone chose to send:
 * a phone that strips mail from its history — which is sensible of it, and is
 * exactly what it does — arrives on turn N+1 with a conversation that no longer
 * contains the mail read on turn N, and a chat that has read the owner's mail
 * would quietly be offered the browser's writes again. The latch inside one turn
 * fixed the same hole for the turns of one request; this is the same fact kept
 * for as long as the chat lasts.
 *
 * **A new chat starts unarmed**, because that is the only thing a person does to
 * put it behind them, and **a reply to a mail is armed from its first word** —
 * the person pressed "draft a reply", so the mail is in the turn whatever the
 * phone's wire says about it.
 */
const armedChats = new Map<string, boolean>();

/** Whether this turn is the start of a new chat: nothing in it is an earlier
 * assistant turn, so there is nothing behind it to still be holding mail. */
function is_a_new_chat(turn: PhoneTurn): boolean {
  return !turn.messages.some((message) => message.role === "assistant");
}

/**
 * What this turn does to its chat's armed state, and what it finds.
 *
 * **Called once, at the start of a turn** — it has side effects, and a reader
 * that cleared the very thing it was asked about would be no reader at all. A
 * turn that starts a new chat puts the old one behind them; a turn that answers a
 * mail arms its chat, because the person pressed "draft a reply" and the mail is
 * in the turn whatever the phone's wire says about it.
 */
export function phoneChatArmed(conversation: string, turn: PhoneTurn): boolean {
  if (is_a_new_chat(turn)) armedChats.delete(conversation);
  if (turn.replyFor !== null && turn.replyFor !== undefined) armedChats.set(conversation, true);
  return phoneChatArmedHere(conversation);
}

/** Whether this phone's conversation is armed, and nothing else. The reader the
 * proofs use, and the one a caller that only wants to know should use. */
export function phoneChatArmedHere(conversation: string): boolean {
  return armedChats.get(conversation) === true;
}

/** Forgets a phone's armed state — the computer's half of an unpair. Nothing else
 * clears it: a new chat and a mail reply both do, and those are the only two
 * things a person can do from a phone. */
export function forgetArmedChat(conversation: string): void {
  armedChats.delete(conversation);
}

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
  // **This turn is this phone's own conversation**, for the browser: it is what a
  // card is stamped with, what decides the phone that is shown it, and what the
  // outcome comes back under. A turn with no device has no conversation, and so
  // no card and no writes.
  const conversation = turn.device === null ? "" : phoneConversation(turn.device);
  // **The armed state, read once, at the start of the turn** — the flag has
  // side effects, and a reader that cleared the very thing it was asked about
  // would be no reader at all.
  const armedChat = phoneChatArmed(conversation, turn);
  // **The offer this turn makes, built before the wire.** The definitions
  // travel with every request and the engine counts them into the prompt, so
  // the fit weighs them beside the conversation — and it weighs the exact
  // list the loop will send: a phone is never offered the browser's tools,
  // and those are the only ones arming takes away, so the phone's list is
  // the same armed or not.
  const offered = phoneTools(settings.webTools, turn.language, settings.model, mail, turn.device, armedChat);
  const wire = phoneWire(
    turn,
    {
      vision: facts.modalities.vision,
      think: thinkingSupport(facts.chatTemplate).enableThinking,
      nctx: facts.nctx,
    },
    new Date(),
    offered,
  );
  if (wire.status === "refused") return sink.fail("bad_request");
  const openedFor = turn.replyFor ?? undefined;
  // What this turn has already done with the browser, and what it failed at.
  const calls = newLedger();
  // **What Kalsa did, said once at the end of the turn** — on the phone as on the
  // desktop, and from the same runs, so the two can never disagree.
  const done: ToolRun[] = [];
  const closeTurn = (): void => {
    if (!done.some((run) => isBrowserRun(run.name))) return;
    // The runs go to the model on this phone's next turn; the line goes out with
    // this one, on every ending. Same record, same words as the desktop draws.
    sayRuns(conversation, done);
    const said = closeRecap(conversation, done);
    if (said === null) return;
    sink.recap(recapLine(said, TABLES[turn.language].tools.recap));
  };
  // What became of a request the person was asked about since this phone last
  // spoke, drained **for this phone only** and carried like the mail note, read by
  // the model alone. An outcome belongs to the phone that was asked.
  //
  // **On the wire, not beside it.** A rider the wire builder does not read is
  // a rider that never reaches the model, and a recap the model cannot read is
  // not a note — it is a line the desktop keeps and the phone silently loses.
  const browserNote = takeNote(conversation, TABLES[turn.language].tools.recap);
  const said = browserNote === "" ? wire.wire : [...wire.wire, noteMessage(browserNote)];
  // **Whether this chat is holding the owner's mail**, asked of the wire the
  // model is about to be given — so the *offer* is right for a phone that starts
  // the turn holding it.
  //
  // **And it latches for the rest of the turn, and for the chat.** Asking the conversation again at each call catches the
  // usual way a chat becomes armed, but only while the conversation still says
  // so: a wire trimmed to fit, a mail result cut by the context budget, an answer
  // that arrives as an error instead of fenced mail. None of those un-reads
  // anything — the model has the mail either way, and may well have it in the
  // round it is answering from. So the moment **any** mail tool runs in this turn
  // the flag is set and stays set for the rest of the turn, and a write into a
  // chat that has read the owner's mail is refused whatever the wire now says.
  let armed = armedChat || phoneArmed(said) || turn.replyFor !== null;
  try {
    await deps.loop({
      endpoint: settings.endpoint,
      token: settings.token,
      model: settings.model,
      messages: said,
      contextFit:
        facts.nctx === null
          ? null
          : { budget: Math.max(0, facts.nctx - ANSWER_RESERVE_TOKENS), size: wireSize },
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
        if (MAIL_NAMES.has(name)) {
          armed = true;
          if (conversation) armedChats.set(conversation, true);
        }
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
        const answered = executeToolCall(
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
          // **A phone turn has the browser's ledger too.** It drives the same
          // browser the desktop drives, so the same action failing twice is the
          // same loop, and the same code is what ends it.
          calls,
        );
        return answered.then((outcome) => {
          filed(calls, name, args, outcome);
          return outcome;
        });
      },
      onToolRun: (run: ToolRun) => {
        done.push(run);
        sink.toolRun(run);
      },
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
    closeTurn();
    return sink.fail(failureCode(error, signal));
  }
  closeTurn();
  return signal.aborted ? sink.fail("cancelled") : sink.done();
}

/**
 * The recap, as a message the model reads.
 *
 * **A word on the wire, not a property beside it.** The desktop rides the note
 * on the person's own message, where `attachments.ts` folds it into the content
 * that is sent; a phone builds its wire by itself and nothing there folds a
 * rider in, so a note left on the side would be dropped before the request was
 * made. This is one plain message saying the same thing — the same line, the
 * same fence — and it is the last thing in the request, so it is read last.
 */
function noteMessage(note: string): WireMessage {
  return { role: "user", content: note };
}

/** The protocol's codes (docs/PHONE-CHAT-PROTOCOL.md §3). The chat's own failure
    kinds have no phone code of their own, so anything not named here is `engine`. */
function failureCode(error: unknown, signal: AbortSignal): string {
  if (signal.aborted || (error instanceof ChatRequestError && error.kind === "aborted")) return "cancelled";
  if (error instanceof ChatRequestError && error.kind === "oversize") return "bad_request";
  return "engine";
}
