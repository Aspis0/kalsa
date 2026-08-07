import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Keyboard, Modal, Pressable, ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { X as LucideX, Globe as LucideGlobe, Settings as LucideSettings } from "lucide-react-native";

import { AiChatPage, type ChatCta, type LocalAttachment } from "../screens/AiChatPage";
import { HelpScreen } from "../screens/HelpScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
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
import { MODEL_REGISTRY, WHISPER_MODEL, getDefaultModel, formatBytes, type ModelInfo } from "../engine/ModelRegistry";
import { downloadModelBundle, friendlyNetworkError, isModelBundleDownloaded, modelLocalPath } from "../engine/ModelDownloader";
import { resolveContextProfile } from "../engine/contextProfile";
import {
  disposeEngine,
  extractMemory,
  getActiveModelId,
  initEngine,
  isEngineReady,
  streamAssistantTurn,
  summarizeConversation,
  type EngineMessage,
  type EngineTurnOptions,
} from "../engine/LlamaService";
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
import { getStrings, useLocale } from "../i18n";
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

type ModelState = ModelPipelineState;

/** Exclusive full-screen overlays (drawer stays separate — transient chrome). */
type ActiveOverlay =
  | { kind: "settings" }
  | { kind: "help" }
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

  // ── Web tools (search + fetch): SEMPRE ATTIVI — il modello decide se usarli
  // (info attuali, notizie, o richiesta esplicita). Le query / fetch partono solo
  // quando il tool viene chiamato (privacy by design).
  // Per-turn allowlist: URLs from the user message + every web_search result;
  // web_fetch may only open those (closes crafted-URL exfiltration). Redirects
  // may land on another path/port of the SAME host, or an already-allowlisted URL.
  const agentOptions = useMemo<EngineTurnOptions>(() => {
    const searchExec = makeWebSearchExecutor(locale);
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

    return {
      tools: [WEB_SEARCH_TOOL, WEB_FETCH_TOOL],
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

        return {
          text: getStrings(locale).errors.unknownTool.replace("{name}", name),
        };
      },
    };
  }, [locale]);

  // ── Drawer + exclusive overlay (settings | miniapp | null) ────────────────
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
  const [memoryFacts, setMemoryFacts] = useState<string[]>([]);
  const memoryFactsRef = useRef<string[]>(memoryFacts);
  memoryFactsRef.current = memoryFacts;
  /** Mirror of MemoryStore.getEnabled — never inject facts when false. */
  const memoryEnabledRef = useRef(false);
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
  const [download, setDownload] = useState<{ bytesReceived: number; bytesTotal: number; progress: number } | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  // Raw download error (untranslated) for on-device diagnostics when friendly text is generic.
  const [modelErrorDetail, setModelErrorDetail] = useState<string | null>(null);
  /** Discriminates download vs engine-init failures when modelState === "error". */
  const [modelErrorKind, setModelErrorKind] = useState<"download" | "engine" | null>(null);
  const currentModel = MODEL_REGISTRY[modelIndex];
  // Same resolve path as initEngine — catalog n_ctx (+ optional high-RAM hybrid
  // upgrade). Passed to AiChatPage for the long-chat nudge ceiling so the
  // warning tracks whatever model is selected, not a fixed magic number.
  const chatEngineCtx = useMemo(
    () =>
      resolveContextProfile({
        hybrid: currentModel.hybrid,
        kvCache: currentModel.kvCache,
        catalogCtx: currentModel.engineCtx,
      }).nCtx,
    [currentModel],
  );
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

  // Guard sincrone per download/switch/stream (non soggette al batching di React).
  const downloadInFlight = useRef(false);
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

  const showNotice = useCallback((value: string) => {
    setNotice(value);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      engineGenerationRef.current += 1; // invalida ogni async in corso
      downloadAbortRef.current?.abort();
      downloadAbortRef.current = null;
      voiceDownloadAbortRef.current?.abort();
      voiceDownloadAbortRef.current = null;
      // Preempt background summary before dispose so FIFO does not hold a
      // half-finished summarize across unmount.
      abortBackgroundSummary();
      void disposeEngine();
      void releaseWhisper();
    };
  }, []);

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

      // Clear previous error banner before retry so "Ready" never coexists with
      // a stale "Could not load the model" under the header / in Settings.
      setModelState("loading");
      setModelError(null);
      setModelErrorDetail(null);
      setModelErrorKind(null);
      const mmprojPath = model.mmproj ? modelLocalPath(model, model.mmproj.file) : null;
      // Resolve once here (V4.2 §Fase 0.5): catalog n_ctx (no silent downgrade)
      // + optional high-RAM upgrade for hybrids + catalog-authoritative KV.
      // initEngine does not re-resolve — pass nCtx and cache types explicitly.
      const profile = resolveContextProfile({
        hybrid: model.hybrid,
        kvCache: model.kvCache,
        catalogCtx: model.engineCtx,
      });
      await initEngine(modelLocalPath(model, model.file), model.id, {
        mmprojPath,
        nCtx: profile.nCtx,
        cacheTypeK: profile.cacheTypeK,
        cacheTypeV: profile.cacheTypeV,
        kvUnified: model.kvUnified,
        mtpNMax: model.mtp?.nMax,
        locale,
      });
      if (!stillCurrent()) return false;
      setModelState("ready");
      // End-based clear too: two concurrent ensures (double-tap in the probe
      // window) where the first fails and the second succeeds must not leave
      // "Ready" coexisting with a stale red banner.
      setModelError(null);
      setModelErrorDetail(null);
      setModelErrorKind(null);
      return true;
    } catch (error) {
      if (!stillCurrent()) return false;
      setModelState("error");
      setModelErrorKind("engine");
      setModelError(friendlyNetworkError(error, locale, "engine").message);
      setModelErrorDetail(rawErrorDetail(error));
      return false;
    }
  }, [locale]);

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
    if (downloadInFlight.current || modelState === "downloading") return;
    const model = MODEL_REGISTRY.find((m) => m.id === modelId);
    if (!model) return;

    downloadInFlight.current = true;
    // Capture generation at start; also re-check selected model after awaits.
    const generation = engineGenerationRef.current;
    const expectedModelId = model.id;
    const stillCurrent = () =>
      generation === engineGenerationRef.current &&
      MODEL_REGISTRY[modelIndexRef.current]?.id === expectedModelId;

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
      setModelState("loading");
      const mmprojPath = model.mmproj ? modelLocalPath(model, model.mmproj.file) : null;
      // Resolve once here (V4.2 §Fase 0.5): catalog n_ctx + optional high-RAM upgrade.
      const profile = resolveContextProfile({
        hybrid: model.hybrid,
        kvCache: model.kvCache,
        catalogCtx: model.engineCtx,
      });
      await initEngine(outcome.model.uri, model.id, {
        mmprojPath,
        nCtx: profile.nCtx,
        cacheTypeK: profile.cacheTypeK,
        cacheTypeV: profile.cacheTypeV,
        kvUnified: model.kvUnified,
        mtpNMax: model.mtp?.nMax,
        locale,
      });
      if (!stillCurrent()) return;
      setModelState("ready");
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
      if (!stillCurrent()) return;
      if (controller.signal.aborted) {
        setModelState("missing");
        return;
      }
      setModelState("error");
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
      const total = model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);
      Alert.alert(
        t("download.title"),
        t("download.confirmBody", { name: model.name, size: formatBytes(total) }),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.download"), onPress: () => void startDownload(modelId) },
        ],
      );
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
  }, [locale, notifyDownload, showNotice, t, voiceState]);

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

  const handleSendStream = useCallback(
    (text: string, callbacks: any, signal: AbortSignal, attachments?: LocalAttachment[], history?: unknown[]) =>
      new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          streamInFlightRef.current = false;
          setStreaming(false);
          resolve();
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
           * Register extract job BEFORE finish() resolves the turn.
           * Otherwise a concurrent next turn can start while the ref is still null.
           */
          const scheduleMemoryExtract = () => {
            if (extractScheduled) return;
            extractScheduled = true;
            if (signal.aborted || turnFailed || !assistantFull.trim()) return;

            const capturedAssistant = assistantFull;
            const capturedUser = text;
            const startEpoch = MemoryStore.getEpoch();

            const extractJob = (async () => {
              try {
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
              }
            })();

            memoryExtractRef.current = extractJob;
            void extractJob.finally(() => {
              if (memoryExtractRef.current === extractJob) {
                memoryExtractRef.current = null;
              }
            });
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
                  // Register extract BEFORE unlocking the turn for the next message.
                  scheduleMemoryExtract();
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
            scheduleMemoryExtract();
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
            onOpenMiniapp={(miniapp) => {
              // Policy: ignore miniapp open while Settings/Help is active
              // (exclusive overlay; stays until user closes it).
              setActiveOverlay((prev) =>
                prev?.kind === "settings" || prev?.kind === "help"
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
