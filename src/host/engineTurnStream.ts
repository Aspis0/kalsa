/**
 * Phase 4 of the lifted engine turn — the static-prefix prewarm, the
 * KALSA_WINDOW line, history assembly, the persona tails, the image caps,
 * the memory-facts bound and the single `streamAssistantTurn` call with its
 * one `bridgeEngineCallbacks` (D2 row 11: the bridge is called once).
 *
 * Two textual adaptations (reported): the two writes back into the core's
 * closure arrive as hooks — `setAssistantFull` for the stream's full-text
 * mirror and `markFailed` for the error flag — the rest is lifted text.
 */
import { assembleEngineHistory } from "../context/compactor";
import { WINDOW_CHARS_PER_TOKEN } from "../context/windowProfile";
import {
  queueStaticPrefixPrewarm,
  type EngineMessage,
} from "../engine/engineBackend";
import { streamHostTurn } from "./engineBackendStream";
import { hostStreamErrorText } from "./remoteEngineError";
import { applyPersonaTail } from "../engine/personaTail";
import { boundMemoryFacts } from "../memory/dnaBounding";
import { formatMemoryLine } from "../memory/memoryTelemetry";
import * as MemoryStore from "../memory/MemoryStore";
import { mapSearchSourcesToChat } from "../agent/webSearchTool";
import { bridgeEngineCallbacks } from "../app/engineCallbackBridge";
import { forceRebuildByChat } from "./turnCorpus";
import type { EngineTurnDeps } from "./engineTurnDeps";
import type { CompactorRun } from "./engineTurnCompactor";

/** The core's closure, handed in because this phase writes two of its vars. */
export interface StreamTurnHooks {
  armMemoryExtract: () => void;
  finish: () => void;
  markFailed: () => void;
  setAssistantFull: (full: string) => void;
}

export async function streamEngineTurn(
  deps: EngineTurnDeps,
  run: CompactorRun,
  turn: StreamTurnHooks,
): Promise<void> {
  const {
    locale,
    agentOptions,
    agentOptionsRef,
    recordDecodeSample,
    memoryEnabledRef,
    injectedFactsRef,
  } = deps;
  const {
    text,
    chatId,
    signal,
    callbacks,
    attachments,
    promptText,
    validatedHistory,
    contextMode,
    hasImages,
    turnCiswireFlags,
  } = run.inputs;
  const {
    armMemoryExtract,
    finish,
    markFailed,
    setAssistantFull,
  } = turn;
  const {
    nativeClearedForAssemble,
    historyLengths,
    currentTurnChars,
    legacyWindowStart,
    anchoredHistoryDropped,
    anchoredRebuildBudget,
    measuredCharsPerToken,
    windowTokens,
    kvHeld,
    nPast,
    lastSaveTokens,
    loadedB,
    hasDigest,
    operativeContext,
    boundaryForAssemble,
    windowSlideForCeiling,
    anchoredOn,
    persona,
    promptFacts,
  } = run;

            // A slide's clearCache does not spare the static prefix — same
            // native cache — so without this the send below re-prefills ~1832
            // tokens of system prompt and tool schemas it already paid for.
            // Awaited on purpose: the promise resolves once the job is
            // ENQUEUED, which is the ordering guarantee we need — the restore
            // must sit in front of this send's completion in the FIFO, or the
            // completion arrives first and the prewarm is skipped for holding
            // chat KV.
            if (nativeClearedForAssemble) {
              try {
                await queueStaticPrefixPrewarm(
                  locale,
                  agentOptionsRef.current.tools,
                );
              } catch {
                // The prewarm is an optimisation on top of this send, never a
                // precondition: the completion below prefills the same tokens
                // either way, and an awaited rejection here would fail the turn.
              }
            }

            // History assembly: legacy sliding window (off/ciswire) or boundary→end
            // (anchored — append-only growth between rebuilds, preserves KV prefix).
            // boundaryForAssemble is anchored-only; no non-anchored store of it
            // is read. One KALSA_WINDOW per send, after the slide block, so the
            // logged start is the one the engine actually gets.
            try {
              const windowChars =
                historyLengths
                  .slice(legacyWindowStart)
                  .reduce((sum, n) => sum + n, 0) + currentTurnChars;
              console.log(
                `KALSA_WINDOW ${JSON.stringify({
                  kvHeld,
                  nPast: nPast ?? null,
                  lastSaveTokens: lastSaveTokens ?? null,
                  loadedB,
                  hasDigest,
                  legacyWindowStart,
                  // Present only when the anchored rebuild had to drop history:
                  // counts and a constant name, never message text.
                  historyDropped: anchoredHistoryDropped,
                  // The budget the rebuild walked against, and its kind — 0 from
                  // a consumed ceiling and 2304 from a profile budget are not
                  // the same event.
                  rebuildBudgetChars: anchoredRebuildBudget?.chars,
                  rebuildBudgetSource: anchoredRebuildBudget?.source,
                  textEst: Math.ceil(windowChars / WINDOW_CHARS_PER_TOKEN),
                  measuredCharsPerToken: measuredCharsPerToken ?? null,
                  windowTokens: windowTokens ?? null,
                })}`,
              );
            } catch {
              // telemetry must never throw
            }
            const assembled = assembleEngineHistory(validatedHistory, {
              compactionEnabled: contextMode === "anchored",
              hasImages,
              boundaryIndex: boundaryForAssemble,
              legacyWindowStart,
            });
            // `persona` was resolved at the char-budget walk above: the same
            // lookup prices the tails and applies them, so budget and prompt
            // cannot disagree mid-send. Keep modelEmittedText so hybrid KV
            // replay is byte-identical to the original completion.
            const engineMessages: EngineMessage[] = assembled.map((m) => {
              const msg: EngineMessage = {
                role: m.role,
                content:
                  m.role === "user"
                    ? applyPersonaTail(m.content, persona?.instructions)
                    : m.content,
              };
              if (
                m.role === "assistant" &&
                typeof m.modelEmittedText === "string" &&
                m.modelEmittedText.length > 0
              ) {
                msg.modelEmittedText = m.modelEmittedText;
                if (m.emissionSource !== undefined) {
                  msg.emissionSource = m.emissionSource;
                }
              }
              return msg;
            });

            // Images attached to the last user message (cap 5): direct
            // images + rendered PDF pages.
            const images: string[] = [];
            for (const attachment of attachments ?? []) {
              if (images.length >= 5) break;
              if (attachment.kind === "image" && attachment.uri) {
                images.push(attachment.uri);
              } else if (attachment.kind === "pdf" && attachment.pages?.length) {
                for (const page of attachment.pages) {
                  if (images.length >= 5) break;
                  images.push(page);
                }
              }
            }
            // Last-user composition (engine, format B):
            //   factsBlock + "\n\n" + applyPersonaTail(userText, persona)
            // Persona applied here; facts are prefixed in streamAssistantTurn
            // so they never rewrite the system prefix.
            const lastUserHistoryContent = applyPersonaTail(
              promptText,
              persona?.instructions,
            );
            const userMessage: EngineMessage = {
              role: "user",
              content: lastUserHistoryContent,
            };
            if (images.length) userMessage.images = images;
            engineMessages.push(userMessage);

            // Bound at send so echo-guard + telemetry see the same kept set
            // the assembly injects (pure; the assembly site bounds again).
            // promptFacts was hoisted above the ceiling guard so the system
            // estimate and this send price the same facts.
            if (memoryEnabledRef.current) {
              const dna = boundMemoryFacts(promptFacts);
              MemoryStore.trackMemoryInjection(dna.health.injectedCount);
              MemoryStore.trackMemoryDnaBound(
                dna.health.deferredCount,
                dna.health.injectedCount,
                dna.health.budgetTokens,
              );
              injectedFactsRef.current = dna.keptTexts;
            } else {
              MemoryStore.trackMemoryInjection(0);
              injectedFactsRef.current = [];
            }

            await streamHostTurn(
              engineMessages,
              bridgeEngineCallbacks(callbacks, {
                onDeltaFull: (full) => {
                  setAssistantFull(full);
                },
                mapSource: (sources) => mapSearchSourcesToChat(sources, locale),
                onDone: () => {
                  // Emit turn telemetry before extraction is armed. Extraction
                  // fields are explicitly not applicable here; the settled line
                  // is the only source of truth for them.
                  MemoryStore.trackMemoryEnabled(memoryEnabledRef.current);
                  const turnTelemetry = MemoryStore.getAndResetMemoryTelemetry();
                  const memTelemetry = {
                    ...turnTelemetry,
                    factsExtracted: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                    factsStored: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                    factsRejectedFull: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                    totalFactsInStore: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                    extractParseOutcome: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                    extractGateSource: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                    extractStopReason: MemoryStore.MEMORY_TELEMETRY_NOT_APPLICABLE,
                    ciswireFlags: turnCiswireFlags || undefined,
                  };
                  console.log(formatMemoryLine(memTelemetry));
                  // Arm extract (memoryExtractRef) before unlocking; gate opens
                  // only after AiChatPage's turn-end save settles.
                  armMemoryExtract();
                  finish();
                },
                onError: (error) => {
                  markFailed();
                  // context_full + an anchored window → force boundary rebuild
                  // next send. ciswire keeps the legacy window; rebuild would
                  // not shrink it.
                  if (
                    contextMode === "anchored" &&
                    error &&
                    typeof error === "object" &&
                    (error as { code?: string }).code === "context_full"
                  ) {
                    forceRebuildByChat.set(chatId, true);
                  }
                  const shownError = hostStreamErrorText(error.message, deps.t);
                  callbacks.onDelta?.(`⚠️ ${shownError}`, `⚠️ ${shownError}`);
                  try {
                    // The engine's own sentence, or humanized remote reason.
                    callbacks.onFailedReason?.(shownError);
                    callbacks.onFailed?.("chat.serviceUnreachable");
                  } catch {
                    // ignore
                  }
                  finish();
                },
              }),
              signal,
              {
                ...agentOptions,
                locale,
                memoryFacts: promptFacts,
                operativeContext,
                lastUserMessage: text,
                lastUserBare: lastUserHistoryContent,
                assembleBoundary: anchoredOn
                  ? boundaryForAssemble
                  : legacyWindowStart,
                assembleChatId: chatId,
                contextMode,
                ceilingSlide: windowSlideForCeiling,
                onDecodeSample: recordDecodeSample,
                ciswireFlags: turnCiswireFlags || undefined,
              },
            );
            // Safety: if the stream returns without onDone/onError (e.g. abort path).
            // Arm extract (no-ops if aborted/empty); gate opens post-save.
}
