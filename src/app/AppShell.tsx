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
  type LibraryDoc,
  type LibraryState,
} from "../documents/DocumentLibrary";
import {
  deleteOwnedFile,
  deleteVectorIndexFile,
  readVectorIndexFile,
  writeVectorIndexFile,
} from "../documents/documentStorage";
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
  getEmbeddingModelStatus,
  listDocumentChunksForEmbed,
  planChunksToEmbed,
  releaseEmbedder,
} from "../engine/EmbeddingService";
// isEmbedderActive available for residency telemetry; chat/embedder mutual
// exclusion is enforced by releaseEmbedder-before-chat + ensureEmbedder gate.
import {
  SemanticVectorIndex,
  DEFAULT_VECTOR_MEMORY_FLOAT_CAP,
  totalResidentFloats,
} from "../documents/semanticIndex";
import {
  tryAcquireChat,
  markChatReady,
  markChatReleased,
  setCoResidencyContext,
  isChatModel2BClass,
  isChatModel4BClass,
  allowsCoResidency,
  CO_RESIDENCY_MIN_MEMORY_BYTES,
} from "../engine/llamaContextGate";
import { resolveContextProfile } from "../engine/contextProfile";
import {
  diskRequirementBytes,
  estimateModelNonEvictableMiB,
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
  streamAssistantTurn,
  summarizeConversation,
  type EngineMessage,
  type EngineTurnOptions,
} from "../engine/LlamaService";
import { computePromptEnvHash, getBootHistoryHash } from "../engine/sessionPersistence";
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
  return modelGateVerdict({
    totalMemoryBytes: profile.totalMemoryBytes,
    availableMemoryBytes: profile.availableMemoryBytes,
    freeDiskBytes,
    ramTier: profile.ramTier,
    modelMinRamTier: model.minRamTier,
    modelNonEvictableMiB: estimateModelNonEvictableMiB({
      sizeBytes: model.sizeBytes,
      engineCtx: model.engineCtx,
      kvBytesPerToken: model.kvBytesPerToken,
    }),
    // Always margined so confirm/start/Settings share one disk requirement.
    modelSizeBytes: diskRequirementBytes(modelBundleSizeBytes(model)),
  });
}

/** Localized hard-gate reason for Alert / error banner. */
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
      out.push(
        interrupted !== undefined
          ? { role, text, interrupted }
          : { role, text },
      );
    }
  }
  return out;
}

/**
 * AppShell — la schermata unica di AI Chat (Fase 1).
 *
 * Refactor del monolite originale (App.tsx, 3655 righe): qui restano solo
 * chat + barra modello + Ask AI + viewer miniapp. L'engine locale gira su
 * llama.rn; la barra modello gestisce download/switch dei GGUF.
 */
export function AppShell() {
  const { colors, styles, fontScaleId } = useLabTheme<any>();
  const typography = useTypography();
  const insets = useSafeAreaInsets();
  const { locale, t } = useLocale();
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    Map<string, "cap" | "capped" | "corrupt" | "no_embedder">
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
    void saveLibraryState(getDefaultLibraryStorage(), next).catch(() => undefined);
  }, []);

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
      void saveLibraryState(getDefaultLibraryStorage(), next).catch(
        () => undefined,
      );
      return true;
    } finally {
      releaseDelete();
    }
  }, [bumpEmbedJobGeneration]);

  /**
   * AppShell-owned document add (import commit).
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
    const next: LibraryState = {
      docs: [...(documentLibraryRef.current.docs ?? []), entry],
    };
    documentLibraryRef.current = next;
    // Functional updater is the authoritative React commit.
    setDocumentLibrary((prev) => ({
      docs: [...(prev.docs ?? []), entry],
    }));
    void saveLibraryState(getDefaultLibraryStorage(), next).catch(
      () => undefined,
    );
    // Background incremental embed (post-import, never blocks chat).
    // Single-flight; silent skip when embedder missing / load fails.
    void scheduleBackgroundEmbed(entry);
    return true;
  }, []);

  const isDocumentDeleteInFlight = useCallback(() => isDeleteActive(), []);

  /**
   * FIX D — lazy per-doc vector restore (no startup cost).
   *
   * Memory policy: total loaded floats across all docs must stay under
   * DEFAULT_VECTOR_MEMORY_FLOAT_CAP (200_000 ≈ 800 KB fp32). If loading this
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

      if (!tryAcquireRead()) return null;
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
        if (idx.chunkCount <= 0) return null;

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
        docDenseReasonByIdRef.current.delete(docId);
        return idx;
      } catch {
        docDenseReasonByIdRef.current.set(docId, "corrupt");
        return null;
      } finally {
        releaseRead();
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
   *   - ensureEmbedder refuses while isEngineReady(); AppShell also skips
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
    if (embedJobInFlightRef.current) return;
    embedJobInFlightRef.current = true;
    const jobGen = embedJobGenerationRef.current;
    const stillCurrent = () => jobGen === embedJobGenerationRef.current;

    // Job-scoped AbortController: bumpEmbedJobGeneration() aborts it.
    const ac = new AbortController();
    embedJobAbortRef.current = ac;
    const signal = ac.signal;

    /**
     * Chat residency gate. Chat is "resident" when the engine is ready OR the
     * UI state is loading/ready (covers the window between setModelState
     * ("loading") and isEngineReady() flipping true).
     */
    const isChatResident = () => {
      const st = modelStateRef.current;
      if (st === "ready" || st === "loading") return true;
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
      embedJobInFlightRef.current = false;
      if (embedJobAbortRef.current === ac) embedJobAbortRef.current = null;
      return;
    }

    try {
      if (!stillCurrent() || signal.aborted) return;

      if (await mustSkipForRam()) {
        // eslint-disable-next-line no-console
        console.log(
          "[embed] skip: chat resident on ≤6GB RAM — BM25-only until chat released",
        );
        return;
      }
      if (!stillCurrent() || signal.aborted) return;

      if (!embedderDownloadedRef.current) {
        try {
          const status = await getEmbeddingModelStatus({ signal });
          if (!stillCurrent() || signal.aborted) return;
          embedderDownloadedRef.current = status === "downloaded";
        } catch {
          return;
        }
        if (!embedderDownloadedRef.current) return;
      }

      // Load text the same way document_chat does (txt / pdf pages).
      let pages: Array<{ docId: string; text: string }> = [];
      if (entry.kind === "txt") {
        try {
          const raw = await FileSystem.readAsStringAsync(entry.fileUri);
          if (!stillCurrent() || signal.aborted) return;
          const looksHtml = /<\/?[a-z][\s\S]*>/i.test(raw.slice(0, 2000));
          const text = looksHtml ? htmlToText(raw).text : raw;
          const trimmed = (text ?? "").trim();
          if (trimmed) {
            pages = [{ docId: entry.sourceId || entry.id, text: trimmed }];
          }
        } catch {
          return;
        }
      } else {
        try {
          const extracted = await requestPdfText(entry.fileUri, {
            sourceId: entry.sourceId || entry.id,
            title: entry.name,
          });
          if (!stillCurrent() || signal.aborted) return;
          const docs = Array.isArray(extracted?.docs) ? extracted.docs : [];
          pages = docs
            .filter((d) => d && typeof d.text === "string" && d.text.trim().length > 0)
            .map((d) => ({
              docId: typeof d.docId === "string" ? d.docId : entry.sourceId || entry.id,
              text: d.text,
            }));
        } catch {
          return;
        }
      }
      if (pages.length === 0) return;

      // FIX F: single source of truth via listDocChunks (retrievalLoop).
      const chunks = listDocumentChunksForEmbed(pages);
      if (chunks.length === 0) return;

      const existing =
        docEmbedHashesByIdRef.current.get(entry.id) ?? new Set<string>();
      const liveIdx = docSemanticByIdRef.current.get(entry.id);
      if (liveIdx) {
        for (const k of liveIdx.contentHashKeys()) existing.add(k);
      }
      const toEmbed = planChunksToEmbed(existing, chunks);
      if (toEmbed.length === 0) return;

      // Working index: either the map-owned one or a fresh cold-import index.
      let index =
        docSemanticByIdRef.current.get(entry.id) ??
        new SemanticVectorIndex({ dims: EMBEDDING_MODEL.dims });

      // Embed one-by-one (G99 ~1–3 s/chunk). Abort if gen stale / signal / deleted.
      for (const chunk of toEmbed) {
        if (!stillCurrent() || signal.aborted) return;
        if (!documentLibraryRef.current.docs?.some((d) => d.id === entry.id)) {
          return;
        }
        if (await mustSkipForRam()) {
          // eslint-disable-next-line no-console
          console.log(
            "[embed] abort mid-job: chat became resident on ≤6GB — no embedder init",
          );
          return;
        }
        if (!stillCurrent() || signal.aborted) return;

        // FIX B: pass job signal so EmbeddingService aborts at every await.
        const vec = await embedDocumentChunk(chunk.text, { signal });
        if (!stillCurrent() || signal.aborted) return;
        if (!vec) {
          // Embedder failed / refused (chat resident) / aborted — stop.
          break;
        }

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
            } catch {
              /* best-effort */
            }
          }
          // eslint-disable-next-line no-console
          console.log(
            "[embed] cap reached — remaining chunks skipped; hybrid degrades when index empty",
          );
          return;
        }
        if (addResult.added === 0) {
          // Vector rejected for non-cap reasons (zero/bad dims) — stop.
          break;
        }
        existing.add(embedChunkKey(chunk.chunkId, chunk.contentHash));

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
        } catch {
          /* best-effort durable write */
        }
        if (!stillCurrent() || signal.aborted) return;
        // Post-write existence check: if deleted during the write, drop the
        // resurrected map entry (delete already removed the file under its gate).
        if (!documentLibraryRef.current.docs?.some((d) => d.id === entry.id)) {
          docSemanticByIdRef.current.delete(entry.id);
          docEmbedHashesByIdRef.current.delete(entry.id);
          return;
        }
      }
    } catch {
      // ignore — hybrid degrades to BM25
    } finally {
      releaseRead();
      embedJobInFlightRef.current = false;
      if (embedJobAbortRef.current === ac) embedJobAbortRef.current = null;
    }
  }, []); // refs only — bumpEmbedJobGeneration is stable via useCallback([])

  // ── Web tools (search + fetch): SEMPRE ATTIVI — il modello decide se usarli
  // (info attuali, notizie, o richiesta esplicita). Le query / fetch partono solo
  // quando il tool viene chiamato (privacy by design).
  // Per-turn allowlist: URLs from the user message + every web_search result;
  // web_fetch may only open those (closes crafted-URL exfiltration). Redirects
  // may land on another path/port of the SAME host, or an already-allowlisted URL.
  // document_chat sits alongside web tools and reuses requestPdfText (no new host).
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
        getDenseUnavailableReason: (docId: string) =>
          docDenseReasonByIdRef.current.get(docId) ?? null,
        isEmbedderDownloaded: () => embedderDownloadedRef.current,
        // FIX 6: thread AbortSignal into embedQuery (native abort gate).
        embedQuery: (text: string, signal?: AbortSignal) =>
          embedQueryVec(text, signal ? { signal } : undefined),
      },
      { locale },
    );
    // ensureSemanticIndexLoaded is stable (useCallback []); captured above.

    return {
      tools: [WEB_SEARCH_TOOL, WEB_FETCH_TOOL, DOCUMENT_CHAT_TOOL],
      executeTool: async (name, args, signal, lastUserMessage) => {
        ensureAllowlistForTurn(lastUserMessage);

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
  }, [locale]);

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
  const streamInFlightRef = useRef(false);
  const modelSwitchInFlightRef = useRef(false);
  /** UI mirror of streamInFlightRef — disables model Select in Settings. */
  const [streaming, setStreaming] = useState(false);
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
      void disposeEngine().finally(() => {
        // FIX B: unmount dispose frees the chat slot.
        markChatReleased();
      });
      void releaseWhisper();
      void releaseEmbedder();
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
      // FIX 3 / §5: releaseEmbedder only when co-residency is NOT allowed
      // (≤6 GB OR 4B chat model). On 8 GB+ with 2B chat, embed may co-reside.
      bumpEmbedJobGeneration();

      // Synchronous co-residency seed: model id + any RAM already known above.
      const modelIs2B = isChatModel2BClass(model.id);
      setCoResidencyContext({ chatModelIs2B: modelIs2B });

      // Synchronous chat-loading claim — MUST precede any further await so the
      // embedder cannot initLlama concurrently during the loading window.
      if (!tryAcquireChat()) {
        // Embedder holds the native slot and co-residency is off — force-release
        // then re-claim. releaseEmbedder is async; re-tryAcquire after it.
        await releaseEmbedder().catch(() => undefined);
        if (!stillCurrent()) {
          markChatReleased();
          return false;
        }
        if (!tryAcquireChat()) {
          // Still blocked — refuse chat load rather than race the embedder.
          setModelState("error");
          setModelErrorKind("engine");
          setModelError(t("errors.engineInitFailed"));
          setModelErrorDetail(null);
          return false;
        }
      }

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
          markChatReleased();
          return false;
        }
      }
      setCoResidencyContext({
        totalMemoryBytes: totalMem,
        chatModelIs2B: modelIs2B,
      });

      // §5 co-residency: release embedder before chat init ONLY when
      // (totalMemoryBytes ≤ 6e9) OR (chat model is 4B-class).
      const mustReleaseEmbed =
        totalMem <= 0 ||
        totalMem <= CO_RESIDENCY_MIN_MEMORY_BYTES ||
        isChatModel4BClass(model.id) ||
        !allowsCoResidency();
      if (mustReleaseEmbed) {
        await releaseEmbedder().catch(() => undefined);
      }
      if (!stillCurrent()) {
        markChatReleased();
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
        markChatReleased();
        return false;
      }
      const initResult = await initEngine(modelLocalPath(model, model.file), model.id, {
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
      });
      if (!stillCurrent()) {
        // Stale generation after success: dispose path will markChatReleased;
        // still release the loading claim so embed is not permanently blocked.
        markChatReleased();
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
      // FIX B: chat context resident — embedder refuses unless §5 co-residency.
      markChatReady();
      // End-based clear too: two concurrent ensures (double-tap in the probe
      // window) where the first fails and the second succeeds must not leave
      // "Ready" coexisting with a stale red banner.
      setModelError(null);
      setModelErrorDetail(null);
      setModelErrorKind(null);
      return true;
    } catch (error) {
      // FIX B: init failure → release chat claim so embed can proceed.
      markChatReleased();
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
          await disposeEngine();
        } catch {
          // ignore
        } finally {
          // FIX B: dispose → chat slot free for embedder.
          markChatReleased();
          modelSwitchInFlightRef.current = false;
        }
      })();
    },
    [modelIndex, modelState],
  );

  /** Settings: select by model id (same storage key + engine dispose path). */
  const selectModelById = useCallback(
    (modelId: string) => {
      const nextIndex = MODEL_REGISTRY.findIndex((m) => m.id === modelId);
      if (nextIndex < 0) return;
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
      // FIX B / FIX 3: cancel background embed; shared gate + §5 co-residency
      // (same policy as ensureEngineForModel).
      bumpEmbedJobGeneration();

      // Synchronous seed + tryAcquireChat BEFORE any await of the init flow.
      // Keep any previously known totalMemoryBytes (do not wipe to 0).
      const modelIs2BDl = isChatModel2BClass(model.id);
      setCoResidencyContext({ chatModelIs2B: modelIs2BDl });

      if (!tryAcquireChat()) {
        await releaseEmbedder().catch(() => undefined);
        if (!stillCurrent()) {
          markChatReleased();
          return;
        }
        if (!tryAcquireChat()) {
          setModelState("error");
          setModelErrorKind("engine");
          setModelError(t("errors.engineInitFailed"));
          return;
        }
      }

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
        markChatReleased();
        return;
      }
      setCoResidencyContext({
        totalMemoryBytes: totalMem,
        chatModelIs2B: modelIs2BDl,
      });

      const mustReleaseEmbed =
        totalMem <= 0 ||
        totalMem <= CO_RESIDENCY_MIN_MEMORY_BYTES ||
        isChatModel4BClass(model.id) ||
        !allowsCoResidency();
      if (mustReleaseEmbed) {
        await releaseEmbedder().catch(() => undefined);
      }
      if (!stillCurrent()) {
        markChatReleased();
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
          markChatReleased();
          return;
        }
        const gate = gateForModel(model, deviceProfile, free);
        if (
          !gate.allowed &&
          (gate.reason === "blocked_ram" || gate.reason === "blocked_tier") &&
          getActiveModelId() !== model.id
        ) {
          markChatReleased();
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
        markChatReleased();
        return;
      }
      const initResult = await initEngine(outcome.model.uri, model.id, {
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
      });
      if (!stillCurrent()) {
        markChatReleased();
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
      // FIX B: chat context resident.
      markChatReady();
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
      // FIX B: init/download failure after tryAcquireChat → free the slot.
      markChatReleased();
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
        const fail = (message: string) => {
          callbacks.onDelta?.(`⚠️ ${message}`, `⚠️ ${message}`);
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
                fail(t("chat.modelLoadFailed", { name: currentModel.name }));
              } else {
                fail(t("chat.modelNotDownloaded", { name: currentModel.name }));
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
          label: modelErrorKind === "engine" ? t("download.loadFailedRetry") : t("download.failedRetry"),
          color: colors.bad,
        };
      case "ready":
        return {
          label: engineLoaded ? t("download.readyLocal") : t("download.downloaded"),
          color: engineLoaded ? colors.good : colors.muted,
        };
    }
  })();

  return (
    // Outer shell is NOT keyed: PdfTextExtractorHost must survive font-scale
    // remounts (otherwise an in-flight extract is rejected as "unmounted" /
    // cancelled while the user only changed text size).
    <View style={{ flex: 1, backgroundColor: colors.shell }}>
    {/*
      key=fontScaleId: force a full remount of the visible tree on text-size
      change. Most of theme/components/* still reads the static `typography`
      singleton at module scope instead of useTypography() — a plain
      re-render leaves their already-created style objects looking stale even
      though the singleton's fontSize/lineHeight are updated (React does not
      know to re-render a component that isn't itself subscribed to the
      change). Remounting is the small, low-risk fix: AppShell's own hooks
      (engine refs, download state, model index) live above this element and
      are untouched, so the loaded model/engine and any in-flight downloads
      are NOT torn down — only the display subtree (chat, drawer, settings,
      help) unmounts and remounts, re-reading the (already-updated) typography
      values. AiChatPage reloads its message list from AsyncStorage on mount,
      which is written on every change, so no chat data is lost.
    */}
    <View key={fontScaleId} style={{ flex: 1 }}>
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
                { color: colors.ink, fontFamily: fontFamilies.displayBold, letterSpacing: 0.2, lineHeight: 20 },
              ]}
              numberOfLines={1}
            >
              Kalsa
            </Text>
            {/* Indicatore modello (selezione in Settings). Tap = download se manca/errore. */}
            <Pressable
              onPress={() => {
                if (modelState === "missing") {
                  confirmDownload(currentModel.id);
                } else if (modelState === "error") {
                  if (modelErrorKind === "engine") {
                    void ensureEngineForModel(currentModel);
                  } else {
                    confirmDownload(currentModel.id);
                  }
                }
              }}
              disabled={modelState !== "missing" && modelState !== "error"}
              hitSlop={6}
            >
              {/* Allow wrap at large font scales so the status segment
                  (Ready / Download …) is never clipped. Do not shrink type. */}
              <Text style={[typography.bodyXs, { color: modelBarStatus.color, lineHeight: 15 }]}>
                {currentModel.name} · {currentModel.quant} · {modelBarStatus.label}
              </Text>
            </Pressable>
          </View>

          {/* Badge statico: la web search è sempre disponibile */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 999,
              backgroundColor: `${colors.accent}22`,
              borderWidth: 1,
              borderColor: `${colors.accent}55`,
            }}
          >
            <LucideGlobe size={11} color={colors.accent} />
            <Text style={[typography.monoXs, { color: colors.accent }]}>
              {t("common.web")}
            </Text>
          </View>
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
            onOpenDocuments={() => setActiveOverlay({ kind: "documents" })}
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
          library={documentLibrary}
          onAddDocument={addDocument}
          onDeleteDocument={deleteDocument}
          isDocumentDeleteInFlight={isDocumentDeleteInFlight}
          onBack={() => setActiveOverlay(null)}
        />
      ) : null}

      {activeOverlay?.kind === "help" ? (
        <HelpScreen
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
      {/* Sibling of the fontScale-keyed tree — never remounts on text-size change. */}
      <PdfTextExtractorHost />
    </View>
  );
}
