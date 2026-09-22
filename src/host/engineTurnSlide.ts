/**
 * Phase 3 of the lifted engine turn — the slide, the reconcile, the
 * KALSA_WINDOW_SLIDE line, the boundary persistence and the ciswire digest.
 * Returns on the same guard phase 2 had, because the original ran both halves
 * inside one `if (retrievalOn || anchoredOn)`. The seven frame locals this
 * block mutates are reached as `run.*` so the values cross the phase boundary;
 * `state` is re-taken from `run` at entry and lands in the same module
 * singleton the old block wrote.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { discardChatKvForWindowSlide, getActiveModelId } from "../engine/LlamaService";
import {
  advanceAnchoredBoundary, advanceCompactionBoundary, anchoredHistoryDropReason,
  compactorStorageKey, lastCompleteExchangeStart, refreshQueryDigest,
  resolveBoundaryIndex, resolveCiswireRanking, selectAnchoredBudget,
  serializeCompactorState, shouldInjectOperativeBlock, splitAtBoundary, summaryStorageKey,
  toRetrievalUnits,
} from "../context/compactor";
import { windowCeilingTokens, WINDOW_SHARE_WITH_DIGEST } from "../context/windowProfile";
import {
  operativeContextForLiveKv, shouldApplySlideAdvance, shouldDiscardKvForSlide,
} from "../engine/windowKvInvariant";
import { formatDigestLine } from "../engine/digestTelemetry";
import { getBenchDigestCadence, getBenchRanking } from "../bench/benchConfig";
import { compactorStateByChat, filterCorpusHygiene, syncDigestIndex, MAX_DIGEST_CORPUS_MESSAGES } from "./turnCorpus";
import type { EngineTurnDeps } from "./engineTurnDeps";
import type { CompactorRun } from "./engineTurnCompactor";

/**
 * Phase 3 — the slide, the reconcile, the persistence and the digest.
 * Returns on the same guard A had, because the original block ran both halves
 * inside one `if`.
 */
export async function advanceCompactorWindow(
  deps: EngineTurnDeps,
  run: CompactorRun,
): Promise<void> {
  const { t, currentModel } = deps;
  const { chatId, validatedHistory, text, hasImages, turnCiswireFlags } = run.inputs;
  const {
    retrievalOn,
    anchoredOn,
    kvHeld,
    reconcileRequired,
    historyLengths,
    currentTurnChars,
    windowProfile,
    noPerMessageCap,
    userTurnCount,
    windowAction,
    pinnedStart,
    systemPromptTokens,
    activeNCtx,
    promptTokensBefore,
    effectiveCharsPerToken,
    ceilingCrossed,
  } = run;
  if (!(retrievalOn || anchoredOn)) return;
  let state = run.state;
              let slideOk = windowAction.slide;
              // A slide is only worth its destructive half — deleting the .kvs
              // and dropping the live RAM cache — if the boundary actually
              // moves: with an infinite charBudget (attachment turn, bench
              // override) the rebuild is a no-op, so discarding would destroy
              // the live KV and leave the prompt at the size it already was,
              // above the ceiling. Compute the advance first.
              let slideBlocked = false;
              // The gate compares the two real assemble starts: anchored's
              // persisted boundary, ciswire's clamped/trusted window start.
              const previousStart = anchoredOn ? pinnedStart : run.legacyWindowStart;
              // Roles only, no text: the floor the anchored rebuild must not
              // cross — the user opening the last exchange with an assistant
              // reply (historyLengths, same order, indexes it); with the newest
              // user message still unanswered, the previous exchange.
              const anchoredFloorIndex = anchoredOn
                ? lastCompleteExchangeStart(validatedHistory.map((m) => m.role))
                : -1;
              if (windowAction.slide) {
                // At the ceiling the profile's charBudget is exactly what
                // cannot help (it is Infinity for attachment turns), so derive
                // the rebuild target from the token ceiling instead. Ciswire
                // carries the digest share because the digest re-enters the
                // prompt the moment this slide clears the live KV. The same
                // system-priced ceiling as the guard above: rebuilding to the
                // un-reduced ceiling would clear the KV and immediately
                // re-grow a window that crosses it again.
                const ceilingBudgetChars = ceilingCrossed
                  ? Math.max(
                      0,
                      windowCeilingTokens(activeNCtx, systemPromptTokens) *
                        effectiveCharsPerToken *
                        (anchoredOn ? 1 : WINDOW_SHARE_WITH_DIGEST),
                    )
                  : undefined;
                let nextState = anchoredOn
                  ? advanceAnchoredBoundary(state, {
                      chatId,
                      userTurnCount,
                      historyLengths,
                      currentTurnLength: currentTurnChars,
                      profile: windowProfile,
                      maxCharsPerMessage: noPerMessageCap,
                      ceilingBudgetChars,
                      // The last complete exchange is kept even when over
                      // the rebuild target — but only within this budget:
                      // on the ceiling path a consumed ceiling gives a
                      // 0-char budget, the floor cannot fit either, and the
                      // history is still dropped.
                      floorIndex: anchoredFloorIndex,
                    })
                  : advanceCompactionBoundary(state, {
                      chatId,
                      userTurnCount,
                      historyLength: validatedHistory.length,
                      hasImages,
                      ceilingBudgetChars,
                      historyLengths,
                      maxCharsPerMessage: noPerMessageCap,
                      currentTurnLength: currentTurnChars,
                    });
                let nextStart = resolveBoundaryIndex(
                  nextState,
                  validatedHistory.length,
                );
                // The one outcome this rebuild can produce that is not a
                // window: the floor did not fit the real budget, so no history
                // is kept. Reported on KALSA_WINDOW below.
                if (anchoredOn) {
                  run.anchoredHistoryDropped = anchoredHistoryDropReason(
                    nextStart,
                    validatedHistory.length,
                    anchoredFloorIndex,
                  );
                  run.anchoredRebuildBudget = selectAnchoredBudget(
                    windowProfile.charBudget,
                    ceilingBudgetChars,
                  );
                }
                // A held window may only advance. In particular, the
                // attempted-start carrier from a killed post-clear prefill
                // must not be replaced by a fresh char walk that moved
                // backwards; that would re-create the repeated-slide loop.
                if (kvHeld && nextStart < previousStart) {
                  nextStart = previousStart;
                  nextState = { ...nextState, boundaryIndex: nextStart };
                }
                const boundaryClearRequested = shouldDiscardKvForSlide({
                  discard: windowAction.discard,
                  previousBoundaryIndex: previousStart,
                  nextBoundaryIndex: nextStart,
                });
                const clearRequested =
                  boundaryClearRequested || reconcileRequired;
                if (clearRequested) {
                  run.nativeClearedForAssemble = await discardChatKvForWindowSlide(
                    getActiveModelId() ?? currentModel.id,
                    chatId,
                  );
                  slideOk = run.nativeClearedForAssemble;
                  if (!run.nativeClearedForAssemble) {
                    throw new Error(t("chat.serviceUnreachable"));
                  }
                } else if (windowAction.discard) {
                  // The boundary cannot move: do not clear the live KV for a
                  // slide that would not happen.
                  slideOk = false;
                  slideBlocked = true;
                }
                // Apply the advance only when any requested clear succeeded.
                if (
                  shouldApplySlideAdvance({
                    clearRequested: windowAction.discard || reconcileRequired,
                    clearSucceeded: run.nativeClearedForAssemble,
                  })
                ) {
                  state = nextState;
                  if (!anchoredOn && (windowAction.discard || reconcileRequired)) {
                    // The live KV was cleared and will be re-prefilled from
                    // this start; ciswire's engine window must use it (its
                    // boundaryIndex stays the digest bookkeeping value).
                    run.legacyWindowStart = nextStart;
                  }
                }
              } else if (reconcileRequired) {
                // No logical slide is due, but the native cache holds chat
                // tokens whose absolute start is unknown. Clear once, keep the
                // attempted logical start, and let adoption install the fact.
                run.nativeClearedForAssemble = await discardChatKvForWindowSlide(
                  getActiveModelId() ?? currentModel.id,
                  chatId,
                );
                if (!run.nativeClearedForAssemble) {
                  throw new Error(t("chat.serviceUnreachable"));
                }
                run.windowSlideForCeiling = true;
                try {
                  console.log(
                    `KALSA_SESSION ${JSON.stringify({
                      op: "window_reconcile",
                      start: anchoredOn ? pinnedStart : run.legacyWindowStart,
                      kvCleared: true,
                    })}`,
                  );
                } catch {
                  // telemetry must never throw
                }
              }

              if (anchoredOn) {
                run.boundaryForAssemble = resolveBoundaryIndex(
                  state,
                  validatedHistory.length,
                );
              }

              // One line per deliberate ceiling slide: the counts that
              // decided it and whether the clear succeeded. No token ids.
              // `advanced`/`skipReason` distinguish "could not slide" from
              // "clear failed", which `kvCleared` alone cannot.
              if (ceilingCrossed) {
                run.windowSlideForCeiling = slideOk;
                try {
                  console.log(
                    `KALSA_WINDOW_SLIDE ${JSON.stringify({
                      nCtx: activeNCtx,
                      ceiling: windowCeilingTokens(activeNCtx, systemPromptTokens),
                      systemTokens: systemPromptTokens,
                      prevStart: previousStart,
                      newStart: anchoredOn ? run.boundaryForAssemble : run.legacyWindowStart,
                      promptTokensBefore,
                      advanced:
                        (anchoredOn ? run.boundaryForAssemble : run.legacyWindowStart) >
                        previousStart,
                      kvCleared: slideOk,
                      skipReason: slideBlocked
                        ? "boundary_cannot_advance"
                        : undefined,
                    })}`,
                  );
                } catch {
                  // telemetry must never throw
                }
              }

              if (anchoredOn) {
                compactorStateByChat.set(chatId, state);
                try {
                  await AsyncStorage.setItem(
                    compactorStorageKey(chatId),
                    serializeCompactorState(state),
                  );
                } catch {
                  // best-effort persistence
                }
              } else {
                // Bench-only override for the digest ranking; absent → the pure
                // resolver default ("hybrid": the char 3-gram leg ranks every doc).
                const rankingOverride = await getBenchRanking();
                const digestRanking = resolveCiswireRanking(rankingOverride);

                // Corpus eligible for BM25 + rolling summary: everything
                // outside ciswire's legacy sliding window.
                const corpusBoundary = run.legacyWindowStart;

                // Older corpus for the warm-index sync.
                const olderClean = filterCorpusHygiene(
                  splitAtBoundary(validatedHistory, corpusBoundary).older,
                );

                // Warm index: append as boundary advances; query every turn.
                const digestIndex = syncDigestIndex(
                  chatId,
                  validatedHistory,
                  corpusBoundary,
                );
                const olderForDigest =
                  olderClean.length > MAX_DIGEST_CORPUS_MESSAGES
                    ? olderClean.slice(-MAX_DIGEST_CORPUS_MESSAGES)
                    : olderClean;
                const oldUnits = toRetrievalUnits(olderForDigest);

                // Query-time BM25 digest — current user message is the retrieval query.
                // (Digest rides on the last user message via format B; freezing it
                // saved zero prefill and cost recall — see RESEARCH_CONTEXT_LOSS.md.)
                state = refreshQueryDigest(state, {
                  chatId,
                  index: digestIndex,
                  oldTurns: oldUnits,
                  currentQuery: text,
                  onTelemetry: (t) =>
                    console.log(
                      formatDigestLine({
                        ...t,
                        ciswireFlags: turnCiswireFlags || undefined,
                      }),
                    ),
                  ranking: digestRanking,
                });
                compactorStateByChat.set(chatId, state);

                // Persist boundary/summary meta every turn (cheap JSON); digest is
                // recomputed from warm index + query so staleness is not critical.
                try {
                  await AsyncStorage.setItem(
                    compactorStorageKey(chatId),
                    serializeCompactorState(state),
                  );
                  await AsyncStorage.setItem(
                    summaryStorageKey(chatId),
                    state.rollingSummary,
                  );
                } catch {
                  // best-effort persistence
                }

                // Bench-only cadence: null → inject every turn (production). The
                // block rides the last user message, so every injection costs the
                // KV that user turn plus its reply; every K turns pays it once.
                const injectBlock = shouldInjectOperativeBlock(
                  userTurnCount - 1,
                  await getBenchDigestCadence(),
                );
                if (injectBlock) {
                  run.operativeContext = operativeContextForLiveKv({
                    // A successful clear means the native KV is gone for this
                    // send, so the digest may ride it (a live KV skips it).
                    kvHeld: run.nativeClearedForAssemble ? false : kvHeld,
                    digest: state.frozenDigest || undefined,
                    summary: state.rollingSummary || undefined,
                  });
                }
              }
}
