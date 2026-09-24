/**
 * The engine half of a send — `handleSendStream`, lifted and split at the
 * block's own seams: engineTurnMemory (extract + afterSessionSave),
 * engineTurnWindow (frame locals), engineTurnCompactor (state load + ceiling
 * guard), engineTurnSlide (slide/reconcile/digest), engineTurnStream
 * (prewarm → assemble → the single streamAssistantTurn).
 *
 * Gate order preserved: thermal backstop → prior-extract wait → ensure →
 * research/notes → window/compactor → stream → arm extract; the
 * `afterSessionSave` is released by the chat side after saveEngineSession.
 * Left behind (outside this function in the old app too): the
 * background/foreground discard effect, the pre-send fit gate, downloads.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isModelBundleDownloaded } from "../engine/ModelDownloader";
import {
  completeOnce,
  getActiveEngineNCtx,
  getActiveModelId,
  invalidateEngineSession,
} from "../engine/engineBackend";
import { isRemoteEngineBackend } from "../engine/engineBackend";
import { getToolChoiceMode } from "../bench/benchConfig";
import {
  CISWIRE_FLAG_COMPACTION,
  CISWIRE_FLAG_MEMORY,
  CISWIRE_FLAG_TOOLHELP,
  CISWIRE_TOOLHELP_KEY,
  COMPACTION_CHOICE_KEY,
  COMPACTION_ENABLED_KEY,
  DEFAULT_CHAT_ID,
  parseContextMode,
  parseCiswireToolHelp,
} from "../context/compactor";
import { COMPACTION_ENABLED_DEFAULT, parseCompactionEnabled } from "../engine/ttftFlags";
import * as MemoryStore from "../memory/MemoryStore";
import {
  bumpFetchAllowlistTurnSeq,
  lastHistoryLenByChat,
  resetCompactorChat,
  validateHistoryMessages,
} from "./turnCorpus";
import { loadNotesContext } from "./notesContext";
import { createMemoryExtract } from "./engineTurnMemory";
import { prepareEngineWindow } from "./engineTurnWindow";
import { loadCompactorWindow } from "./engineTurnCompactor";
import { advanceCompactorWindow } from "./engineTurnSlide";
import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import { streamEngineTurn } from "./engineTurnStream";
import { runEngineResearchTurn } from "./engineTurnResearch";
import type { EngineTurnCallbacks, OwnedEngineTurnDeps } from "./engineTurnDeps";
import type { LocalAttachment } from "./hostMessage";
import { createEngineTurnFinish } from "./engineTurnFinish";

export function handleSendStream(
  deps: OwnedEngineTurnDeps,
  text: string,
  callbacks: EngineTurnCallbacks,
  signal: AbortSignal,
  attachments?: LocalAttachment[],
  history?: unknown[],
  _lastUserBare?: string,
  sendOpts?: {
    research?: boolean;
    notes?: boolean;
    onNotice?: () => void;
  },
): Promise<{ afterSessionSave?: () => void }> {
  const {
    t,
    locale,
    thermalHardGateRef,
    thermalHardGated,
    setStreaming,
    streamInFlightRef,
    nativeTurnStartAtRef,
    bumpForegroundIdleRef,
    lastUserRawRef,
    activeDocumentAttachmentRef,
    onMiniappRef,
    memoryExtractRef,
    memoryExtractCancelRef,
    memoryEnabledRef,
    setMemoryFacts,
    ensureEngineForModel,
    currentModel,
    documentLibraryRef,
    agentOptionsRef,
    chatEngineCtxRef,
    conversationsRef,
    contextModeRef,
    compactionEnabledRef,
    toolhelpRef,
  } = deps;
  return new Promise<{ afterSessionSave?: () => void }>((resolve) => {
        /** Deferred extract hook — set once scheduleMemoryExtract is defined. */
        let afterSessionSave: (() => void) | undefined;
        /** Live onMiniapp hook for the create_miniapp executor (set once per send). */
        const liveMiniapp = (callbacks as {
          onMiniapp?: (miniapp: unknown) => void;
        }).onMiniapp;
        activeDocumentAttachmentRef.current =
          attachments?.find((attachment) => attachment.kind === "document") ?? null;
        if (liveMiniapp) onMiniappRef.current = liveMiniapp;
        const finish = createEngineTurnFinish({
          isTurnOwner: deps.isTurnOwner,
          activeDocumentAttachmentRef,
          streamInFlightRef,
          setStreaming,
          onMiniappRef,
          onFinished: () => resolve(afterSessionSave ? { afterSessionSave } : {}),
        });
        const fail = (message: string, reasonKey?: string) => {
          callbacks.onDelta?.(`⚠️ ${message}`, `⚠️ ${message}`);
          try {
            callbacks.onFailedReason?.(message); // §2.8: the engine's own words, no apology
            callbacks.onFailed?.(reasonKey || "chat.serviceUnreachable");
          } catch {
            // ignore
          }
          finish();
        };

        // Synchronous backstop for a CRITICAL event that lands after
        // the pre-send guard but before this callback runs.
        if (thermalHardGateRef.current || thermalHardGated) {
          fail(t("chat.thermalHardGateBody"), "chat.thermalHardGateBody");
          return;
        }
        streamInFlightRef.current = true;
        nativeTurnStartAtRef.current = Date.now();
        bumpForegroundIdleRef.current();
        setStreaming(true);
        lastUserRawRef.current = typeof text === "string" ? text : "";
        // Fresh web_fetch allowlist for every send, even if text matches the
        // previous turn.
        bumpFetchAllowlistTurnSeq();

        void (async () => {
          let turnFailed = false;
          let assistantFull = "";
          // CisWire feature bits for this turn's telemetry lines. Assigned
          // after the per-send toggle reads below; 0 → field omitted.
          let turnCiswireFlags = 0;
          const memoryExtract = createMemoryExtract(deps, {
            signal,
            text,
            isFailed: () => turnFailed,
            getAssistantFull: () => assistantFull,
            getTurnFlags: () => turnCiswireFlags,
          });
          const armMemoryExtract = memoryExtract.arm;
          afterSessionSave = memoryExtract.afterSessionSave;
          try {
            // Wait out a pending memory extract so we never dual-complete on
            // the engine: a new send owns it now — stop the extraction and let
            // its checkpoint-restore finally run before this turn proceeds.
            if (memoryExtractRef.current) {
              memoryExtractCancelRef.current?.();
              try {
                await memoryExtractRef.current;
              } catch {
                // ignore
              }
              memoryExtractRef.current = null;
            }
            if (!(await ensureEngineForModel(currentModel))) {
              // ensureEngineForModel early-returns false when the bundle is
              // missing without setting modelErrorKind, so re-check disk
              // rather than relying on modelErrorKind alone.
              const downloaded = await isModelBundleDownloaded(currentModel).catch(() => false);
              if (currentModel.id === REMOTE_COMPUTER_MODEL_ID) {
                fail(deps.remoteErrorRef.current ?? t("settings.remoteBrainFailGeneric"), "chat.serviceUnreachable");
              } else if (downloaded) {
                fail(t("chat.modelLoadFailed", { name: currentModel.name }), "chat.modelLoadFailed");
              } else {
                fail(t("chat.modelNotDownloaded", { name: currentModel.name }), "chat.modelNotDownloaded");
              }
              return;
            }

            if (await runEngineResearchTurn({
              requested: sendOpts?.research,
              remoteBackend: isRemoteEngineBackend(),
              locale,
              text,
              attachments,
              docs: documentLibraryRef.current.docs ?? [],
              executeTool: agentOptionsRef.current.executeTool,
              completeOnce,
              nCtx: getActiveEngineNCtx() || chatEngineCtxRef.current || 0,
              signal,
              currentModelId: getActiveModelId() ?? currentModel.id,
              refuseRemote: () => fail(t("settings.remoteGated"), "settings.remoteGated"),
              onStatus: (status) => callbacks.onStatus?.(status),
              onDelta: (delta, full) => {
                assistantFull = full;
                callbacks.onDelta?.(delta, full);
              },
              finish,
              invalidateSession: (modelId) => { void invalidateEngineSession(modelId); },
            })) return;

            let promptText = text;
            if (sendOpts?.notes) {
              try {
                const notesRes = await loadNotesContext();
                if (notesRes.context) {
                  promptText = `${text}\n\n${notesRes.context}`;
                  if (notesRes.truncated) {
                    // Surface silent truncation to the composer (voice note).
                    sendOpts.onNotice?.();
                  }
                }
              } catch {
                // Notes context is optional; keep the ordinary chat prompt.
              }
            }

            // Resolved BEFORE any state capture below (chatId, kvHeld,
            // loadedB): the ceiling guard consumes it synchronously, and an
            // await between capture and use let a chat switch invalidate the
            // captured state — clearing the wrong session on slide (TOCTOU).
            // Absent key → "auto" (tools on).
            const toolChoiceMode = await getToolChoiceMode();

            const chatId = conversationsRef.current.activeId || DEFAULT_CHAT_ID;
            const hasImages = Boolean(attachments?.length);
            const validatedHistory = validateHistoryMessages(history);

            // Detect clearChat: history shrank vs last send → reset stores.
            const prevLen = lastHistoryLenByChat.get(chatId) ?? 0;
            if (validatedHistory.length < prevLen) {
              await resetCompactorChat(chatId);
            }
            lastHistoryLenByChat.set(chatId, validatedHistory.length);

            // Re-read toggles each turn so Settings apply without remount.
            try {
              memoryEnabledRef.current = await MemoryStore.getEnabled();
            } catch {
              memoryEnabledRef.current = false;
            }
            if (!memoryEnabledRef.current) {
              setMemoryFacts([]);
            }
            try {
              const [raw, choice, toolhelpRaw] = await Promise.all([
                AsyncStorage.getItem(COMPACTION_ENABLED_KEY),
                AsyncStorage.getItem(COMPACTION_CHOICE_KEY),
                AsyncStorage.getItem(CISWIRE_TOOLHELP_KEY),
              ]);
              contextModeRef.current = parseContextMode(raw);
              compactionEnabledRef.current = parseCompactionEnabled(
                raw,
                choice === "1",
              );
              toolhelpRef.current = parseCiswireToolHelp(toolhelpRaw);
            } catch {
              contextModeRef.current = "anchored";
              compactionEnabledRef.current = COMPACTION_ENABLED_DEFAULT;
              toolhelpRef.current = false;
            }

            const contextMode = contextModeRef.current;
            // Telemetry bitmask only — no gating behavior here.
            // bit0=compaction-ciswire, bit1=memory, bit2=toolhelp.
            turnCiswireFlags =
              (contextMode === "ciswire" ? CISWIRE_FLAG_COMPACTION : 0) |
              (memoryEnabledRef.current ? CISWIRE_FLAG_MEMORY : 0) |
              (toolhelpRef.current ? CISWIRE_FLAG_TOOLHELP : 0);
            // Retrieval (digest + summary) is only ciswire. Anchored is a
            // no-digest append-only window with its own pressure trigger.
            const frame = await prepareEngineWindow(deps, {
              text,
              callbacks,
              signal,
              attachments,
              history,
              sendOpts,
              chatId,
              hasImages,
              validatedHistory,
              contextMode,
              promptText,
              toolChoiceMode,
              turnCiswireFlags,
            });
            const run = await loadCompactorWindow(deps, frame);
            await advanceCompactorWindow(deps, run);
            await streamEngineTurn(deps, run, {
              armMemoryExtract,
              finish,
              markFailed: () => {
                turnFailed = true;
              },
              setAssistantFull: (full) => {
                assistantFull = full;
              },
            });
            armMemoryExtract();
            finish();
          } catch (error) {
            fail(error instanceof Error ? error.message : String(error));
          }
        })();
      });
}
