/**
 * Phase 1 of the lifted engine turn — the window scaffolding. Verbatim body;
 * the original `let` declarations become this function's locals and are
 * returned as `WindowFrame` for the two phases after it.
 */
import {
  chatKvIsHeld,
  discardChatKvForWindowSlide,
  getActiveEngineNCtx,
  getActiveModelId,
  getLoadedAssembleBoundary,
} from "../engine/engineBackend";
import {
  chatKvLastSaveTokens,
  chatKvNPast,
  getAttemptedAssembleStart,
} from "../engine/LlamaService";
import { getBenchLegacyWindow } from "../bench/benchConfig";
import {
  assembleStartForLiveKv,
  kvHeldForAssembleWindow,
  shouldReconcileAssembleStart,
  windowHasDigest,
} from "../engine/windowKvInvariant";
import { historyBudgetCharge, historyThinkPlacementForModel } from "../engine/modelEmittedText";
import { buildMemoryFactsBlock } from "../engine/memoryFactsTail";
import { applyPersonaTail } from "../engine/personaTail";
import { findPersona } from "../conversations/PersonasStore";
import { builtinCopyFromT } from "../screens/PersonasScreen";
import {
  LEGACY_MAX_CHARS,
  LEGACY_MAX_CHARS_IMAGES,
  resolveBoundaryIndex,
} from "../context/compactor";
import { resolveWindowProfile, windowStartIndex } from "../context/windowProfile";
import type { EngineTurnDeps, TurnInputs } from "./engineTurnDeps";

export async function prepareEngineWindow(
  deps: EngineTurnDeps,
  input: TurnInputs,
) {
  const { chatId, hasImages, validatedHistory, contextMode, promptText } = input;
  const {
    t,
    locale,
    memoryEnabledRef,
    memoryFactsRef,
    personasStateRef,
    activePersonaIdRef,
    currentModel,
  } = deps;
            const retrievalOn = contextMode === "ciswire";
            const anchoredOn = contextMode === "anchored";
            const legacyWindowMode =
              contextMode === "off" || contextMode === "ciswire";
            let operativeContext: { digest?: string; summary?: string } | null = null;
            let boundaryForAssemble = 0;
            // Set when this send follows a deliberate ceiling slide (below).
            let windowSlideForCeiling = false;
            // Named reason when the anchored rebuild dropped the whole history
            // (below), reported on the per-send KALSA_WINDOW line.
            let anchoredHistoryDropped: string | undefined;
            // The char budget that rebuild used and where it came from, so a
            // reader can tell a profile budget from a consumed ceiling.
            let anchoredRebuildBudget:
              | { chars: number; source: "ceiling" | "profile" }
              | undefined;
            let nativeClearedForAssemble = false;
            // The verbatim window, resolved from the context the engine
            // actually loaded (post-clamp) rather than a constant. A bench
            // override still wins, as a message cap with no char budget.
            //
            // Computed ONCE, as a start index, handed to both consumers: the
            // assembly takes the window and the ciswire corpus takes
            // everything outside it — if the two ever disagreed a message
            // would land in both, or in neither. One index makes them agree
            // by construction.
            const benchWindow = await getBenchLegacyWindow();
            const nPast = chatKvNPast();
            const lastSaveTokens = chatKvLastSaveTokens();
            const kvHeld = kvHeldForAssembleWindow({
              kvHoldsChatSession: chatKvIsHeld(),
              nPast,
              lastSaveTokens,
            });
            const loadedB = getLoadedAssembleBoundary(chatId);
            const attemptedStart = getAttemptedAssembleStart(chatId);
            const reconcileRequired = shouldReconcileAssembleStart({
              kvHeld,
              loadedB,
            });
            // Digest share shrinks the verbatim window. While live KV still
            // holds the full chat, that drop is n_common=0. Flag / nPast can
            // both be stale-false; last save tokens count.
            const hasDigest = windowHasDigest({ retrievalOn, kvHeld });
            const windowProfile =
              typeof benchWindow === "number"
                ? {
                    maxMessages: benchWindow,
                    charBudget: Number.POSITIVE_INFINITY,
                    source: `bench:${benchWindow}`,
                  }
                : resolveWindowProfile({
                    nCtx: getActiveEngineNCtx(),
                    hasImages,
                    hasDigest,
                  });
            // The turn being sent is appended AFTER this walk, so it must be
            // charged here or a long message would ride entirely outside the
            // budget — exactly the overflow the budget exists to stop. The
            // built turn carries promptText whole, so the charge is uncapped.
            //
            // Assembly also adds tails on top of stored text, and they ride in
            // the budget too: the persona frame applies to EVERY history user
            // at the send and its extra is content-independent, so
            // applyPersonaTail("") prices it exactly. The bounded facts block
            // rides the last user and — baked — prior user turns while on.
            const promptFacts = memoryEnabledRef.current
              ? memoryFactsRef.current
              : [];
            const persona = findPersona(
              personasStateRef.current,
              activePersonaIdRef.current,
              builtinCopyFromT(t),
            );
            const userTailChars =
              (persona?.instructions
                ? applyPersonaTail("", persona.instructions).length
                : 0) +
              (memoryEnabledRef.current && promptFacts.length > 0
                ? buildMemoryFactsBlock(locale, promptFacts).length
                : 0);
            const baseMessageCap = hasImages
              ? LEGACY_MAX_CHARS_IMAGES
              : LEGACY_MAX_CHARS;
            const currentTurnChars = promptText.length + userTailChars;
            const historyThink = historyThinkPlacementForModel(
              currentModel.preserveThinking,
            );
            // historyBudgetCharge prices each message as its BUILT length:
            // uncapped replay for assistant emissions (byte-identity), capped
            // stored text everywhere else. The array carries the only
            // legitimate cap, so every budget consumer passes Infinity as the
            // per-message cap — re-capping here would re-shave a long emission
            // back under the ceiling guard's eyes.
            const noPerMessageCap = Number.POSITIVE_INFINITY;
            const historyLengths = validatedHistory.map((m) =>
              historyBudgetCharge(m, { historyThink, baseMessageCap, userTailChars }),
            );
            let legacyWindowStart = legacyWindowMode
              ? windowStartIndex(
                  historyLengths,
                  {
                    ...windowProfile,
                    charBudget: Math.max(
                      0,
                      windowProfile.charBudget - currentTurnChars,
                    ),
                  },
                  noPerMessageCap,
                )
              : 0;
            if (!anchoredOn) {
              const computedStart = legacyWindowStart;
              legacyWindowStart = assembleStartForLiveKv({
                mode: contextMode,
                loadedB,
                computedStart,
                kvHeld,
                attemptedStart,
              });
              // loadedB travels in the .kvs metadata and can outlive a shrunk
              // history (clear / edit). Clamp it with the same rule a state
              // boundary gets, so `.slice(start)` can never run past the end
              // and silently drop the whole verbatim window.
              legacyWindowStart = resolveBoundaryIndex(
                { boundaryIndex: legacyWindowStart },
                validatedHistory.length,
              );
              if (computedStart !== legacyWindowStart) {
                try {
                  console.log(
                    `KALSA_SESSION ${JSON.stringify({
                      op: "window_align",
                      from: computedStart,
                      to: legacyWindowStart,
                    })}`,
                  );
                } catch {
                  // telemetry must never throw
                }
              }
            }
            // Off mode has no compactor block below. A held cache without a
            // same-chat boundary fact must still be cleared before a start-0
            // prompt is sent; relying on native partial removal is the hybrid
            // corruption path this protocol forbids.
            if (contextMode === "off" && reconcileRequired) {
              nativeClearedForAssemble = await discardChatKvForWindowSlide(
                getActiveModelId() ?? currentModel.id,
                chatId,
              );
              if (!nativeClearedForAssemble) {
                throw new Error(t("chat.serviceUnreachable"));
              }
              windowSlideForCeiling = true;
              try {
                console.log(
                  `KALSA_SESSION ${JSON.stringify({
                    op: "window_reconcile",
                    start: legacyWindowStart,
                    kvCleared: true,
                  })}`,
                );
              } catch {
                // telemetry must never throw
              }
            }
            // promptFacts is declared at the char-budget walk above: the
            // ceiling guard and this send price the same facts.
            // Ceiling-guard diagnostics: assigned inside the block below and
            // read by the KALSA_WINDOW telemetry after it (which is outside
            // the block, so these must be declared here). Off mode never runs
            // the guard, and null is the honest log there.
  return {
    inputs: input,
    retrievalOn,
    anchoredOn,
    operativeContext: operativeContext as { digest?: string; summary?: string } | null,
    boundaryForAssemble,
    windowSlideForCeiling,
    anchoredHistoryDropped,
    anchoredRebuildBudget,
    nativeClearedForAssemble,
    nPast,
    lastSaveTokens,
    kvHeld,
    loadedB,
    attemptedStart,
    reconcileRequired,
    hasDigest,
    windowProfile,
    promptFacts,
    persona,
    currentTurnChars,
    noPerMessageCap,
    historyLengths,
    legacyWindowStart,
  };
}

/** The frame's shape, inferred from the function that builds it. */
export type WindowFrame = Awaited<ReturnType<typeof prepareEngineWindow>>;
