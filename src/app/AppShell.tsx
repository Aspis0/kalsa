import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Keyboard, Modal, Pressable, ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { X as LucideX, Globe as LucideGlobe, Settings as LucideSettings, FileText as LucideFileText } from "lucide-react-native";

import { AiChatPage, type ChatCta, type LocalAttachment } from "../screens/AiChatPage";
import { HelpScreen } from "../screens/HelpScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { DocumentsScreen } from "../screens/DocumentsScreen";
import {
  emptyLibraryState,
  loadLibraryState,
  saveLibraryState,
  getDefaultLibraryStorage,
  reorderDocs,
  type LibraryDoc,
  type LibraryState,
} from "../documents/DocumentLibrary";
import {
  deleteOwnedFile,
  deleteVectorIndexFile,
  readVectorIndexFile,
  writeVectorIndexFile,
} from "../documents/documentStorage";
import { DocumentCoverHost } from "../documents/documentCover";
import {
  DOCUMENT_CHAT_TOOL,
  createDocumentChatExecutor,
} from "../documents/documentChatTool";
import {
  tryAcquireDelete,
  releaseDelete,
  isDeleteActive,
  tryAcquireRead,
  releaseRead,
  isReadActive,
} from "../documents/docOpGate";
import { DocRetrieverIndex } from "../context/retrievalLoop";
import { htmlToText } from "../util/htmlToText";
import { AskAssistantMiniappRenderer } from "../ui/AskAssistantMiniappRenderer";
import { Drawer, PainterlyBg, type DrawerItem } from "../theme/components";
import { spacing } from "../theme/tokens";
import { useTypography, fontFamilies } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";
import type { AskAssistantMiniapp } from "../domain/askAssistant";
import { handleAskAssistantMiniappAction } from "./miniappActions";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Notifications from "expo-notifications";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { MODEL_REGISTRY, WHISPER_MODEL, EMBEDDING_MODEL, getDefaultModel, formatBytes, type ModelInfo } from "../engine/ModelRegistry";
import { downloadModelBundle, friendlyNetworkError, isModelBundleDownloaded, modelLocalPath } from "../engine/ModelDownloader";
import {
  embedDocumentChunk,
  embedQuery as embedQueryVec,
  embedChunkKey,
  consumeLastEmbedFailure,
  getEmbeddingModelStatus,
  listDocumentChunksForEmbed,
  planChunksToEmbed,
  releaseEmbedder,
  markEmbedderHung,
  isEmbedderHung,
  EMBEDDER_RELEASE_TIMEOUT_MS,
} from "../engine/EmbeddingService";
// isEmbedderActive available for residency telemetry; chat/embedder mutual
// exclusion is enforced by releaseEmbedder-before-chat + ensureEmbedder gate
// + the shared runNativeOp barrier (all llama.rn ops serialize through it).
import {
  SemanticVectorIndex,
  DEFAULT_VECTOR_MEMORY_FLOAT_CAP,
  totalResidentFloats,
} from "../documents/semanticIndex";
import {
  tryAcquireChat,
  markChatReady,
  markChatReleased,
  getState as getLlamaContextGateState,
  getChatGeneration,
  setCoResidencyContext,
  isChatModel2BClass,
  isChatModel4BClass,
  allowsCoResidency,
  CO_RESIDENCY_MIN_MEMORY_BYTES,
  runNativeOp,
  runNativeOpBounded,
  nativeOpBusy,
} from "../engine/llamaContextGate";
import { resolveContextProfile } from "../engine/contextProfile";
import {
  diskRequirementBytes,
  estimateModelNonEvictableMiB,
  evaluateModelFit,
  getCachedDeviceProfile,
  getFreeDiskBytes,
  modelGateVerdict,
  type ModelGateVerdict,
} from "../engine/deviceProfile";
import {
  disposeEngine,
  extractMemory,
  getActiveEngineNCtx,
  getActiveModelId,
  initEngine,
  invalidateEngineSession,
  isEngineReady,
  saveEngineSession,
  streamAssistantTurn,
  summarizeConversation,
  type EngineMessage,
  type EngineTurnOptions,
} from "../engine/LlamaService";
import { startMemoryMonitor, getAvailableMemoryBytesUncached } from "../engine/monitor";
import {
  backgroundDiscardLifecycleRef,
  deferModelSwitchIfSendClaimed,
  discardGenerationRef,
  discardInFlightRef,
  drainPendingModelSwitch,
  regenAbortRef,
  regenInFlightRef,
  sendClaimRef,
  sendingInFlightRef,
} from "../engine/regenState";
import { setProcessUnloadedReason } from "../hooks/useProcessHealth";
import { computePromptEnvHash, getBootHistoryHash, historyHash, resetBootHistoryHash } from "../engine/sessionPersistence";
import { getEngineOverride, getSpeculativeOverride } from "../bench/benchConfig";
import { WEB_SEARCH_TOOL, makeWebSearchExecutor, mapSearchSourcesToChat } from "../agent/webSearchTool";
import {
  WEB_FETCH_TOOL,
  makeFetchAllowlist,
  makeWebFetchExecutor,
  type FetchAllowlist,
} from "../agent/webFetchTool";
import { PdfTextExtractorHost } from "../pdf/PdfTextExtractorHost";
import { makePdfCacheFs } from "../pdf/pdfCacheFs";
import { isPdfTextExtractionBusy, requestPdfText } from "../pdf/pdfTextService";
import * as FileSystem from "expo-file-system/legacy";
import { getStrings, useLocale, type TranslationKey } from "../i18n";
import * as MemoryStore from "../memory/MemoryStore";
import { isWhisperModelDownloaded, releaseWhisper } from "../voice/WhisperService";
import { isTtsEnabled, setTtsEnabled } from "../voice/TtsService";
import { RetrieverIndex } from "../context/retriever";
import {
  advanceCompactionBoundary,
  assembleEngineHistory,
  buildSummaryTranscript,
  COMPACTION_ENABLED_KEY,
  compactorStorageKey,
  countUserTurns,
  DEFAULT_CHAT_ID,
  DEFAULT_COMPACTOR_CONFIG,
  emptyCompactorState,
  parseCompactorState,
  refreshQueryDigest,
  resolveBoundaryIndex,
  serializeCompactorState,
  shouldRebuild,
  splitAtBoundary,
  summaryStorageKey,
  SUMMARY_BUDGET_CHARS,
  toRetrievalUnits,
  truncateBudget,
  type CompactorState,
  type HistoryRoleMessage,
} from "../context/compactor";

/** Shared model pipeline states (download / load / ready) — used by Settings. */
export type ModelPipelineState =
  | "checking"
  | "missing"
  | "downloading"
  | "loading"
  | "ready"
  | "error";

/** Voice ASR asset state (download only — no LLM load). */
export type VoicePipelineState =
  | "checking"
  | "missing"
  | "downloading"
  | "ready"
  | "error";

/** Optional embedding-model asset state (download only — no chat load). */
export type EmbeddingPipelineState =
  | "checking"
  | "missing"
  | "downloading"
  | "ready"
  | "error";

type ModelState = ModelPipelineState;

/** Exclusive full-screen overlays (drawer stays separate — transient chrome). */
type ActiveOverlay =
  | { kind: "settings" }
  | { kind: "help" }
  | { kind: "documents" }
  | { kind: "miniapp"; miniapp: AskAssistantMiniapp }
  | null;

const MODEL_STORAGE_KEY = "kalsa.model.id";
/** Per-user web tool gate (search + fetch). Default ON; AsyncStorage-backed. */
const WEB_TOOLS_ENABLED_KEY = "kalsa.web.enabled";

// ── Model download: keep-awake + progress notification (MIUI/Xiaomi fix) ──
// Aggressive Android power managers (MIUI in particular) freeze the app the
// moment it is backgrounded or the screen locks, killing the in-flight
// multi-GB download socket ("Connection lost"). Keeping the CPU awake for the
// whole download — plus a visible progress notification so the user knows to
// leave the screen on — avoids that.
const DOWNLOAD_KEEP_AWAKE_TAG = "model-download";
const DOWNLOADS_CHANNEL_ID = "downloads";
const DOWNLOAD_PROGRESS_NOTIFICATION_ID = "kalsa-model-download-progress";
/** Never post a notification update more than once per this window. */
const DOWNLOAD_NOTIFY_THROTTLE_MS = 2_000;

/**
 * Untranslated on-device diagnostic string from a thrown value.
 * Suppresses empty / bare "Error:" noise; truncates surrogate-safe to 400 chars.
 */
/**
 * Non-blocking native-patch marker check. When systemInfo is present and
 * lacks "kalsa-native-patches", the build used prebuilt jniLibs and every
 * Kalsa cpp/ patch is inactive. Never throws; skip silently when unknown
 * (idempotent skip-reload path leaves systemInfo undefined).
 */
function warnIfNativePatchesInactive(systemInfo: string | undefined): void {
  try {
    if (typeof systemInfo !== "string" || systemInfo.length === 0) return;
    if (systemInfo.includes("kalsa-native-patches")) return;
    console.warn(
      "[kalsa-native] llama.rn not built from patched source — native patches inactive",
    );
  } catch {
    // never throw from a diagnostic assert
  }
}

function rawErrorDetail(error: unknown): string | null {
  let rawSource: string;
  if (error instanceof Error) {
    rawSource = `${error.name}: ${error.message}`;
  } else {
    try {
      const json = JSON.stringify(error);
      rawSource = json === undefined ? String(error) : json;
    } catch {
      rawSource = String(error);
    }
  }
  const rawTrimmed = rawSource.trim();
  if (!rawTrimmed || rawTrimmed === "Error:" || rawTrimmed === "Error: ") return null;
  return Array.from(rawTrimmed).slice(0, 400).join("");
}

/** Bundle size for disk-gate checks (main GGUF + optional mmproj). */
function modelBundleSizeBytes(model: ModelInfo): number {
  return model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);
}

/**
 * Build a ModelGateVerdict for a registry entry from a cached DeviceProfile +
 * free-disk probe. Pure after inputs are resolved.
 */
function gateForModel(
  model: ModelInfo,
  profile: Awaited<ReturnType<typeof getCachedDeviceProfile>>,
  freeDiskBytes: number | null,
): ModelGateVerdict {
  // RAM estimate includes optional mmproj (vision bundle); disk already bundles.
  const bundleBytes = model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);
  return modelGateVerdict({
    totalMemoryBytes: profile.totalMemoryBytes,
    availableMemoryBytes: profile.availableMemoryBytes,
    freeDiskBytes,
    ramTier: profile.ramTier,
    modelMinRamTier: model.minRamTier,
    modelNonEvictableMiB: estimateModelNonEvictableMiB({
      sizeBytes: bundleBytes,
      engineCtx: model.engineCtx,
      kvBytesPerToken: model.kvBytesPerToken,
    }),
    // Always margined so confirm/start/Settings share one disk requirement.
    modelSizeBytes: diskRequirementBytes(modelBundleSizeBytes(model)),
  });
}

/** Localized hard-gate reason for Alert / error banner. */
/**
 * Bounded releaseEmbedder for chat-init (FIX 2 / round-7 BLOCK policy).
 * Races release against EMBEDDER_RELEASE_TIMEOUT_MS. On timeout:
 *   - markEmbedderHung (drop JS ref; native leak isolated, never reused);
 *   - do NOT clear the native-op chain (hung op holds the barrier — never-overlap);
 *   - do NOT proceed with chat init — caller surfaces an explicit busy UI state.
 * Recovery for a hung native context = process restart. Never throws.
 *
 * Invariant: never two overlapping llama.rn ops; a hung op holds the chain
 * and blocks new native work until restart.
 */
async function releaseEmbedderBounded(): Promise<"released" | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      releaseEmbedder()
        .then(() => "released" as const)
        .catch(() => "released" as const),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(
          () => resolve("timeout"),
          EMBEDDER_RELEASE_TIMEOUT_MS,
        );
      }),
    ]);
    if (result === "timeout") {
      // BLOCK policy (round 7): release timed out — native embedding/release
      // is not cancellable. Drop the JS context ref (markEmbedderHung). Do NOT
      // clear the native-op chain (hung op holds the barrier). Do NOT proceed
      // with chat init. Recovery = process restart.
      markEmbedderHung();
      console.warn(
        `[kalsa] releaseEmbedder timed out after ${EMBEDDER_RELEASE_TIMEOUT_MS}ms; embedder marked hung (nativeOpBusy=${nativeOpBusy()}); chat init blocked — restart to recover`,
      );
    }
    return result;
  } catch {
    return "released";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function gateReasonMessage(
  reason: ModelGateVerdict["reason"],
  t: (key: TranslationKey) => string,
): string {
  switch (reason) {
    case "blocked_tier":
      return t("models.blockedTier");
    case "blocked_ram":
      return t("models.blockedRam");
    case "blocked_disk":
      return t("models.blockedDisk");
    default:
      return t("models.mayNotFit");
  }
}

// ── ConversationCompactor (per-chat, module-level — survives remounts) ─────
const compactorStateByChat = new Map<string, CompactorState>();
/** Pending LLM summary (promoted into frozen rollingSummary on next boundary rebuild). */
const pendingSummaryByChat = new Map<string, string>();
/** Last known history length per chat — clearChat detection (shrink). */
const lastHistoryLenByChat = new Map<string, number>();
/** Force next-turn boundary rebuild after context_full (compaction ON). */
const forceRebuildByChat = new Map<string, boolean>();
/**
 * Warm per-chat BM25 index over the compacted ("older") corpus.
 * Query-time digest hits this every turn (~3 ms); full rebuild only when the
 * boundary advances or state is reset. Cap avoids O(n) blow-up at huge chats.
 */
const digestIndexByChat = new Map<string, RetrieverIndex>();
/** Absolute history index covered by the warm index (older = [0, covered)). */
const digestIndexCoveredByChat = new Map<string, number>();
/** Message-unit count currently in the warm index (for cap / append bookkeeping). */
const digestIndexCorpusLenByChat = new Map<string, number>();
/**
 * Cap older-turns corpus fed to the warm RetrieverIndex.
 * Unbounded corpus → linear rebuild cost (~1.3s at 5000 turns desktop).
 */
const MAX_DIGEST_CORPUS_MESSAGES = 400;
/** Soft message cap before buildSummaryTranscript's existing char budget. */
const MAX_SUMMARY_CORPUS_MESSAGES = 200;
/**
 * MULTI-CHAT LANDMINE: summaryAbortController / summaryDebounceTimer are GLOBAL
 * singletons while other compactor state is per-chat Maps. Fine today because
 * chatId is hardcoded "default". These MUST become per-chat Maps before
 * multi-chat ships, or a send/clear on chat A will abort chat B's summary.
 */
let summaryAbortController: AbortController | null = null;
/**
 * Monotonic per-send turn id for the web_fetch allowlist (F5).
 * Keying on message text alone re-used the allowlist when the user re-sent the
 * same text; identical consecutive messages must get a fresh allowlist.
 */
let fetchAllowlistTurnSeq = 0;
/** Debounce timer: schedule summary only after idle (8s post-turn). */
let summaryDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const SUMMARY_IDLE_DEBOUNCE_MS = 8_000;

/**
 * Exclude error bubbles, kill-recovered partials, and abort-orphaned user turns
 * from digest/summary corpora. Engine history assembly is untouched.
 * - assistant text starting with "⚠️" → skip
 * - assistant with interrupted === true → skip (truncated kill-recovered fragment)
 * - user with no assistant reply immediately after → skip (except last message)
 */
function filterCorpusHygiene(
  messages: HistoryRoleMessage[],
): HistoryRoleMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const out: HistoryRoleMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === "assistant" && m.text.startsWith("⚠️")) continue;
    if (m.role === "assistant" && m.interrupted === true) continue;
    if (m.role === "user") {
      const isLast = i === messages.length - 1;
      if (!isLast) {
        const next = messages[i + 1];
        if (!next || next.role !== "assistant") continue;
      }
    }
    out.push(m);
  }
  return out;
}

function abortBackgroundSummary(): void {
  if (summaryDebounceTimer) {
    clearTimeout(summaryDebounceTimer);
    summaryDebounceTimer = null;
  }
  if (summaryAbortController) {
    try {
      summaryAbortController.abort();
    } catch {
      // ignore
    }
    summaryAbortController = null;
  }
}

function resetDigestIndex(chatId: string): void {
  const id = chatId || DEFAULT_CHAT_ID;
  digestIndexByChat.delete(id);
  digestIndexCoveredByChat.delete(id);
  digestIndexCorpusLenByChat.delete(id);
}

/**
 * Keep the warm RetrieverIndex in sync with the older corpus under `boundary`.
 * - Same boundary as last sync → reuse index (query-time path).
 * - Boundary advanced and under cap → append newly older messages.
 * - Boundary shrunk / over cap / missing → full rebuild from last N older.
 */
function syncDigestIndex(
  chatId: string,
  history: HistoryRoleMessage[],
  boundary: number,
): RetrieverIndex {
  const id = chatId || DEFAULT_CHAT_ID;
  const b = Math.max(0, Math.min(boundary, history.length));
  const olderRaw = history.slice(0, b);
  const olderClean = filterCorpusHygiene(olderRaw);
  const corpus =
    olderClean.length > MAX_DIGEST_CORPUS_MESSAGES
      ? olderClean.slice(-MAX_DIGEST_CORPUS_MESSAGES)
      : olderClean;

  let idx = digestIndexByChat.get(id);
  const covered = digestIndexCoveredByChat.get(id) ?? -1;
  const corpusLen = digestIndexCorpusLenByChat.get(id) ?? 0;

  const needsFullRebuild =
    !idx ||
    covered < 0 ||
    b < covered ||
    // Cap sliding window dropped older units — ordinals/DF would be wrong if we only append.
    (olderClean.length > MAX_DIGEST_CORPUS_MESSAGES &&
      (b !== covered || corpus.length !== corpusLen));

  if (needsFullRebuild) {
    idx = new RetrieverIndex();
    if (corpus.length > 0) {
      // turnIndex = absolute history index of each kept message (approx after hygiene).
      const startIdx = Math.max(0, b - corpus.length);
      idx.append(toRetrievalUnits(corpus, startIdx));
    }
    digestIndexByChat.set(id, idx);
    digestIndexCoveredByChat.set(id, b);
    digestIndexCorpusLenByChat.set(id, corpus.length);
    return idx;
  }

  if (b > covered) {
    const delta = filterCorpusHygiene(history.slice(covered, b));
    if (delta.length > 0) {
      if (corpusLen + delta.length > MAX_DIGEST_CORPUS_MESSAGES) {
        // Append would exceed cap → rebuild from last N of full older corpus.
        idx = new RetrieverIndex();
        if (corpus.length > 0) {
          const startIdx = Math.max(0, b - corpus.length);
          idx.append(toRetrievalUnits(corpus, startIdx));
        }
        digestIndexByChat.set(id, idx);
        digestIndexCoveredByChat.set(id, b);
        digestIndexCorpusLenByChat.set(id, corpus.length);
        return idx;
      }
      idx!.append(toRetrievalUnits(delta, covered));
      digestIndexCorpusLenByChat.set(id, corpusLen + delta.length);
    }
    digestIndexCoveredByChat.set(id, b);
  }

  return idx!;
}

async function resetCompactorChat(chatId: string): Promise<void> {
  const id = chatId || DEFAULT_CHAT_ID;
  compactorStateByChat.delete(id);
  pendingSummaryByChat.delete(id);
  lastHistoryLenByChat.delete(id);
  forceRebuildByChat.delete(id);
  resetDigestIndex(id);
  try {
    await AsyncStorage.multiRemove([
      compactorStorageKey(id),
      summaryStorageKey(id),
    ]);
  } catch {
    // best-effort
  }
}

function validateHistoryMessages(history: unknown[] | undefined): HistoryRoleMessage[] {
  const out: HistoryRoleMessage[] = [];
  for (const m of history ?? []) {
    if (
      m &&
      typeof m === "object" &&
      typeof (m as { text?: unknown }).text === "string" &&
      ((m as { role?: unknown }).role === "user" ||
        (m as { role?: unknown }).role === "assistant")
    ) {
      const role = (m as { role: "user" | "assistant" }).role;
      const text = (m as { text: string }).text;
      const interrupted =
        (m as { interrupted?: unknown }).interrupted === true ? true : undefined;
      const edited =
        (m as { edited?: unknown }).edited === true ? true : undefined;
      const rec: HistoryRoleMessage & { edited?: boolean } = { role, text };
      if (interrupted !== undefined) rec.interrupted = interrupted;
      if (edited !== undefined) rec.edited = edited;
      out.push(rec);
    }
  }
  return out;
}

export type AppShellProps = {
  /**
   * Called after the library persistence queue exhausts 3 retries for a save.
   * Optional so existing mounts (`<AppShell />`) keep working; default path
   * logs + shows a friendly Alert (HIGH-3).
   */
  onPersistenceFailure?: (err: unknown) => void;
};

/**
 * AppShell — la schermata unica di AI Chat (Fase 1).
 *
 * Refactor del monolite originale (App.tsx, 3655 righe): qui restano solo
 * chat + barra modello + Ask AI + viewer miniapp. L'engine locale gira su
 * llama.rn; la barra modello gestisce download/switch dei GGUF.
 */
export function AppShell({ onPersistenceFailure }: AppShellProps = {}) {
  const { colors, styles, fontScaleId } = useLabTheme<any>();
  const typography = useTypography();
  const insets = useSafeAreaInsets();
  const { locale, t } = useLocale();
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // HIGH-5: per-user web tools toggle (default ON). Gates web_search/web_fetch
  // exposure to the model; document_chat is independent.
  const [webToolsEnabled, setWebToolsEnabled] = useState(true);
  const webToolsEnabledRef = useRef(true);
  webToolsEnabledRef.current = webToolsEnabled;
  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(WEB_TOOLS_ENABLED_KEY)
      .then((raw) => {
        if (cancelled) return;
        // Missing key → default ON (current historical behavior).
        if (raw === "0" || raw === "false") {
          setWebToolsEnabled(false);
          webToolsEnabledRef.current = false;
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const toggleWebTools = useCallback(() => {
    setWebToolsEnabled((prev) => {
      const next = !prev;
      webToolsEnabledRef.current = next;
      void AsyncStorage.setItem(WEB_TOOLS_ENABLED_KEY, next ? "1" : "0").catch(
        () => undefined,
      );
      return next;
    });
  }, []);

  // Opt-in error telemetry (default OFF). Passive — never blocks anti-OOM.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const tel = require("../telemetry/telemetry") as {
          initTelemetry: (o?: Record<string, unknown>) => Promise<void>;
        };
        if (cancelled) return;
        await tel.initTelemetry({
          getDeviceContext: () => {
            // Best-effort sync snapshot; full profile is async elsewhere.
            return {
              ramTier: "low" as const,
              totalMemoryBytes: null as number | null,
              osVersion: null as string | null,
              modelId: null as string | null,
              hadWebTools: webToolsEnabledRef.current,
            };
          },
        });
        // Enrich with real device profile once available.
        try {
          const profile = await getCachedDeviceProfile();
          if (cancelled) return;
          await tel.initTelemetry({
            getDeviceContext: () => ({
              ramTier: profile.ramTier,
              totalMemoryBytes: profile.totalMemoryBytes,
              osVersion: profile.osVersion,
              modelId: null,
              hadWebTools: webToolsEnabledRef.current,
            }),
          });
        } catch {
          /* keep defaults */
        }
      } catch {
        /* telemetry never throws */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── User memory refs (declared early so agentOptions can read via getter) ──
  // State/sync for memoryFacts lives below; only injected facts count when enabled.
  const memoryFactsRef = useRef<string[]>([]);
  /** Mirror of MemoryStore.getEnabled — never inject facts when false. */
  const memoryEnabledRef = useRef(false);
  /**
   * Facts actually injected into the system prompt for the CURRENT turn.
   * Captured at send time so the search echo guard still matches them if the
   * user disables memory mid-turn (live enabled/facts refs would go empty).
   */
  const injectedFactsRef = useRef<string[]>([]);

  // ── Document library (local PDF/TXT chat) ────────────────────────────────
  // Owned here so the tool executor + DocumentsScreen share one snapshot.
  // Index cache is a ref Map (not React state) — rebuilt on extract, dropped on delete.
  const [documentLibrary, setDocumentLibrary] = useState<LibraryState>(() =>
    emptyLibraryState(),
  );
  const documentLibraryRef = useRef<LibraryState>(documentLibrary);
  documentLibraryRef.current = documentLibrary;
  const docIndexByIdRef = useRef<Map<string, DocRetrieverIndex>>(new Map());
  /**
   * Per-doc dense vector index. Durable under kalsa-documents/{docId}.vec.json;
   * also held in memory for the session. Dropped on delete / library prune
   * alongside the BM25 index and the .vec.json sidecar.
   */
  const docSemanticByIdRef = useRef<Map<string, SemanticVectorIndex>>(new Map());
  /**
   * Per-doc dense-unavailable reason when the index was refused (cap / corrupt)
   * or partially capped mid-embed. Cleared when a usable index is installed.
   */
  const docDenseReasonByIdRef = useRef<
    Map<string, "cap" | "capped" | "corrupt" | "no_embedder" | "hung">
  >(new Map());
  /**
   * Existing (chunkId, contentHash) keys per doc for incremental embed planning
   * (see embedChunkKey). Same text in different chunks embeds per chunk.
   */
  const docEmbedHashesByIdRef = useRef<Map<string, Set<string>>>(new Map());
  /**
   * Single-flight flag for background embedding jobs (never blocks chat).
   * Set SYNCHRONOUSLY before the first await so a second import cannot race in.
   */
  const embedJobInFlightRef = useRef(false);
  /**
   * Generation token for the background embed job. Bumped on unmount, on
   * library delete of the doc being embedded, and when the chat model starts
   * loading. Bumping also aborts embedJobAbortRef so EmbeddingService sees
   * signal.aborted before every await / initLlama / embedding() call.
   */
  const embedJobGenerationRef = useRef(0);
  /** AbortController paired with embedJobGenerationRef (bump → abort). */
  const embedJobAbortRef = useRef<AbortController | null>(null);
  /**
   * Bump the embed-job generation AND abort the in-flight AbortController so
   * EmbeddingService sees signal.aborted before every await / initLlama /
   * native embedding() call (cancellation contract, FIX B).
   */
  const bumpEmbedJobGeneration = useCallback(() => {
    embedJobGenerationRef.current += 1;
    try {
      embedJobAbortRef.current?.abort();
    } catch {
      /* ignore */
    }
    embedJobAbortRef.current = null;
  }, []);
  /** Cached embedder-downloaded flag (refreshed on download / Settings open). */
  const embedderDownloadedRef = useRef(false);
  /**
   * Mirrors modelState for sync residency checks from the embed job (refs are
   * readable without waiting for a re-render). "ready" / "loading" mean the
   * chat LlamaContext is resident or about to be.
   */
  const modelStateRef = useRef<ModelState>("checking");
  /**
   * Delete authority is the shared docOpGate (module-level), not a React ref.
   * Screen unmount cannot clear it — reopen cannot start import during an old
   * deleteAsync, and document_chat cannot read while delete holds the gate.
   */
  /**
   * Effective n_ctx for document tool + long-chat budgeting.
   * Catalog resolve is the pre-init estimate; after initEngine it is overwritten
   * with the reported effectiveNCtx (post memory-clamp). Single source for:
   * engine init, document strategy (getCtxTokens), and UI long-chat thresholds.
   */
  const chatEngineCtxRef = useRef<number>(4096);
  /**
   * Mutation counter for the library load race: every local edit increments it;
   * a late AsyncStorage load applies only when no mutation has happened yet.
   */
  const libraryMutationRef = useRef(0);
  /**
   * FIFO serialized persistence queue (HIGH-5). add → reorder → preview-update
   * → delete writes land at AsyncStorage in order so a slow save cannot
   * overwrite a newer state. Failures retry up to 3 times, then surface via
   * onPersistenceFailure (or console.warn + Alert) — queue keeps draining
   * subsequent saves so one failure never deadlocks the chain (HIGH-3).
   */
  const pendingSavePromiseRef = useRef<Promise<void>>(Promise.resolve());
  const onPersistenceFailureRef = useRef(onPersistenceFailure);
  onPersistenceFailureRef.current = onPersistenceFailure;

  const enqueueLibrarySave = useCallback(
    (state: LibraryState) => {
      const run = async () => {
        let attempt = 0;
        let lastErr: unknown;
        while (attempt < 3) {
          try {
            await saveLibraryState(getDefaultLibraryStorage(), state);
            return;
          } catch (err) {
            lastErr = err;
            attempt += 1;
          }
        }
        // 3 retries exhausted — notify without throwing (queue must continue).
        const handler = onPersistenceFailureRef.current;
        if (handler) {
          try {
            handler(lastErr);
          } catch {
            /* host handler must not break the save chain */
          }
        } else {
          console.warn(
            "[AppShell] library persistence failed after 3 retries",
            lastErr,
          );
          try {
            Alert.alert(t("documents.title"), t("documents.errorSave"));
          } catch {
            /* Alert unavailable (tests / headless) — warn already logged */
          }
        }
      };
      pendingSavePromiseRef.current = pendingSavePromiseRef.current
        .then(run, run)
        .catch(() => undefined);
    },
    [t],
  );

  useEffect(() => {
    let mounted = true;
    const loadGen = libraryMutationRef.current;
    void loadLibraryState(getDefaultLibraryStorage())
      .then(async (state) => {
        if (!mounted) return;
        // Drop stale load if the user already added/deleted a doc.
        if (libraryMutationRef.current !== loadGen) {
          return;
        }
        setDocumentLibrary(state);
        // FIX D: NO startup vector restore. Parsing every .vec.json on the JS
        // thread stalls the UI and spikes memory for large libraries. Vectors
        // are restored lazily per doc on the first hybrid query (see
        // ensureSemanticIndexLoaded). Memory policy: cap total loaded floats
        // (VECTOR_MEMORY_FLOAT_CAP); beyond → leave that doc BM25-only.
      })
      .catch(() => {
        /* keep empty library on load failure */
      });
    return () => {
      mounted = false;
      // Cancel any in-flight embed job so it cannot lazy-init after unmount.
      bumpEmbedJobGeneration();
    };
  }, [bumpEmbedJobGeneration]);

  const handleLibraryChange = useCallback((next: LibraryState) => {
    // Refuse library mutations (import/add) while a delete is in flight so a
    // fresh import cannot race the old deleteAsync / functional drop.
    if (isDeleteActive()) {
      return;
    }
    libraryMutationRef.current += 1;
    // Drop indexes for removed docs so delete frees retrieval memory.
    const nextIds = new Set((next.docs ?? []).map((d) => d.id));
    for (const id of docIndexByIdRef.current.keys()) {
      if (!nextIds.has(id)) docIndexByIdRef.current.delete(id);
    }
    for (const id of docSemanticByIdRef.current.keys()) {
      if (!nextIds.has(id)) {
        docSemanticByIdRef.current.delete(id);
        docEmbedHashesByIdRef.current.delete(id);
        docDenseReasonByIdRef.current.delete(id);
      }
    }
    for (const id of docDenseReasonByIdRef.current.keys()) {
      if (!nextIds.has(id)) docDenseReasonByIdRef.current.delete(id);
    }
    setDocumentLibrary(next);
    enqueueLibrarySave(next);
  }, [enqueueLibrarySave]);

  /**
   * AppShell-owned document delete. Shared docOpGate DELETE + FS delete + index
   * drop + functional state update all live here so DocumentsScreen unmount
   * cannot clear the guard or capture a stale `library` snapshot.
   * @returns false when refused (any document op already in flight).
   */
  const deleteDocument = useCallback(async (id: string): Promise<boolean> => {
    if (!id || typeof id !== "string") return false;
    // Shared gate: refuse while a read (document_chat) OR another delete is active.
    if (!tryAcquireDelete()) return false;
    // Cancel any background embed for this (or any) doc before dropping files:
    // the embed loop checks the generation token + AbortSignal before every commit.
    bumpEmbedJobGeneration();
    try {
      // Resolve CURRENT library snapshot — never a captured prop.
      const current = documentLibraryRef.current;
      const doc = (current.docs ?? []).find((d) => d.id === id);
      if (doc?.fileUri) {
        await deleteOwnedFile(doc.fileUri);
      }
      // Drop durable page-1 cover JPEG (owned under kalsa-covers/).
      if (doc?.previewUri) {
        await deleteOwnedFile(doc.previewUri);
      }
      // Drop durable dense-vector sidecar alongside the owned file.
      await deleteVectorIndexFile(id);
      // Drop retrieval + semantic indexes for this id (best-effort; functional
      // filter below is the source of truth for the list).
      docIndexByIdRef.current.delete(id);
      docSemanticByIdRef.current.delete(id);
      docEmbedHashesByIdRef.current.delete(id);
      docDenseReasonByIdRef.current.delete(id);
      libraryMutationRef.current += 1;
      // Gate blocks handleLibraryChange, so ref is current. Functional updater
      // still guards against any non-import concurrent React state write.
      const next: LibraryState = {
        docs: (documentLibraryRef.current.docs ?? []).filter((d) => d.id !== id),
      };
      documentLibraryRef.current = next;
      setDocumentLibrary((prev) => ({
        docs: (prev.docs ?? []).filter((d) => d.id !== id),
      }));
      enqueueLibrarySave(next);
      return true;
    } finally {
      releaseDelete();
    }
  }, [bumpEmbedJobGeneration, enqueueLibrarySave]);

  /**
   * AppShell-owned document add (import commit). Prepends (new-on-top).
   * Invariant: every library mutation (add + delete) is owned by AppShell,
   * applied against current ref state with a functional updater; screens never
   * merge snapshots. A screen-captured `library` prop must not re-add a doc
   * that was deleted while import was in flight.
   * @returns false when refused (delete gate held — screen surfaces busy).
   */
  const addDocument = useCallback((entry: LibraryDoc): boolean => {
    if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
      return false;
    }
    if (isDeleteActive()) return false;
    libraryMutationRef.current += 1;
    // Atomic commit against CURRENT state — never a screen-captured snapshot.
    // Prepend: newest import sits at the top of the list (CRIT-3).
    const next: LibraryState = {
      docs: [entry, ...(documentLibraryRef.current.docs ?? [])],
    };
    documentLibraryRef.current = next;
    // Functional updater is the authoritative React commit.
    setDocumentLibrary((prev) => ({
      docs: [entry, ...(prev.docs ?? [])],
    }));
    enqueueLibrarySave(next);
    // Background incremental embed (post-import, never blocks chat).
    // Single-flight; silent skip when embedder missing / load fails.
    void scheduleBackgroundEmbed(entry);
    return true;
  }, [enqueueLibrarySave]);

  /**
   * Reorder library docs by id permutation. Malformed orderedIds are a no-op
   * (reorderDocs pure contract). Persistence goes through the FIFO queue.
   */
  const reorderDocuments = useCallback(
    (orderedIds: string[]): void => {
      if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;
      if (isDeleteActive()) return;
      const prev = documentLibraryRef.current;
      const next = reorderDocs(prev, orderedIds);
      // No-op when pure helper refused OR order already matches (same ids).
      const prevIds = (prev.docs ?? []).map((d) => d.id).join("\0");
      const nextIds = (next.docs ?? []).map((d) => d.id).join("\0");
      if (prevIds === nextIds) return;
      libraryMutationRef.current += 1;
      documentLibraryRef.current = next;
      setDocumentLibrary(next);
      enqueueLibrarySave(next);
    },
    [enqueueLibrarySave],
  );

  /**
   * Commit a durable cover URI onto an existing library entry. Refuses when
   * the doc is gone (generation / delete race). Functional updater + queue.
   */
  const updateDocumentPreview = useCallback(
    (id: string, previewUri: string): void => {
      if (!id || typeof id !== "string" || id.length === 0) return;
      if (!previewUri || typeof previewUri !== "string") return;
      if (isDeleteActive()) return;
      const current = documentLibraryRef.current;
      if (!(current.docs ?? []).some((d) => d.id === id)) return;
      libraryMutationRef.current += 1;
      const next: LibraryState = {
        docs: (current.docs ?? []).map((d) =>
          d.id === id ? { ...d, previewUri } : d,
        ),
      };
      documentLibraryRef.current = next;
      setDocumentLibrary((prev) => ({
        docs: (prev.docs ?? []).map((d) =>
          d.id === id ? { ...d, previewUri } : d,
        ),
      }));
      enqueueLibrarySave(next);
    },
    [enqueueLibrarySave],
  );

  const isDocumentDeleteInFlight = useCallback(() => isDeleteActive(), []);

  /**
   * FIX D — lazy per-doc vector restore (no startup cost).
   *
   * Memory policy: total loaded floats across all docs must stay under
   * DEFAULT_VECTOR_MEMORY_FLOAT_CAP (400_000 ≈ 1.6 MB fp32; raised from 200k
   * after Jelly HIGH-4: 516-chunk partial on 273 KB docs). If loading this
   * doc would exceed the cap, leave it BM25-only (return null) and record
   * reason "cap". Corrupt / missing sidecars → reason "corrupt".
   */
  const VECTOR_MEMORY_FLOAT_CAP = DEFAULT_VECTOR_MEMORY_FLOAT_CAP;
  const ensureSemanticIndexLoaded = useCallback(
    async (docId: string): Promise<SemanticVectorIndex | null> => {
      if (!docId || typeof docId !== "string") return null;
      const live = docSemanticByIdRef.current.get(docId);
      if (live && live.chunkCount > 0) {
        // Live index may still be marked capped (partial embed) — keep reason.
        return live;
      }

      // Doc must still be in the library.
      if (!documentLibraryRef.current.docs?.some((d) => d.id === docId)) {
        return null;
      }

      // document_chat already holds READ (non-reentrant). Reuse that latch
      // instead of tryAcquireRead, which would fail and skip the sidecar load.
      const readAlreadyHeld = isReadActive();
      if (!readAlreadyHeld && !tryAcquireRead()) return null;
      try {
        const raw = await readVectorIndexFile(docId);
        // Re-check after await.
        if (!documentLibraryRef.current.docs?.some((d) => d.id === docId)) {
          return null;
        }
        if (!raw || typeof raw !== "object") {
          // Missing sidecar is not "corrupt" — just cold (no reason).
          return null;
        }
        let idx: SemanticVectorIndex;
        try {
          idx = SemanticVectorIndex.fromJSON(
            raw as ReturnType<SemanticVectorIndex["toJSON"]>,
          );
        } catch {
          docDenseReasonByIdRef.current.set(docId, "corrupt");
          return null; // corrupt / bad dims → BM25-only
        }
        // Zero-vector edge (round 6): a capped sidecar with zero valid vectors
        // must still record "capped" so hybrid surfaces degraded-cap consistently
        // (do not early-return before recording the reason).
        if (idx.chunkCount <= 0) {
          if (idx.isCapped) {
            docDenseReasonByIdRef.current.set(docId, "capped");
          }
          return null;
        }

        // Memory policy: refuse load if total floats would exceed the cap.
        const loadedFloats = totalResidentFloats(docSemanticByIdRef.current.values());
        const incoming = idx.chunkCount * idx.dims;
        if (loadedFloats + incoming > VECTOR_MEMORY_FLOAT_CAP) {
          // Beyond cap → BM25-only for this doc; surface reason to hybrid path.
          docDenseReasonByIdRef.current.set(docId, "cap");
          return null;
        }

        docSemanticByIdRef.current.set(docId, idx);
        docEmbedHashesByIdRef.current.set(docId, idx.contentHashKeys());
        // FIX 3: retain "capped" when the restored index is partial; only clear
        // the reason when the index is genuinely uncapped (full hybrid).
        if (idx.isCapped) {
          docDenseReasonByIdRef.current.set(docId, "capped");
        } else {
          docDenseReasonByIdRef.current.delete(docId);
        }
        return idx;
      } catch {
        docDenseReasonByIdRef.current.set(docId, "corrupt");
        return null;
      } finally {
        if (!readAlreadyHeld) releaseRead();
      }
    },
    [],
  );

  /**
   * Background embed job for a freshly imported document.
   *
   * Residency / cancellation (FIX B):
   *   - chat init and embedder init are mutually exclusive (both ends).
   *   - job owns an AbortController; bumpEmbedJobGeneration aborts it so
   *     EmbeddingService sees signal.aborted before every await / initLlama.
   *   - ensureEmbedder refuses while chat_ready without co-res; AppShell also skips
   *     the job when chat is resident on ≤6 GB (soft pre-gate + log).
   *
   * Ownership on commit (FIX A):
   *   - READ latch blocks delete concurrently, but ownership is still
   *     re-checked at every commit:
   *       !lib && !map → abort (ownership lost / deleted)
   *       !lib &&  map → abort (library wins; drop map entry)
   *       lib  && !map → COLD import / recreate (create ownership)
   *       lib  &&  map → commit into the owned index
   *
   * Chunking (FIX F): listDocumentChunksForEmbed → listDocChunks (shared
   * with DocRetrieverIndex) so dense/BM25 chunkIds are byte-identical.
   *
   * Never throws; never holds the chat path.
   */
  const scheduleBackgroundEmbed = useCallback(async (entry: LibraryDoc) => {
    if (!entry?.id || !entry.fileUri) return;
    // Single-flight: set SYNCHRONOUSLY before the first await so a concurrent
    // import cannot sneak a second job past the flag.
    if (embedJobInFlightRef.current) {
      // eslint-disable-next-line no-console
      console.log(
        `[embed] skip: already in flight {"docId":${JSON.stringify(entry.id)}}`,
      );
      return;
    }
    embedJobInFlightRef.current = true;
    const jobGen = embedJobGenerationRef.current;
    const stillCurrent = () => jobGen === embedJobGenerationRef.current;

    // Job-scoped AbortController: bumpEmbedJobGeneration() aborts it.
    const ac = new AbortController();
    embedJobAbortRef.current = ac;
    const signal = ac.signal;

    // eslint-disable-next-line no-console
    console.log(
      `[embed] start {"docId":${JSON.stringify(entry.id)},"kind":${JSON.stringify(entry.kind)}}`,
    );

    /**
     * Chat residency gate for the soft RAM pre-check.
     * "Resident" means the ENGINE is loaded (or loading), NOT that the GGUF is
     * merely on disk. modelState "ready" after the download probe means
     * downloaded-on-disk only — treating it as resident blocked embeds on cold
     * start (header "Ready · local") even when isEngineReady() was false.
     * Use loading UI state + isEngineReady only.
     */
    const isChatResident = () => {
      const st = modelStateRef.current;
      // "loading" covers the window between setModelState("loading") and
      // isEngineReady() flipping true (engine init in flight).
      if (st === "loading") return true;
      try {
        if (isEngineReady()) return true;
      } catch {
        /* ignore */
      }
      return false;
    };

    /** Soft pre-gate: skip job early when chat resident on ≤6 GB (log). */
    const mustSkipForRam = async (): Promise<boolean> => {
      if (!isChatResident()) return false;
      try {
        const profile = await getCachedDeviceProfile();
        const total = profile.totalMemoryBytes ?? 0;
        // Keep gate co-residency inputs fresh for tryAcquireEmbed (§5).
        setCoResidencyContext({
          totalMemoryBytes: total,
          chatModelIs2B: isChatModel2BClass(getActiveModelId()),
        });
        // <= 6 GB: refuse co-residence. Unknown RAM (0/null) → conservative skip.
        // Hard gate is still llamaContextGate.tryAcquireEmbed.
        if (total <= 0 || total <= CO_RESIDENCY_MIN_MEMORY_BYTES) return true;
        // 4B chat: no co-residency even on 8GB+.
        if (isChatModel4BClass(getActiveModelId())) return true;
        return false;
      } catch {
        return true;
      }
    };

    // Shared READ latch for the whole run so delete cannot remove the file /
    // index mid-embed, and so we cannot resurrect a deleted index.
    if (!tryAcquireRead()) {
      // eslint-disable-next-line no-console
      console.log(
        `[embed] skip: read gate busy {"docId":${JSON.stringify(entry.id)}}`,
      );
      embedJobInFlightRef.current = false;
      if (embedJobAbortRef.current === ac) embedJobAbortRef.current = null;
      return;
    }

    try {
      if (!stillCurrent() || signal.aborted) {
        // eslint-disable-next-line no-console
        console.log(
          `[embed] skip: aborted before work {"docId":${JSON.stringify(entry.id)}}`,
        );
        return;
      }

      if (await mustSkipForRam()) {
        // eslint-disable-next-line no-console
        console.log(
          "[embed] skip: chat resident on ≤6GB RAM — BM25-only until chat released",
        );
        return;
      }
      if (!stillCurrent() || signal.aborted) {
        // eslint-disable-next-line no-console
        console.log(
          `[embed] skip: aborted after RAM gate {"docId":${JSON.stringify(entry.id)}}`,
        );
        return;
      }

      if (!embedderDownloadedRef.current) {
        try {
          const status = await getEmbeddingModelStatus({ signal });
          if (!stillCurrent() || signal.aborted) {
            // eslint-disable-next-line no-console
            console.log(
              `[embed] skip: aborted during embedder status {"docId":${JSON.stringify(entry.id)}}`,
            );
            return;
          }
          embedderDownloadedRef.current = status === "downloaded";
        } catch {
          // eslint-disable-next-line no-console
          console.log(
            `[embed] skip: embedder status failed {"docId":${JSON.stringify(entry.id)}}`,
          );
          return;
        }
        if (!embedderDownloadedRef.current) {
          // eslint-disable-next-line no-console
          console.log(
            `[embed] skip: embedder missing {"docId":${JSON.stringify(entry.id)}}`,
          );
          return;
        }
      }

      // Load text the same way document_chat does (txt / pdf pages).
      let pages: Array<{ docId: string; text: string }> = [];
      if (entry.kind === "txt") {
        try {
          const raw = await FileSystem.readAsStringAsync(entry.fileUri);
          if (!stillCurrent() || signal.aborted) {
            // eslint-disable-next-line no-console
            console.log(
              `[embed] skip: aborted during txt read {"docId":${JSON.stringify(entry.id)}}`,
            );
            return;
          }
          const looksHtml = /<\/?[a-z][\s\S]*>/i.test(raw.slice(0, 2000));
          const text = looksHtml ? htmlToText(raw).text : raw;
          const trimmed = (text ?? "").trim();
          if (trimmed) {
            pages = [{ docId: entry.sourceId || entry.id, text: trimmed }];
          }
        } catch {
          // eslint-disable-next-line no-console
          console.log(
            `[embed] skip: txt read failed {"docId":${JSON.stringify(entry.id)}}`,
          );
          return;
        }
      } else {
        try {
          const extracted = await requestPdfText(entry.fileUri, {
            sourceId: entry.sourceId || entry.id,
            title: entry.name,
            signal,
          });
          if (!stillCurrent() || signal.aborted) {
            // eslint-disable-next-line no-console
            console.log(
              `[embed] skip: aborted during pdf extract {"docId":${JSON.stringify(entry.id)}}`,
            );
            return;
          }
          const docs = Array.isArray(extracted?.docs) ? extracted.docs : [];
          pages = docs
            .filter((d) => d && typeof d.text === "string" && d.text.trim().length > 0)
            .map((d) => ({
              docId: typeof d.docId === "string" ? d.docId : entry.sourceId || entry.id,
              text: d.text,
            }));
        } catch {
          // eslint-disable-next-line no-console
          console.log(
            `[embed] skip: pdf extract failed {"docId":${JSON.stringify(entry.id)}}`,
          );
          return;
        }
      }
      if (pages.length === 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[embed] skip: pages empty {"docId":${JSON.stringify(entry.id)}}`,
        );
        return;
      }

      // FIX F: single source of truth via listDocChunks (retrievalLoop).
      const chunks = listDocumentChunksForEmbed(pages);
      if (chunks.length === 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[embed] skip: chunks empty {"docId":${JSON.stringify(entry.id)},"pages":${pages.length}}`,
        );
        return;
      }

      const existing =
        docEmbedHashesByIdRef.current.get(entry.id) ?? new Set<string>();
      const liveIdx = docSemanticByIdRef.current.get(entry.id);
      if (liveIdx) {
        for (const k of liveIdx.contentHashKeys()) existing.add(k);
      }
      const toEmbed = planChunksToEmbed(existing, chunks);
      if (toEmbed.length === 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[embed] skip: already embedded {"docId":${JSON.stringify(entry.id)},"chunks":${chunks.length}}`,
        );
        return;
      }
      // eslint-disable-next-line no-console
      console.log(
        `[embed] plan {"docId":${JSON.stringify(entry.id)},"toEmbed":${toEmbed.length},"totalChunks":${chunks.length}}`,
      );

      // Working index: either the map-owned one or a fresh cold-import index.
      let index =
        docSemanticByIdRef.current.get(entry.id) ??
        new SemanticVectorIndex({ dims: EMBEDDING_MODEL.dims });

      // Embed one-by-one (G99 ~1–3 s/chunk). Abort if gen stale / signal / deleted.
      // Terminal reason tracks why the job ended so `[embed] done` is never
      // misleading on partial/failed exits (vec null, reject, cap, delete).
      let embeddedCount = 0;
      /** "completed" | "partial" | "failed" | "aborted" — set before every exit. */
      let terminalReason: "completed" | "partial" | "failed" | "aborted" =
        "completed";
      const logEmbedDone = (reason: typeof terminalReason) => {
        // eslint-disable-next-line no-console
        console.log(
          `[embed] done {"docId":${JSON.stringify(entry.id)},"embedded":${embeddedCount},"indexChunks":${index.chunkCount},"reason":${JSON.stringify(reason)}}`,
        );
        // Opt-in telemetry: genuine native/model failures only.
        // RAM-gate / abort / hung / not-downloaded / cap / partial are excluded.
        if (reason === "failed") {
          try {
            const kind = consumeLastEmbedFailure();
            if (
              kind === "oom" ||
              kind === "model_corrupt" ||
              kind === "native_crash"
            ) {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const tel = require("../telemetry/telemetry") as {
                reportTelemetry: (i: Record<string, unknown>) => void;
              };
              tel.reportTelemetry({
                code: "embed.native",
                detail: kind,
                phase: "embed",
                chunks: embeddedCount,
              });
            }
          } catch {
            /* telemetry never throws */
          }
        }
      };
      for (const chunk of toEmbed) {
        if (!stillCurrent() || signal.aborted) {
          // eslint-disable-next-line no-console
          console.log(
            `[embed] abort mid-job: signal/gen {"docId":${JSON.stringify(entry.id)},"embedded":${embeddedCount}}`,
          );
          logEmbedDone("aborted");
          return;
        }
        if (!documentLibraryRef.current.docs?.some((d) => d.id === entry.id)) {
          // eslint-disable-next-line no-console
          console.log(
            `[embed] abort mid-job: doc deleted {"docId":${JSON.stringify(entry.id)}}`,
          );
          logEmbedDone("aborted");
          return;
        }
        if (await mustSkipForRam()) {
          // eslint-disable-next-line no-console
          console.log(
            "[embed] abort mid-job: chat became resident on ≤6GB — no embedder init",
          );
          // RAM-gate is not a native embed failure (design §5).
          logEmbedDone(embeddedCount > 0 ? "partial" : "aborted");
          return;
        }
        if (!stillCurrent() || signal.aborted) {
          // eslint-disable-next-line no-console
          console.log(
            `[embed] abort mid-job: signal after RAM gate {"docId":${JSON.stringify(entry.id)}}`,
          );
          logEmbedDone("aborted");
          return;
        }

        // FIX B: pass job signal so EmbeddingService aborts at every await.
        const vec = await embedDocumentChunk(chunk.text, { signal });
        if (!stillCurrent() || signal.aborted) {
          // eslint-disable-next-line no-console
          console.log(
            `[embed] abort mid-job: signal after chunk embed {"docId":${JSON.stringify(entry.id)},"chunkId":${JSON.stringify(chunk.chunkId)}}`,
          );
          logEmbedDone("aborted");
          return;
        }
        if (!vec) {
          // Embedder failed / refused (chat resident) / aborted — stop.
          // eslint-disable-next-line no-console
          console.log(
            `[embed] skip: embedder init refused or chunk failed {"docId":${JSON.stringify(entry.id)},"chunkId":${JSON.stringify(chunk.chunkId)}}`,
          );
          // Partial if some chunks already landed; failed if none did.
          terminalReason = embeddedCount > 0 ? "partial" : "failed";
          break;
        }
        // eslint-disable-next-line no-console
        console.log(
          `[embed] chunk ok {"docId":${JSON.stringify(entry.id)},"chunkId":${JSON.stringify(chunk.chunkId)},"dims":${vec.length}}`,
        );

        // FIX D — cap at add time (not only on restore). Account for other
        // docs' resident floats + this index; replacements of same chunkId
        // cost 0 net floats. Skip + mark capped when the would-be total
        // exceeds VECTOR_MEMORY_FLOAT_CAP.
        let otherFloats = 0;
        for (const [id, other] of docSemanticByIdRef.current) {
          if (id === entry.id) continue;
          otherFloats += other.chunkCount * other.dims;
        }
        const addResult = index.addVectors(
          [
            {
              chunkId: chunk.chunkId,
              vector: vec,
              text: chunk.text,
              contentHash: chunk.contentHash,
            },
          ],
          {
            floatCap: VECTOR_MEMORY_FLOAT_CAP,
            otherResidentFloats: otherFloats,
          },
        );
        if (addResult.skippedByCap > 0 || index.isCapped) {
          docDenseReasonByIdRef.current.set(entry.id, "capped");
          // Keep whatever we already have; stop embedding further chunks.
          if (index.chunkCount > 0) {
            docSemanticByIdRef.current.set(entry.id, index);
            docEmbedHashesByIdRef.current.set(entry.id, existing);
            try {
              await writeVectorIndexFile(entry.id, index.toJSON());
              // eslint-disable-next-line no-console
              console.log(
                `[embed] write (cap) {"docId":${JSON.stringify(entry.id)},"chunks":${index.chunkCount}}`,
              );
            } catch {
              /* best-effort */
            }
          }
          // eslint-disable-next-line no-console
          console.log(
            `[embed] cap reached {"docId":${JSON.stringify(entry.id)},"chunks":${index.chunkCount}} — remaining skipped; hybrid degrades when index empty`,
          );
          // Cap stop: partial (some/all of planned remaining skipped).
          logEmbedDone("partial");
          return;
        }
        if (addResult.added === 0) {
          // Vector rejected for non-cap reasons (zero/bad dims) — stop.
          // eslint-disable-next-line no-console
          console.log(
            `[embed] skip: vector rejected {"docId":${JSON.stringify(entry.id)},"chunkId":${JSON.stringify(chunk.chunkId)}}`,
          );
          terminalReason = embeddedCount > 0 ? "partial" : "failed";
          break;
        }
        existing.add(embedChunkKey(chunk.chunkId, chunk.contentHash));
        embeddedCount += 1;

        // ── FIX A: semantic-map ownership at commit ─────────────────────────
        // Invariant: the READ latch blocks concurrent delete, but ownership
        // must still be checked at commit. Every path either creates, commits
        // into an owned index, or aborts — no empty branch.
        const libHas = !!documentLibraryRef.current.docs?.some(
          (d) => d.id === entry.id,
        );
        const mapHas = docSemanticByIdRef.current.has(entry.id);

        if (!libHas) {
          // Library no longer lists the doc → ownership lost / deleted. Abort
          // without writing map or durable file (do not resurrect).
          if (mapHas) {
            docSemanticByIdRef.current.delete(entry.id);
            docEmbedHashesByIdRef.current.delete(entry.id);
          }
          // eslint-disable-next-line no-console
          console.log(
            `[embed] abort mid-job: doc deleted at commit {"docId":${JSON.stringify(entry.id)},"embedded":${embeddedCount}}`,
          );
          logEmbedDone("aborted");
          return;
        }

        if (!mapHas) {
          // COLD import (map never owned) OR previously-owned index was cleared
          // while the library still lists the doc → recreate ownership by
          // committing this working index into the map.
          // (index is already the working set for this job.)
        } else {
          // Map still owns this docId → commit into the owned index.
          // Prefer the live map entry if it is the same object; otherwise keep
          // our working index (we seeded from it at job start).
          const owned = docSemanticByIdRef.current.get(entry.id);
          if (owned && owned !== index) {
            // Map was replaced under us (should not happen under single-flight
            // + READ latch) — abort rather than clobber a foreign owner.
            // eslint-disable-next-line no-console
            console.log(
              `[embed] abort mid-job: map ownership lost {"docId":${JSON.stringify(entry.id)},"embedded":${embeddedCount}}`,
            );
            logEmbedDone("aborted");
            return;
          }
        }

        // Create / commit path: set map + durable sidecar.
        docSemanticByIdRef.current.set(entry.id, index);
        docEmbedHashesByIdRef.current.set(entry.id, existing);
        // Clear cap/corrupt reason when we successfully install vectors
        // (unless the index itself is marked capped mid-job).
        if (index.isCapped) {
          docDenseReasonByIdRef.current.set(entry.id, "capped");
        } else {
          docDenseReasonByIdRef.current.delete(entry.id);
        }
        try {
          await writeVectorIndexFile(entry.id, index.toJSON());
          // eslint-disable-next-line no-console
          console.log(
            `[embed] write {"docId":${JSON.stringify(entry.id)},"chunks":${index.chunkCount}}`,
          );
        } catch {
          /* best-effort durable write */
        }
        if (!stillCurrent() || signal.aborted) {
          logEmbedDone("aborted");
          return;
        }
        // Post-write existence check: if deleted during the write, drop the
        // resurrected map entry (delete already removed the file under its gate).
        if (!documentLibraryRef.current.docs?.some((d) => d.id === entry.id)) {
          docSemanticByIdRef.current.delete(entry.id);
          docEmbedHashesByIdRef.current.delete(entry.id);
          // eslint-disable-next-line no-console
          console.log(
            `[embed] abort mid-job: doc deleted post-write {"docId":${JSON.stringify(entry.id)},"embedded":${embeddedCount}}`,
          );
          logEmbedDone("aborted");
          return;
        }
      }
      // Loop finished or broke: completed only when every planned chunk embedded.
      if (terminalReason === "completed" && embeddedCount < toEmbed.length) {
        // Defensive: break sites set terminalReason; if any path forgot, treat
        // as partial rather than silently claiming completed.
        terminalReason = embeddedCount > 0 ? "partial" : "failed";
      }
      logEmbedDone(terminalReason);
    } catch {
      // ignore — hybrid degrades to BM25
      // eslint-disable-next-line no-console
      console.log(
        `[embed] skip: job exception {"docId":${JSON.stringify(entry.id)}}`,
      );
    } finally {
      releaseRead();
      embedJobInFlightRef.current = false;
      if (embedJobAbortRef.current === ac) embedJobAbortRef.current = null;
    }
  }, []); // refs only — bumpEmbedJobGeneration is stable via useCallback([])

  // ── Web tools (search + fetch): default ON, per-user toggleable (HIGH-5).
  // Queries / fetches only run when the tool is called (privacy by design).
  // Per-turn allowlist: URLs from the user message + every web_search result;
  // web_fetch may only open those (closes crafted-URL exfiltration). Redirects
  // may land on another path/port of the SAME host, or an already-allowlisted URL.
  // document_chat sits alongside web tools and reuses requestPdfText (no new host).
  // agentOptions is rebuilt when webToolsEnabled flips so the tool list matches.
  const agentOptions = useMemo<EngineTurnOptions>(() => {
    const searchExec = makeWebSearchExecutor(locale, {
      getMemoryFacts: () => injectedFactsRef.current,
    });
    // Recreated when fetchAllowlistTurnSeq advances (each send); held across
    // tool rounds within the same turn so search results stay allowlisted.
    const pdfCacheFs = makePdfCacheFs({
      getDirectory: () =>
        FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "",
      writeAsBase64: (uri, base64) =>
        FileSystem.writeAsStringAsync(uri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        }),
      deleteAsync: (uri) =>
        FileSystem.deleteAsync(uri, { idempotent: true }).then(() => undefined),
      noCacheDirMessage: getStrings(locale).errors.webFetchPdfNoCacheDir,
    });
    const fetchDeps = {
      extractPdfText: (
        fileUri: string,
        opts?: { sourceId?: string; title?: string | null; signal?: AbortSignal },
      ) => requestPdfText(fileUri, opts),
      pdfCacheFs,
      isPdfTextExtractionBusy,
    };
    let allowlist: FetchAllowlist = makeFetchAllowlist();
    let fetchExec = makeWebFetchExecutor(locale, allowlist, fetchDeps);
    let seededTurnSeq: number | null = null;

    const ensureAllowlistForTurn = (lastUserMessage?: string) => {
      if (seededTurnSeq === fetchAllowlistTurnSeq) return;
      allowlist = makeFetchAllowlist();
      if (lastUserMessage) allowlist.addFromText(lastUserMessage);
      fetchExec = makeWebFetchExecutor(locale, allowlist, fetchDeps);
      seededTurnSeq = fetchAllowlistTurnSeq;
    };

    const documentExec = createDocumentChatExecutor(
      {
        getLibraryDocs: () => documentLibraryRef.current.docs ?? [],
        requestPdfText: (doc: LibraryDoc, opts) =>
          requestPdfText(doc.fileUri, {
            sourceId: doc.sourceId,
            title: doc.name,
            signal: opts?.signal,
          }),
        readTxt: async (doc: LibraryDoc, opts) => {
          // Uncancellable host read: check abort BEFORE starting and AFTER settle
          // so wrapper abort rejects the caller while strategy still holds the latch.
          if (opts?.signal?.aborted) {
            throw new Error("document_chat aborted");
          }
          // expo-file-system read has no AbortSignal; honor abort before/after.
          const raw = await FileSystem.readAsStringAsync(doc.fileUri);
          if (opts?.signal?.aborted) {
            throw new Error("document_chat aborted");
          }
          const looksHtml = /<\/?[a-z][\s\S]*>/i.test(raw.slice(0, 2000));
          if (looksHtml) return htmlToText(raw).text;
          return raw;
        },
        getCtxTokens: () => chatEngineCtxRef.current,
        getIndexFor: (docId: string) =>
          docIndexByIdRef.current.get(docId) ?? null,
        setIndexFor: (docId: string, index: DocRetrieverIndex) => {
          docIndexByIdRef.current.set(docId, index);
        },
        getSemanticIndexFor: (docId: string) =>
          docSemanticByIdRef.current.get(docId) ?? null,
        // FIX D: lazy restore from durable sidecar on first hybrid query.
        loadSemanticIndexFor: (docId: string) => ensureSemanticIndexLoaded(docId),
        getDenseUnavailableReason: (docId: string) => {
          // Process-wide hung embedder wins over per-doc reasons so hybrid
          // surfaces degradedNoEmbedder after an abandoned native op.
          if (isEmbedderHung()) return "hung";
          return docDenseReasonByIdRef.current.get(docId) ?? null;
        },
        isEmbedderDownloaded: () => embedderDownloadedRef.current,
        // FIX 6: thread AbortSignal into embedQuery (native abort gate).
        embedQuery: (text: string, signal?: AbortSignal) =>
          embedQueryVec(text, signal ? { signal } : undefined),
      },
      { locale },
    );
    // ensureSemanticIndexLoaded is stable (useCallback []); captured above.

    // HIGH-5: omit web tools when the user toggled Web off. document_chat always
    // stays available so library attachments keep working offline.
    const tools = webToolsEnabled
      ? [WEB_SEARCH_TOOL, WEB_FETCH_TOOL, DOCUMENT_CHAT_TOOL]
      : [DOCUMENT_CHAT_TOOL];

    return {
      tools,
      executeTool: async (name, args, signal, lastUserMessage) => {
        ensureAllowlistForTurn(lastUserMessage);

        // Defense in depth: even if a stale completion still holds the tool
        // schema, refuse web tools when the toggle is off.
        if (
          !webToolsEnabledRef.current &&
          (name === "web_search" || name === "web_fetch")
        ) {
          return {
            text: getStrings(locale).errors.unknownTool.replace(
              "{name}",
              name,
            ),
          };
        }

        if (name === "web_search") {
          const outcome = await searchExec(name, args, signal, lastUserMessage);
          const sources = outcome.sources as Array<{ url?: string }> | undefined;
          if (sources?.length) {
            for (const source of sources) {
              if (typeof source?.url === "string" && source.url) {
                allowlist.add(source.url);
              }
            }
          }
          return outcome;
        }

        if (name === "web_fetch") {
          return fetchExec(name, args, signal);
        }

        if (name === "document_chat") {
          const outcome = await documentExec(name, args, signal);
          // Vision fallback: do NOT hand the model an instruction to use an
          // unwired path. Return a user-facing scanned-document message only.
          if (outcome.strategy === "vision_fallback") {
            const strings = getStrings(locale);
            const msg =
              strings.errors.documentChatVisionFallback
                ?.replace("{name}", "")
                ?.replace("{pages}", "") ||
              outcome.text.replace(/\[\[DOCUMENT_VISION_FALLBACK\]\]\s*/g, "");
            // Prefer the tool's already-localized text (has name/pages filled).
            const cleaned = outcome.text
              .replace(/\[\[DOCUMENT_VISION_FALLBACK\]\]\s*/g, "")
              .trim();
            return {
              text:
                cleaned ||
                msg ||
                "This document has no searchable text layer. Re-attach it as page images for vision.",
              kind: "document_chat" as const,
              strategy: "vision_fallback" as const,
            };
          }
          return {
            text: outcome.text,
            passages: outcome.passages,
            provenance: outcome.provenance,
            strategy: outcome.strategy,
            error: outcome.error,
            kind: "document_chat" as const,
          };
        }

        return {
          text: getStrings(locale).errors.unknownTool.replace("{name}", name),
        };
      },
    };
  }, [locale, webToolsEnabled]);

  // ── Drawer + exclusive overlay (settings | documents | miniapp | null) ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeOverlay, setActiveOverlay] = useState<ActiveOverlay>(null);
  const edgeSwipe = Gesture.Pan()
    .activeOffsetX(24)
    .failOffsetY([-15, 15]) // scroll verticale NON deve aprire il drawer
    .hitSlop({ left: 0, width: 48 }) // solo dal bordo sinistro: niente conflitti con sources/scroll
    .runOnJS(true)
    .onStart(() => setDrawerOpen(true));
  const drawerItems: DrawerItem[] = useMemo(
    () => [
      {
        id: "settings",
        label: t("common.settings"),
        Icon: LucideSettings,
        onPress: () => {
          Keyboard.dismiss();
          setDrawerOpen(false);
          // Opening settings replaces any open miniapp (exclusive overlay).
          setActiveOverlay({ kind: "settings" });
        },
      },
      {
        id: "documents",
        label: t("documents.title"),
        Icon: LucideFileText,
        onPress: () => {
          Keyboard.dismiss();
          setDrawerOpen(false);
          setActiveOverlay({ kind: "documents" });
        },
      },
    ],
    [t],
  );

  // Android hardware back while Settings/Help is open: each screen owns its
  // BackHandler (Settings: dirty-confirm; Help: return to Settings). AppShell
  // must NOT register a competing handler that would bypass those paths.

  // ── Notifiche locali (download) ──────────────────────────────────────────
  const notifyDownload = useCallback(async (title: string, body: string) => {
    try {
      const settings = await Notifications.getPermissionsAsync();
      if (!settings.granted) {
        const requested = await Notifications.requestPermissionsAsync();
        if (!requested.granted) return;
      }
      // Android 8+: le notifiche devono appartenere a un channel. Il canale
      // "default" è quello usato dalle notifiche immediate (trigger null).
      await Notifications.setNotificationChannelAsync("default", {
        name: t("notify.channelName"),
        importance: Notifications.AndroidImportance.DEFAULT,
      });
      await Notifications.scheduleNotificationAsync({
        content: { title, body },
        // channelId va nel trigger (non in content): trigger null usa il canale fallback Android.
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 1,
          channelId: "default",
        },
      });
    } catch (error) {
      // notifiche non disponibili: non bloccante, ma non silenzioso in debug
      console.warn("[notifyDownload]", error);
    }
  }, [t]);

  // ── Model download progress notification (sticky, "downloads" channel) ───
  // Whether the permission check for THIS download session succeeded. Cached
  // once per download (see startDownload) so a denial cannot re-prompt the
  // user on every throttled progress tick during a multi-minute transfer.
  const downloadNotifyAllowedRef = useRef(false);
  const lastDownloadNotifyAtRef = useRef(0);

  /** Create the low-importance "downloads" channel + check/request permission once. */
  const beginDownloadNotifications = useCallback(async () => {
    lastDownloadNotifyAtRef.current = 0;
    downloadNotifyAllowedRef.current = false;
    try {
      await Notifications.setNotificationChannelAsync(DOWNLOADS_CHANNEL_ID, {
        name: t("notify.downloadsChannelName"),
        importance: Notifications.AndroidImportance.LOW,
        sound: null,
      });
      const settings = await Notifications.getPermissionsAsync();
      const granted = settings.granted || (await Notifications.requestPermissionsAsync()).granted;
      downloadNotifyAllowedRef.current = granted;
    } catch (error) {
      // Never block the download on notification setup — skip silently.
      downloadNotifyAllowedRef.current = false;
      console.warn("[beginDownloadNotifications]", error);
    }
  }, [t]);

  const showDownloadProgressNotification = useCallback(
    async (modelName: string, percent: number) => {
      if (!downloadNotifyAllowedRef.current) return;
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: DOWNLOAD_PROGRESS_NOTIFICATION_ID,
          content: {
            title: t("download.notifyProgressTitle", { name: modelName }),
            body: t("download.notifyProgressBody", { percent }),
            sticky: true,
            autoDismiss: false,
            sound: false,
          },
          // channelId-only trigger = immediate delivery on that channel.
          trigger: { channelId: DOWNLOADS_CHANNEL_ID },
        });
      } catch (error) {
        console.warn("[showDownloadProgressNotification]", error);
      }
    },
    [t],
  );

  const dismissDownloadProgressNotification = useCallback(async () => {
    try {
      await Notifications.dismissNotificationAsync(DOWNLOAD_PROGRESS_NOTIFICATION_ID);
    } catch {
      // best-effort
    }
  }, []);

  // ── User memory (local facts for system prompt personalization) ──────────
  // Refs declared above agentOptions; keep state + sync here.
  const [memoryFacts, setMemoryFacts] = useState<string[]>([]);
  memoryFactsRef.current = memoryFacts;
  /** Mirror of kalsa.context.compaction — default OFF (legacy sliding window). */
  const compactionEnabledRef = useRef(false);
  /** Serialize extractMemory so it never overlaps a chat completion on the same engine. */
  const memoryExtractRef = useRef<Promise<void> | null>(null);

  const refreshMemoryFacts = useCallback(async () => {
    try {
      const enabled = await MemoryStore.getEnabled();
      memoryEnabledRef.current = enabled;
      if (!enabled) {
        setMemoryFacts([]);
        return;
      }
      const facts = await MemoryStore.listFacts();
      // Most recent 10 facts (list is chronological ascending).
      setMemoryFacts(facts.map((fact) => fact.text).slice(-10));
    } catch {
      // best-effort; never block UI, never log contents
    }
  }, []);

  useEffect(() => {
    void refreshMemoryFacts();
  }, [refreshMemoryFacts]);

  // ── Stato modello ────────────────────────────────────────────────────────
  const [modelIndex, setModelIndex] = useState(() =>
    Math.max(0, MODEL_REGISTRY.findIndex((m) => m.id === getDefaultModel().id)),
  );
  const [modelState, setModelState] = useState<ModelState>("checking");
  // Keep modelStateRef in lockstep for the embed-job residency gate (reads
  // without waiting for a re-render). Assigned on every render below.
  modelStateRef.current = modelState;
  const [download, setDownload] = useState<{ bytesReceived: number; bytesTotal: number; progress: number } | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  // Raw download error (untranslated) for on-device diagnostics when friendly text is generic.
  const [modelErrorDetail, setModelErrorDetail] = useState<string | null>(null);
  /** Discriminates download vs engine-init failures when modelState === "error". */
  const [modelErrorKind, setModelErrorKind] = useState<"download" | "engine" | null>(null);
  const currentModel = MODEL_REGISTRY[modelIndex];
  // Pre-init estimate: catalog n_ctx (+ optional high-RAM hybrid upgrade).
  // After initEngine succeeds we overwrite both state and ref with the
  // reported effectiveNCtx (memory clamp may shrink). Document tool
  // (getCtxTokens → chatEngineCtxRef) and AiChatPage longChat (engineCtx prop)
  // share that same resolved value — see comment on chatEngineCtxRef.
  const catalogEngineCtx = useMemo(
    () =>
      resolveContextProfile({
        hybrid: currentModel.hybrid,
        kvCache: currentModel.kvCache,
        catalogCtx: currentModel.engineCtx,
      }).nCtx,
    [currentModel],
  );
  const [chatEngineCtx, setChatEngineCtx] = useState<number>(catalogEngineCtx);
  // Keep state in sync when the selected model changes (pre-init estimate).
  // Do not clobber a live effective value while the same model stays ready.
  useEffect(() => {
    if (isEngineReady() && getActiveModelId() === currentModel.id) {
      const live = getActiveEngineNCtx();
      if (live > 0) {
        setChatEngineCtx(live);
        chatEngineCtxRef.current = live;
        return;
      }
    }
    setChatEngineCtx(catalogEngineCtx);
    chatEngineCtxRef.current = catalogEngineCtx;
  }, [catalogEngineCtx, currentModel.id]);
  // Ref speculare per il race tra check iniziale e load della preferenza.
  const modelIndexRef = useRef(modelIndex);
  modelIndexRef.current = modelIndex;

  // Riconoscimento modello all'avvio: ripristina l'ultimo modello usato
  // (come la selezione persistita), NON sempre il default.
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(MODEL_STORAGE_KEY)
      .then((saved) => {
        if (!mounted || !saved) return;
        const savedIndex = MODEL_REGISTRY.findIndex((model) => model.id === saved);
        if (savedIndex >= 0) setModelIndex(savedIndex);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  // Capture pre-send history for the KV gate (before any send mutates kalsa.messages.v1).
  useEffect(() => {
    void getBootHistoryHash();
  }, []);

  // Guard sincrone per download/switch/stream (non soggette al batching di React).
  const downloadInFlight = useRef(false);
  /** Blocks double-tap confirmDownload while profile/disk probes await the Alert. */
  const confirmDownloadLockRef = useRef(false);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const engineGenerationRef = useRef(0);
  /**
   * Ownership token from tryAcquireChat (null when chat slot not held).
   * markChatReady / markChatReleased must pass this gen so a stale load
   * cannot idle a newer owner's gate (FIX 1).
   */
  const chatGateGenRef = useRef<number | null>(null);
  const streamInFlightRef = useRef(false);
  const modelSwitchInFlightRef = useRef(false);
  /** Single-flight waiter that drains pendingModelSwitchQueue after sendClaim. */
  const modelSwitchDrainInFlightRef = useRef(false);
  /** UI mirror of streamInFlightRef — disables model Select in Settings. */
  const [streaming, setStreaming] = useState(false);
  /** Banner when fit returns unknown / unload reason for Settings. */
  const [memoryBannerKey, setMemoryBannerKey] = useState<string | null>(null);

  // Anti-OOM: uncached MemAvailable polling + AppState background/foreground.
  // Background -> abort stream if busy, save session if kv-reproducible, dispose.
  // Foreground -> evaluateModelFit; only allow lazy restore when fits|tight. Never auto-load.
  useEffect(() => {
    let disposed = false;
    const handle = startMemoryMonitor({
      intervalMs: 15_000,
      onPressure: (bytes) => {
        if (disposed) return;
        try {
          console.info(
            "pressure.transition",
            JSON.stringify({
              availableMb:
                typeof bytes === "number" ? Math.round(bytes / (1024 * 1024)) : null,
            }),
          );
        } catch {
          // telemetry never throws
        }
      },
      onAppState: (state) => {
        if (disposed) return;
        if (state === "background") {
          // True background only. iOS `inactive` is Control Center / shade —
          // abort/save/dispose there would kill a still-visible session.
          // (AiChatPage already skips expensive KV save on inactive.)
          if (discardInFlightRef.current) return;
          discardInFlightRef.current = true;
          void (async () => {
            // Round-8 FIX 3: capture THIS load's gen SYNCHRONOUSLY at entry,
            // BEFORE the first await (lifecycle / hard-wait / save). Same pattern
            // as regen/edit myGen capture. A concurrent ensure may bump the ref
            // during awaits; release is a no-op if gen is no longer current.
            const releasedGenBg = chatGateGenRef.current;
            try {
              // Abort regen first so edit/regen cannot race dispose.
              regenAbortRef.current?.abort();

              // Abort-and-await lifecycle owned by AiChatPage: aborts send,
              // awaits stream finalization + turn-end save, returns real hash.
              let historyHashValue = historyHash("");
              const lifecycle = backgroundDiscardLifecycleRef.current;
              if (lifecycle) {
                try {
                  const result = await lifecycle();
                  if (
                    result &&
                    typeof result.historyHashValue === "string"
                  ) {
                    historyHashValue = result.historyHashValue;
                  }
                } catch {
                  // fall through with empty-history hash only if genuinely empty
                }
              }

              // Hard wait: never dispose while stream/send/regen/claim still in flight.
              const t0 = Date.now();
              while (
                (streamInFlightRef.current ||
                  sendingInFlightRef.current ||
                  regenInFlightRef.current ||
                  sendClaimRef.current) &&
                Date.now() - t0 < 5000
              ) {
                await new Promise((r) => setTimeout(r, 50));
              }
              // If still busy after wait (e.g. a new send re-claimed during the
              // lifecycle await), bail before disposing so the engine stays up.
              // Monitor re-fires on the next background transition / pressure tick.
              if (
                streamInFlightRef.current ||
                sendingInFlightRef.current ||
                regenInFlightRef.current ||
                sendClaimRef.current
              ) {
                return;
              }

              const modelId = getActiveModelId();
              if (modelId && isEngineReady()) {
                // saveEngineSession itself gates on kvReproducible.
                // Use the real historyHash from lifecycle (empty only if empty).
                try {
                  await saveEngineSession(modelId, historyHashValue);
                } catch {
                  // ignore
                }
              }
              // Only clear the ref if we still own this gen (no concurrent ensure
              // claimed a newer generation during the awaits above).
              if (
                releasedGenBg !== null &&
                chatGateGenRef.current === releasedGenBg
              ) {
                chatGateGenRef.current = null;
              }
              if (isEngineReady() || releasedGenBg !== null) {
                try {
                  if (isEngineReady()) {
                    await runNativeOp(() => disposeEngine());
                    // Same-process unload→reload must not compare stale H0
                    // against the just-saved .kvs (would miss and delete it).
                    resetBootHistoryHash();
                    setProcessUnloadedReason("chat.unloaded");
                    setMemoryBannerKey("chat.unloaded");
                    console.info(
                      "model.unload",
                      JSON.stringify({ reason: "background" }),
                    );
                  }
                } catch {
                  // ignore
                } finally {
                  // Release only the gen captured at entry (markChatReleased is
                  // already gen-guarded against a newer owner). If gen was null
                  // but the gate is still chat_* after dispose (stale owner),
                  // release the current generation so embed is not stuck.
                  if (releasedGenBg !== null) {
                    markChatReleased(releasedGenBg);
                  } else {
                    const gate = getLlamaContextGateState();
                    if (gate === "chat_loading" || gate === "chat_ready") {
                      markChatReleased(getChatGeneration());
                    }
                  }
                }
              }
            } catch {
              // never throw from AppState listener
            } finally {
              discardInFlightRef.current = false;
              // Bump so a concurrent/next send can detect this discard cycle
              // finished; ensureEngineForModel re-acquires if the engine is gone.
              discardGenerationRef.current += 1;
            }
          })();
          return;
        }
        if (state === "active") {
          void (async () => {
            try {
              const model = MODEL_REGISTRY[modelIndexRef.current];
              if (!model) return;
              if (isEngineReady() && getActiveModelId() === model.id) return;
              const available = await getAvailableMemoryBytesUncached();
              const fit = evaluateModelFit(
                {
                  sizeBytes: model.sizeBytes,
                  engineCtx: model.engineCtx,
                  kvBytesPerToken: model.kvBytesPerToken,
                  mmproj: model.mmproj
                    ? { sizeBytes: model.mmproj.sizeBytes }
                    : null,
                },
                available,
              );
              console.info(
                "model.fit",
                JSON.stringify({
                  verdict: fit.verdict,
                  availableMb:
                    typeof available === "number"
                      ? Math.round(available / (1024 * 1024))
                      : null,
                }),
              );
              if (fit.verdict === "does_not_fit" || fit.verdict === "unknown") {
                setMemoryBannerKey(fit.reasonKey);
                setProcessUnloadedReason(fit.reasonKey);
                return;
              }
              // fits | tight -> allow lazy restore on next send. Never auto-load.
              setMemoryBannerKey(null);
            } catch {
              // ignore
            }
          })();
        }
      },
    });
    return () => {
      disposed = true;
      handle.stop();
    };
  }, []);
  /** Per-model download presence for Settings badges (scanned when Settings opens). */
  const [downloadedById, setDownloadedById] = useState<Record<string, boolean>>({});

  // ── Voice (ASR model + TTS preference) ───────────────────────────────────
  const [voiceState, setVoiceState] = useState<VoicePipelineState>("checking");
  const [voiceDownloadPercent, setVoiceDownloadPercent] = useState<number | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabledState] = useState(true);
  const voiceDownloadInFlight = useRef(false);
  const voiceDownloadAbortRef = useRef<AbortController | null>(null);

  // ── Embedding model (optional hybrid retrieval) ──────────────────────────
  const [embeddingState, setEmbeddingState] =
    useState<EmbeddingPipelineState>("checking");
  const [embeddingDownloadPercent, setEmbeddingDownloadPercent] = useState<
    number | null
  >(null);
  const [embeddingError, setEmbeddingError] = useState<string | null>(null);
  const embeddingDownloadInFlight = useRef(false);
  const embeddingDownloadAbortRef = useRef<AbortController | null>(null);

  const showNotice = useCallback((value: string) => {
    setNotice(value);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      engineGenerationRef.current += 1; // invalida ogni async in corso
      // FIX 1: capture THIS load's gen SYNCHRONOUSLY at invalidation time.
      // Never read chatGateGenRef.current inside the dispose callback — a newer
      // load may have acquired a higher gen by then, and releasing it would
      // idle the wrong owner.
      const releasedGen = chatGateGenRef.current;
      chatGateGenRef.current = null;
      // FIX 5: cancel background embed so it cannot lazy-initLlama after unmount.
      bumpEmbedJobGeneration();
      downloadAbortRef.current?.abort();
      downloadAbortRef.current = null;
      voiceDownloadAbortRef.current?.abort();
      voiceDownloadAbortRef.current = null;
      embeddingDownloadAbortRef.current?.abort();
      embeddingDownloadAbortRef.current = null;
      // Preempt background summary before dispose so FIFO does not hold a
      // half-finished summarize across unmount.
      abortBackgroundSummary();
      // FIX 1 / round 7: full chat disposal lifecycle through the native-op
      // barrier so a chat release cannot overlap an in-flight embed op.
      // Sequential: disposeEngine (wrapped) THEN releaseEmbedder (which itself
      // enters runNativeOp — do NOT nest, that would deadlock the FIFO).
      void (async () => {
        try {
          await runNativeOp(() => disposeEngine());
        } catch {
          // ignore — unmount best-effort
        } finally {
          // FIX B / FIX 1: unmount dispose frees only the gen captured above.
          if (releasedGen !== null) markChatReleased(releasedGen);
        }
        // Sequential after dispose settles — releaseEmbedder owns its own barrier entry.
        try {
          await releaseEmbedder();
        } catch {
          // releaseEmbedder already absorbs; defense for fire-and-forget.
        }
      })();
      void releaseWhisper();
    };
  }, [bumpEmbedJobGeneration]);

  // Initial voice model + TTS preference scan.
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [ok, tts] = await Promise.all([
          isWhisperModelDownloaded(),
          isTtsEnabled(),
        ]);
        if (!mounted) return;
        setVoiceState(ok ? "ready" : "missing");
        setTtsEnabledState(tts);
      } catch {
        if (mounted) setVoiceState("missing");
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Initial embedding-model presence scan (optional hybrid retrieval).
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const status = await getEmbeddingModelStatus();
        if (!mounted) return;
        const ready = status === "downloaded";
        embedderDownloadedRef.current = ready;
        setEmbeddingState(ready ? "ready" : "missing");
      } catch {
        if (mounted) {
          embedderDownloadedRef.current = false;
          setEmbeddingState("missing");
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Controllo iniziale: il modello corrente è già scaricato?
  useEffect(() => {
    let mounted = true;
    const checkedIndex = modelIndexRef.current;
    void (async () => {
      try {
        const ok = await isModelBundleDownloaded(MODEL_REGISTRY[checkedIndex]);
        // Il modello selezionato potrebbe essere cambiato nel frattempo (load preferenza).
        if (mounted && modelIndexRef.current === checkedIndex) {
          setModelState(ok ? "ready" : "missing");
        }
      } catch {
        if (mounted && modelIndexRef.current === checkedIndex) setModelState("missing");
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelIndex]);

  const ensureEngineForModel = useCallback(async (model: ModelInfo): Promise<boolean> => {
    // Capture generation + expected model BEFORE any await (race with selectModel).
    const generation = engineGenerationRef.current;
    const expectedModelId = model.id;
    const stillCurrent = () =>
      generation === engineGenerationRef.current &&
      MODEL_REGISTRY[modelIndexRef.current]?.id === expectedModelId;

    if (isEngineReady() && getActiveModelId() === model.id) return true;
    // Round 8 FIX 2: if embedder is hung, refuse immediately — never reach
    // acquire/submit. markEmbedderHung clears the lifecycle gate to idle so a
    // retry could otherwise re-acquire chat, skip release (hung short-circuit),
    // and enqueue initEngine forever behind the hung native op. Recovery =
    // process restart; repeated retries are no-ops (no FIFO growth).
    if (isEmbedderHung()) {
      setModelState("error");
      setModelErrorKind("engine");
      setModelError(t("embedding.busy"));
      setModelErrorDetail(null);
      return false;
    }
    // Ownership token acquired by THIS ensure call (null until tryAcquireChat).
    // Catch must only release this gen — never a previous owner's (FIX 1).
    let acquiredChatGen: number | null = null;
    // Disk probe can throw on rare FS errors — keep it inside try so bar/Settings
    // void-retry sites never produce an unhandled rejection.
    try {
      if (!(await isModelBundleDownloaded(model))) return false;
      if (!stillCurrent()) return false;

      // Hard RAM gate before initEngine. Never force-evict the currently active
      // model (if this model is already active and ready we returned above).
      // Also seed llamaContextGate co-residency inputs while we have the profile
      // (sync tryAcquireChat below must not await for RAM).
      let totalMemKnown = 0;
      try {
        const [profile, free] = await Promise.all([
          getCachedDeviceProfile(),
          getFreeDiskBytes(),
        ]);
        if (!stillCurrent()) return false;
        totalMemKnown = profile.totalMemoryBytes ?? 0;
        setCoResidencyContext({
          totalMemoryBytes: totalMemKnown,
          chatModelIs2B: isChatModel2BClass(model.id),
        });
        const gate = gateForModel(model, profile, free);
        // Refuse load for blocked_ram / blocked_tier (disk is a download-time gate).
        // Active-model exception: if getActiveModelId matches, never refuse
        // (already handled by the early ready return; keep explicit for safety).
        if (
          !gate.allowed &&
          (gate.reason === "blocked_ram" || gate.reason === "blocked_tier") &&
          getActiveModelId() !== model.id
        ) {
          setModelState("error");
          setModelErrorKind("engine");
          setModelError(gateReasonMessage(gate.reason, t));
          setModelErrorDetail(null);
          return false;
        }
      } catch {
        // Probe failure → fall through to existing load path (no hard block).
        // Still seed model class so 4B cannot co-reside even if RAM unknown.
        setCoResidencyContext({ chatModelIs2B: isChatModel2BClass(model.id) });
      }

      // Clear previous error banner before retry so "Ready" never coexists with
      // a stale "Could not load the model" under the header / in Settings.
      // FIX B: bump + abort so in-flight embed cannot initLlama after we start
      // chat load. Shared llamaContextGate: tryAcquireChat SYNCHRONOUSLY before
      // the first await of the init flow (closes the loading window).
      // FIX 1: ownership token (chatGen) — stale markChatReleased cannot idle a newer load.
      // FIX 2: bounded releaseEmbedder wait (EMBEDDER_RELEASE_TIMEOUT_MS).
      // FIX 3 / §5: releaseEmbedder only when co-residency is NOT allowed
      // (≤6 GB OR 4B chat model). On 8 GB+ with 2B chat, embed may co-reside.
      bumpEmbedJobGeneration();

      // Synchronous co-residency seed: model id + any RAM already known above.
      const modelIs2B = isChatModel2BClass(model.id);
      setCoResidencyContext({ chatModelIs2B: modelIs2B });

      // Synchronous chat-loading claim — MUST precede any further await so the
      // embedder cannot initLlama concurrently during the loading window.
      // Returns a generation token; null when refused (embed_active without
      // co-res, or already chat_loading/chat_ready — double-load backstop).
      let chatGen = tryAcquireChat();
      if (chatGen === null) {
        // Already loading/ready: refuse double-load rather than steal ownership
        // (gate is the backstop; AppShell guards concurrent loads via modelState).
        const gateState = getLlamaContextGateState();
        if (gateState === "chat_loading" || gateState === "chat_ready") {
          return false;
        }
        // Embedder holds the native slot and co-residency is off — bounded
        // release then re-claim. FIX 2 / round 7 BLOCK: on timeout, mark hung
        // and refuse chat init (never clear the native-op chain / never force
        // handoff — hung op holds the barrier until process restart).
        const releaseOutcome = await releaseEmbedderBounded();
        if (!stillCurrent()) {
          return false;
        }
        if (releaseOutcome === "timeout") {
          // BLOCK: embedder hung, native op still sole owner of the barrier.
          // Surface explicit busy state; recovery = process restart.
          setModelState("error");
          setModelErrorKind("engine");
          setModelError(t("embedding.busy"));
          setModelErrorDetail(null);
          return false;
        }
        chatGen = tryAcquireChat();
        if (chatGen === null) {
          // Still blocked — refuse chat load rather than race the embedder.
          setModelState("error");
          setModelErrorKind("engine");
          setModelError(t("errors.engineInitFailed"));
          setModelErrorDetail(null);
          return false;
        }
      }
      acquiredChatGen = chatGen;
      chatGateGenRef.current = chatGen;

      setModelState("loading");
      modelStateRef.current = "loading";
      setModelError(null);
      setModelErrorDetail(null);
      setModelErrorKind(null);

      // Prefer RAM already known from the hard-gate probe; re-fetch only if missing.
      let totalMem = totalMemKnown;
      if (totalMem <= 0) {
        try {
          const profile = await getCachedDeviceProfile();
          totalMem = profile.totalMemoryBytes ?? 0;
        } catch {
          totalMem = 0;
        }
        if (!stillCurrent()) {
          markChatReleased(chatGen);
          if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
          return false;
        }
      }
      setCoResidencyContext({
        totalMemoryBytes: totalMem,
        chatModelIs2B: modelIs2B,
      });

      // §5 co-residency: release embedder before chat init ONLY when
      // (totalMemoryBytes ≤ 6e9) OR (chat model is 4B-class).
      // FIX 2 / round 7 BLOCK: on timeout, refuse chat init (hung holds barrier).
      const mustReleaseEmbed =
        totalMem <= 0 ||
        totalMem <= CO_RESIDENCY_MIN_MEMORY_BYTES ||
        isChatModel4BClass(model.id) ||
        !allowsCoResidency();
      if (mustReleaseEmbed) {
        const midRelease = await releaseEmbedderBounded();
        if (midRelease === "timeout") {
          markChatReleased(chatGen);
          if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
          setModelState("error");
          setModelErrorKind("engine");
          setModelError(t("embedding.busy"));
          setModelErrorDetail(null);
          return false;
        }
      }
      if (!stillCurrent()) {
        markChatReleased(chatGen);
        if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
        return false;
      }

      const mmprojPath = model.mmproj ? modelLocalPath(model, model.mmproj.file) : null;
      // Resolve once here (V4.2 §Fase 0.5): catalog n_ctx (no silent downgrade)
      // + optional high-RAM upgrade for hybrids + catalog-authoritative KV.
      // initEngine does not re-resolve — pass nCtx and cache types explicitly.
      const profile = resolveContextProfile({
        hybrid: model.hybrid,
        kvCache: model.kvCache,
        catalogCtx: model.engineCtx,
      });
      const speculativeOverride = await getSpeculativeOverride();
      const engineOverride = await getEngineOverride();
      // Boot-captured HISTORY_KEY hash: conversation start, not mid-send (lazy
      // engine init would otherwise hash after the user turn is already persisted).
      const sessionHistoryHash = await getBootHistoryHash();
      // Same memoryFacts slice the system prompt uses (newest 10, or [] if off).
      let sessionPromptEnvHash = computePromptEnvHash(locale, []);
      try {
        const enabled = await MemoryStore.getEnabled();
        if (enabled) {
          const facts = await MemoryStore.listFacts();
          sessionPromptEnvHash = computePromptEnvHash(
            locale,
            facts.map((f) => f.text).slice(-10),
          );
        }
      } catch {
        // empty facts → match disabled / cold
      }
      if (!stillCurrent()) {
        markChatReleased(chatGen);
        if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
        return false;
      }
      // Round 9: atomic check-and-submit (runNativeOpBounded). Emptiness check
      // and enqueue run in one synchronous block under the JS event loop — never
      // observe free then separately submit (race that could append behind a
      // newly-hung foreign op). Timeout refuses WITHOUT enqueueing.
      // Re-check hung + stillCurrent first (cheap; no enqueue risk).
      if (isEmbedderHung()) {
        markChatReleased(chatGen);
        if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
        setModelState("error");
        setModelErrorKind("engine");
        setModelError(t("embedding.busy"));
        setModelErrorDetail(null);
        return false;
      }
      if (!stillCurrent()) {
        markChatReleased(chatGen);
        if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
        return false;
      }
      const boundedInit = await runNativeOpBounded(
        () =>
          initEngine(modelLocalPath(model, model.file), model.id, {
            mmprojPath,
            nCtx: profile.nCtx,
            cacheTypeK: profile.cacheTypeK,
            cacheTypeV: profile.cacheTypeV,
            kvUnified: model.kvUnified,
            mtpNMax: model.mtp?.nMax,
            mtpDefaultOn: model.mtp?.defaultEnabled === true,
            speculativeOverride,
            engineOverride,
            sessionRestore: {
              historyHash: sessionHistoryHash,
              promptEnvHash: sessionPromptEnvHash,
            },
            locale,
          }),
        EMBEDDER_RELEASE_TIMEOUT_MS,
      );
      if (!boundedInit.ok) {
        markEmbedderHung();
        markChatReleased(chatGen);
        if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
        setModelState("error");
        setModelErrorKind("engine");
        setModelError(t("embedding.busy"));
        setModelErrorDetail(null);
        console.warn(
          `[kalsa] runNativeOpBounded timed out after ${EMBEDDER_RELEASE_TIMEOUT_MS}ms (nativeOpBusy=${nativeOpBusy()}); chat init blocked — restart to recover`,
        );
        return false;
      }
      const initResult = boundedInit.value;
      if (!stillCurrent()) {
        // Stale app generation after success: release THIS chatGen only so a
        // newer load's gate is not idled (FIX 1 ownership token).
        markChatReleased(chatGen);
        if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
        return false;
      }
      // Propagate effective n_ctx (post memory-clamp) so document strategy and
      // long-chat UI budget match the loaded engine — not the pre-clamp catalog.
      // Single source: engine init → chatEngineCtxRef / chatEngineCtx state →
      // getCtxTokens + AiChatPage engineCtx prop.
      const effective = initResult.effectiveNCtx;
      chatEngineCtxRef.current = effective;
      setChatEngineCtx(effective);
      warnIfNativePatchesInactive(initResult.systemInfo);
      setModelState("ready");
      modelStateRef.current = "ready";
      // FIX B / FIX 1: chat context resident — only if we still own this gen.
      markChatReady(chatGen);
      // End-based clear too: two concurrent ensures (double-tap in the probe
      // window) where the first fails and the second succeeds must not leave
      // "Ready" coexisting with a stale red banner.
      setModelError(null);
      setModelErrorDetail(null);
      setModelErrorKind(null);
      return true;
    } catch (error) {
      // FIX B / FIX 1: init failure → release only the gen THIS call acquired.
      if (acquiredChatGen !== null) {
        markChatReleased(acquiredChatGen);
        if (chatGateGenRef.current === acquiredChatGen) chatGateGenRef.current = null;
      }
      if (!stillCurrent()) return false;
      setModelState("error");
      modelStateRef.current = "error";
      setModelErrorKind("engine");
      setModelError(friendlyNetworkError(error, locale, "engine").message);
      setModelErrorDetail(rawErrorDetail(error));
      return false;
    }
  }, [locale, t, bumpEmbedJobGeneration]);

  const selectModel = useCallback(
    (nextIndex: number) => {
      if (
        downloadInFlight.current ||
        modelSwitchInFlightRef.current ||
        modelState === "downloading" ||
        modelState === "loading"
      ) {
        return;
      }
      if (nextIndex < 0 || nextIndex >= MODEL_REGISTRY.length) return;
      if (nextIndex === modelIndex) return;

      // Single-file policy: drop the previous model's session artifacts on switch.
      // A successful save also runs deleteOtherModelSessions — only one model's
      // .kvs is kept at a time, so switch-back is always a cold start.
      const prevId = MODEL_REGISTRY[modelIndex]?.id;
      if (prevId) void invalidateEngineSession(prevId);

      // Sync transition: bump generation + show checking before dispose awaits.
      modelSwitchInFlightRef.current = true;
      engineGenerationRef.current += 1;
      // FIX 1: capture THIS load's gen SYNCHRONOUSLY at switch/invalidation time.
      // The dispose callback must never read chatGateGenRef.current — a newer
      // ensureEngineForModel may have acquired a higher gen by then.
      const releasedGen = chatGateGenRef.current;
      chatGateGenRef.current = null;
      modelIndexRef.current = nextIndex; // keep stillCurrent() correct before re-render
      setModelIndex(nextIndex);
      setModelState("checking");
      setModelError(null);
      setModelErrorDetail(null);
      setModelErrorKind(null);
      // Persisti la selezione: riconoscimento al riavvio (come Atomic Chat).
      AsyncStorage.setItem(MODEL_STORAGE_KEY, MODEL_REGISTRY[nextIndex].id).catch(() => undefined);

      // Preempt background summary BEFORE dispose — same rule as send: never
      // leave a summarize job holding the engine across a model switch.
      abortBackgroundSummary();

      // Extraction holds the engine: wait briefly so dispose does not race it.
      // Epoch checks discard any delayed writes after the engine is gone.
      void (async () => {
        if (memoryExtractRef.current) {
          try {
            await Promise.race([
              memoryExtractRef.current,
              new Promise<void>((resolve) => setTimeout(resolve, 3000)),
            ]);
          } catch {
            // ignore
          }
          memoryExtractRef.current = null;
        }
        try {
          // FIX 1 / round 7: dispose inside runNativeOp so chat release cannot
          // overlap an in-flight embed op (never-overlap invariant).
          await runNativeOp(() => disposeEngine());
        } catch {
          // ignore
        } finally {
          // FIX B / FIX 1: dispose → free only the gen captured at switch time.
          if (releasedGen !== null) markChatReleased(releasedGen);
          modelSwitchInFlightRef.current = false;
        }
      })();
    },
    [modelIndex, modelState],
  );

  /** Settings: select by model id (same storage key + engine dispose path). */
  const selectModelById = useCallback(
    (modelId: string) => {
      // While a send holds the pre-await claim (fit-gate), queue the switch
      // (last-wins) and apply it only after the claim releases. Avoids dispose
      // racing ensureEngineForModel mid-send.
      if (deferModelSwitchIfSendClaimed(modelId)) {
        if (!modelSwitchDrainInFlightRef.current) {
          modelSwitchDrainInFlightRef.current = true;
          void (async () => {
            try {
              const t0 = Date.now();
              while (sendClaimRef.current && Date.now() - t0 < 5000) {
                await new Promise((r) => setTimeout(r, 50));
              }
              // Timed out still claimed: drop queue so a late dispose cannot
              // land mid-stream without a fresh user action.
              if (sendClaimRef.current) {
                drainPendingModelSwitch();
                return;
              }
              const pendingId = drainPendingModelSwitch();
              if (!pendingId) return;
              // Claim free — re-enter (defer will no-op).
              selectModelById(pendingId);
            } finally {
              modelSwitchDrainInFlightRef.current = false;
            }
          })();
        }
        return;
      }
      const nextIndex = MODEL_REGISTRY.findIndex((m) => m.id === modelId);
      if (nextIndex < 0) return;
      // Refuse model switch while edit/regenerate owns the turn.
      if (regenInFlightRef.current) {
        Alert.alert(t("chat.regenBusy"), t("chat.regenBusy"));
        return;
      }
      if (streamInFlightRef.current) {
        Alert.alert(
          t("settings.switchWhileStreamingTitle"),
          t("settings.switchWhileStreamingBody"),
          [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("common.continue"),
              style: "destructive",
              onPress: () => selectModel(nextIndex),
            },
          ],
        );
        return;
      }
      selectModel(nextIndex);
    },
    [selectModel, t],
  );

  const startDownload = useCallback(async (modelId: string) => {
    const model = MODEL_REGISTRY.find((m) => m.id === modelId);
    if (!model) return;

    // Synchronous generation capture + download lock BEFORE any await so a
    // model switch during the free-disk probe cannot start a multi-GB transfer
    // for a deselected model (stillCurrent only suppresses UI after transfer).
    const generation = engineGenerationRef.current;
    if (downloadInFlight.current || modelState === "downloading") return;
    downloadInFlight.current = true;

    const expectedModelId = model.id;
    const stillCurrent = () =>
      generation === engineGenerationRef.current &&
      MODEL_REGISTRY[modelIndexRef.current]?.id === expectedModelId;

    // Re-check free disk before downloadModelBundle (same margined requirement
    // as gateForModel / Settings — diskRequirementBytes = size × 1.1).
    try {
      const free = await getFreeDiskBytes();
      if (generation !== engineGenerationRef.current) {
        downloadInFlight.current = false;
        return;
      }
      const need = diskRequirementBytes(modelBundleSizeBytes(model));
      if (typeof free === "number" && free < need) {
        Alert.alert(t("download.title"), t("models.blockedDisk"));
        downloadInFlight.current = false;
        return;
      }
    } catch {
      // Probe failure → proceed (existing path had no disk pre-check).
    }

    if (generation !== engineGenerationRef.current) {
      downloadInFlight.current = false;
      return;
    }

    const controller = new AbortController();
    downloadAbortRef.current = controller;
    setModelState("downloading");
    setModelError(null);
    setModelErrorDetail(null);
    setModelErrorKind(null);
    const bundleTotal = model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);
    setDownload({ bytesReceived: 0, bytesTotal: bundleTotal, progress: 0 });

    // Keep the CPU awake for the whole download: MIUI/aggressive Android power
    // management otherwise freezes the app as soon as it is backgrounded or
    // the screen locks, killing the socket mid-transfer ("Connection lost").
    await activateKeepAwakeAsync(DOWNLOAD_KEEP_AWAKE_TAG).catch(() => undefined);
    await beginDownloadNotifications();
    void showDownloadProgressNotification(model.name, 0);

    // Tracks which phase failed so the catch can distinguish download vs engine init.
    let errorPhase: "download" | "engine" = "download";
    // Ownership token acquired by THIS download→init path (null until tryAcquireChat).
    let acquiredChatGenDl: number | null = null;
    try {
      const outcome = await downloadModelBundle(model, {
        onBundleProgress: (progress) => {
          if (!stillCurrent()) return;
          setDownload({
            bytesReceived: Math.round(progress.overall * bundleTotal),
            bytesTotal: bundleTotal,
            progress: progress.overall,
          });
          const now = Date.now();
          if (now - lastDownloadNotifyAtRef.current >= DOWNLOAD_NOTIFY_THROTTLE_MS) {
            lastDownloadNotifyAtRef.current = now;
            void showDownloadProgressNotification(model.name, Math.round(progress.overall * 100));
          }
        },
        signal: controller.signal,
        locale,
      });
      if (!stillCurrent()) return;
      if (outcome.model.status === "aborted" || outcome.mmproj?.status === "aborted") {
        setModelState("missing");
        return;
      }
      if (!(await isModelBundleDownloaded(model))) {
        if (!stillCurrent()) return;
        setModelState("error");
        setModelErrorKind("download");
        setModelError(t("download.incomplete"));
        return;
      }
      if (!stillCurrent()) return;
      errorPhase = "engine";
      // Round 8 FIX 2: hung guard at TOP of download→init path — same as
      // ensureEngineForModel. Never acquire/submit when embedder is hung
      // (retry after timeout must not bypass the block policy / grow FIFO).
      if (isEmbedderHung()) {
        setModelState("error");
        setModelErrorKind("engine");
        setModelError(t("embedding.busy"));
        setModelErrorDetail(null);
        return;
      }
      // FIX B / FIX 3: cancel background embed; shared gate + §5 co-residency
      // (same policy as ensureEngineForModel). FIX 1 ownership token + FIX 2 bound.
      bumpEmbedJobGeneration();

      // Synchronous seed + tryAcquireChat BEFORE any await of the init flow.
      // Keep any previously known totalMemoryBytes (do not wipe to 0).
      const modelIs2BDl = isChatModel2BClass(model.id);
      setCoResidencyContext({ chatModelIs2B: modelIs2BDl });

      let chatGenDl = tryAcquireChat();
      if (chatGenDl === null) {
        const gateStateDl = getLlamaContextGateState();
        if (gateStateDl === "chat_loading" || gateStateDl === "chat_ready") {
          // Double-load backstop — do not clobber an in-flight / ready chat.
          return;
        }
        // FIX 2 / round 7 BLOCK: bounded release then re-claim. On timeout,
        // mark hung and refuse chat init (never force-handoff / never clear
        // the native-op chain — hung op holds the barrier until restart).
        const releaseOutcomeDl = await releaseEmbedderBounded();
        if (!stillCurrent()) {
          return;
        }
        if (releaseOutcomeDl === "timeout") {
          // BLOCK: embedder hung, native op still sole owner of the barrier.
          setModelState("error");
          setModelErrorKind("engine");
          setModelError(t("embedding.busy"));
          return;
        }
        chatGenDl = tryAcquireChat();
        if (chatGenDl === null) {
          setModelState("error");
          setModelErrorKind("engine");
          setModelError(t("errors.engineInitFailed"));
          return;
        }
      }
      acquiredChatGenDl = chatGenDl;
      chatGateGenRef.current = chatGenDl;

      setModelState("loading");
      modelStateRef.current = "loading";

      // Refine RAM after chat_loading is held.
      let totalMem = 0;
      try {
        const profile = await getCachedDeviceProfile();
        totalMem = profile.totalMemoryBytes ?? 0;
      } catch {
        totalMem = 0;
      }
      if (!stillCurrent()) {
        markChatReleased(chatGenDl);
        if (chatGateGenRef.current === chatGenDl) chatGateGenRef.current = null;
        return;
      }
      setCoResidencyContext({
        totalMemoryBytes: totalMem,
        chatModelIs2B: modelIs2BDl,
      });

      // FIX 2 / round 7 BLOCK: bounded release — on timeout refuse chat init.
      const mustReleaseEmbed =
        totalMem <= 0 ||
        totalMem <= CO_RESIDENCY_MIN_MEMORY_BYTES ||
        isChatModel4BClass(model.id) ||
        !allowsCoResidency();
      if (mustReleaseEmbed) {
        const midReleaseDl = await releaseEmbedderBounded();
        if (midReleaseDl === "timeout") {
          markChatReleased(chatGenDl);
          if (chatGateGenRef.current === chatGenDl) chatGateGenRef.current = null;
          setModelState("error");
          setModelErrorKind("engine");
          setModelError(t("embedding.busy"));
          return;
        }
      }
      if (!stillCurrent()) {
        markChatReleased(chatGenDl);
        if (chatGateGenRef.current === chatGenDl) chatGateGenRef.current = null;
        return;
      }

      const mmprojPath = model.mmproj ? modelLocalPath(model, model.mmproj.file) : null;

      // Hard RAM/tier gate before initEngine after download. Never force-evict
      // the currently active model (if this download is for a non-active model
      // that cannot fit, refuse load but keep the file on disk).
      try {
        const [deviceProfile, free] = await Promise.all([
          getCachedDeviceProfile(),
          getFreeDiskBytes(),
        ]);
        if (!stillCurrent()) {
          markChatReleased(chatGenDl);
          if (chatGateGenRef.current === chatGenDl) chatGateGenRef.current = null;
          return;
        }
        const gate = gateForModel(model, deviceProfile, free);
        if (
          !gate.allowed &&
          (gate.reason === "blocked_ram" || gate.reason === "blocked_tier") &&
          getActiveModelId() !== model.id
        ) {
          markChatReleased(chatGenDl);
          if (chatGateGenRef.current === chatGenDl) chatGateGenRef.current = null;
          setModelState("error");
          setModelErrorKind("engine");
          setModelError(gateReasonMessage(gate.reason, t));
          setModelErrorDetail(null);
          setDownloadedById((prev) => ({ ...prev, [model.id]: true }));
          return;
        }
      } catch {
        // Probe failure → proceed with load.
      }

      // Resolve once here (V4.2 §Fase 0.5): catalog n_ctx + optional high-RAM upgrade.
      const profile = resolveContextProfile({
        hybrid: model.hybrid,
        kvCache: model.kvCache,
        catalogCtx: model.engineCtx,
      });
      const speculativeOverride = await getSpeculativeOverride();
      const engineOverride = await getEngineOverride();
      // Boot-captured HISTORY_KEY hash: conversation start, not mid-send (lazy
      // engine init would otherwise hash after the user turn is already persisted).
      const sessionHistoryHash = await getBootHistoryHash();
      let sessionPromptEnvHash = computePromptEnvHash(locale, []);
      try {
        const enabled = await MemoryStore.getEnabled();
        if (enabled) {
          const facts = await MemoryStore.listFacts();
          sessionPromptEnvHash = computePromptEnvHash(
            locale,
            facts.map((f) => f.text).slice(-10),
          );
        }
      } catch {
        // empty facts → match disabled / cold
      }
      if (!stillCurrent()) {
        markChatReleased(chatGenDl);
        if (chatGateGenRef.current === chatGenDl) chatGateGenRef.current = null;
        return;
      }
      // Round 9: atomic check-and-submit (runNativeOpBounded) — same policy as
      // ensureEngineForModel. Never observe free then separately submit.
      if (isEmbedderHung()) {
        markChatReleased(chatGenDl);
        if (chatGateGenRef.current === chatGenDl) chatGateGenRef.current = null;
        setModelState("error");
        setModelErrorKind("engine");
        setModelError(t("embedding.busy"));
        setModelErrorDetail(null);
        return;
      }
      if (!stillCurrent()) {
        markChatReleased(chatGenDl);
        if (chatGateGenRef.current === chatGenDl) chatGateGenRef.current = null;
        return;
      }
      // Hoist uri so the runNativeOpBounded closure does not re-widen
      // DownloadOutcome (status === "aborted" already returned above).
      const modelUri = (outcome.model as { status: "done"; uri: string }).uri;
      const boundedInitDl = await runNativeOpBounded(
        () =>
          initEngine(modelUri, model.id, {
            mmprojPath,
            nCtx: profile.nCtx,
            cacheTypeK: profile.cacheTypeK,
            cacheTypeV: profile.cacheTypeV,
            kvUnified: model.kvUnified,
            mtpNMax: model.mtp?.nMax,
            mtpDefaultOn: model.mtp?.defaultEnabled === true,
            speculativeOverride,
            engineOverride,
            sessionRestore: {
              historyHash: sessionHistoryHash,
              promptEnvHash: sessionPromptEnvHash,
            },
            locale,
          }),
        EMBEDDER_RELEASE_TIMEOUT_MS,
      );
      if (!boundedInitDl.ok) {
        markEmbedderHung();
        markChatReleased(chatGenDl);
        if (chatGateGenRef.current === chatGenDl) chatGateGenRef.current = null;
        setModelState("error");
        setModelErrorKind("engine");
        setModelError(t("embedding.busy"));
        setModelErrorDetail(null);
        console.warn(
          `[kalsa] runNativeOpBounded timed out after ${EMBEDDER_RELEASE_TIMEOUT_MS}ms (nativeOpBusy=${nativeOpBusy()}); chat init blocked — restart to recover`,
        );
        return;
      }
      const initResult = boundedInitDl.value;
      if (!stillCurrent()) {
        markChatReleased(chatGenDl);
        if (chatGateGenRef.current === chatGenDl) chatGateGenRef.current = null;
        return;
      }
      // Propagate effective n_ctx (post memory-clamp) — same single source as
      // ensureEngineForModel (engine init / document strategy / UI budgeting).
      const effective = initResult.effectiveNCtx;
      chatEngineCtxRef.current = effective;
      setChatEngineCtx(effective);
      warnIfNativePatchesInactive(initResult.systemInfo);
      setModelState("ready");
      modelStateRef.current = "ready";
      // FIX B / FIX 1: chat context resident (token-guarded).
      markChatReady(chatGenDl);
      // Same end-based clear as ensureEngineForModel: no stale banner on ready.
      setModelError(null);
      setModelErrorDetail(null);
      setModelErrorKind(null);
      setDownloadedById((prev) => ({ ...prev, [model.id]: true }));
      showNotice(t("download.readyNotice", { name: model.name }));
      void notifyDownload(
        t("notify.channelName"),
        t("download.notifyReady", { name: model.name }),
      );
    } catch (error) {
      // FIX B / FIX 1: free only the gen THIS download path acquired.
      if (acquiredChatGenDl !== null) {
        markChatReleased(acquiredChatGenDl);
        if (chatGateGenRef.current === acquiredChatGenDl) chatGateGenRef.current = null;
      }
      if (!stillCurrent()) return;
      if (controller.signal.aborted) {
        setModelState("missing");
        return;
      }
      setModelState("error");
      modelStateRef.current = "error";
      setModelErrorKind(errorPhase);
      setModelErrorDetail(rawErrorDetail(error));
      const friendly = friendlyNetworkError(error, locale, errorPhase).message;
      setModelError(friendly);
      void notifyDownload(
        t("notify.channelName"),
        t("download.notifyFailed", { error: friendly }),
      );
    } finally {
      downloadInFlight.current = false;
      downloadAbortRef.current = null;
      await deactivateKeepAwake(DOWNLOAD_KEEP_AWAKE_TAG).catch(() => undefined);
      await dismissDownloadProgressNotification();
    }
  }, [
    beginDownloadNotifications,
    bumpEmbedJobGeneration,
    dismissDownloadProgressNotification,
    locale,
    modelState,
    notifyDownload,
    showDownloadProgressNotification,
    showNotice,
    t,
  ]);

  // Conferma esplicita prima del download (mai automatico) — always bound to modelId.
  const confirmDownload = useCallback(
    (modelId: string) => {
      const model = MODEL_REGISTRY.find((m) => m.id === modelId);
      if (!model) return;
      // Synchronous double-tap guard before any await (probes + Alert).
      if (downloadInFlight.current || confirmDownloadLockRef.current) return;
      confirmDownloadLockRef.current = true;
      // Hard gate before the size Alert: refuse download of models that cannot fit.
      void (async () => {
        try {
          const [deviceProfile, free] = await Promise.all([
            getCachedDeviceProfile(),
            getFreeDiskBytes(),
          ]);
          const gate = gateForModel(model, deviceProfile, free);
          if (!gate.allowed) {
            confirmDownloadLockRef.current = false;
            Alert.alert(t("download.title"), gateReasonMessage(gate.reason, t));
            return;
          }
        } catch {
          // Probe failure → fall through to the normal confirm dialog.
        }
        const total = model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);
        Alert.alert(
          t("download.title"),
          t("download.confirmBody", { name: model.name, size: formatBytes(total) }),
          [
            {
              text: t("common.cancel"),
              style: "cancel",
              onPress: () => {
                confirmDownloadLockRef.current = false;
              },
            },
            {
              text: t("common.download"),
              onPress: () => {
                confirmDownloadLockRef.current = false;
                void startDownload(modelId);
              },
            },
          ],
        );
      })();
    },
    [startDownload, t],
  );

  const startVoiceDownload = useCallback(async () => {
    if (voiceDownloadInFlight.current || voiceState === "downloading") return;
    voiceDownloadInFlight.current = true;
    const controller = new AbortController();
    voiceDownloadAbortRef.current = controller;
    setVoiceState("downloading");
    setVoiceError(null);
    setVoiceDownloadPercent(0);
    try {
      const outcome = await downloadModelBundle(WHISPER_MODEL, {
        onBundleProgress: (progress) => {
          setVoiceDownloadPercent(Math.round(progress.overall * 100));
        },
        signal: controller.signal,
        locale,
      });
      if (outcome.model.status === "aborted") {
        setVoiceState("missing");
        setVoiceDownloadPercent(null);
        return;
      }
      if (!(await isWhisperModelDownloaded())) {
        setVoiceState("error");
        setVoiceError(t("download.incomplete"));
        setVoiceDownloadPercent(null);
        return;
      }
      setVoiceState("ready");
      setVoiceDownloadPercent(null);
      showNotice(t("download.readyNotice", { name: WHISPER_MODEL.name }));
      void notifyDownload(
        t("notify.channelName"),
        t("download.notifyReady", { name: WHISPER_MODEL.name }),
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setVoiceState("missing");
        setVoiceDownloadPercent(null);
        return;
      }
      setVoiceState("error");
      const friendly = friendlyNetworkError(error, locale, "download").message;
      setVoiceError(friendly);
      setVoiceDownloadPercent(null);
      void notifyDownload(
        t("notify.channelName"),
        t("download.notifyFailed", { error: friendly }),
      );
    } finally {
      voiceDownloadInFlight.current = false;
      voiceDownloadAbortRef.current = null;
    }
  }, [locale, notifyDownload, showNotice, t, voiceState, bumpEmbedJobGeneration]);

  const confirmVoiceDownload = useCallback(() => {
    Alert.alert(
      t("download.title"),
      t("download.confirmBody", {
        name: WHISPER_MODEL.name,
        size: formatBytes(WHISPER_MODEL.sizeBytes),
      }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.download"), onPress: () => void startVoiceDownload() },
      ],
    );
  }, [startVoiceDownload, t]);

  const startEmbeddingDownload = useCallback(async () => {
    if (embeddingDownloadInFlight.current || embeddingState === "downloading") {
      return;
    }
    embeddingDownloadInFlight.current = true;
    const controller = new AbortController();
    embeddingDownloadAbortRef.current = controller;
    setEmbeddingState("downloading");
    setEmbeddingError(null);
    setEmbeddingDownloadPercent(0);
    try {
      // Free-disk check via existing download flow (not subject to chat RAM gate).
      try {
        const free = await getFreeDiskBytes();
        const need = diskRequirementBytes(EMBEDDING_MODEL.sizeBytes);
        if (typeof free === "number" && free >= 0 && free < need) {
          setEmbeddingState("error");
          setEmbeddingError(t("models.blockedDisk"));
          setEmbeddingDownloadPercent(null);
          return;
        }
      } catch {
        // Probe failure → proceed with download.
      }
      const outcome = await downloadModelBundle(EMBEDDING_MODEL, {
        onBundleProgress: (progress) => {
          setEmbeddingDownloadPercent(Math.round(progress.overall * 100));
        },
        signal: controller.signal,
        locale,
      });
      if (outcome.model.status === "aborted") {
        setEmbeddingState("missing");
        setEmbeddingDownloadPercent(null);
        return;
      }
      if (!(await isModelBundleDownloaded(EMBEDDING_MODEL))) {
        setEmbeddingState("error");
        setEmbeddingError(t("download.incomplete"));
        setEmbeddingDownloadPercent(null);
        return;
      }
      embedderDownloadedRef.current = true;
      setEmbeddingState("ready");
      setEmbeddingDownloadPercent(null);
      showNotice(t("download.readyNotice", { name: EMBEDDING_MODEL.name }));
      void notifyDownload(
        t("notify.channelName"),
        t("download.notifyReady", { name: EMBEDDING_MODEL.name }),
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setEmbeddingState("missing");
        setEmbeddingDownloadPercent(null);
        return;
      }
      setEmbeddingState("error");
      const friendly = friendlyNetworkError(error, locale, "download").message;
      setEmbeddingError(friendly);
      setEmbeddingDownloadPercent(null);
      void notifyDownload(
        t("notify.channelName"),
        t("download.notifyFailed", { error: friendly }),
      );
    } finally {
      embeddingDownloadInFlight.current = false;
      embeddingDownloadAbortRef.current = null;
    }
  }, [embeddingState, locale, notifyDownload, showNotice, t]);

  const confirmEmbeddingDownload = useCallback(() => {
    Alert.alert(
      t("download.title"),
      t("download.confirmBody", {
        name: EMBEDDING_MODEL.name,
        size: formatBytes(EMBEDDING_MODEL.sizeBytes),
      }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.download"),
          onPress: () => void startEmbeddingDownload(),
        },
      ],
    );
  }, [startEmbeddingDownload, t]);

  const handleToggleTts = useCallback((next: boolean) => {
    setTtsEnabledState(next);
    void setTtsEnabled(next).catch(() => {
      // best-effort; keep UI optimistic
    });
  }, []);

  // When Settings opens, scan which models are fully on disk (once per open + after state changes).
  useEffect(() => {
    if (activeOverlay?.kind !== "settings") return;
    let mounted = true;
    void (async () => {
      const entries = await Promise.all(
        MODEL_REGISTRY.map(async (m) => {
          try {
            const ok = await isModelBundleDownloaded(m);
            return [m.id, ok] as const;
          } catch {
            return [m.id, false] as const;
          }
        }),
      );
      if (!mounted) return;
      const map: Record<string, boolean> = {};
      for (const [id, ok] of entries) map[id] = ok;
      setDownloadedById(map);
    })();
    return () => {
      mounted = false;
    };
  }, [activeOverlay?.kind, modelState]);

  // ── Chat wiring ──────────────────────────────────────────────────────────
  const handleMiniappAction = useCallback(
    (action: Record<string, unknown>, miniapp: AskAssistantMiniapp) => {
      void handleAskAssistantMiniappAction(action, miniapp, {
        setAskAssistantDraft: () => undefined,
        setFeedback: showNotice,
        setMobileError: (value) => showNotice(`⚠️ ${value}`),
        locale,
      });
    },
    [locale, showNotice],
  );

  /**
   * Stream a chat turn. Resolves with `afterSessionSave` so the UI can run
   * turn-end KV save first, then schedule memory extract (extract clearCache's
   * the chat KV — save must win the FIFO).
   */
  const handleSendStream = useCallback(
    (
      text: string,
      callbacks: any,
      signal: AbortSignal,
      attachments?: LocalAttachment[],
      history?: unknown[],
    ) =>
      new Promise<{ afterSessionSave?: () => void }>((resolve) => {
        let settled = false;
        /** Deferred extract hook — set once scheduleMemoryExtract is defined. */
        let afterSessionSave: (() => void) | undefined;
        const finish = () => {
          if (settled) return;
          settled = true;
          streamInFlightRef.current = false;
          setStreaming(false);
          resolve(afterSessionSave ? { afterSessionSave } : {});
        };
        const fail = (message: string, reasonKey?: string) => {
          callbacks.onDelta?.(`⚠️ ${message}`, `⚠️ ${message}`);
          try {
            callbacks.onFailed?.(reasonKey || "chat.serviceUnreachable");
          } catch {
            // ignore
          }
          finish();
        };

        streamInFlightRef.current = true;
        setStreaming(true);
        // Fresh web_fetch allowlist for every send (F5), even if text matches the previous turn.
        fetchAllowlistTurnSeq += 1;

        void (async () => {
          let turnFailed = false;
          let assistantFull = "";
          let extractScheduled = false;
          let compactionFollowupScheduled = false;

          /**
           * Turn-end order (must preserve for KV save effectiveness):
           *   1) armMemoryExtract at onDone — registers memoryExtractRef so a
           *      concurrent next send waits, but does NOT yet queue extractMemory
           *   2) AiChatPage awaits saveEngineSession (FIFO)
           *   3) afterSessionSave releases the save-gate → extractMemory runs
           *
           * extractMemory clearCache's the chat KV (kvHoldsChatSession=false).
           * If extract were queued before save, save would always skip with
           * reason kv_not_chat. Gates: memory enabled, non-empty reply, not
           * aborted/failed, sendRunId (AiChatPage).
           */
          let releaseSaveGate: (() => void) | undefined;
          const armMemoryExtract = () => {
            if (extractScheduled) return;
            extractScheduled = true;
            if (signal.aborted || turnFailed || !assistantFull.trim()) return;

            const capturedAssistant = assistantFull;
            const capturedUser = text;
            const startEpoch = MemoryStore.getEpoch();

            const saveGate = new Promise<void>((resolve) => {
              releaseSaveGate = resolve;
            });
            // clearChat/stop aborts the signal — release so we never hang the ref.
            const onAbortRelease = () => {
              releaseSaveGate?.();
            };
            signal.addEventListener("abort", onAbortRelease, { once: true });
            // Safety valve (re-verify finding 1c): if NO path releases the gate
            // (rapid re-send inside the save window, a skipped save branch, a
            // Fabric-lane ordering glitch), the extract must still run — a
            // stranded gate keeps memoryExtractRef set and DEADLOCKS the next
            // send. Worst case of firing early: the save skips with
            // kv_not_chat, which is the pre-feature behavior, never a hang.
            const gateTimeoutId = setTimeout(() => {
              releaseSaveGate?.();
            }, 10_000);

            const extractJob = (async () => {
              try {
                await saveGate;
                if (signal.aborted || turnFailed) return;
                if (!(await MemoryStore.getEnabled())) return;
                if (MemoryStore.getEpoch() !== startEpoch) return;

                const { add, remove } = await extractMemory(
                  capturedUser,
                  capturedAssistant,
                  locale,
                );

                // Single batched apply: re-checks epoch + enabled under the store mutex
                // so a clear/toggle-off during extract cannot be partially overwritten.
                if (add.length === 0 && remove.length === 0) return;
                if (MemoryStore.getEpoch() !== startEpoch) return;
                if (!(await MemoryStore.getEnabled())) return;

                const applied = await MemoryStore.applyExtractResults(
                  add,
                  remove,
                  startEpoch,
                );
                if (applied) {
                  await refreshMemoryFacts();
                }
              } catch {
                // ignore — extraction must never surface to the user
              } finally {
                clearTimeout(gateTimeoutId);
                try {
                  signal.removeEventListener("abort", onAbortRelease);
                } catch {
                  // ignore
                }
              }
            })();

            memoryExtractRef.current = extractJob;
            void extractJob.finally(() => {
              if (memoryExtractRef.current === extractJob) {
                memoryExtractRef.current = null;
              }
            });
          };
          // AiChatPage: await saveEngineSession → afterSessionSave() (releases gate).
          afterSessionSave = () => {
            const release = releaseSaveGate;
            if (release) {
              release();
              return;
            }
            // Fallback if arm ran without a gate (empty/aborted) or ordering glitch:
            // arm now and release immediately so extract is not silently dropped.
            armMemoryExtract();
            const releaseAfterArm = releaseSaveGate;
            if (releaseAfterArm) releaseAfterArm();
          };

          try {
            // PREEMPT summary BEFORE any engine wait/enqueue so the FIFO never
            // makes a user turn sit behind a background summarize job.
            abortBackgroundSummary();

            // Wait out a pending memory extract so we never dual-complete on the engine.
            if (memoryExtractRef.current) {
              try {
                await memoryExtractRef.current;
              } catch {
                // ignore
              }
              memoryExtractRef.current = null;
            }
            if (!(await ensureEngineForModel(currentModel))) {
              // Bundle missing → download prompt; engine error → load-failed + Settings retry.
              // ensureEngineForModel early-returns false when bundle is missing without setting
              // modelErrorKind, so re-check disk rather than relying on modelErrorKind alone.
              const downloaded = await isModelBundleDownloaded(currentModel).catch(() => false);
              if (downloaded) {
                fail(
                  t("chat.modelLoadFailed", { name: currentModel.name }),
                  "chat.modelLoadFailed",
                );
              } else {
                fail(
                  t("chat.modelNotDownloaded", { name: currentModel.name }),
                  "chat.modelNotDownloaded",
                );
              }
              return;
            }

            const chatId = DEFAULT_CHAT_ID;
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
              const raw = await AsyncStorage.getItem(COMPACTION_ENABLED_KEY);
              compactionEnabledRef.current = raw === "1" || raw === "true";
            } catch {
              compactionEnabledRef.current = false;
            }

            const compactionOn = compactionEnabledRef.current;
            let operativeContext: { digest?: string; summary?: string } | null = null;
            let olderForSummary: HistoryRoleMessage[] = [];
            let boundaryForAssemble = 0;

            if (compactionOn) {
              const userTurnCount = countUserTurns(validatedHistory, true);

              // Load per-chat compactor state (memory → AsyncStorage).
              let state = compactorStateByChat.get(chatId);
              if (!state) {
                try {
                  const raw = await AsyncStorage.getItem(compactorStorageKey(chatId));
                  state = parseCompactorState(raw, chatId);
                  // Prefer dedicated summary key if present (may be newer pending).
                  const sumRaw = await AsyncStorage.getItem(summaryStorageKey(chatId));
                  if (typeof sumRaw === "string" && sumRaw.trim()) {
                    state = {
                      ...state,
                      rollingSummary: truncateBudget(sumRaw.trim(), SUMMARY_BUDGET_CHARS),
                    };
                  }
                  compactorStateByChat.set(chatId, state);
                } catch {
                  state = emptyCompactorState(chatId);
                  compactorStateByChat.set(chatId, state);
                }
              }

              // Load-time guards: stale digest/summary after clearChat + app restart
              // (in-memory lastHistoryLen dies with the process; AsyncStorage survives).
              // (1) State belongs to a longer (deleted) conversation.
              // (2) First send of an empty conversation still has persisted state.
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

              // Boundary + rolling summary: K-turn cadence (or early size / force).
              // Verbatim window stays append-only between these rebuilds (KV prefix).
              if (
                shouldRebuild(state, userTurnCount, null, recentForBudget) ||
                forceRebuild
              ) {
                const pending = pendingSummaryByChat.get(chatId);
                state = advanceCompactionBoundary(state, {
                  chatId,
                  userTurnCount,
                  historyLength: validatedHistory.length,
                  hasImages,
                  nextSummary:
                    typeof pending === "string"
                      ? pending
                      : state.rollingSummary,
                });
                if (pending !== undefined) pendingSummaryByChat.delete(chatId);
              }

              boundaryForAssemble = resolveBoundaryIndex(
                state,
                validatedHistory.length,
              );

              // Older corpus for summary scheduling + warm-index sync.
              const olderClean = filterCorpusHygiene(
                splitAtBoundary(validatedHistory, boundaryForAssemble).older,
              );
              olderForSummary =
                olderClean.length > MAX_SUMMARY_CORPUS_MESSAGES
                  ? olderClean.slice(-MAX_SUMMARY_CORPUS_MESSAGES)
                  : olderClean;

              // Warm index: append as boundary advances; query every turn.
              const digestIndex = syncDigestIndex(
                chatId,
                validatedHistory,
                boundaryForAssemble,
              );
              const olderForDigest =
                olderClean.length > MAX_DIGEST_CORPUS_MESSAGES
                  ? olderClean.slice(-MAX_DIGEST_CORPUS_MESSAGES)
                  : olderClean;
              const oldUnits = toRetrievalUnits(olderForDigest);

              // Query-time BM25 digest — current user message is the retrieval query.
              // (Digest rides on last user message via format B; freezing it saved
              // zero prefill and cost recall — see RESEARCH_CONTEXT_LOSS.md.)
              state = refreshQueryDigest(state, {
                chatId,
                index: digestIndex,
                oldTurns: oldUnits,
                currentQuery: text,
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

              if (state.frozenDigest || state.rollingSummary) {
                operativeContext = {
                  digest: state.frozenDigest || undefined,
                  summary: state.rollingSummary || undefined,
                };
              }
            }

            // History assembly: legacy sliding window (OFF) or boundary→end (ON,
            // append-only growth between rebuilds — preserves KV prefix).
            const assembled = assembleEngineHistory(validatedHistory, {
              compactionEnabled: compactionOn,
              hasImages,
              boundaryIndex: boundaryForAssemble,
            });
            const engineMessages: EngineMessage[] = assembled.map((m) => ({
              role: m.role,
              content: m.content,
            }));

            // Immagini da allegare all'ultimo messaggio user (cap 5):
            // immagini dirette + pagine PDF renderizzate.
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
            const userMessage: EngineMessage = { role: "user", content: text };
            if (images.length) userMessage.images = images;
            engineMessages.push(userMessage);

            const promptFacts = memoryEnabledRef.current ? memoryFactsRef.current : [];
            // Echo guard uses exactly the facts injected this turn (immune to
            // mid-turn memory disable). Empty when memory off / no facts.
            injectedFactsRef.current = promptFacts;

            /**
             * Schedule a preemptable background summary (debounced 8s idle) only
             * when the NEXT user turn will rebuild anyway (turnsSinceRebuild ===
             * K-1). Summary completion / clearCache destroys the KV prefix; by
             * aligning with the pre-rebuild turn that destruction is absorbed by
             * the rebuild turn's inevitable cold prefill (not a warm mid-cycle
             * turn). Pending-summary promotion at rebuild time is unchanged.
             */
            const scheduleCompactionFollowup = () => {
              if (compactionFollowupScheduled) return;
              compactionFollowupScheduled = true;
              if (!compactionOn || turnFailed || signal.aborted) return;
              if (olderForSummary.length === 0) return;

              // turnsSinceRebuild after this turn's state (post-rebuild → 0).
              const st = compactorStateByChat.get(chatId);
              const K = DEFAULT_COMPACTOR_CONFIG.rebuildEveryKUserTurns;
              const turnsSinceRebuild =
                st && typeof st.builtAtUserTurn === "number" && st.builtAtUserTurn >= 0
                  ? countUserTurns(validatedHistory, true) - st.builtAtUserTurn
                  : 0;
              if (turnsSinceRebuild !== K - 1) return;

              const transcript = buildSummaryTranscript(olderForSummary);
              if (!transcript.trim()) return;

              if (summaryDebounceTimer) clearTimeout(summaryDebounceTimer);
              summaryDebounceTimer = setTimeout(() => {
                summaryDebounceTimer = null;
                // Still idle? streamInFlight means user already sent again.
                if (streamInFlightRef.current) return;

                const ac = new AbortController();
                summaryAbortController = ac;
                const capturedLocale = locale;
                const capturedChatId = chatId;
                void (async () => {
                  try {
                    const summary = await summarizeConversation(
                      transcript,
                      capturedLocale,
                      ac.signal,
                    );
                    if (ac.signal.aborted || !summary.trim()) return;
                    const trimmed = truncateBudget(
                      summary.trim(),
                      SUMMARY_BUDGET_CHARS,
                    );
                    // Store as pending — promoted into rollingSummary on next boundary rebuild.
                    pendingSummaryByChat.set(capturedChatId, trimmed);
                    try {
                      await AsyncStorage.setItem(
                        summaryStorageKey(capturedChatId),
                        trimmed,
                      );
                    } catch {
                      // best-effort
                    }
                  } catch {
                    // keep previous rollingSummary
                  } finally {
                    if (summaryAbortController === ac) {
                      summaryAbortController = null;
                    }
                  }
                })();
              }, SUMMARY_IDLE_DEBOUNCE_MS);
            };

            await streamAssistantTurn(
              engineMessages,
              {
                onDelta: (delta, full) => {
                  assistantFull = full;
                  callbacks.onDelta?.(delta, full);
                },
                onStatus: (status) => callbacks.onStatus?.(status),
                onSources: (sources) =>
                  callbacks.onSources?.(mapSearchSourcesToChat(sources as any, locale)),
                onMiniapp: (miniapp) => callbacks.onMiniapp?.(miniapp),
                onTool: (tool) => callbacks.onActions?.({ kind: "tool", tool }),
                onDone: () => {
                  // Arm extract (memoryExtractRef) before unlocking; gate opens
                  // only after AiChatPage's turn-end save settles.
                  armMemoryExtract();
                  scheduleCompactionFollowup();
                  finish();
                },
                onError: (error) => {
                  turnFailed = true;
                  // context_full + compaction ON → force rebuild next send.
                  if (
                    compactionOn &&
                    error &&
                    typeof error === "object" &&
                    (error as { code?: string }).code === "context_full"
                  ) {
                    forceRebuildByChat.set(chatId, true);
                  }
                  callbacks.onDelta?.(`⚠️ ${error.message}`, `⚠️ ${error.message}`);
                  try {
                    callbacks.onFailed?.("chat.serviceUnreachable");
                  } catch {
                    // ignore
                  }
                  finish();
                },
              },
              signal,
              {
                ...agentOptions,
                locale,
                memoryFacts: promptFacts,
                operativeContext,
              },
            );
            // Safety: if the stream returns without onDone/onError (e.g. abort path).
            // Arm extract (no-ops if aborted/empty); gate opens post-save.
            armMemoryExtract();
            scheduleCompactionFollowup();
            finish();
          } catch (error) {
            fail(error instanceof Error ? error.message : String(error));
          }
        })();
      }),
    [agentOptions, currentModel, ensureEngineForModel, locale, refreshMemoryFacts, t],
  );

  // ── Render barra modello ─────────────────────────────────────────────────
  const progressPercent = download ? Math.round(download.progress * 100) : 0;

  // Extra guidance for connectivity-shaped failures (keep-open hint), plus the
  // raw download error as an untranslated diagnostic when it differs from the
  // friendly message (no adb access on user devices).
  const modelErrorHint = (() => {
    if (modelState !== "error") return null;
    const isConnectivity =
      !!modelError &&
      (modelError === t("errors.connectionLost") ||
        modelError === t("errors.networkUnreachable"));
    // Detail is always "Name: message"; strip that prefix before comparing so a
    // zero-value duplicate of the friendly text is not shown as a "hint".
    const detailBody = modelErrorDetail
      ? modelErrorDetail.replace(/^(?:[A-Za-z]+Error?|Error):\s*/, "")
      : null;
    const raw =
      modelErrorDetail && detailBody !== modelError ? modelErrorDetail : null;
    if (isConnectivity) {
      const keepOpen = t("download.keepOpenHint");
      // Raw first so numberOfLines ellipsis keeps the diagnostic, not the hint.
      return raw ? `${raw} — ${keepOpen}` : keepOpen;
    }
    return raw;
  })();

  const modelBarStatus = (() => {
    const engineLoaded = isEngineReady() && getActiveModelId() === currentModel.id;
    switch (modelState) {
      case "checking":
        return { label: t("download.checking"), color: colors.muted };
      case "missing":
        return {
          label: t("download.missing", {
            size: formatBytes(currentModel.sizeBytes + (currentModel.mmproj?.sizeBytes ?? 0)),
          }),
          color: colors.accent,
        };
      case "downloading":
        return {
          label: t("download.downloading", { percent: progressPercent }),
          color: colors.accent,
        };
      case "loading":
        return { label: t("download.loading"), color: colors.muted };
      case "error":
        return {
          // Round 8 FIX 2: when embedder is hung, retry is a no-op — surface
          // restart guidance instead of "tap to retry" (busy message already
          // set on the banner; bar label matches recovery action).
          label: isEmbedderHung()
            ? t("embedding.restartHint")
            : modelErrorKind === "engine"
              ? t("download.loadFailedRetry")
              : t("download.failedRetry"),
          color: colors.bad,
        };
      case "ready":
        // HIGH-2: downloaded-but-unloaded is tappable ("Tap to reload"), never auto-load.
        return {
          label: engineLoaded
            ? t("download.readyLocal")
            : t("chat.lazyReload"),
          color: engineLoaded ? colors.good : colors.accent,
        };
    }
  })();

  return (
    // Outer shell is NOT keyed: PdfTextExtractorHost must survive font-scale
    // remounts (otherwise an in-flight extract is rejected as "unmounted" /
    // cancelled while the user only changed text size).
    <View style={{ flex: 1, backgroundColor: colors.shell }}>
    {/*
      PainterlyBg + header + AiChatPage stay unkeyed: they already call
      useTypography() and re-render via theme context. key=fontScaleId lives
      only on Help / Documents / drawer — those still read the static
      typography singleton via theme/components, so they remount to pick up
      the new sizes without resetting the chat FlatList / JPEG decode /
      history reload. Settings is NOT keyed: it already uses useTypography()
      and remounting would wipe an in-progress API-key draft.
    */}
    <View style={{ flex: 1 }}>
      <PainterlyBg />
      <GestureDetector gesture={edgeSwipe}>
      <View style={{ flex: 1 }}>
      {/* Top safe-area belongs to the header below (paddingTop: insets.top + 4).
          AiChatPage owns only the bottom inset, for the composer — it used to add
          the top inset too, which reserved the status-bar height twice. */}
      <SafeAreaView style={{ flex: 1 }} edges={[]}>
        {/* Header compatto: titolo + modello/stato in una riga */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            paddingHorizontal: spacing.lg,
            paddingTop: insets.top + 4,
            paddingBottom: 2,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={[
                typography.bodyMd,
                { color: colors.ink, fontFamily: fontFamilies.displayBold, letterSpacing: 0.2 },
              ]}
              numberOfLines={1}
            >
              Kalsa
            </Text>
            {/* Model chip: download if missing; retry if error; load if downloaded-unloaded.
                Never auto-load on foreground (ANTI_OOM). HIGH-2: chip stays enabled. */}
            <Pressable
              onPress={() => {
                if (modelState === "missing") {
                  confirmDownload(currentModel.id);
                } else if (modelState === "error") {
                  // Hung embedder: retry is a no-op (recovery = process restart).
                  // Bar is disabled below when hung so this path is unreachable.
                  if (isEmbedderHung()) return;
                  if (modelErrorKind === "engine") {
                    void ensureEngineForModel(currentModel);
                  } else {
                    confirmDownload(currentModel.id);
                  }
                } else if (modelState === "ready") {
                  const engineLoaded =
                    isEngineReady() && getActiveModelId() === currentModel.id;
                  if (!engineLoaded && !isEmbedderHung()) {
                    void ensureEngineForModel(currentModel);
                  }
                }
              }}
              disabled={
                isEmbedderHung() ||
                modelState === "downloading" ||
                modelState === "loading" ||
                modelState === "checking" ||
                (modelState === "ready" &&
                  isEngineReady() &&
                  getActiveModelId() === currentModel.id)
              }
              // Nit (round 9): hung bar stays non-interactive (restart-only label).
              pointerEvents={isEmbedderHung() ? "none" : "auto"}
              hitSlop={6}
            >
              {/* Allow wrap at large font scales so the status segment
                  (Ready / Download …) is never clipped. Do not shrink type. */}
              <Text style={[typography.bodyXs, { color: modelBarStatus.color }]}>
                {currentModel.name} · {currentModel.quant} · {modelBarStatus.label}
              </Text>
            </Pressable>
          </View>

          {/* HIGH-5: real Web toggle (persisted). Default ON. */}
          <Pressable
            onPress={toggleWebTools}
            hitSlop={8}
            accessibilityRole="switch"
            accessibilityState={{ checked: webToolsEnabled }}
            accessibilityLabel={t("common.web")}
            accessibilityHint={
              webToolsEnabled
                ? t("common.webOnHint")
                : t("common.webOffHint")
            }
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 999,
              backgroundColor: webToolsEnabled
                ? `${colors.accent}22`
                : `${colors.muted}18`,
              borderWidth: 1,
              borderColor: webToolsEnabled
                ? `${colors.accent}55`
                : `${colors.muted}44`,
              opacity: webToolsEnabled ? 1 : 0.7,
            }}
          >
            <LucideGlobe
              size={11}
              color={webToolsEnabled ? colors.accent : colors.muted}
            />
            <Text
              style={[
                typography.monoXs,
                {
                  color: webToolsEnabled ? colors.accent : colors.muted,
                  textDecorationLine: webToolsEnabled ? "none" : "line-through",
                },
              ]}
            >
              {t("common.web")}
            </Text>
          </Pressable>
        </View>

        {/* Progress bar sottile, solo durante il download */}
        {modelState === "downloading" ? (
          <View
            style={{
              marginHorizontal: spacing.lg,
              marginBottom: spacing.xs,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.line,
              overflow: "hidden",
            }}
          >
            <View style={{ height: 4, width: `${progressPercent}%`, backgroundColor: colors.accent }} />
          </View>
        ) : null}

        {modelError ? (
          <Text
            style={[
              typography.bodyXs,
              { color: colors.bad, marginHorizontal: spacing.lg, marginBottom: spacing.xs },
            ]}
            numberOfLines={1}
          >
            {modelError}
          </Text>
        ) : null}

        {modelErrorHint ? (
          <Text
            style={[
              typography.bodyXs,
              { color: colors.muted, marginHorizontal: spacing.lg, marginBottom: spacing.xs },
            ]}
            numberOfLines={4}
          >
            {modelErrorHint}
          </Text>
        ) : null}

        <View style={{ flex: 1 }}>
          <AiChatPage
            userName={null}
            selectedRun={null}
            prefillText={null}
            onSendStream={handleSendStream}
            voiceReady={voiceState === "ready"}
            ttsEnabled={ttsEnabled}
            engineCtx={chatEngineCtx}
            documentLibrary={documentLibrary}
            onMemoryBanner={(key) => setMemoryBannerKey(key)}
            onOpenDocuments={() => setActiveOverlay({ kind: "documents" })}
            onAddDocument={addDocument}
            onOpenMiniapp={(miniapp) => {
              // Policy: ignore miniapp open while Settings/Help/Documents is active
              // (exclusive overlay; stays until user closes it).
              setActiveOverlay((prev) =>
                prev?.kind === "settings" ||
                prev?.kind === "help" ||
                prev?.kind === "documents"
                  ? prev
                  : { kind: "miniapp", miniapp: miniapp as AskAssistantMiniapp },
              );
            }}
            onCtaPress={(_cta: ChatCta) => undefined}
            onMenuPress={() => setDrawerOpen(true)}
          />
        </View>

        {notice ? (
          <View
            style={{
              position: "absolute",
              left: spacing.lg,
              right: spacing.lg,
              bottom: 96,
              backgroundColor: colors.panelSolid,
              borderRadius: 12,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              borderWidth: 1,
              borderColor: colors.line,
            }}
          >
            <Text style={[typography.bodyXs, { color: colors.ink }]}>{notice}</Text>
          </View>
        ) : null}
      </SafeAreaView>
      </View>
      </GestureDetector>

      <Drawer
        key={fontScaleId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        brand="Kalsa"
        subtitle={t("drawer.subtitle")}
        items={drawerItems}
      />

      {activeOverlay?.kind === "settings" ? (
        <SettingsScreen
          onBack={() => {
            setActiveOverlay(null);
            // Settings may have edited memory — refresh facts for the next turn.
            void refreshMemoryFacts();
          }}
          onOpenHelp={() => setActiveOverlay({ kind: "help" })}
          model={{
            currentModelId: currentModel.id,
            modelState,
            downloadPercent: modelState === "downloading" ? progressPercent : null,
            modelError,
            modelErrorHint,
            modelErrorKind,
            streaming,
            downloadedById,
            onSelectModel: selectModelById,
            onDownloadModel: confirmDownload,
            onRetryLoad: () => {
              void ensureEngineForModel(currentModel);
            },
          }}
          voice={{
            state: voiceState,
            downloadPercent: voiceState === "downloading" ? voiceDownloadPercent : null,
            error: voiceError,
            ttsEnabled,
            modelName: WHISPER_MODEL.name,
            modelSizeLabel: formatBytes(WHISPER_MODEL.sizeBytes),
            onDownload: confirmVoiceDownload,
            onToggleTts: handleToggleTts,
          }}
          embedding={{
            state: embeddingState,
            downloadPercent:
              embeddingState === "downloading" ? embeddingDownloadPercent : null,
            error: embeddingError,
            modelName: EMBEDDING_MODEL.name,
            modelSizeLabel: formatBytes(EMBEDDING_MODEL.sizeBytes),
            onDownload: confirmEmbeddingDownload,
          }}
        />
      ) : null}

      {activeOverlay?.kind === "documents" ? (
        <DocumentsScreen
          key={fontScaleId}
          library={documentLibrary}
          onAddDocument={addDocument}
          onDeleteDocument={deleteDocument}
          onReorderDocuments={reorderDocuments}
          onUpdateDocumentPreview={updateDocumentPreview}
          isDocumentDeleteInFlight={isDocumentDeleteInFlight}
          onBack={() => setActiveOverlay(null)}
        />
      ) : null}

      {activeOverlay?.kind === "help" ? (
        <HelpScreen
          key={fontScaleId}
          // Back from Help returns to Settings (Help is opened from Settings).
          onBack={() => setActiveOverlay({ kind: "settings" })}
        />
      ) : null}

      {activeOverlay?.kind === "miniapp" ? (
        <Modal
          visible
          animationType="slide"
          onRequestClose={() => setActiveOverlay(null)}
          statusBarTranslucent
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.shell }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.line,
              }}
            >
              <Text
                style={{ flex: 1, fontSize: 16, fontFamily: fontFamilies.bodySemi, color: colors.ink }}
                numberOfLines={1}
              >
                {activeOverlay.miniapp.title}
              </Text>
              <Pressable onPress={() => setActiveOverlay(null)} hitSlop={8}>
                <LucideX size={20} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
              <AskAssistantMiniappRenderer
                colors={colors}
                miniapp={activeOverlay.miniapp}
                onAction={(action, miniapp) =>
                  handleMiniappAction(action as Record<string, unknown>, miniapp as AskAssistantMiniapp)
                }
                styles={styles}
              />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      ) : null}
    </View>
      {/* Hosts stay unkeyed — never remount on text-size change. */}
      <PdfTextExtractorHost />
      <DocumentCoverHost />
    </View>
  );
}
