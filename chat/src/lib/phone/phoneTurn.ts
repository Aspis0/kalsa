// One phone turn, run by this window's own loop with the desktop's tools and
// its mail. It reads and writes nothing of the desktop chat: no store, no slot
// activation, no thread.

import { ChatRequestError, fetchSamplingDefaultsWithStatus, serverBase } from "../chat";
import { streamChatCompletion } from "../toolLoop";
import { executeToolCall, offeredTools } from "../tools/registry";
import type { ToolDefinition } from "../tools/definitions";
import { MAIL_NAMES } from "../tools/definitions";
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
function phoneTools(webTools: boolean, language: Language, model: string, mail: boolean): ToolDefinition[] {
  return offeredTools(webTools, language, model).filter(
    (tool) =>
      tool.function.name !== "create_miniapp" &&
      (mail || !MAIL_NAMES.has(tool.function.name)),
  );
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
  try {
    await deps.loop({
      endpoint: settings.endpoint,
      token: settings.token,
      model: settings.model,
      messages: wire.wire,
      contextFit:
        facts.nctx === null
          ? null
          : { budget: Math.max(0, facts.nctx - CONTEXT_RESERVE_TOKENS), size: wireSize },
      sampling: samplingWire(loadSampling()),
      signal,
      tools: phoneTools(settings.webTools, turn.language, settings.model, mail),
      // The phone cannot ask, so its web calls never wait on the gate. What still
      // applies: a search or page whose address the conversation never showed is
      // refused (fetchProvenanceRefusal, searchQueryRefusal). No sensitive-data
      // detection runs on the phone.
      runTool: (name, args, runSignal, conversation) =>
        executeToolCall(name, args, runSignal, null, conversation, settings.model, openedFor),
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
