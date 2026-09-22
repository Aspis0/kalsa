/**
 * Phase 2 of the lifted engine turn — the per-chat compactor window's state
 * load and ceiling guard. The original was one 483-line block; the guard
 * moves to the two phases' entry (the same condition the block tested), and
 * this phase returns a cast on the guard-false path: under that guard
 * `advanceCompactorWindow` returns before touching any field below, so the
 * cast and the runtime agree by construction — stated at the cast rather
 * than hidden in it.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildSystemPrompt, getActiveEngineNCtx, getLoadedAssembleBoundary, resolvedStaticPrefixTokens } from "../engine/LlamaService";
import {
  compactorStorageKey, countUserTurns, emptyCompactorState, parseCompactorState,
  resolveBoundaryIndex, serializeCompactorState, shouldRebuild, shouldRebuildAnchored,
  splitAtBoundary, summaryStorageKey, truncateBudget, SUMMARY_BUDGET_CHARS,
  type CompactorState, type HistoryRoleMessage,
} from "../context/compactor";
import {
  anchoredWindowChars, conservativeWindowTokens, projectedWindowTokens,
  shouldSlideWindowAtCeiling, WINDOW_CHARS_PER_TOKEN,
} from "../context/windowProfile";
import { decideAssembleWindowAction } from "../engine/windowKvInvariant";
import { getBenchWindowBudget, shouldUseToolCalling } from "../bench/benchConfig";
import { compactorStateByChat, forceRebuildByChat, resetCompactorChat } from "./turnCorpus";
import type { EngineTurnDeps } from "./engineTurnDeps";
import type { WindowFrame } from "./engineTurnWindow";

export interface CompactorRun extends WindowFrame {
  state: CompactorState;
  userTurnCount: number;
  recentForBudget: HistoryRoleMessage[];
  compactorConfig: { windowCharBudget: number } | null;
  windowAction: ReturnType<typeof decideAssembleWindowAction>;
  pinnedStart: number;
  systemPromptTokens: number;
  activeNCtx: number;
  pinnedWindowChars: number;
  promptTokensBefore: number;
  measuredCharsPerToken: number | undefined;
  windowTokens: number | undefined;
  effectiveCharsPerToken: number;
  ceilingCrossed: boolean;
}
export async function loadCompactorWindow(
  deps: EngineTurnDeps,
  run: WindowFrame,
): Promise<CompactorRun> {
  const { chatId, validatedHistory, toolChoiceMode } = run.inputs;
  const { locale, agentOptions } = deps;
  const { retrievalOn, anchoredOn, kvHeld, nPast, legacyWindowStart, historyLengths, currentTurnChars, windowProfile, noPerMessageCap, promptFacts } = run;
  if (!(retrievalOn || anchoredOn)) {
    // Off mode has no compactor block: the original `if` simply did not run.
    // The cast is the guard restated for the type checker — every field below
    // is absent, and neither later phase reads them before its own copy of
    // this condition (the log's `?? null` covers the absence).
    return run as CompactorRun;
  }
            let measuredCharsPerToken: number | undefined;
            let windowTokens: number | undefined;
              const userTurnCount = countUserTurns(validatedHistory, true);

              // Load per-chat compactor state (memory → AsyncStorage).
              let state = compactorStateByChat.get(chatId);
              if (!state) {
                try {
                  const raw = await AsyncStorage.getItem(compactorStorageKey(chatId));
                  state = parseCompactorState(raw, chatId);
                  if (!anchoredOn) {
                    // Prefer the dedicated summary key when present (storage compatibility).
                    const sumRaw = await AsyncStorage.getItem(summaryStorageKey(chatId));
                    if (typeof sumRaw === "string" && sumRaw.trim()) {
                      state = {
                        ...state,
                        rollingSummary: truncateBudget(sumRaw.trim(), SUMMARY_BUDGET_CHARS),
                      };
                    }
                  }
                  compactorStateByChat.set(chatId, state);
                } catch {
                  state = emptyCompactorState(chatId);
                  compactorStateByChat.set(chatId, state);
                }
              }
              if (anchoredOn) {
                // Do not carry an operative block from another regime into
                // the no-digest anchored prompt.
                state = {
                  ...state,
                  frozenDigest: "",
                  rollingSummary: "",
                };
                compactorStateByChat.set(chatId, state);
              }

              // Load-time guards: stale digest/summary after clearChat + app
              // restart (in-memory lastHistoryLen dies with the process;
              // AsyncStorage survives). (1) State belongs to a longer
              // (deleted) conversation. (2) First send of an empty one still
              // has persisted state.
              const persistedCompactorExists =
                state.builtAtUserTurn >= 0 ||
                Boolean(state.frozenDigest?.trim()) ||
                Boolean(state.rollingSummary?.trim()) ||
                state.boundaryIndex >= 0;
              if (
                state.builtAtUserTurn > countUserTurns(validatedHistory) ||
                (validatedHistory.length === 0 && persistedCompactorExists)
              ) {
                await resetCompactorChat(chatId);
                state = emptyCompactorState(chatId);
                compactorStateByChat.set(chatId, state);
              }

              // Force boundary rebuild after context_full (set in onError); consume once.
              const forceRebuild = forceRebuildByChat.get(chatId) === true;
              if (forceRebuild) forceRebuildByChat.delete(chatId);

              // Char-budget path needs the current verbatim window.
              const boundaryProbe = resolveBoundaryIndex(
                state,
                validatedHistory.length,
              );
              const recentForBudget = splitAtBoundary(
                validatedHistory,
                boundaryProbe,
              ).recent;

              // Bench-only: shrink the verbatim-window budget so compaction
              // fires often, the regime a phone runs in. Absent in production
              // → null → WINDOW_CHAR_BUDGET. Read inline (not via React state)
              // so there is no window where the trigger disagrees with itself.
              const winBudget = await getBenchWindowBudget();
              const compactorConfig =
                winBudget == null ? null : { windowCharBudget: winBudget };

              if (kvHeld) {
                const loadedB = getLoadedAssembleBoundary(chatId);
                if (loadedB !== null) {
                  const fromB = resolveBoundaryIndex(
                    state,
                    validatedHistory.length,
                  );
                  if (fromB !== loadedB) {
                    try {
                      console.log(
                        `KALSA_SESSION ${JSON.stringify({
                          op: "window_align",
                          from: fromB,
                          to: loadedB,
                        })}`,
                      );
                    } catch {
                      // telemetry must never throw
                    }
                  }
                  state = { ...state, boundaryIndex: loadedB };
                  compactorStateByChat.set(chatId, state);
                  try {
                    await AsyncStorage.setItem(
                      compactorStorageKey(chatId),
                      serializeCompactorState(state),
                    );
                  } catch {
                    // best-effort
                  }
                }
              }
              const pinnedStart = resolveBoundaryIndex(
                state,
                validatedHistory.length,
              );
              // Ceiling guard (anchored and ciswire): while the live KV holds
              // the chat the boundary cannot move, so the window grows every
              // turn. Crossing n_ctx - WINDOW_RESERVE_TOKENS on a hybrid
              // (attn+recurrent) model is unrecoverable — the recurrent half
              // cannot evict a prefix, so ctx_shift corrupts instead of
              // recycling. Slide deliberately, before the n_ctx edge.
              const activeNCtx = getActiveEngineNCtx();
              // The prompt the native sees is window + static prefix, so the
              // ceiling must price both. Read SYNCHRONOUSLY from the memo the
              // prewarm fills inside the engine FIFO: an await here sat between
              // the capture of chatId/kvHeld/loadedB above and the slide's
              // clear below, so a chat switch could clear the wrong session
              // (TOCTOU). Unmeasured prefix identity → prudent char-side
              // fallback, never 0.
              const withTools =
                Boolean(agentOptions.tools?.length && agentOptions.executeTool) &&
                shouldUseToolCalling(toolChoiceMode);
              const systemPromptTokens = resolvedStaticPrefixTokens({
                locale,
                systemText: buildSystemPrompt(locale, withTools, promptFacts),
                tools: withTools ? agentOptions.tools : [],
              }).tokens;
              const windowStartForCeiling = anchoredOn
                ? pinnedStart
                : legacyWindowStart;
              const pinnedWindowChars = anchoredWindowChars(
                historyLengths,
                windowStartForCeiling,
                noPerMessageCap,
                currentTurnChars,
              );
              const promptTokensBefore =
                projectedWindowTokens(pinnedWindowChars);
              // Measured chars/token from the live KV (sync reals only — no
              // await, TOCTOU). The current turn is not yet in the KV, so
              // exclude it from the chars side. conservativeWindowTokens clamps
              // to [chars/3, chars] and ignores ratios >= 3, so the guard can
              // only slide EARLIER than the chars/3 projection, never later;
              // the KV delta counting non-window tokens biases the same way.
              const windowKvChars = pinnedWindowChars - currentTurnChars;
              const windowKvTokens = (nPast ?? 0) - systemPromptTokens;
              measuredCharsPerToken =
                windowKvChars > 0 && windowKvTokens > 0
                  ? windowKvChars / windowKvTokens
                  : undefined;
              windowTokens = conservativeWindowTokens(
                pinnedWindowChars,
                measuredCharsPerToken,
              );
              // The same ratio the guard effectively used (the clamp only
              // honours a ratio < 3). The ceiling rebuild must convert with
              // this and not the default, or it would re-grow a window past
              // the ceiling and slide in a loop.
              const effectiveCharsPerToken =
                Number.isFinite(measuredCharsPerToken) &&
                measuredCharsPerToken !== undefined &&
                measuredCharsPerToken > 0 &&
                measuredCharsPerToken < WINDOW_CHARS_PER_TOKEN
                  ? measuredCharsPerToken
                  : WINDOW_CHARS_PER_TOKEN;
              const ceilingCrossed = shouldSlideWindowAtCeiling({
                nCtx: activeNCtx,
                windowChars: pinnedWindowChars,
                windowTokens,
                kvHeld,
                reservedPromptTokens: systemPromptTokens,
              });

              const windowAction = decideAssembleWindowAction({
                budgetRebuild: anchoredOn
                  ? shouldRebuildAnchored(state, {
                      historyLengths,
                      currentTurnLength: currentTurnChars,
                      profile: windowProfile,
                      maxCharsPerMessage: noPerMessageCap,
                    })
                  : shouldRebuild(
                      state,
                      userTurnCount,
                      compactorConfig,
                      recentForBudget,
                    ),
                forceRebuild,
                kvHoldsChatSession: kvHeld,
                anchored: anchoredOn,
                ceilingCrossed,
              });
  return {
    ...run,
    state,
    userTurnCount,
    recentForBudget,
    compactorConfig,
    windowAction,
    pinnedStart,
    systemPromptTokens,
    activeNCtx,
    pinnedWindowChars,
    promptTokensBefore,
    measuredCharsPerToken,
    windowTokens,
    effectiveCharsPerToken,
    ceilingCrossed,
  };
}
