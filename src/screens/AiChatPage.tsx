import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Dimensions,
  FlatList,
  Image,
  Linking,
  type ListRenderItemInfo,
  Modal,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BarChart2,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  Globe,
  Image as ImageIcon,
  Languages,
  Menu,
  MoreHorizontal,
  Search,
  Sparkles,
  SquarePen,
  Volume2,
  X,
} from "lucide-react-native";
import {
  hasDeepResearchTrigger,
  stripDeepResearchTrigger,
} from "../research/plan";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { PdfExtractError, PdfToImages } from "../components/PdfToImages";
import { MarkdownText } from "../chat/MarkdownText";
import { isSafeHttpUrl } from "../util/url";
import { isBenchCommand, tryHandleBenchCommand, getBenchNoRepack } from "../bench/benchConfig";
import { normalizeMiniapp, parseMiniappFromText } from "../domain/askAssistant";
import { classifyChatContent, type ContentFilterReason } from "../domain/contentFilter";
import {
  getActiveModelId,
  getEngineLostModelId,
  invalidateEngineSession,
  isEngineLostRecovery,
  isEngineReady,
  markKvNonReproducible,
  probeAndReconcileEngine,
  saveEngineSession,
  translateText,
} from "../engine/LlamaService";
import { shouldRecoverLost } from "../engine/engineLiveness";
import {
  backgroundDiscardLifecycleRef,
  regenAbortRef,
  regenGenerationRef,
  regenHandleSendPassRef,
  regenInFlightRef,
  sendClaimRef,
  sendingInFlightRef,
} from "../engine/regenState";
import { decidePreSendFit } from "../engine/deviceProfile";
import { getAvailableMemoryBytesUncached } from "../engine/monitor";
import { getModelById } from "../engine/ModelRegistry";
import { miniappStripMakesKvNonReproducible } from "../engine/kvReproducibility";
import {
  normalizeModelEmittedTextForSave,
  readModelEmittedText,
} from "../engine/modelEmittedText";
import { historyHash } from "../engine/sessionPersistence";
import {
  messagesKey,
  titleFromFirstUserText,
  previewFromMessages,
  searchBlobFromMessages,
} from "../conversations/ConversationsStore";
import { mergeSharePrefill } from "../app/shareIntent";
import { createStreamCoalescer } from "../engine/streamCoalescer";
import { getStrings, useLocale, type Locale, type TranslateFn } from "../i18n";
import { useLabTheme } from "../ui/labTheme";
import { spacing, radius } from "../theme/tokens";
import { StreamCaret } from "../chat/StreamCaret";
import { BrandIcon, SendGlyphPair } from "../theme/icons/BrandIcon";
import { typography, useTypography, fontFamilies } from "../theme/typography";
import {
  cancelCapture,
  CaptureBusyError,
  isCapturing,
  requestMicPermission,
  startCapture,
  stopCapture,
} from "../voice/VoiceCapture";
import {
  ensureDefaultWhisper,
  WhisperModelMissingError,
  transcribePcm,
} from "../voice/WhisperService";
import * as TtsService from "../voice/TtsService";
import {
  reduceVoicePhase,
  resolveMicTap,
  type VoiceUiPhase,
} from "../voice/voiceUiState";
import { shouldShowLongChatNudge } from "../chat/longChatEstimate";
import {
  estimateTokensForDoc,
  formatBytesLocalized,
  type LibraryDoc,
} from "../documents/DocumentLibrary";
import {
  CHAT_DOCUMENT_PICKER_TYPES,
  pickKind,
  shouldSniffPickedKind,
  sniffDocxOrLegacy,
} from "../documents/documentKinds";
import {
  DocxExtractError,
  extractDocxTextFromFile,
} from "../documents/docxToText";
import {
  MAX_DOCUMENT_BYTES,
  MAX_TEXT_BYTES,
  deleteOwnedFile,
  peekFileHead,
  resolveAssetSizeBytes,
  sizeWithinLimits,
  writeOwnedText,
} from "../documents/documentStorage";

/** Metro still sees the require(); a missing packager asset must not kill chat. */
function tryRequireAsset(load: () => unknown): number | undefined {
  try {
    const value = load();
    return typeof value === "number" ? value : undefined;
  } catch {
    return undefined;
  }
}

const EMPTY_STATE_RASTER = tryRequireAsset(
  () => require("../../assets/brand/light/empty-state.jpg"),
);

export type AiChatSelectedRun = {
  jobId: string;
  organism?: string | null;
  status?: string | null;
  accession?: string | null;
};

export type MessageSource = {
  title: string;
  /** Landing URL from web_search (optional — older history may lack it). */
  url?: string;
  authors?: string;
  doi?: string;
  /** Search provider id that produced this source (e.g. "brave", "exa-mcp"). */
  provider?: string;
};

export type ResultImage = { id: string; label: string; url: string; artifactType?: string };
export type ResultDownload = { id: string; label: string; url: string; artifactType?: string };
export type ChatCta = {
  artifactType?: string | null;
  contrastId?: string | null;
  id?: string;
  kind: "output" | "output_picker" | "run_monitor_recovery";
  label: string;
  outputId?: string | null;
  target?: string | null;
};

// ── Feature 4: attachment locale (vision) ─────────────────────────────────
// `uri`/`pages` sono file di cache temporanei (NON persistiti); `pageCount` è
// l'unico metadata persistito (sanitizer).
// kind "document" = library PDF/TXT (retrieval source via document_chat tool);
// carries libraryDocId so the tool can select the right entry.
export type LocalAttachment = {
  id: string;
  kind: "image" | "pdf" | "document";
  name: string;
  uri: string;
  pages?: string[];
  pageCount?: number;
  /** Library document id when kind === "document". */
  libraryDocId?: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /**
   * Text the model actually emitted (assistant only). UI renders `text`
   * (cleaned); prompt assembly replays this when present so the KV prefix matches.
   */
  modelEmittedText?: string;
  streaming?: boolean;
  /** Terminal marker: generation was interrupted mid-stream (partial text kept). */
  interrupted?: boolean;
  /** True when the user edited this message text (edit-then-regen flow). */
  edited?: boolean;
  // Feature 1: status history
  statusLabel?: string;
  statusHistory?: string[];
  sources?: MessageSource[];
  // Feature 2: miniapp
  miniapp?: { kind: string; title: string; blocks: any[] };
  // Feature 4: attachments on user messages
  attachments?: LocalAttachment[];
  // RNA-seq job context: result image/download links delivered alongside the
  // assistant reply.
  images?: ResultImage[];
  downloads?: ResultDownload[];
  ctas?: ChatCta[];
  createdAt: number;
};

type StreamCallbacks = {
  onDelta: (delta: string, full: string) => void;
  onStatus: (status: { label: string }) => void;
  onSources: (sources: MessageSource[]) => void;
  onActions?: (payload: any) => void;
  onCta?: (payload: ChatCta) => void;
  // Feature 2: miniapp callback
  onMiniapp?: (miniapp: any) => void;
  // RNA-seq job context: emitted once per stream before the LLM starts.
  onImages?: (images: ResultImage[], downloads: ResultDownload[]) => void;
  /** Unmodified model output for this assistant turn (prompt replay / KV). */
  onModelEmittedText?: (text: string) => void;
  /** Optional failure signal from stream backends that resolve instead of reject. */
  onFailed?: (reasonKey: string) => void;
};

/** Discriminated result for handleSend — regen/edit inspect this for snapshot restore. */
export type HandleSendResult =
  | { ok: true }
  | { ok: false; reasonKey: string };

/** Extra flags for the user bubble handleSend appends (edit-then-regen). */
type HandleSendOpts = {
  edited?: boolean;
};

/** UI phase for tap-to-talk (mirrors pure VoiceUiPhase). */
type VoiceUiState = VoiceUiPhase;

type SendStreamResult = {
  /**
   * Call after turn-end saveEngineSession settles so memory extract runs after
   * the KV snapshot is on disk (extract can restore from that file).
   */
  afterSessionSave?: () => void;
};

type Props = {
  onSendStream?: (
    text: string,
    callbacks: StreamCallbacks,
    signal: AbortSignal,
    attachments?: LocalAttachment[],
    history?: unknown[],
    /** Persist/assemble user text (trimmed, no docHints / placeholder). */
    lastUserBare?: string,
    opts?: { research?: boolean; notes?: boolean },
  ) => Promise<SendStreamResult | void>;
  selectedRun?: AiChatSelectedRun | null;
  prefillText?: string | null;
  /** Bumps when the same share text is delivered again. */
  prefillNonce?: number;
  /** Attach a library document from Android share-in (do not auto-send). */
  attachLibraryDoc?: { id: string; name: string; nonce: number } | null;
  onSaveToNotes?: (text: string) => void;
  onClearSelectedRun?: () => void;
  userName?: string | null;
  onOpenMiniapp?: (miniapp: any) => void;
  onMenuPress?: () => void;
  onCtaPress?: (cta: ChatCta) => void;
  /** True when Whisper Tiny is fully downloaded. */
  voiceReady?: boolean;
  /** Settings → Voice TTS toggle (default true). */
  ttsEnabled?: boolean;
  /**
   * Effective n_ctx of the loaded engine (post memory-clamp), from AppShell.
   * Same value as chatEngineCtxRef / getActiveEngineNCtx — not the pre-clamp
   * catalog resolve. Used by the long-chat nudge as its token ceiling.
   * Omitted → longChatEstimate.LONG_CHAT_DEFAULT_N_CTX.
   */
  engineCtx?: number;
  /** Snapshot of the local document library (for attach-from-library). */
  documentLibrary?: {
    docs: Array<{
      id: string;
      name: string;
      kind: string;
      pageCount?: number;
      previewUri?: string;
    }>;
  };
  /** Open the Documents overlay (empty library / manage). */
  onOpenDocuments?: () => void;
  /**
   * AppShell-owned library add. Chat Word import persists as owned TXT.
   * Omitted in isolated tests — those paths must not leave orphan files.
   */
  onAddDocument?: (entry: LibraryDoc) => boolean;
  /**
   * Optional UI banner sink for non-blocking fit signals (e.g. model.memoryUnknown).
   * AppShell wires this to setMemoryBannerKey.
   */
  onMemoryBanner?: (reasonKey: string | null) => void;
  /** Active conversation id — messages load/persist under messagesKey(id). */
  conversationId?: string;
  /** Header / long-chat "new chat": parent inserts a fresh conversation. */
  onNewConversation?: () => void;
  onSwitchConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  /** After a successful persist, parent updates title/preview/searchBlob. */
  onConversationTouched?: (meta: {
    title: string;
    preview: string;
    searchBlob: string;
  }) => void;
  /** Parent calls this to flush the active conversation before a switch. */
  persistFlushRef?: React.MutableRefObject<(() => void) | null>;
  /** True when the active chat has no in-memory/persisted messages (after load). */
  isActiveChatEmptyRef?: React.MutableRefObject<(() => boolean) | null>;
  /** Parent bumps the persist epoch before deleting this chat's messages key. */
  bumpPersistEpochRef?: React.MutableRefObject<(() => void) | null>;
  /**
   * Catalog vision capability of the selected model (mmproj present).
   * Derived from the registry, not from a loaded engine context.
   * Missing / unknown → treat as text-only so the notice is conservative.
   */
  supportsVision?: boolean;
};

type SuggestionItem = {
  text: string;
  sub: string;
  colorKey: "compute" | "accent";
  Icon: React.ComponentType<{ size: number; color: string }>;
};

function buildSuggestions(t: TranslateFn): SuggestionItem[] {
  return [
    {
      text: t("chat.suggestion1"),
      sub: t("chat.suggestion1Sub"),
      colorKey: "compute",
      Icon: Sparkles,
    },
    {
      text: t("chat.suggestion2"),
      sub: t("chat.suggestion2Sub"),
      colorKey: "accent",
      Icon: Globe,
    },
    {
      text: t("chat.suggestion3"),
      sub: t("chat.suggestion3Sub"),
      colorKey: "accent",
      Icon: BarChart2,
    },
    {
      text: t("chat.suggestion4"),
      sub: t("chat.suggestion4Sub"),
      colorKey: "compute",
      Icon: BookOpen,
    },
  ];
}


// ── Feature 2: miniapp icon map ─────────────────────────────────────────────
function miniappIcon(kind: string): React.ComponentType<{ size: number; color: string }> {
  // Mapping generico: il modello sceglie il kind; icone bio rimosse.
  switch (kind) {
    case "calculator":
    case "comparison":
      return BarChart2;
    case "planner":
      return ClipboardList;
    case "quiz":
      return BookOpen;
    default:
      return Sparkles;
  }
}

// ── Feature 3: code block parsing ─────────────────────────────────────────
type TextSegment = { type: "text"; content: string };
type CodeSegment = { type: "code"; lang: string; content: string };
type MessageSegment = TextSegment | CodeSegment;

function parseMessageSegments(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "code", lang: match[1] || "text", content: match[2] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ type: "text", content: text }];
}

function greetingForHour(h: number, t: TranslateFn): string {
  if (h < 12) return t("chat.greetingMorning");
  if (h < 18) return t("chat.greetingAfternoon");
  return t("chat.greetingEvening");
}

function formatDayLabel(ts: number, t: TranslateFn, locale: Locale): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) {
    const time = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    return t("chat.today", { time });
  }
  if (d.toDateString() === yesterday.toDateString()) return t("chat.yesterday");
  const tag = locale === "it" ? "it-IT" : "en-US";
  return d.toLocaleDateString(tag, { weekday: "long", month: "short", day: "numeric" });
}

function isSameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// X2: localized copy for the pre-send content gate (src/domain/contentFilter.js).
// classifyChatContent's own formatChatContentFilterMessage() is English-only —
// route the user-visible text through i18n instead, keyed on the same reasons.
function contentFilterMessage(reason: ContentFilterReason | null, t: TranslateFn): string {
  switch (reason) {
    case "self_harm":
      return t("contentFilter.selfHarm");
    case "child_exploitation":
    case "sex_crimes":
      return t("contentFilter.sexualAbuse");
    case "unsafe_bio":
    case "unsafe_chem":
      return t("contentFilter.unsafeScience");
    case "privacy":
      return t("contentFilter.privacy");
    case "prompt_injection":
      return t("contentFilter.promptInjection");
    case "non_violent_crime":
    case "violent_crime":
      return t("contentFilter.illegalActivity");
    default:
      return t("contentFilter.generic");
  }
}

// Module-level counter — avoids Date.now() collisions when two IDs
// are generated in the same millisecond within the same synchronous block.
// Seed univoco per sessione: gli id non devono collidere con quelli della
// history persistita (che usa lo stesso contatore nelle sessioni precedenti).
let _msgIdCounter = Math.floor((Date.now() % 1_000_000_000) / 7);
function nextMsgId(prefix: string): string {
  _msgIdCounter += 1;
  return `${prefix}-${_msgIdCounter}`;
}

function nextLibraryDocId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// PDF attach rimosso (Fase 3): nessun endpoint remoto, tutto locale.

/**
 * Build the AsyncStorage payload for chat history.
 * Normal path skips live streaming messages (no token-churn writes).
 * With allowStreamingPartial, in-flight assistant bubbles with non-empty text
 * are written as interrupted partials so a process kill can still restore them.
 */
function buildPersistableMessages(
  messagesSnapshot: Message[],
  opts?: { allowStreamingPartial?: boolean },
): Message[] {
  const allowStreamingPartial = opts?.allowStreamingPartial === true;
  return messagesSnapshot
    .filter((message) => {
      if (!message.streaming) return true;
      if (!allowStreamingPartial) return false;
      // Skip empty thinking placeholders — no useful partial to restore.
      return typeof message.text === "string" && message.text.trim().length > 0;
    })
    .map((message) => {
      const attachments = message.attachments?.map((a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        uri: "",
        ...(typeof a.pageCount === "number" && a.pageCount > 0 ? { pageCount: a.pageCount } : {}),
        ...(typeof a.libraryDocId === "string" && a.libraryDocId.length > 0
          ? { libraryDocId: a.libraryDocId.slice(0, 120) }
          : {}),
      }));
      // modelEmittedText rides on ...message (assistant-only). New persisted
      // field → historyHash changes once (one cold prefill; fails safe).
      // Whitespace-only normalises to absent (matches restore).
      const emitted = normalizeModelEmittedTextForSave(
        message.role,
        message.modelEmittedText,
      );
      if (message.streaming && allowStreamingPartial) {
        return {
          ...message,
          streaming: undefined,
          statusLabel: undefined,
          statusHistory: undefined,
          interrupted: true,
          attachments,
          ...(emitted !== undefined
            ? { modelEmittedText: emitted }
            : { modelEmittedText: undefined }),
        };
      }
      return {
        ...message,
        streaming: undefined,
        // Never persist live tool status — restored "Writing / Reading document…"
        // after kill/reload left an orphan strip on finished turns (Jelly MED-5).
        statusLabel: undefined,
        statusHistory: undefined,
        attachments,
        ...(emitted !== undefined
          ? { modelEmittedText: emitted }
          : { modelEmittedText: undefined }),
      };
    });
}

/**
 * Immediate history write (AppState / unmount / throttle) — fire-and-forget.
 *
 * Invariant: every write is epoch-stamped; clear bumps the epoch; stale writes
 * are no-ops. Callers capture `epoch` at SCHEDULE time and pass getEpoch so a
 * clearChat (or hard reset) that lands before setItem drops the write.
 * Returns true when a write was scheduled.
 */
function persistMessagesNow(
  messagesSnapshot: Message[],
  opts?: {
    allowStreamingPartial?: boolean;
    /** Epoch stamped when the write was scheduled. */
    epoch?: number;
    /** Reads the live epoch; stale when !== opts.epoch. */
    getEpoch?: () => number;
    /** Per-conversation messages key. Missing → skip write. */
    storageKey?: string;
  },
): boolean {
  if (!messagesSnapshot.length) return false;
  const storageKey = opts?.storageKey;
  if (!storageKey) return false;
  // Drop if clear/reset already advanced the epoch before we build the payload.
  if (
    opts?.epoch != null &&
    typeof opts.getEpoch === "function" &&
    opts.getEpoch() !== opts.epoch
  ) {
    return false;
  }
  const clean = buildPersistableMessages(messagesSnapshot, opts);
  if (!clean.length) return false;
  // Re-check immediately before the write so a clear that raced the build drops.
  if (
    opts?.epoch != null &&
    typeof opts.getEpoch === "function" &&
    opts.getEpoch() !== opts.epoch
  ) {
    return false;
  }
  AsyncStorage.setItem(storageKey, JSON.stringify(clean)).catch((err) => {
    // Same non-fatal surface as saveEngineSession / voice failures.
    console.warn("[persistMessages]", err);
  });
  return true;
}

/** Sanitizza lo storico persistito: ogni campo (anche annidato) è validato, niente crash su payload corrotti. */
function sanitizeHistoryMessages(raw: unknown, locale: Locale): Message[] {
  if (!Array.isArray(raw)) return [];
  const strings = getStrings(locale);
  const result: Message[] = [];
  const MAX_TEXT = 100_000;
  const MAX_ITEMS = 100;
  // Dedup id: sessioni senza seed univoco possono aver persistito id duplicati
  // (stesso contatore ripartito da zero) → chiavi React duplicate.
  const seenIds = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id) continue;
    if (record.role !== "user" && record.role !== "assistant") continue;
    if (typeof record.text !== "string") continue;
    let messageId = record.id;
    if (seenIds.has(messageId)) {
      messageId = `${messageId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    seenIds.add(messageId);
    const message: Message = {
      id: messageId,
      role: record.role,
      text: record.text.slice(0, MAX_TEXT),
      createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
    };
    // interrupted is terminal (partial kept after kill) — restore so the UI marker shows.
    // Only with non-empty text so a corrupt payload cannot render a floating marker.
    // Transient `streaming` is never restored (no eternal spinners).
    if (record.interrupted === true && message.text.trim().length > 0) {
      message.interrupted = true;
    }
    if (record.edited === true) {
      message.edited = true;
    }
    // Model-emitted text (assistant only) for prompt replay / KV prefix match.
    const emitted = readModelEmittedText(record.role, record.modelEmittedText);
    if (emitted !== undefined) {
      message.modelEmittedText = emitted.slice(0, MAX_TEXT);
    }
    // Transient UI only — never restore live status strips after kill/reload
    // (orphan "Writing / Reading document…" after a finished turn — Jelly MED-5).
    // statusLabel / statusHistory are intentionally dropped on restore.
    if (Array.isArray(record.sources) && record.sources.length <= MAX_ITEMS) {
      message.sources = record.sources
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
        .slice(0, MAX_ITEMS)
        .map((s) => ({
          id: typeof s.id === "string" ? s.id : `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title:
            (typeof s.title === "string" && s.title.trim() ? s.title : "" ) ||
            (typeof s.url === "string" ? s.url : "") ||
            (typeof s.host === "string" ? s.host : "") ||
            strings.common.source,
          ...(typeof s.authors === "string" ? { authors: s.authors.slice(0, 300) } : {}),
          ...(typeof s.doi === "string" ? { doi: s.doi.slice(0, 300) } : {}),
          ...(typeof s.url === "string" ? { url: s.url.slice(0, 2000) } : {}),
          ...(typeof s.provider === "string" ? { provider: s.provider.slice(0, 40) } : {}),
        }));
    }
    // Always normalize miniapp through the domain layer so null/string blocks
    // and missing answerIndex never crash the renderer on history reload.
    if (record.miniapp && typeof record.miniapp === "object" && !Array.isArray(record.miniapp)) {
      const normalized = normalizeMiniapp(record.miniapp);
      if (normalized) {
        message.miniapp = normalized as Message["miniapp"];
      }
      // If normalize fails, leave miniapp unset (text-only) and try text migration below.
    }
    // Migration: older history may have miniapp JSON only inside assistant text,
    // or a corrupt miniapp field that failed normalize above.
    if (record.role === "assistant" && !message.miniapp) {
      const extracted = parseMiniappFromText(message.text);
      if (extracted.miniapp) {
        message.text = (extracted.text || message.text).slice(0, MAX_TEXT);
        message.miniapp = extracted.miniapp as Message["miniapp"];
      }
    }
    if (Array.isArray(record.attachments) && record.attachments.length <= MAX_ITEMS) {
      message.attachments = record.attachments
        .filter(
          (a): a is Record<string, unknown> => !!a && typeof a === "object" && !Array.isArray(a),
        )
        .slice(0, MAX_ITEMS)
        .map((a) => ({
          id: typeof a.id === "string" ? a.id : `att-${Date.now()}`,
          kind:
            a.kind === "pdf" || a.kind === "image" || a.kind === "document"
              ? (a.kind as LocalAttachment["kind"])
              : "image",
          name: typeof a.name === "string" ? a.name.slice(0, 300) : strings.common.attachment,
          // Le URI sono cache temporanea: non persistite (non disponibili al reload).
          uri: "",
          ...(typeof a.pageCount === "number" && a.pageCount > 0
            ? { pageCount: Math.min(a.pageCount, 10) }
            : {}),
          ...(typeof a.libraryDocId === "string" && a.libraryDocId.length > 0
            ? { libraryDocId: a.libraryDocId.slice(0, 120) }
            : {}),
        }));
    }
    if (Array.isArray(record.images) && record.images.length <= MAX_ITEMS) {
      message.images = record.images
        .filter(
          (i): i is Record<string, unknown> =>
            !!i && typeof i === "object" && !Array.isArray(i) && typeof i.url === "string",
        )
        .slice(0, MAX_ITEMS)
        .map((i) => ({
          id: typeof i.id === "string" ? i.id : `img-${Date.now()}`,
          label: typeof i.label === "string" ? i.label.slice(0, 300) : strings.common.image,
          url: (i.url as string).slice(0, 2000),
          ...(typeof i.artifactType === "string" ? { artifactType: i.artifactType } : {}),
        }));
    }
    if (Array.isArray(record.downloads) && record.downloads.length <= MAX_ITEMS) {
      message.downloads = record.downloads
        .filter(
          (d): d is Record<string, unknown> =>
            !!d && typeof d === "object" && !Array.isArray(d) && typeof d.url === "string",
        )
        .slice(0, MAX_ITEMS)
        .map((d) => ({
          id: typeof d.id === "string" ? d.id : `dl-${Date.now()}`,
          label: typeof d.label === "string" ? d.label.slice(0, 300) : strings.common.download,
          url: (d.url as string).slice(0, 2000),
          ...(typeof d.artifactType === "string" ? { artifactType: d.artifactType } : {}),
        }));
    }
    if (Array.isArray(record.ctas) && record.ctas.length <= MAX_ITEMS) {
      message.ctas = record.ctas
        .filter(
          (c): c is Record<string, unknown> =>
            !!c && typeof c === "object" && !Array.isArray(c) && typeof c.label === "string",
        )
        .slice(0, MAX_ITEMS)
        .map((c) => ({
          kind: (typeof c.kind === "string" ? c.kind : "output") as ChatCta["kind"],
          label: (c.label as string).slice(0, 300),
          ...(typeof c.id === "string" ? { id: c.id } : {}),
          ...(typeof c.outputId === "string" ? { outputId: c.outputId } : {}),
          ...(typeof c.target === "string" ? { target: c.target } : {}),
        }));
    }
    result.push(message);
  }
  return result;
}

export function AiChatPage({
  onSendStream,
  selectedRun,
  prefillText,
  prefillNonce,
  attachLibraryDoc,
  onSaveToNotes,
  onClearSelectedRun,
  userName,
  onOpenMiniapp,
  onMenuPress,
  onCtaPress,
  voiceReady = false,
  ttsEnabled = true,
  engineCtx,
  documentLibrary,
  onOpenDocuments,
  onAddDocument,
  onMemoryBanner,
  conversationId,
  onNewConversation,
  onConversationTouched,
  persistFlushRef,
  isActiveChatEmptyRef,
  bumpPersistEpochRef,
  supportsVision = false,
}: Props) {
  const { colors, mode, fontScaleId } = useLabTheme<any>();
  // Reactive tokens: font-scale change re-renders this page via context.
  // Rows get a fontScaleId-stable typography prop so IME height ticks
  // (which recreate themeValue) do not bust ChatMessageRow memo.
  // AttachSheetRow / TranslationBlock / MiniappCard still read the static
  // singleton; they re-render as children of a subscribed parent.
  const typography = useTypography();
  const rowTypography = useMemo(() => typography, [fontScaleId]);
  const { t, locale } = useLocale();
  const insets = useSafeAreaInsets();
  // Manual keyboard padding from the lib's animated height (see Animated.View below).
  const { height: kbHeight } = useReanimatedKeyboardAnimation();
  const kbPad = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, -kbHeight.value),
  }));
  const winH = useWindowDimensions().height;
  const screenH = Dimensions.get("screen").height;
  const [kbDebugOn, setKbDebugOn] = useState(
    () =>
      __DEV__ === true ||
      (globalThis as any).KALSA_KB_DEBUG === true,
  );
  const [kbDebugLabel, setKbDebugLabel] = useState("kb=…");
  // Mirror for the worklet so runOnJS is never scheduled when the pill is off.
  const kbDebugOnSV = useSharedValue(kbDebugOn ? 1 : 0);
  const kbDebugLastMs = useSharedValue(0);

  useEffect(() => {
    kbDebugOnSV.value = kbDebugOn ? 1 : 0;
  }, [kbDebugOn, kbDebugOnSV]);

  useEffect(() => {
    if (kbDebugOn) return; // already on from __DEV__/global
    let cancelled = false;
    AsyncStorage.getItem("kalsa.kbDebug")
      .then((v) => {
        if (!cancelled && v === "1") setKbDebugOn(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [kbDebugOn]);

  const updateKbDebug = useCallback(
    (h: number) => {
      // h is negative when open (lib convention); display absolute height.
      const abs = Math.max(0, Math.round(-h));
      setKbDebugLabel(`kb=${abs}px win=${winH}px screen=${screenH}px`);
    },
    [winH, screenH],
  );

  useEffect(() => {
    // Seed label from current height when the pill turns on (keyboard may already be open).
    if (kbDebugOn) updateKbDebug(kbHeight.value);
  }, [kbDebugOn, updateKbDebug, kbHeight]);

  // Throttle to ~4 Hz while debug is on; skip the JS bridge entirely when off.
  useAnimatedReaction(
    () => Math.round(kbHeight.value),
    (h) => {
      "worklet";
      if (kbDebugOnSV.value !== 1) return;
      const now = Date.now();
      if (now - kbDebugLastMs.value < 250) return;
      kbDebugLastMs.value = now;
      runOnJS(updateKbDebug)(h);
    },
    [updateKbDebug],
  );

  const [messages, setMessages] = useState<Message[]>([]);
  /** One-shot long-chat nudge for this conversation; reset on clearChat. */
  const [longChatNudgeShown, setLongChatNudgeShown] = useState(false);
  const [emptyArtFailed, setEmptyArtFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [sending, setSending] = useState(false);
  // BLOCKER-3: synchronous in-flight guard (React state updates are async).
  // Declared next to `sending` so handleMicPress can gate on the ref, not stale state.
  const sendingRef = useRef(false);
  const [voiceUi, setVoiceUi] = useState<VoiceUiState>("idle");
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  /**
   * Sync mirror of voiceUi — mic onPress must not rely on React state in the
   * useCallback closure (stale phase + voiceBusyRef true → silent no-op on
   * the second tap while the status line already shows "Listening…").
   */
  const voiceUiRef = useRef<VoiceUiState>("idle");
  /** Sync guard: true while listening/transcribing — blocks send/attach. */
  const voiceBusyRef = useRef(false);
  /** Prevents double stop+transcribe (user tap + 60s limit racing). */
  const voiceStopInFlightRef = useRef(false);
  /**
   * Generation token for a voice run (start → stop/transcribe).
   * Incremented on cancel/clearChat/background so a late transcription
   * never mutates the draft after the user moved on.
   */
  const voiceRunIdRef = useRef(0);
  const voiceNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageMenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Keep voiceUiRef and React state in lockstep for every phase change. */
  const setVoicePhase = useCallback((phase: VoiceUiState) => {
    voiceUiRef.current = phase;
    setVoiceUi(phase);
  }, []);
  const scrollViewRef = useRef<FlatList<Message>>(null);
  /** Inverted list: offset 0 = visual bottom (newest). True while the user is
   *  at the bottom — the only state that may auto-follow the stream. Ref, no
   *  setState, so onScroll stays cheap. */
  const atBottomRef = useRef(true);
  const inputRef = useRef<TextInput>(null);
  const greeting = useMemo(() => greetingForHour(new Date().getHours(), t), [t]);
  const showEmptyArt = EMPTY_STATE_RASTER != null && !emptyArtFailed;
  const suggestions = useMemo(() => buildSuggestions(t), [t]);
  /** Newest-first view of the history. FlatList keys on m.id so only the
   *  changed row re-renders; the array is reallocated per flush (same item
   *  refs), which is what signals a streaming update. */
  const reversedMessages = useMemo(() => messages.slice().reverse(), [messages]);
  const reversedMessagesRef = useRef(reversedMessages);
  reversedMessagesRef.current = reversedMessages;

  // ── Persistenza conversazione (Fase 1) ──────────────────────────────────
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const historyLoadedRef = useRef(historyLoaded);
  historyLoadedRef.current = historyLoaded;
  /** Always mirrors latest messages for flush paths (AppState / unmount / throttle). */
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  /** Throttle for mid-stream safety-net persists (at most once / 10s). */
  const lastPartialPersistAtRef = useRef(0);
  /**
   * Persistence epoch: every delayed/async write stamps the epoch at SCHEDULE
   * time and re-checks immediately before AsyncStorage.setItem. clearChat (and
   * conversation switch) bumps the epoch first so a pending debounce /
   * safety-net / AppState write that still holds the old messages is a no-op.
   * Invariant: every write is epoch-stamped; clear bumps the epoch; stale writes
   * are no-ops.
   */
  const persistEpochRef = useRef(0);
  const persistKeyRef = useRef(
    conversationId ? messagesKey(conversationId) : "",
  );
  const onConversationTouchedRef = useRef(onConversationTouched);
  onConversationTouchedRef.current = onConversationTouched;

  const notifyConversationTouched = useCallback((msgs: Message[]) => {
    const cb = onConversationTouchedRef.current;
    if (!cb) return;
    const firstUser = msgs.find(
      (m) => m.role === "user" && typeof m.text === "string" && m.text.trim(),
    );
    cb({
      title: titleFromFirstUserText(firstUser?.text ?? ""),
      preview: previewFromMessages(msgs),
      searchBlob: searchBlobFromMessages(msgs),
    });
  }, []);

  const persistActiveMessages = useCallback(
    (
      msgs: Message[],
      opts?: {
        allowStreamingPartial?: boolean;
        epoch?: number;
        getEpoch?: () => number;
      },
    ): boolean => {
      const key = persistKeyRef.current;
      if (!key) return false;
      const wrote = persistMessagesNow(msgs, { ...opts, storageKey: key });
      if (wrote) notifyConversationTouched(msgs);
      return wrote;
    },
    [notifyConversationTouched],
  );

  useEffect(() => {
    persistEpochRef.current += 1;
    const loadEpoch = persistEpochRef.current;
    let key = "";
    try {
      key = conversationId ? messagesKey(conversationId) : "";
    } catch {
      key = "";
    }
    persistKeyRef.current = key;

    setMessages([]);
    messagesRef.current = [];
    setLongChatNudgeShown(false);
    setDraft("");
    setHistoryLoaded(false);

    if (!key) {
      setHistoryLoaded(true);
      return;
    }

    let mounted = true;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (!mounted || persistEpochRef.current !== loadEpoch || !raw) return;
        try {
          const parsed = JSON.parse(raw);
          // locale is already resolved (App gates on localeReady).
          const valid = sanitizeHistoryMessages(parsed, locale);
          if (valid.length) {
            setMessages(valid);
            messagesRef.current = valid;
          }
        } catch {
          // storico corrotto: ignora e riparti pulito
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted && persistEpochRef.current === loadEpoch) {
          setHistoryLoaded(true);
        }
      });
    return () => {
      mounted = false;
    };
    // Reload when the active conversation changes. locale is stable after
    // LocaleProvider ready gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    if (persistFlushRef) {
      persistFlushRef.current = () => {
        const snap = messagesRef.current;
        const epoch = persistEpochRef.current;
        persistActiveMessages(snap, {
          allowStreamingPartial: true,
          epoch,
          getEpoch: () => persistEpochRef.current,
        });
      };
    }
    if (isActiveChatEmptyRef) {
      isActiveChatEmptyRef.current = () => {
        if (!historyLoadedRef.current) return false;
        return messagesRef.current.length === 0;
      };
    }
    if (bumpPersistEpochRef) {
      bumpPersistEpochRef.current = () => {
        persistEpochRef.current += 1;
      };
    }
    return () => {
      if (persistFlushRef) persistFlushRef.current = null;
      if (isActiveChatEmptyRef) isActiveChatEmptyRef.current = null;
      if (bumpPersistEpochRef) bumpPersistEpochRef.current = null;
    };
  }, [
    bumpPersistEpochRef,
    isActiveChatEmptyRef,
    persistFlushRef,
    persistActiveMessages,
  ]);

  // Debounced normal path: skip while any turn is streaming so the 400ms quiet
  // gap cannot clobber a throttled/AppState partial (drops streaming messages).
  // Partials are owned exclusively by the 10s throttle + AppState/unmount flushes;
  // on completion (streaming cleared) this path resumes and overwrites the partial.
  useEffect(() => {
    if (!historyLoaded || !messages.length) return;
    if (messages.some((m) => m.streaming)) return;
    // Stamp epoch at SCHEDULE time so a clearChat during the 400ms window drops.
    const epoch = persistEpochRef.current;
    const timer = setTimeout(() => {
      if (persistEpochRef.current !== epoch) return;
      // X4: attachments[].uri/pages stripped inside buildPersistableMessages.
      persistActiveMessages(messages, {
        epoch,
        getEpoch: () => persistEpochRef.current,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [historyLoaded, messages, persistActiveMessages]);

  // Safety net while streaming: at most one partial persist every 10s.
  useEffect(() => {
    const streamingWithText = messages.some(
      (m) => m.streaming && typeof m.text === "string" && m.text.trim().length > 0,
    );
    if (!streamingWithText) {
      lastPartialPersistAtRef.current = 0;
      return;
    }
    if (!historyLoaded) return;
    const now = Date.now();
    if (
      lastPartialPersistAtRef.current !== 0 &&
      now - lastPartialPersistAtRef.current < 10_000
    ) {
      return;
    }
    lastPartialPersistAtRef.current = now;
    const epoch = persistEpochRef.current;
    persistActiveMessages(messages, {
      allowStreamingPartial: true,
      epoch,
      getEpoch: () => persistEpochRef.current,
    });
  }, [historyLoaded, messages, persistActiveMessages]);

  // Feature 4: attach state (immagini/foto/PDF → vision; library docs → document_chat)
  const [attachedItems, setAttachedItems] = useState<LocalAttachment[]>([]);
  const attachedItemsRef = useRef(attachedItems);
  attachedItemsRef.current = attachedItems;
  /** Arms the next send as deep research (one-shot; cleared on send). */
  const [researchMode, setResearchMode] = useState(false);
  const researchModeRef = useRef(false);
  researchModeRef.current = researchMode;
  /** Arms the next send with local Notes context (one-shot; cleared on send). */
  const [notesMode, setNotesMode] = useState(false);
  const notesModeRef = useRef(false);
  notesModeRef.current = notesMode;
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  /** Nested picker: choose a library document to attach as a retrieval source. */
  const [docPickOpen, setDocPickOpen] = useState(false);
  const [pdfToRender, setPdfToRender] = useState<{ uri: string; name: string } | null>(null);
  const pdfToRenderRef = useRef(pdfToRender);
  pdfToRenderRef.current = pdfToRender;
  const pdfPagesRef = useRef<string[]>([]);
  const pickingPdfRef = useRef(false);
  const importAndAttachDocxRef = useRef<
    (uri: string, name: string) => Promise<void>
  >(async () => undefined);

  // In-app translation (volatile — NOT persisted with history).
  // One translation at a time: a new run replaces the previous result.
  const [messageMenu, setMessageMenu] = useState<{
    id: string;
    text: string;
    role: Message["role"];
  } | null>(null);
  /** Inline edit of a user message (id + draft text). */
  const [editingMessage, setEditingMessage] = useState<{
    id: string;
    draft: string;
  } | null>(null);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [translationResult, setTranslationResult] = useState<{
    id: string;
    text: string;
    lang: Locale;
    error?: boolean;
    truncated?: boolean;
  } | null>(null);
  const [translationExpanded, setTranslationExpanded] = useState(true);
  const [copiedFlash, setCopiedFlash] = useState(false);
  const translateRunRef = useRef(0);
  /** Sync guard: blocks send / long-press while a translate job is in flight. */
  const translationInFlightRef = useRef(false);
  /** Abort controller for the active translateText job (clearChat / unmount). */
  const translateAbortRef = useRef<AbortController | null>(null);

  // V4.2 §Fase 3.5: long-conversation nudge (one-shot per conversation).
  // Token estimate includes attachment vision cost; threshold is a fraction of
  // the resolved model n_ctx (see longChatEstimate.ts).
  // Recompute the nudge only when the history length changes or the last
  // message (de)finalizes — NOT on every streaming flush (message identity
  // changes per token, which used to rescan the whole history).
  const longChat = useMemo(
    () => shouldShowLongChatNudge(messages, engineCtx),
    [messages.length, engineCtx, messages[messages.length - 1]?.streaming],
  );

  useEffect(() => {
    if (longChat && !longChatNudgeShown) setLongChatNudgeShown(true);
  }, [longChat, longChatNudgeShown]);

  const showVoiceNote = useCallback((text: string) => {
    if (!mountedRef.current) return;
    setVoiceNote(text);
    if (voiceNoteTimer.current) clearTimeout(voiceNoteTimer.current);
    voiceNoteTimer.current = setTimeout(() => {
      if (mountedRef.current) setVoiceNote(null);
    }, 4000);
  }, []);

  /** Invalidate any in-flight voice run and hard-reset capture/TTS UI. */
  const invalidateVoice = useCallback(() => {
    voiceRunIdRef.current += 1;
    voiceBusyRef.current = false;
    voiceStopInFlightRef.current = false;
    setVoicePhase(reduceVoicePhase(voiceUiRef.current, { type: "CANCEL" }));
    void cancelCapture();
    void TtsService.stop();
    setSpeakingId(null);
  }, [setVoicePhase]);

  /**
   * Stop capture (if any) and transcribe into draft.
   * Honours voiceRunId: late results after cancel/send/clearChat are dropped.
   * Any whisper/init throw returns UI to idle and surfaces a short note.
   */
  const stopAndTranscribe = useCallback(
    async (runId: number, fromLimit: boolean) => {
      // Serialize stop+transcribe (user tap vs 60s limit).
      if (voiceStopInFlightRef.current) return;
      voiceStopInFlightRef.current = true;
      voiceBusyRef.current = true;
      setVoicePhase(reduceVoicePhase(voiceUiRef.current, { type: "STOP_BEGIN" }));
      if (fromLimit) {
        showVoiceNote(t("voice.limitReached"));
      }
      try {
        const pcm = await stopCapture();
        // Dropped if user cancelled / cleared / backgrounded mid-stop.
        if (voiceRunIdRef.current !== runId) return;
        // Empty / sub-threshold buffer: skip whisper init (no hang, clear UX).
        if (pcm.byteLength < 3200) {
          if (!fromLimit) {
            showVoiceNote(t("voice.empty"));
          }
          return;
        }
        await ensureDefaultWhisper();
        if (voiceRunIdRef.current !== runId) return;
        const text = await transcribePcm(pcm, locale);
        if (voiceRunIdRef.current !== runId) return;
        if (text) {
          setDraft((prev) => {
            const trimmed = prev.trimEnd();
            if (!trimmed) return text;
            return `${trimmed}${/\s$/.test(prev) ? "" : " "}${text}`;
          });
        } else if (!fromLimit) {
          // Limit path already shows limitReached; avoid clobbering it with empty.
          showVoiceNote(t("voice.empty"));
        }
      } catch (error) {
        // Always log one line for CI/logcat — even if this run was invalidated.
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[voice] transcribe failed: ${msg}`);
        if (voiceRunIdRef.current !== runId) return;
        if (error instanceof WhisperModelMissingError) {
          showVoiceNote(t("voice.modelMissing"));
        } else {
          // Whisper init / JSI / OOM / decode — not a mic-permission issue.
          showVoiceNote(t("voice.transcribeError"));
        }
      } finally {
        voiceStopInFlightRef.current = false;
        if (voiceRunIdRef.current === runId) {
          setVoicePhase(reduceVoicePhase(voiceUiRef.current, { type: "DONE" }));
          voiceBusyRef.current = false;
        }
      }
    },
    [locale, setVoicePhase, showVoiceNote, t],
  );

  // Stop mic / TTS on unmount (includes "starting" via cancelCapture).
  useEffect(() => {
    return () => {
      if (voiceNoteTimer.current) clearTimeout(voiceNoteTimer.current);
      voiceRunIdRef.current += 1;
      voiceBusyRef.current = false;
      voiceStopInFlightRef.current = false;
      void cancelCapture();
      void TtsService.stop();
    };
  }, []);

  // Background / inactive → cancel capture + invalidate pending transcription.
  // Also flush any in-flight assistant partial so a process kill can restore it.
  // Native KV session save: `background` only (iOS `inactive` fires on Control
  // Center / shade pulls — full saveSession is tens of MB and too expensive there).
  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        const snap = messagesRef.current;
        // Capture epoch at flush time; drop if clearChat lands before write.
        const epoch = persistEpochRef.current;
        if (
          snap.some(
            (m) => m.streaming && typeof m.text === "string" && m.text.trim().length > 0,
          )
        ) {
          persistActiveMessages(snap, {
            allowStreamingPartial: true,
            epoch,
            getEpoch: () => persistEpochRef.current,
          });
        }
        // KV save + clean history overwrite only on true background + idle.
        // While sending, keep the allowStreamingPartial payload above (pre-diff
        // behavior) — a clean buildPersistableMessages would drop the partial.
        if (next === "background" && !sendingRef.current) {
          const modelId = getActiveModelId();
          if (modelId) {
            const clean = buildPersistableMessages(snap);
            if (!clean.length) {
              // Empty chat: drop stale session so next load stays cold-clean.
              void invalidateEngineSession(modelId);
            } else if (persistEpochRef.current === epoch) {
              // Same JSON as the conversation messages write so ensureEngine
              // load hash matches. Epoch check: drop if clearChat raced.
              const payload = JSON.stringify(clean);
              const storageKey = persistKeyRef.current;
              if (persistEpochRef.current === epoch && storageKey) {
                AsyncStorage.setItem(storageKey, payload).catch((err) => {
                  console.warn("[persistMessages]", err);
                });
                notifyConversationTouched(clean as Message[]);
                void saveEngineSession(modelId, historyHash(payload), clean.length);
              }
            }
          }
        }
        if (
          isCapturing() ||
          voiceBusyRef.current ||
          voiceUiRef.current !== "idle"
        ) {
          invalidateVoice();
        } else {
          // Still stop TTS if speaking in background.
          void TtsService.stop();
          setSpeakingId(null);
        }
      }
    };
    const sub = AppState.addEventListener("change", onAppState);
    return () => sub.remove();
  }, [invalidateVoice, persistActiveMessages, notifyConversationTouched]);

  /**
   * Tap mic: start listening; tap again: stop + transcribe into draft.
   *
   * Phase decisions use voiceUiRef + isCapturing() (sync), not React state in
   * the closure — otherwise a stale "idle" + voiceBusyRef true silently drops
   * the second tap while the UI still shows Listening….
   */
  const handleMicPress = useCallback(async () => {
    const intent = resolveMicTap({
      phase: voiceUiRef.current,
      capturing: isCapturing(),
      busy: voiceBusyRef.current,
      stopInFlight: voiceStopInFlightRef.current,
      sending: sendingRef.current || sendClaimRef.current,
    });

    if (intent.type === "ignore") {
      if (
        intent.reason === "transcribing" ||
        intent.reason === "stop_in_flight"
      ) {
        // Visible hint — do not restart capture mid-transcription.
        showVoiceNote(t("voice.transcribeBusy"));
        return;
      }
      if (intent.reason === "start_in_flight") {
        // Cancel pending start (permission / pre-init) so a second tap does not
        // leave a stuck busy flag with no way to recover except a third tap.
        voiceRunIdRef.current += 1;
        voiceBusyRef.current = false;
        void cancelCapture();
        setVoicePhase(reduceVoicePhase(voiceUiRef.current, { type: "CANCEL" }));
        return;
      }
      // sending — composer already blocked
      return;
    }

    if (intent.type === "stop") {
      const runId = voiceRunIdRef.current;
      await stopAndTranscribe(runId, false);
      return;
    }

    // Start path — model missing: keep button pressable, show hint (do not hard-disable).
    if (!voiceReady) {
      showVoiceNote(t("voice.modelMissing"));
      return;
    }

    voiceBusyRef.current = true;
    const runId = ++voiceRunIdRef.current;
    try {
      const granted = await requestMicPermission();
      if (voiceRunIdRef.current !== runId) return;
      if (!granted) {
        showVoiceNote(t("voice.micPermission"));
        return;
      }
      await startCapture({
        onLimitReached: () => {
          // Auto-stop at 60 s / ~2 MB → same transcribe path with limit note.
          if (voiceRunIdRef.current !== runId) return;
          void stopAndTranscribe(runId, true);
        },
      });
      if (voiceRunIdRef.current !== runId) {
        void cancelCapture();
        return;
      }
      setVoicePhase(reduceVoicePhase(voiceUiRef.current, { type: "STARTED" }));
      setVoiceNote(null);
      // Keep voiceBusyRef true for the whole listening window so handleSend /
      // attach see a sync block even before React re-renders voiceUi.
      // Stop path (mic tap) does not gate on voiceBusyRef.
    } catch (error) {
      if (voiceRunIdRef.current !== runId) return;
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[voice] capture start failed: ${msg}`);
      if (error instanceof CaptureBusyError) {
        showVoiceNote(t("voice.error"));
      } else {
        showVoiceNote(t("voice.error"));
      }
      setVoicePhase(reduceVoicePhase(voiceUiRef.current, { type: "ERROR" }));
      void cancelCapture();
      voiceBusyRef.current = false;
    } finally {
      // On failure / cancel mid-start, clear busy. On success (listening),
      // leave busy true until stopAndTranscribe finishes.
      // Run-id mismatch (send/cancel/clear): never leave THIS start's busy stuck.
      if (voiceRunIdRef.current !== runId) {
        voiceBusyRef.current = false;
      } else if (!isCapturing()) {
        voiceBusyRef.current = false;
      }
    }
  }, [
    setVoicePhase,
    showVoiceNote,
    stopAndTranscribe,
    t,
    voiceReady,
  ]);

  const handleReadAloud = useCallback(
    async (id: string, text: string) => {
      setMessageMenu(null);
      if (!ttsEnabled) {
        showVoiceNote(t("voice.ttsDisabled"));
        return;
      }
      const cleaned = text.trim();
      if (!cleaned) return;
      try {
        if (speakingId === id && (await TtsService.isSpeaking())) {
          await TtsService.stop();
          // Audit follow-up: unmount can race this await same as the
          // callbacks below — guard before touching state.
          if (!mountedRef.current) return;
          setSpeakingId(null);
          return;
        }
        await TtsService.stop();
        if (!mountedRef.current) return;
        setSpeakingId(id);
        TtsService.speak(cleaned, locale, {
          // M8: TTS callbacks fire asynchronously after the component may have
          // unmounted (nav away mid-speech) — guard with mountedRef like the
          // rest of the file does for async completions.
          onDone: () => {
            if (!mountedRef.current) return;
            setSpeakingId((cur) => (cur === id ? null : cur));
          },
          onStopped: () => {
            if (!mountedRef.current) return;
            setSpeakingId((cur) => (cur === id ? null : cur));
          },
          onError: () => {
            if (!mountedRef.current) return;
            setSpeakingId((cur) => (cur === id ? null : cur));
            // Least invasive: short status line under the composer.
            showVoiceNote(t("voice.ttsError"));
          },
        });
      } catch {
        if (mountedRef.current) setSpeakingId(null);
        if (mountedRef.current) showVoiceNote(t("voice.ttsError"));
      }
    },
    [locale, showVoiceNote, speakingId, t, ttsEnabled],
  );

  const MAX_IMAGE_ATTACHMENTS = 5;

  const addImageAttachment = useCallback(async (source: "library" | "camera") => {
    try {
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
      // Audit follow-up: nav-away while the native picker is open unmounts
      // the screen — guard before touching state, consistent with the rest
      // of the file's async completions.
      if (!mountedRef.current) return;
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      // HEIC/WebP non supportati da mtmd: conversione a JPEG + resize cap.
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      if (!mountedRef.current) return;
      const atCap = attachedItemsRef.current.length >= MAX_IMAGE_ATTACHMENTS;
      setAttachedItems((prev) => {
        if (prev.length >= MAX_IMAGE_ATTACHMENTS) {
          // Audit follow-up: was a silent no-op — surface the same class of
          // notice handlePdfDone already shows on cap (generic copy, this
          // path isn't PDF-specific).
          showVoiceNote(t("errors.attachmentLimitReachedGeneric", { max: MAX_IMAGE_ATTACHMENTS }));
          return prev;
        }
        return [
          ...prev,
          {
            id: nextMsgId("img"),
            kind: "image",
            name: asset.fileName ?? `photo-${Date.now()}.jpg`,
            uri: manipulated.uri,
          },
        ];
      });
      // Notice, not a block — user may switch model later. Skip when the
      // cap path already owns the voice note.
      if (!atCap && !supportsVision) {
        showVoiceNote(t("chat.visionUnsupportedNotice"));
      }
      setAttachSheetOpen(false);
    } catch {
      // picker annullato/errore: ignora
    }
  }, [showVoiceNote, supportsVision, t]);

  const addPdfAttachment = useCallback(async () => {
    if (pickingPdfRef.current || pdfToRenderRef.current) return;
    if (attachedItemsRef.current.length >= MAX_IMAGE_ATTACHMENTS) {
      showVoiceNote(t("errors.attachmentLimitReached", { max: MAX_IMAGE_ATTACHMENTS }));
      return;
    }
    pickingPdfRef.current = true;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: CHAT_DOCUMENT_PICKER_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
      // Audit follow-up: same nav-away-during-picker race as addImageAttachment.
      if (!mountedRef.current) return;
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      const name = (asset.name ?? "").trim();
      let kind = pickKind(asset.mimeType, name);
      if (shouldSniffPickedKind(kind, name)) {
        const head = await peekFileHead(asset.uri, 8);
        if (head) {
          const sniffed = sniffDocxOrLegacy(head);
          if (sniffed) kind = sniffed;
        }
      }
      if (kind === "doc_legacy") {
        showVoiceNote(t("documents.errorLegacyWord"));
        return;
      }
      if (kind === "docx") {
        if (attachedItemsRef.current.length >= MAX_IMAGE_ATTACHMENTS) {
          showVoiceNote(t("errors.attachmentLimitReached", { max: MAX_IMAGE_ATTACHMENTS }));
          return;
        }
        setAttachSheetOpen(false);
        await importAndAttachDocxRef.current(asset.uri, name || "document.docx");
        return;
      }
      if (kind !== "pdf") {
        showVoiceNote(t("errors.attachmentInvalidType"));
        return;
      }
      if (attachedItemsRef.current.length >= MAX_IMAGE_ATTACHMENTS) {
        showVoiceNote(t("errors.attachmentLimitReached", { max: MAX_IMAGE_ATTACHMENTS }));
        return;
      }
      setAttachSheetOpen(false);
      pdfPagesRef.current = [];
      const displayName = name || "document.pdf";
      const next = { uri: asset.uri, name: displayName };
      pdfToRenderRef.current = next;
      setPdfToRender(next);
    } catch {
      // ignora
    } finally {
      pickingPdfRef.current = false;
    }
  }, [showVoiceNote, t]);

  const handlePdfPage = useCallback((_index: number, imageUri: string) => {
    pdfPagesRef.current.push(imageUri);
  }, []);

  const handlePdfDone = useCallback(() => {
    // Audit follow-up: the WebView bridge callback can fire after unmount
    // (nav away mid-conversion) — guard like the rest of the file's async
    // completions before touching state.
    if (!mountedRef.current) return;
    const meta = pdfToRenderRef.current;
    const pages = pdfPagesRef.current.slice();
    pdfPagesRef.current = [];
    pdfToRenderRef.current = null;
    setPdfToRender(null);
    if (!meta) return;
    if (!pages.length) {
      showVoiceNote(t("errors.pdfNoPages"));
      return;
    }
    if (attachedItemsRef.current.length >= MAX_IMAGE_ATTACHMENTS) {
      for (const uri of pages) {
        void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      }
      showVoiceNote(t("errors.attachmentLimitReached", { max: MAX_IMAGE_ATTACHMENTS }));
      return;
    }
    setAttachedItems((current) => {
      if (current.length >= MAX_IMAGE_ATTACHMENTS) return current;
      return [
        ...current,
        {
          id: nextMsgId("pdf"),
          kind: "pdf",
          name: meta.name,
          uri: meta.uri,
          pages,
          pageCount: pages.length,
        },
      ];
    });
    if (!supportsVision) {
      showVoiceNote(t("chat.visionUnsupportedNotice"));
    }
  }, [showVoiceNote, supportsVision, t]);

  const handlePdfError = useCallback((error: Error) => {
    if (!mountedRef.current) return;
    pdfPagesRef.current = [];
    pdfToRenderRef.current = null;
    setPdfToRender(null);
    if (error instanceof PdfExtractError) {
      if (error.code === "timeout") showVoiceNote(t("errors.pdfExtractTimeout"));
      else if (error.code === "page_timeout") showVoiceNote(t("errors.pdfTimeout"));
      else if (error.code === "renderer_gone") showVoiceNote(t("errors.pdfRendererGone"));
      else if (error.code === "cap") showVoiceNote(t("errors.pdfTooLarge"));
      else showVoiceNote(t("errors.pdfExtractFailed"));
    } else {
      showVoiceNote(t("errors.pdfExtractFailed"));
    }
  }, [showVoiceNote, t]);

  // BLOCKER-1: unmount guard + abort ref
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * Promise of the active handleSend turn (resolves when the stream + finally
   * settle). Background discard awaits this so dispose never races generation.
   */
  const sendInFlightPromiseRef = useRef<Promise<HandleSendResult> | null>(null);
  /**
   * Promise of the turn-end saveEngineSession (if any). Lifecycle awaits it
   * after send settles so the real historyHash is on disk before dispose.
   */
  const turnEndSavePromiseRef = useRef<Promise<void> | null>(null);
  /**
   * U1: generation token for a send turn (same idiom as voiceRunIdRef /
   * translateRunRef). clearChat() aborts + synchronously resets
   * sendingRef/setSending; without this token the aborted handleSend's own
   * finally block resets them again later, clobbering a newer turn's state.
   * Incremented at the top of handleSend and in clearChat; every place that
   * resets sending state must check the captured id still equals current.
   */
  const sendRunIdRef = useRef(0);
  /** 3s recovery if abort never settles native completion (sending stuck true). */
  const stopWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Abort in-flight work when the active conversation changes. Message reload
  // lives in the conversationId load effect (must bump persist epoch first).
  const lastAbortConvRef = useRef<string | undefined>(conversationId);
  useEffect(() => {
    const prev = lastAbortConvRef.current;
    lastAbortConvRef.current = conversationId;
    if (prev === conversationId) return;
    abortRef.current?.abort();
    sendRunIdRef.current += 1;
    regenGenerationRef.current += 1;
    sendClaimRef.current = false;
    regenAbortRef.current?.abort();
    regenAbortRef.current = null;
    regenInFlightRef.current = false;
    regenHandleSendPassRef.current = false;
    sendingRef.current = false;
    sendingInFlightRef.current = false;
    setSending(false);
    if (stopWatchdogRef.current != null) {
      clearTimeout(stopWatchdogRef.current);
      stopWatchdogRef.current = null;
    }
    translateAbortRef.current?.abort();
    translateAbortRef.current = null;
    translationInFlightRef.current = false;
    translateRunRef.current += 1;
    setMessageMenu(null);
    setTranslatingId(null);
    setTranslationResult(null);
    pdfToRenderRef.current = null;
    setPdfToRender(null);
    pdfPagesRef.current = [];
    setAttachSheetOpen(false);
    attachedItemsRef.current = [];
    setAttachedItems([]);
    // Arm must not leak across conversations (cross-chat bug).
    researchModeRef.current = false;
    setResearchMode(false);
    notesModeRef.current = false;
    setNotesMode(false);
    voiceRunIdRef.current += 1;
    voiceBusyRef.current = false;
    voiceStopInFlightRef.current = false;
    setVoicePhase(reduceVoicePhase(voiceUiRef.current, { type: "CANCEL" }));
    setVoiceNote(null);
    void cancelCapture();
    void TtsService.stop();
    setSpeakingId(null);
  }, [conversationId, setVoicePhase]);

  useEffect(() => {
    return () => {
      // Flush partial from ref BEFORE abort: updateMessage no-ops once unmounted,
      // and finally may never rewrite state — ref still holds latest streamed text.
      // Epoch-stamped so a clearChat that already ran drops this unmount write.
      const epoch = persistEpochRef.current;
      persistActiveMessages(messagesRef.current, {
        allowStreamingPartial: true,
        epoch,
        getEpoch: () => persistEpochRef.current,
      });
      mountedRef.current = false;
      abortRef.current?.abort();
      regenAbortRef.current?.abort();
      translateAbortRef.current?.abort();
      translateRunRef.current += 1;
      translationInFlightRef.current = false;
      sendingInFlightRef.current = false;
      // Owner transfer FIRST (match clearChat): bump generation/runId so a
      // stale handleSend finally cannot clear a remounted turn's claim.
      sendRunIdRef.current += 1;
      regenGenerationRef.current += 1;
      sendClaimRef.current = false;
      if (stopWatchdogRef.current != null) {
        clearTimeout(stopWatchdogRef.current);
        stopWatchdogRef.current = null;
      }
      if (copiedFlashTimer.current) {
        clearTimeout(copiedFlashTimer.current);
        copiedFlashTimer.current = null;
      }
      if (messageMenuCloseTimer.current) {
        clearTimeout(messageMenuCloseTimer.current);
        messageMenuCloseTimer.current = null;
      }
      if (voiceNoteTimer.current) {
        clearTimeout(voiceNoteTimer.current);
        voiceNoteTimer.current = null;
      }
    };
  }, []);

  // Drop translation UI if its source message was removed (e.g. history trim).
  useEffect(() => {
    if (!translationResult) return;
    if (!messages.some((m) => m.id === translationResult.id)) {
      setTranslationResult(null);
      setTranslatingId(null);
    }
  }, [messages, translationResult]);

  useEffect(() => {
    if (!prefillText) return;
    setDraft((prev) => mergeSharePrefill(prev, prefillText));
  }, [prefillText, prefillNonce]);



  // HIGH-1: targeted update — supports both patch object and function-form updater.
  // ownerGen / ownerRunId: capture at the call site; the functional setMessages
  // updater may run after clearChat / a newer send, so re-check ownership inside
  // the deferred callback and no-op if the generation or runId has moved.
  const updateMessage = useCallback(
    (
      id: string,
      patchOrFn: Partial<Message> | ((prev: Message) => Partial<Message>),
      ownerGen?: number,
      ownerRunId?: number,
    ) => {
      if (!mountedRef.current) return;
      setMessages(prev => {
        if (
          ownerGen !== undefined &&
          (ownerGen !== regenGenerationRef.current ||
            (ownerRunId !== undefined && ownerRunId !== sendRunIdRef.current))
        ) {
          return prev;
        }
        const idx = prev.findIndex(m => m.id === id);
        if (idx === -1) return prev;
        const patch =
          typeof patchOrFn === "function" ? patchOrFn(prev[idx]) : patchOrFn;
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        return next;
      });
    },
    [],
  );

  /**
   * Uncached pre-send fit gate. Refuses does_not_fit / tight-under-1.5x.
   * unknown → allow + non-blocking banner via onMemoryBanner.
   * If the engine already holds this model, skip size-vs-available — those
   * resident bytes are what lowered MemAvailable (P0 double-count).
   */
  const awaitPreSendFitGate = useCallback(async (): Promise<HandleSendResult> => {
    // sendClaimRef is this send's own lock — not a mid-stream busy. A
    // completion already running (sendingInFlightRef / native jobs) must
    // no-op the lost-mark so we never drop a live turn.
    const liveness = await probeAndReconcileEngine({
      busy: !!sendingInFlightRef.current,
    });
    if (liveness.status === "lost") {
      onMemoryBanner?.("chat.unloaded");
    }
    const lostModelId = getEngineLostModelId();
    const mid = getActiveModelId() ?? lostModelId;
    // No active model and no lost mark → allow; ensureEngineForModel
    // will surface load errors. After a scoped lost mark, mid is the
    // lost model id so recoverLost cannot apply to a different model.
    if (!mid) {
      try {
        console.log(
          `KALSA_SEND ${JSON.stringify({
            phase: "fit",
            liveness: liveness.status,
            alreadyResident: false,
            recoverLost: false,
            allow: true,
            reasonKey: "no_active_model",
          })}`,
        );
      } catch {
        // breadcrumb must never throw
      }
      return { ok: true };
    }
    const model = getModelById(mid);
    if (!model) {
      return { ok: true };
    }
    const alreadyResident =
      liveness.status === "alive" &&
      isEngineReady() &&
      getActiveModelId() === mid;
    const recoverLost = shouldRecoverLost(lostModelId, mid);
    let available: number | null = null;
    try {
      available = await getAvailableMemoryBytesUncached();
    } catch {
      available = null;
    }
    if (!mountedRef.current) return { ok: false, reasonKey: "chat.regenFailed" };
    const decision = decidePreSendFit(
      {
        sizeBytes: model.sizeBytes,
        engineCtx: model.engineCtx,
        kvBytesPerToken: model.kvBytesPerToken,
        mmproj: model.mmproj ? { sizeBytes: model.mmproj.sizeBytes } : null,
        loadPolicy: model.loadPolicy,
      },
      available,
      {
        alreadyResident,
        recoverLost,
        lostModelId,
        requestedModelId: mid,
        // Same resolved mode initEngine will load with.
        benchNoRepack: await getBenchNoRepack(),
      },
    );
    try {
      console.log(
        `KALSA_SEND ${JSON.stringify({
          phase: "fit",
          liveness: liveness.status,
          alreadyResident,
          recoverLost,
          allow: decision.allow,
          reasonKey: decision.allow ? decision.bannerKey : decision.reasonKey,
          availableMb:
            typeof available === "number"
              ? Math.round(available / (1024 * 1024))
              : null,
        })}`,
      );
    } catch {
      // breadcrumb must never throw
    }
    if (!decision.allow) {
      showVoiceNote(t(decision.reasonKey as any));
      onMemoryBanner?.(decision.reasonKey);
      return { ok: false, reasonKey: decision.reasonKey };
    }
    if (decision.bannerKey) {
      onMemoryBanner?.(decision.bannerKey);
    }
    return { ok: true };
  }, [onMemoryBanner, showVoiceNote, t]);

  /**
   * Abort-and-await lifecycle for AppShell background disposal.
   * 1) abort regen + send (incl. any pre-send fit-gate claim)
   * 2) await handleSend finalization
   * 3) await turn-end save (promise installed synchronously before setMessages)
   * 4) return real historyHash of current messages
   */
  const awaitLifecycleForBackgroundDiscard = useCallback(async () => {
    // Abort regen first so edit/regen refuse before handleSend starts.
    regenAbortRef.current?.abort();
    // Abort the active stream / pre-send controller (installed before fit gate).
    abortRef.current?.abort();
    // Spin until send claim / stream / regen settle so a fit-gate await cannot
    // race past background and start generation after we dispose.
    const tSpin = Date.now();
    while (
      (sendClaimRef.current ||
        sendingRef.current ||
        regenInFlightRef.current ||
        sendingInFlightRef.current ||
        sendInFlightPromiseRef.current) &&
      Date.now() - tSpin < 5000
    ) {
      const sendP = sendInFlightPromiseRef.current;
      const remaining = 5000 - (Date.now() - tSpin);
      if (remaining <= 0) break;
      if (sendP) {
        try {
          // Race the in-flight send: a promise that never settles must not
          // pin background discard past the 5s budget.
          await Promise.race([
            sendP,
            new Promise<void>((r) => setTimeout(r, remaining)),
          ]);
        } catch {
          // ignore — failure already recorded on the result
        }
      } else {
        await new Promise((r) => setTimeout(r, Math.min(50, remaining)));
      }
      // Re-assert abort each tick: a late handleSend may install a new controller
      // while sendClaimRef is still held during the fit-gate await.
      abortRef.current?.abort();
      regenAbortRef.current?.abort();
    }
    // Await turn-end save AFTER send settles so the real historyHash is on disk.
    // The promise is installed synchronously (before setMessages returns), so a
    // deferred React updater cannot hide it from this lifecycle.
    const saveP = turnEndSavePromiseRef.current;
    if (saveP) {
      try {
        await saveP;
      } catch {
        // ignore
      }
    }
    // Final flag drain (stream flag is AppShell-owned).
    const t0 = Date.now();
    while (
      (sendingRef.current ||
        regenInFlightRef.current ||
        sendingInFlightRef.current ||
        sendClaimRef.current) &&
      Date.now() - t0 < 2000
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const clean = buildPersistableMessages(messagesRef.current);
    const payload = clean.length > 0 ? JSON.stringify(clean) : "";
    return {
      historyHashValue: historyHash(payload),
      historyMessageCount: clean.length,
    };
  }, []);

  // Register lifecycle for AppShell background handler; clear on unmount.
  useEffect(() => {
    backgroundDiscardLifecycleRef.current = awaitLifecycleForBackgroundDiscard;
    return () => {
      if (backgroundDiscardLifecycleRef.current === awaitLifecycleForBackgroundDiscard) {
        backgroundDiscardLifecycleRef.current = null;
      }
    };
  }, [awaitLifecycleForBackgroundDiscard]);

  // HIGH-3: useCallback so onPress closures in suggestion cards don't hold stale `sending`
  const handleSend = useCallback(
    async (
      text: string,
      currentAttachments?: LocalAttachment[],
      opts?: HandleSendOpts,
    ): Promise<HandleSendResult> => {
      const trimmed = text.trim();
      const hasAttachments = (currentAttachments?.length ?? 0) > 0;
      let jsReady = false;
      try {
        jsReady = isEngineReady();
      } catch {
        jsReady = false;
      }
      try {
        console.log(
          `KALSA_SEND ${JSON.stringify({
            empty: !trimmed && !hasAttachments,
            sendClaim: !!sendClaimRef.current,
            sending: !!sendingRef.current,
            translation: !!translationInFlightRef.current,
            voiceBusy: !!voiceBusyRef.current,
            regen: !!regenInFlightRef.current,
            regenPass: !!regenHandleSendPassRef.current,
            pdf: !!pdfToRenderRef.current,
            historyLoaded: !!historyLoaded,
            jsReady,
            lostRecovery: isEngineLostRecovery(),
            activeModel: getActiveModelId(),
          })}`,
        );
      } catch {
        // breadcrumb must never throw
      }
      // BLOCKER-3: synchronous ref check — not subject to React batching.
      // Also ignore send while a translation holds the engine (silent),
      // or while voice is listening/transcribing (voiceBusyRef is sync).
      // Audit follow-up: also belt-and-braces block while a PDF conversion
      // is in flight — the composer-side guards (onSubmitEditing, send
      // button) already block this, but handleSend can also be invoked
      // directly (suggestion cards / edit). Read pdfToRenderRef so a stale
      // handleSend/edit closure cannot bypass or stay blocked.
      // regenInFlight blocks concurrent user sends; regenHandleSendPassRef is a
      // one-shot allow so edit can call handleSend without deadlock.
      // sendClaimRef is the pre-await lock: two rapid ordinary sends must not
      // both pass the busy check and both enter the uncached fit-gate await.
      // Attachment-only turns are allowed: modelText falls back to doc hints
      // or a generic look-at-file prompt when trimmed is empty.
      if (
        (!trimmed && !hasAttachments) ||
        sendClaimRef.current ||
        sendingRef.current ||
        translationInFlightRef.current ||
        voiceBusyRef.current ||
        (regenInFlightRef.current && !regenHandleSendPassRef.current) ||
        !!pdfToRenderRef.current ||
        !historyLoaded
      ) {
        return {
          ok: false,
          reasonKey: sendClaimRef.current || sendingRef.current
            ? "chat.sendBusy"
            : "chat.regenBusy",
        };
      }
      if (regenHandleSendPassRef.current) {
        regenHandleSendPassRef.current = false;
      }

      // Reserve the claim BEFORE any await so a second send cannot enter.
      // Capture generation at acquire: body + finally only act if we still own it
      // (clearChat bumps regenGenerationRef; a stale continuation must not mutate
      // a newer chat, and a stale finally must not clear a newer send's claim).
      const mySendGen = regenGenerationRef.current;
      // Alias used by post-await body gates (same capture as claim ownership).
      const myGen = mySendGen;
      const stillThisRun = (my: number) => regenGenerationRef.current === my;
      const invalidateVoiceForSend = () => {
        if (
          isCapturing() ||
          voiceBusyRef.current ||
          voiceUiRef.current !== "idle"
        ) {
          invalidateVoice();
        } else {
          voiceRunIdRef.current += 1;
        }
      };
      sendClaimRef.current = true;
      // Install abort controller early so background lifecycle can abort this
      // turn during the fit-gate await (before sendingRef is claimed).
      const preSendController = new AbortController();
      abortRef.current = preSendController;
      try {
        // Uncached pre-send fit gate (also covers engine-already-ready path).
        const fitGate = await awaitPreSendFitGate();
        // clearChat / new regen during fit-gate: bail before any mutation.
        if (!stillThisRun(myGen)) {
          if (abortRef.current === preSendController) {
            abortRef.current = null;
          }
          return { ok: false, reasonKey: "chat.regenFailed" };
        }
        if (!fitGate.ok) {
          if (abortRef.current === preSendController) {
            abortRef.current = null;
          }
          return fitGate;
        }
        // Background / clearChat / regen abort during the fit-gate await:
        // refuse before claiming sendingRef or starting generation.
        if (
          preSendController.signal.aborted ||
          regenAbortRef.current?.signal.aborted
        ) {
          if (abortRef.current === preSendController) {
            abortRef.current = null;
          }
          return { ok: false, reasonKey: "chat.regenFailed" };
        }

      // U1: this turn's generation token. clearChat() may abort + reset
      // sending state while this async turn (bench / filter / stream) is
      // still in flight — every reset below must check this id first so a
      // stale turn can never clobber a newer one's sending state.
      // runId is complementary to myGen: clearChat bumps BOTH; body gates
      // check both so either invalidation path stops mutations.
      const runId = ++sendRunIdRef.current;
      // Failure flag flipped by onFailed / catch so we resolve ok:false even
      // when the stream backend resolves instead of rejecting.
      let failed = false;
      let failReasonKey = "chat.serviceUnreachable";

      // Debug bench knobs via chat (adb input text; no root / no extra perms).
      // Does not call the model. History may keep the exchange for harness logs.
      // Accept /bench … and slash-free bench:… (Git Bash mangles leading / via adb).
      if (isBenchCommand(trimmed)) {
        invalidateVoiceForSend();
        sendingRef.current = true;
        sendingInFlightRef.current = true;
        setSending(true);
        setDraft("");
        const userMsgId = nextMsgId("u");
        const assistantId = nextMsgId("a");
        const now = Date.now();
        let reply = "bench: error";
        try {
          reply = (await tryHandleBenchCommand(trimmed)) ?? "bench: not a command";
        } catch {
          reply = "bench: failed";
        }
        // clearChat / new regen during bench await: do not push into the newer chat.
        if (!stillThisRun(myGen) || sendRunIdRef.current !== runId) {
          if (abortRef.current === preSendController) {
            abortRef.current = null;
          }
          return { ok: false, reasonKey: "chat.regenFailed" };
        }
        // Audit follow-up: clearChat() may fire during the await above —
        // gate the push on the same generation token used for the sending
        // reset, otherwise the stale bench Q&A reappears in the cleared chat.
        if (mountedRef.current && sendRunIdRef.current === runId && stillThisRun(myGen)) {
          setMessages((prev) => {
            // Deferred updater: clearChat may have bumped gen/runId after schedule.
            if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) {
              return prev;
            }
            return [
              ...prev,
              {
                id: userMsgId,
                role: "user",
                text: trimmed,
                createdAt: now,
                ...(opts?.edited ? { edited: true } : {}),
              },
              {
                id: assistantId,
                role: "assistant",
                text: reply,
                streaming: false,
                createdAt: now + 1,
              },
            ];
          });
        }
        if (sendRunIdRef.current === runId && stillThisRun(myGen)) {
          sendingRef.current = false;
          sendingInFlightRef.current = false;
          if (mountedRef.current) setSending(false);
        }
        return { ok: true } as HandleSendResult;
      }

      // X2: pre-send content gate (src/domain/contentFilter.js). Blocking
      // categories (block / safety_block → shouldCallProvider === false)
      // never reach the model — append the localized decline and stop.
      // "warn" (mild profanity) and "allow" keep shouldCallProvider true and
      // fall through to the normal stream below.
      const classification = classifyChatContent(trimmed);
      if (!classification.shouldCallProvider) {
        invalidateVoiceForSend();
        sendingRef.current = true;
        sendingInFlightRef.current = true;
        setSending(true);
        setDraft("");
        const gateAttachments = currentAttachments ?? [];
        const userMsgId = nextMsgId("u");
        const assistantId = nextMsgId("a");
        const now = Date.now();
        // Audit follow-up: gate for symmetry with the bench branch above —
        // currently synchronous (no await before this point) so inert today,
        // but future-proofs against this branch growing an await.
        if (mountedRef.current && sendRunIdRef.current === runId && stillThisRun(myGen)) {
          setMessages((prev) => {
            // Deferred updater: clearChat may have bumped gen/runId after schedule.
            if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) {
              return prev;
            }
            return [
              ...prev,
              {
                id: userMsgId,
                role: "user",
                text: trimmed,
                createdAt: now,
                attachments: gateAttachments.length > 0 ? gateAttachments : undefined,
                ...(opts?.edited ? { edited: true } : {}),
              },
              {
                id: assistantId,
                role: "assistant",
                text: contentFilterMessage(classification.reason, t),
                streaming: false,
                createdAt: now + 1,
              },
            ];
          });
        }
        setAttachedItems([]);
        if (sendRunIdRef.current === runId && stillThisRun(myGen)) {
          sendingRef.current = false;
          sendingInFlightRef.current = false;
          if (mountedRef.current) setSending(false);
        }
        return { ok: true };
      }

      // Invalidate any in-flight transcription so a late result cannot rewrite draft
      // after this send clears it. If a listen snuck in during the fit-gate await,
      // cancel capture too so voiceBusyRef cannot stay stuck true.
      invalidateVoiceForSend();
      sendingRef.current = true;
      sendingInFlightRef.current = true;
      setSending(true);

      // Snapshot attachments at send time
      const snapshotAttachments = currentAttachments ?? [];
      const hasVisionInput = snapshotAttachments.some(
        (a) =>
          a.kind === "image" ||
          (a.kind === "pdf" && (a.pages?.length ?? 0) > 0),
      );
      if (hasVisionInput && !supportsVision) {
        showVoiceNote(t("chat.visionUnsupportedNotice"));
      }
      // Library documents are retrieval sources (document_chat tool), not vision.
      // Annotate the model-facing text with doc ids so the tool can select them.
      const docHints = snapshotAttachments
        .filter((a) => a.kind === "document" && a.libraryDocId)
        .map((a) => `[document:${a.libraryDocId} name="${a.name}"]`)
        .join(" ");
      const armedResearch = researchModeRef.current;
      const armedNotes = notesModeRef.current;
      const keywordResearch = hasDeepResearchTrigger(trimmed);
      const useResearch = armedResearch || keywordResearch;
      if (armedResearch) {
        researchModeRef.current = false;
        setResearchMode(false);
      }
      if (armedNotes) {
        notesModeRef.current = false;
        setNotesMode(false);
      }
      // Research is text-only: on a vision-capable model an attached image
      // would be silently dropped — say so.
      if (useResearch && hasVisionInput && supportsVision) {
        showVoiceNote(t("chat.deepResearchIgnoringImages"));
      }
      const researchQuestion = keywordResearch
        ? stripDeepResearchTrigger(trimmed) || trimmed
        : trimmed;
      const modelText = researchQuestion
        ? docHints
          ? `${researchQuestion}\n\n${docHints}`
          : researchQuestion
        : docHints || t("chat.lookAtAttachedFile");

      // BLOCKER-2: module counter, no Date.now() collision
      const userMsgId = nextMsgId("u");
      const assistantId = nextMsgId("a");

      const now = Date.now();
      // Generation may have moved between fit-gate and here if clearChat raced
      // a microtask; refuse before painting user/assistant bubbles.
      if (!stillThisRun(myGen) || sendRunIdRef.current !== runId) {
        if (abortRef.current === preSendController) {
          abortRef.current = null;
        }
        return { ok: false, reasonKey: "chat.regenFailed" };
      }
      if (mountedRef.current) {
        setMessages(prev => {
          // Deferred updater: clearChat / newer send may have invalidated ownership.
          if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) {
            return prev;
          }
          return [
            ...prev,
            {
              id: userMsgId,
              role: "user",
              text: trimmed,
              createdAt: now,
              attachments: snapshotAttachments.length > 0 ? snapshotAttachments : undefined,
              ...(opts?.edited ? { edited: true } : {}),
            },
            {
              id: assistantId,
              role: "assistant",
              text: "",
              streaming: true,
              statusLabel: t("chat.writingStatus"),
              statusHistory: [],
              createdAt: now,
            },
          ];
        });
      }
      setDraft("");
      // Clear attached items after send
      setAttachedItems([]);

      // Reuse the pre-send controller so a background abort during the fit gate
      // also cancels the stream that is about to start.
      const controller = preSendController;
      abortRef.current = controller;

      // Track whether any text has streamed — used to decide whether to remove empty placeholder on abort.
      // Set on onDelta (not on coalescer flush) so abort-before-first-flush still keeps the bubble.
      let anyTextStreamed = false;
      // Unmodified model output for this turn (prompt replay). UI still streams cleaned text.
      let modelEmittedText: string | undefined;
      // ~30 fps UI flush: llama.rn is 5–15 tok/s; setState every token is wasteful.
      // Coalescer overwrites with the latest full text and flushes on a 33 ms cadence.
      // Capture myGen/runId into the flush: a deferred trailing timer must not
      // paint into a chat that clearChat / a newer send already owns.
      const streamCoalescer = createStreamCoalescer((fullText) => {
        if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) {
          return;
        }
        updateMessage(
          assistantId,
          { text: fullText, statusLabel: undefined },
          myGen,
          runId,
        );
      });

      /** Memory extract deferred until after turn-end KV save (see AppShell). */
      let afterSessionSave: (() => void) | undefined;
      try {
        if (onSendStream) {
          const streamResult = await onSendStream(
            modelText,
            {
              onDelta: (_delta, full) => {
                // Mark text presence even if a later flush is dropped as stale —
                // abort-with-partial decisions depend on whether tokens arrived.
                anyTextStreamed = true;
                if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) {
                  return;
                }
                streamCoalescer.push(full);
              },
              onModelEmittedText: (text) => {
                if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) {
                  return;
                }
                if (typeof text === "string" && text.length > 0) {
                  modelEmittedText = text;
                }
              },
              // Feature 1: append to history AND set current label
              onStatus: (status) => {
                if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) {
                  return;
                }
                updateMessage(
                  assistantId,
                  prev => ({
                    statusLabel: status.label,
                    statusHistory: [...(prev.statusHistory ?? []), status.label],
                  }),
                  myGen,
                  runId,
                );
              },
              // BLOCKER-4: sources non chiudono lo streaming (il round tool
              // può continuare): aggiorna solo sources e statusLabel.
              onSources: (sources) => {
                if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) {
                  return;
                }
                updateMessage(
                  assistantId,
                  { sources, statusLabel: undefined },
                  myGen,
                  runId,
                );
              },
              onActions: (payload: any) => {
                if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) {
                  return;
                }
                const proposed = Array.isArray(payload?.proposed_actions) ? payload.proposed_actions : [];
                const ctas = proposed
                  .filter((action: any) => action?.executable === true && action?.output_id)
                  .slice(0, 4)
                  .map((action: any) => ({
                    artifactType: action.artifact_type || null,
                    contrastId: action.contrast_id || null,
                    id: `output-${action.output_id}-${action.artifact_type || "artifact"}`,
                    kind: "output" as const,
                    label: action.label
                      ? t("chat.openAction", { label: action.label })
                      : t("chat.openOutputPicker"),
                    outputId: action.output_id,
                    target: "outputs",
                  }));
                if (ctas.length) {
                  updateMessage(
                    assistantId,
                    prev => ({ ctas: [...(prev.ctas ?? []), ...ctas] }),
                    myGen,
                    runId,
                  );
                }
              },
              onCta: (payload: ChatCta) => {
                if (!payload?.kind || !payload?.label) return;
                if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) {
                  return;
                }
                updateMessage(
                  assistantId,
                  prev => ({ ctas: [...(prev.ctas ?? []), payload] }),
                  myGen,
                  runId,
                );
              },
              // Miniapp callback: store only (do NOT end streaming).
              // streaming:false + final text extraction stay in the finally block
              // after await onSendStream. LlamaService currently never emits this;
              // cloud/unified clients may. Invalid payloads are ignored.
              onMiniapp: (miniapp) => {
                if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) {
                  return;
                }
                const normalized = normalizeMiniapp(miniapp);
                if (!normalized) return;
                updateMessage(
                  assistantId,
                  { miniapp: normalized as Message["miniapp"] },
                  myGen,
                  runId,
                );
              },
              // RNA-seq job context: store result images/downloads on this message.
              onImages: (imgs, dls) => {
                if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) {
                  return;
                }
                updateMessage(
                  assistantId,
                  { images: imgs, downloads: dls },
                  myGen,
                  runId,
                );
              },
              // Backend resolves (not rejects) on stream/engine failures; flip
              // failed so handleSend returns ok:false for regen/edit rollback.
              onFailed: (reasonKey: string) => {
                failed = true;
                if (typeof reasonKey === "string" && reasonKey.trim()) {
                  failReasonKey = reasonKey;
                }
              },
            },
            controller.signal,
            snapshotAttachments.length > 0 ? snapshotAttachments : undefined,
            messagesRef.current,
            trimmed,
            useResearch || armedNotes
              ? { research: useResearch, notes: armedNotes }
              : undefined,
          );
          // clearChat mid-stream: do not adopt stream result into a new chat.
          if (!stillThisRun(myGen) || sendRunIdRef.current !== runId) {
            failed = true;
            failReasonKey = "chat.regenFailed";
          } else if (controller.signal.aborted && !anyTextStreamed) {
            // Stop / background discard with no tokens: ok:false so regen/edit
            // restore the previous assistant instead of dropping it.
            failed = true;
            failReasonKey = "chat.sendAborted";
          } else if (streamResult && typeof streamResult === "object") {
            afterSessionSave = streamResult.afterSessionSave;
          }
        } else {
          // onSendStream missing → mark failed so regen/edit roll back.
          failed = true;
          failReasonKey = "chat.backendNotWired";
          if (stillThisRun(myGen) && sendRunIdRef.current === runId) {
            updateMessage(
              assistantId,
              {
                streaming: false,
                statusLabel: undefined,
                text: t("chat.backendNotWired"),
              },
              myGen,
              runId,
            );
          }
        }
      } catch (err: any) {
        // Stale generation: skip all catch mutations (clearChat owns the UI).
        if (!stillThisRun(myGen) || sendRunIdRef.current !== runId) {
          failed = true;
          failReasonKey = "chat.regenFailed";
        } else if (controller.signal.aborted) {
          // BLOCKER-2 (audit): aborted with no streamed content → remove empty placeholder
          if (!anyTextStreamed && mountedRef.current) {
            setMessages(prev => {
              if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) {
                return prev;
              }
              return prev.filter(m => m.id !== assistantId);
            });
          }
          if (!anyTextStreamed) {
            failed = true;
            failReasonKey = "chat.sendAborted";
          }
          // If partial text was streamed, the finally block finalizes it cleanly — no action needed
        } else if (mountedRef.current) {
          // BLOCKER-5: surface error as chat text instead of leaving zombie spinner
          // Flush any pending stream text first, then overwrite with the error message.
          streamCoalescer.finalize();
          failed = true;
          if (err?.message?.includes("quota") || err?.message?.includes("limit")) {
            failReasonKey = "chat.queryLimit";
          } else {
            failReasonKey = "chat.serviceUnreachable";
          }
          const msg = t(failReasonKey as any);
          updateMessage(
            assistantId,
            { streaming: false, statusLabel: undefined, text: msg },
            myGen,
            runId,
          );
        } else {
          failed = true;
        }
      } finally {
        // Drain or drop the coalescer BEFORE finalize logic so the last token
        // is not stuck in a pending timeout, and discarded aborts never paint.
        if (controller.signal.aborted && !anyTextStreamed) {
          streamCoalescer.cancel();
        } else {
          streamCoalescer.finalize();
        }
        // Abort senza testo: rimuovi il placeholder vuoto (niente bubble fantasma).
        // Generation + runId: clearChat bumps both; stale finally must not paint.
        if (!stillThisRun(myGen) || sendRunIdRef.current !== runId) {
          // Stale turn — leave UI alone; clearChat already owns state.
        } else if (controller.signal.aborted && !anyTextStreamed) {
          setMessages(prev => {
            if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) {
              return prev;
            }
            return prev.filter(m => m.id !== assistantId);
          });
        } else if (!controller.signal.aborted || anyTextStreamed) {
          // Extract miniapp JSON from the final assistant text (local models emit
          // schema miniapp_v1 in the prose / fenced block; cloud path may also
          // call onMiniapp directly).
          // Abort-with-partial → interrupted marker; successful completion clears it.
          // Gate on sendRunId + generation so a clearChat mid-turn cannot resurrect
          // wiped history via messagesRef + persistMessagesNow.
          if (sendRunIdRef.current === runId && stillThisRun(myGen)) {
            const wasInterrupted = controller.signal.aborted && anyTextStreamed;
            // Finalize via functional updater so we compose over any queued final
            // onDelta (⚠️ error text, thinkStream final, miniapp payload) that has
            // not committed yet under Fabric. Compute the snapshot INSIDE the
            // updater (prev is queue-applied), stash the result, then flush
            // storage from that same array — not messagesRef (stale pre-commit).
            // Persist is fire-and-forget / invocation-level only: a kill before
            // the AsyncStorage write lands can still leave the last throttle
            // partial (interrupted:true) on disk; acceptable by design.
            // Pure compose over queue-applied prev (no side effects). Side
            // effects (persist + messagesRef) are gated on runId *inside* the
            // setState updater: React still applies queued updaters after
            // clearChat, so an outer gate alone cannot stop resurrection.
            // miniappStripped is reported out so we can mark KV
            // non-reproducible BEFORE saveEngineSession (A2): native KV holds
            // the raw generation, persist uses the stripped text.
            const applyFinalize = (
              prev: Message[],
            ): { messages: Message[]; miniappStripped: boolean } => {
              let miniappStripped = false;
              const messages = prev.map((message) => {
                if (message.id !== assistantId) return message;
                const emittedSave = normalizeModelEmittedTextForSave(
                  "assistant",
                  modelEmittedText,
                );
                const base: Message = {
                  ...message,
                  streaming: false,
                  statusLabel: undefined,
                  interrupted: wasInterrupted ? true : undefined,
                  ...(emittedSave !== undefined ? { modelEmittedText: emittedSave } : {}),
                };
                if (base.miniapp) return base;
                const extracted = parseMiniappFromText(base.text || "");
                // Only mark when a block was actually stripped (not every parse).
                if (miniappStripMakesKvNonReproducible(Boolean(extracted.miniapp))) {
                  miniappStripped = true;
                  return {
                    ...base,
                    text: extracted.text || base.text,
                    miniapp: extracted.miniapp as Message["miniapp"],
                  };
                }
                return base;
              });
              return { messages, miniappStripped };
            };
            if (mountedRef.current) {
              // Stash the updater's return value so persist uses the same array
              // scheduled into React state (includes any queued final delta —
              // the updater receives the queue-applied prev).
              let finalized: Message[] | null = null;
              // CRITICAL: install the turn-end save promise SYNCHRONOUSLY before
              // setMessages. React may defer the updater until after paint; the
              // background lifecycle must be able to await the same promise even
              // when it observes messagesRef before the updater runs.
              // Holder object avoids TS control-flow narrowing of bare lets
              // assigned inside the Promise executor.
              const turnSaveHold: {
                resolve: (() => void) | null;
                reject: ((err: unknown) => void) | null;
              } = { resolve: null, reject: null };
              const turnSaveP = new Promise<void>((resolve, reject) => {
                turnSaveHold.resolve = resolve;
                turnSaveHold.reject = reject;
              });
              turnEndSavePromiseRef.current = turnSaveP;
              // Attach rejection handler: turnSaveP can reject via saveEngineSession
              // failure (turnSaveHold.reject). finally alone re-propagates the
              // rejection → unhandledrejection. Fire-and-forget; lifecycle awaits
              // the same promise with its own try/catch.
              void turnSaveP
                .finally(() => {
                  if (turnEndSavePromiseRef.current === turnSaveP) {
                    turnEndSavePromiseRef.current = null;
                  }
                })
                .catch(() => {
                  // no-op — turn-end save is fire-and-forget for UI path
                });
              let saveWorkScheduled = false;
              setMessages((prev) => {
                // clearChat bumped sendRunId and/or generation: skip persist +
                // ref write and keep the cleared (or newer) prev.
                if (sendRunIdRef.current !== runId || !stillThisRun(myGen)) {
                  turnSaveHold.resolve?.();
                  return prev;
                }
                const applied = applyFinalize(prev);
                finalized = applied.messages;
                // Keep ref in lockstep so AppState/unmount flushes cannot re-read
                // a pre-finalize streaming bubble during the pre-commit window.
                messagesRef.current = finalized;
                // Persist from the stashed snapshot. Eager path: runs sync
                // when setMessages is called. Deferred path (pending final
                // onDelta lanes): runs at render after React applies the
                // queued delta first — still the correct composed result.
                // Epoch-stamped: clearChat bumps epoch before removeItem.
                const epoch = persistEpochRef.current;
                persistActiveMessages(finalized, {
                  epoch,
                  getEpoch: () => persistEpochRef.current,
                });
                // Turn-end order (FIFO): saveEngineSession FIRST, then memory
                // extract. extractMemory restores chat KV after the one-shot
                // completion (reuses this .kvs when save won). Fire-and-forget
                // so the UI is not blocked; gates (runId, memory, non-empty
                // reply) live inside afterSessionSave / scheduleMemoryExtract.
                // A2: mark BEFORE save when miniapp JSON was stripped from text.
                if (applied.miniappStripped) {
                  markKvNonReproducible("miniapp_stripped");
                }
                {
                  const mid = getActiveModelId();
                  const runAfterSave = afterSessionSave;
                  if (mid) {
                    const persistable = buildPersistableMessages(finalized);
                    const payload = JSON.stringify(persistable);
                    saveWorkScheduled = true;
                    void (async () => {
                      try {
                        await saveEngineSession(
                          mid,
                          historyHash(payload),
                          persistable.length,
                        );
                        turnSaveHold.resolve?.();
                      } catch (err) {
                        turnSaveHold.reject?.(err);
                      } finally {
                        // Post-await: generation may have moved during save.
                        if (sendRunIdRef.current === runId && stillThisRun(myGen)) {
                          runAfterSave?.();
                        }
                      }
                    })();
                  } else if (sendRunIdRef.current === runId && stillThisRun(myGen)) {
                    runAfterSave?.();
                    turnSaveHold.resolve?.();
                    saveWorkScheduled = true;
                  }
                }
                if (!saveWorkScheduled) {
                  turnSaveHold.resolve?.();
                }
                return finalized;
              });
              // If React never applied the updater (unmounted mid-flight),
              // still settle the promise so the lifecycle cannot hang.
              if (!mountedRef.current && !saveWorkScheduled) {
                turnSaveHold.resolve?.();
              }
            } else if (sendRunIdRef.current === runId && stillThisRun(myGen)) {
              const applied = applyFinalize(messagesRef.current);
              const next = applied.messages;
              messagesRef.current = next;
              const epoch = persistEpochRef.current;
              persistActiveMessages(next, {
                epoch,
                getEpoch: () => persistEpochRef.current,
              });
              if (applied.miniappStripped) {
                markKvNonReproducible("miniapp_stripped");
              }
              const mid = getActiveModelId();
              const runAfterSave = afterSessionSave;
              if (mid) {
                const persistable = buildPersistableMessages(next);
                const payload = JSON.stringify(persistable);
                // Synchronous install even on the unmounted path.
                const saveP = (async () => {
                  try {
                    await saveEngineSession(
                      mid,
                      historyHash(payload),
                      persistable.length,
                    );
                  } finally {
                    if (sendRunIdRef.current === runId && stillThisRun(myGen)) {
                      runAfterSave?.();
                    }
                  }
                })();
                turnEndSavePromiseRef.current = saveP;
                void saveP
                  .finally(() => {
                    if (turnEndSavePromiseRef.current === saveP) {
                      turnEndSavePromiseRef.current = null;
                    }
                  })
                  .catch(() => {
                    // no-op — unmounted turn-end save is fire-and-forget
                  });
              } else {
                runAfterSave?.();
              }
            }
          }
        }
        // U1: only reset the global sending indicators if this is still the
        // latest turn — clearChat() already reset them synchronously for a
        // newer turn, and this stale finally must not clobber it.
        // Also clear the stop watchdog only for THIS run: a stale finally must
        // not cancel a newer turn's watchdog (e.g. after force-unlock + re-send).
        if (sendRunIdRef.current === runId && stillThisRun(myGen)) {
          sendingRef.current = false;
          sendingInFlightRef.current = false;
          if (mountedRef.current) setSending(false);
          if (stopWatchdogRef.current != null) {
            clearTimeout(stopWatchdogRef.current);
            stopWatchdogRef.current = null;
          }
        }
      }
      if (controller.signal.aborted && !anyTextStreamed) {
        failed = true;
        if (failReasonKey === "chat.serviceUnreachable") {
          failReasonKey = "chat.sendAborted";
        }
      }
      return failed
        ? { ok: false as const, reasonKey: failReasonKey }
        : { ok: true as const };
      } finally {
        // Release only if we still own the claim (generation match).
        // clearChat bumps regenGenerationRef then clears claim for the new
        // owner; a stale finally must not clear that newer claim.
        if (regenGenerationRef.current === mySendGen) {
          sendClaimRef.current = false;
        }
      }
    },
    [awaitPreSendFitGate, historyLoaded, invalidateVoice, onSendStream, showVoiceNote, supportsVision, t, updateMessage],
  );

  // Publish the active handleSend promise so background discard can await it.
  const handleSendTracked = useCallback(
    (
      text: string,
      currentAttachments?: LocalAttachment[],
      opts?: HandleSendOpts,
    ) => {
      const p = handleSend(text, currentAttachments, opts);
      sendInFlightPromiseRef.current = p;
      void p.finally(() => {
        if (sendInFlightPromiseRef.current === p) {
          sendInFlightPromiseRef.current = null;
        }
      });
      return p;
    },
    [handleSend],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    // If native completion never settles after abort, unlock the composer
    // after 3s for the same run (mirrors clearChat ordering so a late finally
    // no-ops on runId gates and cannot resurrect interrupted state).
    if (stopWatchdogRef.current != null) {
      clearTimeout(stopWatchdogRef.current);
      stopWatchdogRef.current = null;
    }
    const runIdAtStop = sendRunIdRef.current;
    stopWatchdogRef.current = setTimeout(() => {
      stopWatchdogRef.current = null;
      if (!mountedRef.current) return;
      if (!sendingRef.current || sendRunIdRef.current !== runIdAtStop) return;
      // 1) Invalidate first so the engine's late finally no-ops its runId gates.
      // ownedRunId is our post-bump token: if clearChat/new-send bumps again
      // before React applies the updater, the inner gate no-ops (same reason
      // finally gates persist+messagesRef inside the setState updater).
      // Owner transfer matches clearChat: bump regenGenerationRef BEFORE
      // clearing sendClaimRef so a stale send finally cannot drop a newer claim.
      sendRunIdRef.current += 1;
      regenGenerationRef.current += 1;
      const ownedRunId = sendRunIdRef.current;
      // 2) Mark streaming assistants interrupted + persist in lockstep (like finally).
      // Empty placeholders (no streamed text) are dropped, mirroring the abort path.
      setMessages((prev) => {
        if (sendRunIdRef.current !== ownedRunId) {
          return prev;
        }
        const next = prev
          .filter((message) => !(message.streaming && !(message.text ?? "").trim()))
          .map((message) => {
            if (!message.streaming) return message;
            return {
              ...message,
              streaming: false,
              statusLabel: undefined,
              interrupted: true,
            };
          });
        messagesRef.current = next;
        const epoch = persistEpochRef.current;
        persistActiveMessages(next, {
          epoch,
          getEpoch: () => persistEpochRef.current,
        });
        return next;
      });
      // 3) Unlock composer only if we still own the generation token.
      // Note: if native completion truly never settles, withEngineJob's FIFO may
      // still be wedged — UI unlock is intentional; a follow-up send may queue
      // until dispose/model-switch releases the hung job.
      if (sendRunIdRef.current === ownedRunId) {
        sendingRef.current = false;
        sendingInFlightRef.current = false;
        sendClaimRef.current = false;
        // Stop during an edit-triggered send: clear the shared lock state so
        // the composer does not stay regenBusy.
        regenInFlightRef.current = false;
        regenHandleSendPassRef.current = false;
        setSending(false);
      }
    }, 3000);
  }, []);

  const exportChat = useCallback(() => {
    if (!messages.length) return;
    const markdown = messages
      .map(
        (message) =>
          `${message.role === "user" ? t("chat.exportYou") : t("chat.exportAi")}:\n${message.text}`,
      )
      .join("\n\n---\n\n");
    void Share.share({ message: markdown, title: t("chat.exportTitle") }).catch(
      () => undefined,
    );
  }, [messages, t]);

  const clearChat = useCallback(() => {
    if (onNewConversation && historyLoadedRef.current && messagesRef.current.length === 0) {
      return;
    }
    abortRef.current?.abort();
    // Flush the current conversation BEFORE bumping the persist epoch so
    // "new chat" cannot drop the last un-debounced write of the old thread.
    persistActiveMessages(messagesRef.current, {
      allowStreamingPartial: true,
      epoch: persistEpochRef.current,
      getEpoch: () => persistEpochRef.current,
    });
    // U1: invalidate any in-flight send turn so its later finally/bench/gate
    // reset cannot clobber the synchronous reset below.
    sendRunIdRef.current += 1;
    // Persistence epoch: every delayed write is epoch-stamped; bumping
    // here makes pending debounce / safety-net / AppState / unmount setItems
    // no-ops even if they already hold a pre-clear messages closure.
    persistEpochRef.current += 1;
    // Drop stop watchdog so it cannot fire after a wiped history.
    if (stopWatchdogRef.current != null) {
      clearTimeout(stopWatchdogRef.current);
      stopWatchdogRef.current = null;
    }
    // Abort any in-flight translation (mutex job will stopCompletion).
    translateAbortRef.current?.abort();
    translateAbortRef.current = null;
    translationInFlightRef.current = false;
    // BLOCKER-1 (audit): reset sending state synchronously so composer unlocks immediately
    sendingRef.current = false;
    sendingInFlightRef.current = false;
    // Owner transfer FIRST: bump generation so any concurrent stale finally
    // (sendClaim / regenInFlight / pass / abort) sees a mismatch and skips.
    // Then clear all locks for the idle post-clear state.
    regenGenerationRef.current += 1;
    sendClaimRef.current = false;
    regenAbortRef.current?.abort();
    regenAbortRef.current = null;
    regenInFlightRef.current = false;
    regenHandleSendPassRef.current = false;
    setSending(false);
    setMessages([]);
    // Sync ref immediately so AppState/unmount/throttle flushes cannot
    // re-persist pre-clear messages during the Fabric pre-commit window.
    messagesRef.current = [];
    setLongChatNudgeShown(false);
    setDraft("");
    // U9: reset any in-flight PDF conversion so a stale WebView/instance never
    // resurfaces attachments or a stuck "Reading pages…" composer state.
    pdfToRenderRef.current = null;
    setPdfToRender(null);
    pdfPagesRef.current = [];
    setAttachSheetOpen(false);
    // Audit follow-up: also drop already-queued attachments — otherwise a
    // stale chip (image/PDF picked before "New chat") rides into the fresh
    // conversation and gets sent with the next message.
    attachedItemsRef.current = [];
    setAttachedItems([]);
    notesModeRef.current = false;
    setResearchMode(false);
    setNotesMode(false);
    // Voice: invalidate transcription token, cancel capture, stop TTS, clear UI.
    voiceRunIdRef.current += 1;
    voiceBusyRef.current = false;
    voiceStopInFlightRef.current = false;
    setVoicePhase(reduceVoicePhase(voiceUiRef.current, { type: "CANCEL" }));
    setVoiceNote(null);
    if (voiceNoteTimer.current) {
      clearTimeout(voiceNoteTimer.current);
      voiceNoteTimer.current = null;
    }
    void cancelCapture();
    void TtsService.stop();
    setSpeakingId(null);
    // Drop volatile translation UI with the conversation.
    translateRunRef.current += 1;
    setMessageMenu(null);
    setTranslatingId(null);
    setTranslationResult(null);
    setCopiedFlash(false);
    // Do not removeItem the previous conversation's messages — parent owns
    // the index and inserts a new empty conversation.
    if (onNewConversation) {
      onNewConversation();
    } else {
      const activeId = getActiveModelId();
      if (activeId) void invalidateEngineSession(activeId);
    }
  }, [onNewConversation, persistActiveMessages, setVoicePhase]);

  /**
   * Edit a user message then generate from that point.
   * Atomic splice (edited flag) + truncate + handleSend(newText).
   *
   * Generation-gated body (round-4): after every await and before each
   * setMessages (truncate / stamp / rollback), abort if generation moved.
   */
  const editMessage = useCallback(
    async (
      targetMsgId: string,
      newText: string,
    ): Promise<{ ok: true } | { ok: false; reasonKey: string }> => {
      const trimmed = newText.trim();
      if (
        regenInFlightRef.current ||
        sendingRef.current ||
        sendClaimRef.current
      ) {
        return { ok: false, reasonKey: "chat.regenBusy" };
      }
      const editTarget = messagesRef.current.find((m) => m.id === targetMsgId);
      const editHasAttachments = (editTarget?.attachments?.length ?? 0) > 0;
      // Same as send: empty caption is valid when attachments remain.
      if (!trimmed && !editHasAttachments) {
        return { ok: false, reasonKey: "chat.editEmpty" };
      }
      // Capture generation at acquire (before any await).
      const myGeneration = regenGenerationRef.current;
      regenInFlightRef.current = true;
      regenAbortRef.current = new AbortController();
      const snapshot = messagesRef.current.slice();
      try {
        // Abort any in-flight stream first (uses handleSend's abortRef).
        if (sendingRef.current) {
          abortRef.current?.abort();
          await new Promise((r) => setTimeout(r, 0));
          // clearChat may have run during the yield — do not truncate/stamp.
          if (regenGenerationRef.current !== myGeneration) {
            return { ok: false, reasonKey: "chat.regenFailed" };
          }
        }
        const idx = messagesRef.current.findIndex((m) => m.id === targetMsgId);
        if (idx < 0) {
          return { ok: false, reasonKey: "chat.regenFailed" };
        }
        const target = messagesRef.current[idx];
        if (!target || target.role !== "user") {
          return { ok: false, reasonKey: "chat.regenFailed" };
        }
        // Keep messages before the edited user; drop the user and everything after.
        // handleSend will re-append the (edited) user text + new assistant.
        // Re-check generation before mutating messages (defensive vs re-entry).
        if (regenGenerationRef.current !== myGeneration) {
          return { ok: false, reasonKey: "chat.regenFailed" };
        }
        const base = messagesRef.current.slice(0, idx).map((m) => m);
        setMessages((prev) => {
          if (regenGenerationRef.current !== myGeneration) {
            return prev;
          }
          return base;
        });
        if (regenGenerationRef.current === myGeneration) {
          messagesRef.current = base;
        }
        regenHandleSendPassRef.current = true;
        if (regenAbortRef.current?.signal.aborted) {
          if (regenGenerationRef.current !== myGeneration) {
            return { ok: false, reasonKey: "chat.regenFailed" };
          }
          setMessages((prev) => {
            if (regenGenerationRef.current !== myGeneration) {
              return prev;
            }
            return snapshot;
          });
          if (regenGenerationRef.current === myGeneration) {
            messagesRef.current = snapshot;
          }
          return { ok: false, reasonKey: "chat.regenFailed" };
        }
        // handleSend appends the user bubble with edited:true at creation so
        // a live stream cannot be patched mid-flight (and the badge is on
        // the bubble from the first paint).
        const sendResult = await handleSendTracked(trimmed, target.attachments, {
          edited: true,
        });
        // clearChat during handleSend: do not rollback into the new chat.
        if (regenGenerationRef.current !== myGeneration) {
          return { ok: false, reasonKey: "chat.regenFailed" };
        }
        if (!sendResult.ok) {
          setMessages((prev) => {
            if (regenGenerationRef.current !== myGeneration) {
              return prev;
            }
            return snapshot;
          });
          if (regenGenerationRef.current === myGeneration) {
            messagesRef.current = snapshot;
            setSending(false);
            sendingRef.current = false;
            sendingInFlightRef.current = false;
          }
          return { ok: false, reasonKey: sendResult.reasonKey || "chat.regenFailed" };
        }
        return { ok: true };
      } catch {
        if (regenGenerationRef.current !== myGeneration) {
          return { ok: false, reasonKey: "chat.regenFailed" };
        }
        setMessages((prev) => {
          if (regenGenerationRef.current !== myGeneration) {
            return prev;
          }
          return snapshot;
        });
        if (regenGenerationRef.current === myGeneration) {
          messagesRef.current = snapshot;
          setSending(false);
          sendingRef.current = false;
          sendingInFlightRef.current = false;
        }
        return { ok: false, reasonKey: "chat.regenFailed" };
      } finally {
        // Generation-gated release: only the current owner clears all locks.
        if (regenGenerationRef.current === myGeneration) {
          regenInFlightRef.current = false;
          regenHandleSendPassRef.current = false;
          regenAbortRef.current = null;
        }
      }
    },
    [handleSendTracked],
  );

  // A live turn must not keep an edit sheet open: Save would race the stream
  // (stamp / truncate while tokens still land). Close both overlays on send.
  useEffect(() => {
    if (!sending) return;
    setEditingMessage(null);
    setMessageMenu(null);
  }, [sending]);

  useEffect(() => {
    if (messageMenu) return;
    if (messageMenuCloseTimer.current) {
      clearTimeout(messageMenuCloseTimer.current);
      messageMenuCloseTimer.current = null;
    }
  }, [messageMenu]);

  /** Open message action sheet (Copy + Translate + Read aloud + Edit). No-op while streaming / engine busy. */
  const openMessageMenu = useCallback(
    (id: string, text: string, role: Message["role"], streaming?: boolean) => {
      // Skip while this message streams, a chat turn is in flight, or a translate is running.
      // Refs ONLY (no state reads): ChatMessageRow's memo comparator ignores
      // most callback identity, so a state-capturing closure would freeze
      // inside memoized rows (user rows created mid-send froze sending=true
      // and their long-press menu died — hostile-review finding 1a).
      // sendingRef / translationInFlightRef / messagesRef keep this callback
      // identity-stable.
      const menuMsg = messagesRef.current.find((m) => m.id === id);
      const hasAttachments = (menuMsg?.attachments?.length ?? 0) > 0;
      if (
        streaming ||
        sendingRef.current ||
        translationInFlightRef.current ||
        regenInFlightRef.current ||
        (!text.trim() && !hasAttachments)
      ) {
        return;
      }
      setMessageMenu({ id, text, role });
    },
    [],
  );

  const copyTextToClipboard = useCallback(async (value: string): Promise<boolean> => {
    try {
      await Clipboard.setStringAsync(value);
      if (mountedRef.current) {
        setCopiedFlash(true);
        if (copiedFlashTimer.current) clearTimeout(copiedFlashTimer.current);
        copiedFlashTimer.current = setTimeout(() => {
          if (mountedRef.current) setCopiedFlash(false);
        }, 1500);
      }
      return true;
    } catch {
      // fallback: share sheet if clipboard write fails
      try {
        await Share.share({ message: value });
      } catch {
        // ignore
      }
      return false;
    }
  }, []);

  /**
   * Run on-device translation into the settings locale.
   * Target is always settings language (no language detection).
   * Result is volatile React state only — never written to history.
   */
  const runTranslate = useCallback(
    async (messageId: string, sourceText: string) => {
      // Do not contend with an active chat completion on the same engine.
      if (sendingRef.current || translationInFlightRef.current) return;
      const runId = ++translateRunRef.current;
      // Sync flag BEFORE the await so handleSend / long-press see it immediately.
      translationInFlightRef.current = true;
      const controller = new AbortController();
      translateAbortRef.current = controller;
      setMessageMenu(null);
      setTranslatingId(messageId);
      setTranslationResult(null);
      setTranslationExpanded(true);
      // Capture target lang at start so the badge stays correct if locale changes mid-run.
      const targetLang = locale;
      try {
        const out = await translateText(sourceText, targetLang, targetLang, controller.signal);
        if (runId !== translateRunRef.current) return;
        if (!out.text) {
          setTranslationResult({
            id: messageId,
            text: "",
            lang: targetLang,
            error: true,
            truncated: out.truncated,
          });
        } else {
          setTranslationResult({
            id: messageId,
            text: out.text,
            lang: targetLang,
            truncated: out.truncated,
          });
        }
      } catch {
        if (runId !== translateRunRef.current) return;
        setTranslationResult({ id: messageId, text: "", lang: targetLang, error: true });
      } finally {
        if (translateAbortRef.current === controller) {
          translateAbortRef.current = null;
        }
        if (runId === translateRunRef.current) {
          translationInFlightRef.current = false;
          setTranslatingId(null);
        }
      }
    },
    [locale],
  );

  const closeTranslation = useCallback(() => {
    translateRunRef.current += 1;
    translateAbortRef.current?.abort();
    translateAbortRef.current = null;
    translationInFlightRef.current = false;
    setTranslatingId(null);
    setTranslationResult(null);
  }, []);

  const toggleTranslationExpanded = useCallback(() => {
    setTranslationExpanded((v) => !v);
  }, []);

  // ── PDF attach rimosso (Fase 3): nessun endpoint remoto, tutto locale. ──

  // WARN-2: useMemo avoids draft.trim() allocation on every render.
  // Also block while translating / voice busy (listening or transcribing).
  const voiceBlocksComposer = voiceUi !== "idle" || voiceBusyRef.current;
  const canSend = useMemo(
    () =>
      (!!draft.trim() || attachedItems.length > 0) &&
      !sending &&
      !translatingId &&
      historyLoaded &&
      !voiceBlocksComposer &&
      // Audit follow-up: block submission while a PDF conversion is in
      // flight — otherwise the late handlePdfDone queues the PDF chip into
      // the NEXT message instead of the one being sent now.
      !pdfToRender,
    [
      attachedItems.length,
      draft,
      historyLoaded,
      pdfToRender,
      sending,
      translatingId,
      voiceBlocksComposer,
    ],
  );

  const onComposerAttach = useCallback(() => {
    if (voiceBusyRef.current || voiceUiRef.current !== "idle" || pdfToRenderRef.current) {
      return;
    }
    setAttachSheetOpen(true);
  }, []);

  const toggleResearchMode = useCallback(() => {
    const next = !researchModeRef.current;
    researchModeRef.current = next;
    setResearchMode(next);
  }, []);

  const toggleNotesMode = useCallback(() => {
    const next = !notesModeRef.current;
    notesModeRef.current = next;
    setNotesMode(next);
  }, []);

  const hasDocumentContext = attachedItems.some((item) => item.kind === "document");
  const onComposerDocument = useCallback(() => {
    const docs = documentLibrary?.docs ?? [];
    if (docs.length === 0) {
      onOpenDocuments?.();
      return;
    }
    setDocPickOpen(true);
  }, [documentLibrary, onOpenDocuments]);

  const onComposerSendOrStop = useCallback(() => {
    if (sendingRef.current) {
      handleStop();
      return;
    }
    if (pdfToRenderRef.current) return;
    const text = draftRef.current;
    const attachments = attachedItemsRef.current;
    if (!text.trim() && attachments.length === 0) return;
    handleSendTracked(text, attachments);
  }, [handleSendTracked, handleStop]);

  // ── Attach chip color helper ────────────────────────────────────────────
  function chipColorForKind(kind: LocalAttachment["kind"]) {
    if (kind === "pdf") return { dot: colors.compute, bg: colors.computeSoft };
    if (kind === "document") return { dot: colors.compute, bg: colors.computeSoft };
    return { dot: colors.accent, bg: colors.accentSoft };
  }

  /** Attach a library document as a retrieval source (document_chat tool). */
  const addLibraryDocumentAttachment = useCallback(
    (doc: { id: string; name: string }) => {
      setAttachedItems((prev) => {
        if (prev.some((a) => a.kind === "document" && a.libraryDocId === doc.id)) {
          return prev;
        }
        if (prev.length >= MAX_IMAGE_ATTACHMENTS) {
          showVoiceNote(
            t("errors.attachmentLimitReachedGeneric", { max: MAX_IMAGE_ATTACHMENTS }),
          );
          return prev;
        }
        return [
          ...prev,
          {
            id: nextMsgId("doc"),
            kind: "document" as const,
            name: doc.name,
            uri: "",
            libraryDocId: doc.id,
          },
        ];
      });
      setAttachSheetOpen(false);
      setDocPickOpen(false);
    },
    [showVoiceNote, t],
  );

  useEffect(() => {
    const doc = attachLibraryDoc;
    if (!doc?.id) return;
    addLibraryDocumentAttachment({ id: doc.id, name: doc.name });
  }, [addLibraryDocumentAttachment, attachLibraryDoc]);

  const importAndAttachDocx = useCallback(
    async (uri: string, name: string) => {
      if (!mountedRef.current) return;
      if (attachedItemsRef.current.length >= MAX_IMAGE_ATTACHMENTS) {
        showVoiceNote(t("errors.attachmentLimitReached", { max: MAX_IMAGE_ATTACHMENTS }));
        return;
      }
      showVoiceNote(t("documents.importingWord"));
      const resolvedSize = await resolveAssetSizeBytes(uri);
      if (!mountedRef.current) return;
      // Images inside the zip are skipped; the 50 MiB cap is the container, the 10 MiB cap is inflated text.
      const sizeCheck = sizeWithinLimits(resolvedSize, "docx");
      if (!sizeCheck.ok) {
        if (sizeCheck.reason === "empty") {
          showVoiceNote(t("documents.errorEmpty"));
        } else if (sizeCheck.reason === "too_large") {
          showVoiceNote(
            t("documents.errorTooLarge", {
              max: formatBytesLocalized(MAX_DOCUMENT_BYTES, locale),
            }),
          );
        } else {
          showVoiceNote(t("documents.errorDocx"));
        }
        return;
      }
      let text = "";
      try {
        text = await extractDocxTextFromFile(uri);
      } catch (error) {
        if (!mountedRef.current) return;
        if (error instanceof DocxExtractError) {
          if (error.code === "DOCX_EMPTY") {
            showVoiceNote(t("documents.errorEmpty"));
          } else if (error.code === "DOCX_TOO_LARGE") {
            showVoiceNote(
              t("documents.errorTooLarge", {
                max: formatBytesLocalized(MAX_TEXT_BYTES, locale),
              }),
            );
          } else {
            showVoiceNote(t("documents.errorDocx"));
          }
        } else {
          showVoiceNote(t("documents.errorDocx"));
        }
        return;
      }
      if (!mountedRef.current) return;
      if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
        showVoiceNote(
          t("documents.errorTooLarge", {
            max: formatBytesLocalized(MAX_TEXT_BYTES, locale),
          }),
        );
        return;
      }
      if (attachedItemsRef.current.length >= MAX_IMAGE_ATTACHMENTS) {
        showVoiceNote(t("errors.attachmentLimitReached", { max: MAX_IMAGE_ATTACHMENTS }));
        return;
      }
      const id = nextLibraryDocId();
      let ownedUri: string;
      try {
        ownedUri = await writeOwnedText(id, text);
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        showVoiceNote(
          msg === "NO_DOCUMENT_DIRECTORY"
            ? t("documents.errorStorage")
            : t("documents.errorDocx"),
        );
        return;
      }
      if (!mountedRef.current) {
        await deleteOwnedFile(ownedUri);
        return;
      }
      if (!onAddDocument) {
        await deleteOwnedFile(ownedUri);
        showVoiceNote(t("documents.errorSave"));
        return;
      }
      const entry: LibraryDoc = {
        id,
        name,
        sourceId: id,
        kind: "txt",
        addedAt: Date.now(),
        sizeBytes: new TextEncoder().encode(text).length,
        docCount: 1,
        fileUri: ownedUri,
        extractionStatus: "ok",
        estimatedTokens: estimateTokensForDoc(text),
      };
      if (!onAddDocument(entry)) {
        await deleteOwnedFile(ownedUri);
        if (mountedRef.current) showVoiceNote(t("documents.errorBusy"));
        return;
      }
      addLibraryDocumentAttachment({ id, name });
    },
    [addLibraryDocumentAttachment, locale, onAddDocument, showVoiceNote, t],
  );
  importAndAttachDocxRef.current = importAndAttachDocx;

  const keyExtractor = useCallback((m: Message) => m.id, []);

  const listContentContainerStyle = useMemo(
    () => ({
      paddingTop: 160,
      paddingBottom: spacing.md,
      paddingHorizontal: spacing.md,
    }),
    [],
  );

  const handleListScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    // Inverted list: offset 0 is the visual bottom (newest message).
    atBottomRef.current = e.nativeEvent.contentOffset.y <= 48;
  }, []);

  const handleListContentSizeChange = useCallback(() => {
    // Follow the stream only when the user is at the bottom; never yank when scrolled up.
    if (atBottomRef.current) {
      scrollViewRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, []);

  const listExtraData = useMemo(
    () => ({
      translatingId,
      translationResult,
      colors,
      t,
      locale,
    }),
    [
      translatingId,
      translationResult,
      colors,
      t,
      locale,
    ],
  );

  const renderMessageItem = useCallback(
    ({ item: m, index: i }: ListRenderItemInfo<Message>) => {
      // Inverted list: the message visually ABOVE row i is data[i+1]
      // (the next-newer one). Gap/divider logic mirrors the old
      // pre-inversion code with that neighbor.
      const list = reversedMessagesRef.current;
      const above = list[i + 1];
      const isTurnStart = !above || above.role !== m.role;
      // Visually topmost row = oldest message = last index of reversed data.
      // (Pre-inversion: idx===0 was oldest at top with topGap 0.)
      const topGap =
        i === list.length - 1
          ? 0
          : isTurnStart
            ? spacing.lg
            : spacing.md;
      const showDayDivider = !above || !isSameDay(above.createdAt, m.createdAt);
      const dayLabel = showDayDivider ? formatDayLabel(m.createdAt, t, locale) : null;
      return (
        <ChatMessageRow
          key={m.id}
          message={m}
          topGap={topGap}
          dayLabel={dayLabel}
          isFirst={i === list.length - 1}
          isTranslating={translatingId === m.id}
          translationResult={translationResult?.id === m.id ? translationResult : null}
          translationExpanded={
            translationResult?.id === m.id ? translationExpanded : false
          }
          colors={colors}
          typography={rowTypography}
          t={t}
          onOpenMessageMenu={openMessageMenu}
          onCopyText={(text) => { void copyTextToClipboard(text); }}
          onSpeak={handleReadAloud}
          isSpeaking={speakingId === m.id}
          onCloseTranslation={closeTranslation}
          onRetryTranslate={runTranslate}
          onToggleTranslationExpanded={toggleTranslationExpanded}
          onOpenMiniapp={onOpenMiniapp}
          onCtaPress={onCtaPress}
        />
      );
    },
    [
      closeTranslation,
      colors,
      copyTextToClipboard,
      handleReadAloud,
      locale,
      onCtaPress,
      onOpenMiniapp,
      openMessageMenu,
      rowTypography,
      runTranslate,
      speakingId,
      t,
      toggleTranslationExpanded,
      translatingId,
      translationExpanded,
      translationResult,
    ],
  );

  return (
    // Manual padding from the lib's animated keyboard height — the lib KAV's
    // frame-diff formula under-lifted by a constant on API 34/35 emulators and
    // Android 16 field device (runs 31219016159/31221427122/31223107657); raw
    // height has no frame math to get wrong; sign is negative-when-open per
    // lib convention.
    <Animated.View style={[{ flex: 1, backgroundColor: colors.shell }, kbPad]}>

      {/* ── Nav bar ── */}
      <ChatNavBar
        colors={colors}
        t={t}
        onMenuPress={onMenuPress}
        onExport={exportChat}
        onNewChat={clearChat}
      />

      {/* ── Selected run banner ── */}
      {selectedRun ? (
        <View
          style={{
            marginHorizontal: spacing.md,
            marginTop: spacing.sm,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            padding: spacing.sm + 2,
            backgroundColor: colors.computeSoft,
            borderRadius: 12,
          }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: colors.compute }} />
          <Text style={[typography.bodyXs, { flex: 1, color: colors.ink }]} numberOfLines={1}>
            {t("chat.selectedRun", {
              label: [
                selectedRun.accession || selectedRun.jobId,
                selectedRun.organism,
                selectedRun.status,
              ]
                .filter(Boolean)
                .join(" · "),
            })}
          </Text>
          {onClearSelectedRun ? (
            <Pressable onPress={onClearSelectedRun} hitSlop={8} accessibilityLabel={t("chat.a11yClearRun")}>
              <Text style={[typography.bodyXs, { color: colors.muted }]}>{t("common.clear")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* ── Long-conversation nudge (V4.2 §Fase 3.5) ── */}
      {longChatNudgeShown ? (
        <View
          style={{
            marginHorizontal: spacing.md,
            marginTop: spacing.sm,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            padding: spacing.sm + 2,
            backgroundColor: colors.computeSoft,
            borderRadius: 12,
          }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: colors.compute }} />
          <Text style={[typography.bodyXs, { flex: 1, color: colors.ink }]} numberOfLines={2}>
            {t("chat.longChatNudge")}
          </Text>
          <Pressable onPress={clearChat} hitSlop={8} accessibilityLabel={t("chat.a11yNewChat")}>
            <Text style={[typography.bodyXs, { color: colors.muted }]}>{t("chat.longChatNudgeAction")}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* ── Messages / welcome ── */}
      {!historyLoaded ? (
        <View style={{ flex: 1 }} />
      ) : messages.length === 0 ? (
        // HIGH-1 (Jelly 480×854): welcome chips must NOT cover the composer.
        // flex:1 + ScrollView keeps the EditText always in the tree and tappable;
        // on tall screens the list simply does not scroll.
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: spacing.xs,
            paddingTop: spacing.xl,
            paddingBottom: spacing.md,
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Greeting — optional sage plate (raster has no letters). */}
          <View
            style={
              showEmptyArt
                ? {
                    marginBottom: spacing.xs,
                    borderRadius: radius.lg,
                    overflow: "hidden",
                    aspectRatio: 4 / 3,
                    justifyContent: "center",
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.md,
                  }
                : { marginBottom: spacing.xs }
            }
          >
            {showEmptyArt ? (
              <Image
                source={EMPTY_STATE_RASTER}
                style={{
                  position: "absolute",
                  width: "100%",
                  height: "100%",
                }}
                resizeMode="cover"
                resizeMethod="resize"
                accessible={false}
                importantForAccessibility="no"
                onError={() => setEmptyArtFailed(true)}
              />
            ) : null}
            {showEmptyArt && mode === "dark" ? (
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  width: "100%",
                  height: "100%",
                  backgroundColor: colors.shell,
                  opacity: 0.78,
                }}
              />
            ) : null}
            <Text
              style={[
                typography.displayXl,
                { color: colors.ink, maxWidth: showEmptyArt ? "70%" : undefined },
              ]}
            >
              {greeting}
              {userName ? (
                <Text style={{ color: colors.accent }}>{`, ${userName}`}</Text>
              ) : null}
              {"."}
            </Text>
          </View>
          <Text style={[typography.bodyMd, { color: colors.muted, marginBottom: spacing.xl }]}>
            {t("chat.welcomePrompt")}
          </Text>

          {/* Suggestion cards */}
          {suggestions.map((s) => {
            const iconColor =
              s.colorKey === "compute" ? colors.compute : colors.accent;
            const iconBg =
              s.colorKey === "compute" ? colors.computeSoft : colors.accentSoft;
            return (
              <Pressable
                key={s.text}
                onPress={() => handleSendTracked(s.text, attachedItems)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                  paddingVertical: spacing.sm + 2,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: colors.line,
                  backgroundColor: pressed ? colors.panelBright : colors.panel,
                  marginBottom: spacing.xs,
                })}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    backgroundColor: iconBg,
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <s.Icon size={16} color={iconColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.bodySm, { color: colors.ink }]}>{s.text}</Text>
                  <Text style={[typography.bodyXs, { color: colors.muted, marginTop: 1 }]}>
                    {s.sub}
                  </Text>
                </View>
                <ChevronRight color={colors.muted} size={14} />
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <FlatList
          ref={scrollViewRef}
          data={reversedMessages}
          extraData={listExtraData}
          keyExtractor={keyExtractor}
          inverted
          // Visual bottom padding (below the newest message): with `inverted`
          // the content container is flipped, so paddingTop lands at the
          // visual bottom.
          contentContainerStyle={listContentContainerStyle}
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          onScroll={handleListScroll}
          scrollEventThrottle={32}
          onContentSizeChange={handleListContentSizeChange}
          renderItem={renderMessageItem}
        />
      )}

      {/* ── Composer ── */}
      <View
        style={{
          backgroundColor: colors.shell,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.sm,
          // insets.bottom is nav-bar-only on safe-area-context 5.7 (no IME),
          // so it cannot stack with the KAV keyboard padding. An upgrade to an
          // IME-aware safe-area release WOULD double-count here — re-check then.
          paddingBottom: spacing.sm + Math.max(0, insets.bottom - 8),
          gap: spacing.xs,
        }}
      >
        {/* Feature 4: context chips row */}
        {pdfToRender ? (
          <View style={{ paddingHorizontal: spacing.md, paddingBottom: 4 }}>
            <PdfToImages
              // U2: force a full remount when the selected PDF changes so a
              // re-selection mid-conversion never reuses stale doneRef/
              // chunksRef/html state from the previous document.
              key={pdfToRender.uri}
              pdfUri={pdfToRender.uri}
              onPage={handlePdfPage}
              onDone={handlePdfDone}
              onError={handlePdfError}
            />
          </View>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.xs, paddingBottom: 4 }}
        >
          <ComposerContextChip
            icon={<Search size={15} color={researchMode ? colors.accent : colors.muted} />}
            label={t("chat.deepResearch")}
            onPress={toggleResearchMode}
            colors={colors}
            active={researchMode}
            disabled={sending || voiceBlocksComposer || !!pdfToRender}
            accessibilityLabel={researchMode ? t("chat.deepResearchActive") : t("chat.deepResearch")}
          />
          <ComposerContextChip
            icon={<BookOpen size={15} color={hasDocumentContext ? colors.accent : colors.muted} />}
            label={t("chat.libraryDocument")}
            onPress={onComposerDocument}
            colors={colors}
            active={hasDocumentContext}
            disabled={sending || voiceBlocksComposer || !!pdfToRender}
            toggle={false}
          />
          <ComposerContextChip
            icon={<ClipboardList size={15} color={notesMode ? colors.accent : colors.muted} />}
            label={t("notes.title")}
            onPress={toggleNotesMode}
            colors={colors}
            active={notesMode}
            disabled={sending || voiceBlocksComposer || !!pdfToRender}
          />
        </ScrollView>

        {attachedItems.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.xs, paddingBottom: 4 }}
          >
            {attachedItems.map(item => {
              const { dot, bg } = chipColorForKind(item.kind);
              const libraryCover =
                item.kind === "document" && item.libraryDocId
                  ? documentLibrary?.docs.find((d) => d.id === item.libraryDocId)
                      ?.previewUri
                  : undefined;
              const thumbUri =
                item.kind === "image" && item.uri
                  ? item.uri
                  : item.kind === "pdf" && item.pages?.[0]
                    ? item.pages[0]
                    : libraryCover;
              return (
                <View
                  key={item.id}
                  accessibilityLabel={item.name}
                  style={{
                    width: 56,
                    height: 72,
                    borderRadius: 12,
                    overflow: "hidden",
                    backgroundColor: bg,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {thumbUri ? (
                    <Image
                      source={{ uri: thumbUri }}
                      style={{ width: 56, height: 72 }}
                      resizeMode="cover"
                      accessible={false}
                      importantForAccessibility="no"
                    />
                  ) : item.kind === "image" ? (
                    <ImageIcon size={22} color={dot} />
                  ) : item.kind === "document" ? (
                    <BookOpen size={22} color={dot} />
                  ) : (
                    <FileText size={22} color={dot} />
                  )}
                  <Pressable
                    onPress={() =>
                      setAttachedItems(prev => prev.filter(a => a.id !== item.id))
                    }
                    hitSlop={8}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={t("chat.a11yRemoveAttachment")}
                    style={{
                      position: "absolute",
                      top: 2,
                      right: 2,
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      backgroundColor: colors.panelSolid,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <X size={12} color={colors.muted} />
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        ) : null}

        {/* Voice status line (listening / transcribing / errors) */}
        {voiceUi !== "idle" || voiceNote ? (
          <Text
            style={[
              typography.bodyXs,
              {
                color: voiceUi === "listening" ? (colors.bad ?? "#c0392b") : colors.muted,
                paddingHorizontal: spacing.xs,
              },
            ]}
            numberOfLines={2}
          >
            {voiceUi === "listening"
              ? t("voice.listening")
              : voiceUi === "transcribing"
                ? t("voice.transcribing")
                : voiceNote}
          </Text>
        ) : null}

        {/* Elevated composer surface — input on top, actions row below */}
        <View
          style={{
            backgroundColor: colors.panelSolid,
            borderWidth: 1,
            borderColor: colors.lineStrong,
            borderRadius: radius.lg,
            padding: spacing.xs,
          }}
        >
          {/* Input-area only: taps on padding focus the field without wrapping the action row. */}
          <Pressable onPress={() => inputRef.current?.focus()}>
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder={t("chat.placeholder")}
              placeholderTextColor={colors.muted}
              editable={!sending && !voiceBlocksComposer}
              onSubmitEditing={() => {
                // Audit follow-up: typing stays enabled during a PDF
                // conversion, but submission must not start mid-conversion.
                if (pdfToRender) return;
                handleSendTracked(draft, attachedItems);
              }}
              returnKeyType="send"
              multiline
              style={[
                typography.chatBody,
                {
                  maxHeight: 120,
                  color: colors.ink,
                  paddingHorizontal: spacing.xs,
                  paddingVertical: spacing.xs,
                },
              ]}
            />
          </Pressable>

          <ComposerActionRow
            canSend={canSend}
            sending={sending}
            pdfBlocked={!!pdfToRender}
            voiceBlocksComposer={voiceBlocksComposer}
            voiceUi={voiceUi}
            voiceReady={voiceReady}
            colors={colors}
            t={t}
            onAttach={onComposerAttach}
            onMic={handleMicPress}
            onSendOrStop={onComposerSendOrStop}
          />
        </View>
      </View>

      {/* Message long-press: Copy + Translate (replaces direct Share.share). */}
      {messageMenu ? (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => setMessageMenu(null)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.42)", justifyContent: "flex-end" }}
            onPress={() => setMessageMenu(null)}
          >
            <Pressable
              style={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.md }}
              onPress={() => undefined}
            >
              <View
                style={{
                  backgroundColor: colors.shell,
                  borderRadius: radius.xl ?? 24,
                  overflow: "hidden",
                }}
              >
                <Text
                  style={[
                    typography.bodyXs,
                    { color: colors.muted, paddingHorizontal: spacing.md, paddingTop: spacing.md },
                  ]}
                >
                  {copiedFlash ? t("common.copied") : t("chat.a11yLongPress")}
                </Text>
                {!messageMenu.text.trim() ? (
                  <AttachSheetRow
                    icon={<BrandIcon name="copy" size={22} />}
                    label={copiedFlash ? t("common.copied") : t("common.copy")}
                    onPress={() => {
                      // Keep menu open ~400ms with "Copied!" so feedback is visible.
                      void (async () => {
                        await copyTextToClipboard(messageMenu.text);
                        if (messageMenuCloseTimer.current) {
                          clearTimeout(messageMenuCloseTimer.current);
                        }
                        messageMenuCloseTimer.current = setTimeout(() => {
                          messageMenuCloseTimer.current = null;
                          if (mountedRef.current) setMessageMenu(null);
                        }, 400);
                      })();
                    }}
                    colors={colors}
                  />
                ) : null}
                {onSaveToNotes ? (
                  <AttachSheetRow
                    icon={<ClipboardList size={18} color={colors.ink} />}
                    label={t("notes.saveToNotes")}
                    onPress={() => {
                      onSaveToNotes(messageMenu.text);
                      setMessageMenu(null);
                    }}
                    colors={colors}
                  />
                ) : null}
                <AttachSheetRow
                  icon={<Languages size={18} color={colors.ink} />}
                  label={t("translate.title")}
                  onPress={() => {
                    void runTranslate(messageMenu.id, messageMenu.text);
                  }}
                  colors={colors}
                />
                {messageMenu.role === "user" && !sending ? (
                  <AttachSheetRow
                    icon={<SquarePen size={18} color={colors.ink} />}
                    label={t("chat.edit")}
                    onPress={() => {
                      setEditingMessage({ id: messageMenu.id, draft: messageMenu.text });
                      setMessageMenu(null);
                    }}
                    colors={colors}
                  />
                ) : null}
                <AttachSheetRow
                  icon={<X size={18} color={colors.muted} />}
                  label={t("common.cancel")}
                  onPress={() => setMessageMenu(null)}
                  colors={colors}
                />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {editingMessage ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setEditingMessage(null)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.42)", justifyContent: "center", padding: spacing.md }}
            onPress={() => setEditingMessage(null)}
          >
            <Pressable
              style={{
                backgroundColor: colors.shell,
                borderRadius: radius.xl ?? 24,
                padding: spacing.md,
                gap: spacing.sm,
              }}
              onPress={() => undefined}
            >
              <Text style={[typography.bodySm, { color: colors.ink, fontFamily: fontFamilies.bodySemi }]}>
                {t("chat.edit")}
              </Text>
              <TextInput
                value={editingMessage.draft}
                onChangeText={(v) =>
                  setEditingMessage((prev) => (prev ? { ...prev, draft: v } : prev))
                }
                multiline
                autoFocus
                accessibilityLabel={t("chat.edit")}
                style={{
                  minHeight: 96,
                  maxHeight: 200,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radius.md ?? 12,
                  padding: spacing.sm,
                  color: colors.ink,
                  textAlignVertical: "top",
                }}
              />
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm }}>
                <Pressable
                  onPress={() => setEditingMessage(null)}
                  accessibilityLabel={t("common.cancel")}
                  style={({ pressed }) => ({
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={[typography.bodySm, { color: colors.muted }]}>{t("common.cancel")}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const id = editingMessage.id;
                    const draft = editingMessage.draft;
                    void editMessage(id, draft).then((res) => {
                      if (!mountedRef.current) return;
                      if (!res.ok) {
                        showVoiceNote(t(res.reasonKey as any));
                        return;
                      }
                      setEditingMessage(null);
                    });
                  }}
                  accessibilityLabel={t("common.save")}
                  style={({ pressed }) => ({
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    backgroundColor: colors.accent,
                    borderRadius: radius.md ?? 12,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Text style={[typography.bodySm, { color: colors.primaryText }]}>{t("common.save")}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {attachSheetOpen ? (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => setAttachSheetOpen(false)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.42)", justifyContent: "flex-end" }}
            onPress={() => setAttachSheetOpen(false)}
          >
            <Pressable style={{ padding: spacing.md, paddingBottom: 32 }} onPress={() => undefined}>
              <View
                style={{
                  backgroundColor: colors.shell,
                  borderRadius: radius.xl ?? 24,
                  overflow: "hidden",
                }}
              >
                <AttachSheetRow
                  icon={<ImageIcon size={18} color={colors.ink} />}
                  label={t("chat.photoLibrary")}
                  onPress={() => void addImageAttachment("library")}
                  colors={colors}
                />
                <AttachSheetRow
                  icon={<Camera size={18} color={colors.ink} />}
                  label={t("chat.takePhoto")}
                  onPress={() => void addImageAttachment("camera")}
                  colors={colors}
                />
                <AttachSheetRow
                  icon={<FileText size={18} color={colors.ink} />}
                  label={t("chat.pdfOrWord")}
                  onPress={() => void addPdfAttachment()}
                  colors={colors}
                />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {docPickOpen ? (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => setDocPickOpen(false)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.42)", justifyContent: "flex-end" }}
            onPress={() => setDocPickOpen(false)}
          >
            <Pressable style={{ padding: spacing.md, paddingBottom: 32 }} onPress={() => undefined}>
              <View
                style={{
                  backgroundColor: colors.shell,
                  borderRadius: radius.xl ?? 24,
                  overflow: "hidden",
                  maxHeight: 360,
                }}
              >
                {(documentLibrary?.docs ?? []).map((doc) => (
                  <AttachSheetRow
                    key={doc.id}
                    icon={<FileText size={18} color={colors.ink} />}
                    label={doc.name}
                    onPress={() => addLibraryDocumentAttachment(doc)}
                    colors={colors}
                  />
                ))}
                <AttachSheetRow
                  icon={<X size={18} color={colors.muted} />}
                  label={t("common.cancel")}
                  onPress={() => setDocPickOpen(false)}
                  colors={colors}
                />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {kbDebugOn ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: insets.top + 4,
            right: 8,
            zIndex: 9999,
            backgroundColor: colors.muted,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 4,
            opacity: 0.9,
          }}
        >
          <Text
            style={{
              fontFamily: fontFamilies.mono,
              fontSize: 10,
              color: colors.shell,
            }}
          >
            {kbDebugLabel}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

const ChatNavBar = React.memo(function ChatNavBar({
  colors,
  t,
  onMenuPress,
  onExport,
  onNewChat,
}: {
  colors: any;
  t: TranslateFn;
  onMenuPress?: () => void;
  onExport: () => void;
  onNewChat: () => void;
}) {
  return (
    <View
      style={{
        // No top inset here: AppShell's model bar sits directly above this row
        // and already applies `insets.top`. Applying it again reserved the
        // status-bar height a second time and left an empty band under the
        // model name — invisible while surfaces were translucent, obvious once
        // this header got an opaque background and a bottom border.
        // `insets.bottom` is still used below, for the composer.
        backgroundColor: colors.shell,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
      }}
    >
      <View
        style={{
          height: 48,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: spacing.md,
        }}
      >
        <Pressable
          onPress={onMenuPress}
          accessibilityLabel={t("chat.a11yMenu")}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Menu size={20} color={colors.ink} />
        </Pressable>

        <View style={{ flex: 1 }} />

        <Pressable
          onPress={onExport}
          hitSlop={8}
          accessibilityLabel={t("chat.a11yExport")}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <BrandIcon name="share" size={28} />
        </Pressable>

        <Pressable
          onPress={onNewChat}
          hitSlop={8}
          accessibilityLabel={t("chat.a11yNewChat")}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <BrandIcon name="new-chat" size={28} />
        </Pressable>
      </View>
    </View>
  );
});

const ComposerActionRow = React.memo(function ComposerActionRow({
  canSend,
  sending,
  pdfBlocked,
  voiceBlocksComposer,
  voiceUi,
  voiceReady,
  colors,
  t,
  onAttach,
  onMic,
  onSendOrStop,
}: {
  canSend: boolean;
  sending: boolean;
  pdfBlocked: boolean;
  voiceBlocksComposer: boolean;
  voiceUi: VoiceUiState;
  voiceReady: boolean;
  colors: any;
  t: TranslateFn;
  onAttach: () => void;
  onMic: () => void;
  onSendOrStop: () => void;
}) {
  const attachDisabled = sending || voiceBlocksComposer || pdfBlocked;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: spacing.xs,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Pressable
          onPress={onAttach}
          disabled={attachDisabled}
          accessible
          accessibilityRole="button"
          accessibilityLabel={t("chat.a11yAttach")}
          accessibilityState={{ disabled: attachDisabled }}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            opacity: attachDisabled ? 0.45 : pressed ? 0.7 : 1,
          })}
        >
          <BrandIcon name="attach" />
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Pressable
          onPress={onMic}
          disabled={sending || voiceUi === "transcribing"}
          accessible
          accessibilityRole="button"
          accessibilityState={{
            disabled: sending || voiceUi === "transcribing",
            busy: voiceUi === "transcribing",
          }}
          accessibilityLabel={
            voiceUi === "listening"
              ? t("voice.a11yMicStop")
              : !voiceReady
                ? t("voice.modelMissing")
                : t("voice.a11yMic")
          }
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            opacity:
              sending || voiceUi === "transcribing"
                ? 0.45
                : pressed
                  ? 0.7
                  : voiceReady
                    ? 1
                    : 0.55,
          })}
        >
          <BrandIcon
            name="mic"
            tone={voiceUi === "listening" ? "danger" : "accent"}
          />
        </Pressable>

        <Pressable
          onPress={onSendOrStop}
          accessible
          accessibilityRole="button"
          accessibilityLabel={sending ? t("chat.a11yStop") : t("chat.a11ySend")}
          accessibilityState={{ disabled: !sending && !canSend }}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <View style={{ width: 36, height: 36 }}>
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                opacity: sending ? 1 : 0,
              }}
              accessibilityElementsHidden={!sending}
              importantForAccessibility={sending ? "auto" : "no-hide-descendants"}
            >
              <BrandIcon name="stop" />
            </View>
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                opacity: sending ? 0 : 1,
              }}
              accessibilityElementsHidden={sending}
              importantForAccessibility={sending ? "no-hide-descendants" : "auto"}
            >
              <SendGlyphPair canSend={canSend} />
            </View>
          </View>
        </Pressable>
      </View>
    </View>
  );
});

function ComposerContextChip({
  icon,
  label,
  onPress,
  colors,
  active,
  disabled,
  accessibilityLabel,
  toggle = true,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  colors: any;
  active: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  toggle?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessible
      accessibilityRole={toggle ? "switch" : "button"}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={toggle ? { checked: active, disabled } : { selected: active, disabled }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: spacing.sm,
        paddingVertical: 5,
        borderRadius: radius.md ?? 12,
        backgroundColor: active ? colors.accentSoft : colors.panelSolid,
        borderWidth: 1,
        borderColor: active ? colors.accent : colors.line,
        opacity: disabled ? 0.45 : pressed ? 0.78 : 1,
      })}
    >
      {icon}
      <Text style={[typography.bodyXs, { color: active ? colors.accent : colors.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function AttachSheetRow({
  icon,
  label,
  onPress,
  colors,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  colors: any;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
        backgroundColor: pressed ? colors.panelBright : "transparent",
      })}
    >
      {icon}
      <Text style={[typography.bodySm, { color: colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

function MessageActionChip({
  icon,
  label,
  onPress,
  colors,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  colors: any;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingVertical: 4,
        paddingHorizontal: 6,
        borderRadius: radius.sm,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {icon}
      <Text style={[typography.bodyXs, { color: active ? colors.accent : colors.muted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ThinkingBlock({
  statusLabel,
  statusHistory,
  colors,
  t,
}: {
  statusLabel?: string;
  statusHistory?: string[];
  colors: any;
  t: TranslateFn;
}) {
  const [expanded, setExpanded] = useState(false);
  const history = statusHistory ?? [];
  const canExpand = history.length > 0;
  const header = statusLabel || t("chat.thinkingStatus");
  return (
    <View>
      <Pressable
        onPress={canExpand ? () => setExpanded((v) => !v) : undefined}
        accessibilityRole={canExpand ? "button" : undefined}
        accessibilityState={canExpand ? { expanded } : undefined}
        accessibilityLabel={header}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs,
          paddingVertical: 2,
        }}
      >
        {statusLabel ? <ActivityIndicator size="small" color={colors.muted} /> : null}
        <Text style={[typography.displaySm, { color: colors.ink, flex: 1 }]}>{header}</Text>
        {canExpand ? (
          <View style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}>
            <ChevronDown size={14} color={colors.muted} />
          </View>
        ) : null}
      </Pressable>
      {expanded
        ? history.map((label, i) => (
            <View
              key={`${i}-${label}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingVertical: 1,
                paddingLeft: spacing.xs,
              }}
            >
              <Check size={12} color={colors.muted} />
              <Text style={[typography.bodyXs, { color: colors.muted }]}>{label}</Text>
            </View>
          ))
        : null}
    </View>
  );
}

function CodeFenceBlock({
  lang,
  content,
  colors,
  t,
  onCopyText,
}: {
  lang: string;
  content: string;
  colors: any;
  t: TranslateFn;
  onCopyText: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );
  return (
    <View
      style={{
        backgroundColor: colors.surfaceSunken,
        borderWidth: 1,
        borderColor: colors.lineStrong,
        borderRadius: radius.sm,
        marginVertical: 4,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: spacing.sm,
          paddingVertical: 4,
          borderBottomWidth: 1,
          borderBottomColor: colors.lineStrong,
        }}
      >
        <Text style={[typography.bodyXs, { color: colors.muted }]}>{lang}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Pressable
            onPress={() => {
              onCopyText(content);
              setCopied(true);
              if (copiedTimer.current) clearTimeout(copiedTimer.current);
              copiedTimer.current = setTimeout(() => setCopied(false), 1500);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("common.copy")}
          >
            <Text style={[typography.bodyXs, { color: colors.accent }]}>
              {copied ? t("common.copied") : t("common.copy")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              void Share.share({ message: content }).catch(() => undefined);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("common.share")}
          >
            <Text style={[typography.bodyXs, { color: colors.accent }]}>
              {t("common.share")}
            </Text>
          </Pressable>
        </View>
      </View>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
        <Text style={[typography.monoSm, { color: colors.ink, padding: spacing.sm }]}>
          {content}
        </Text>
      </ScrollView>
    </View>
  );
}


// ── Memoized chat row: history rows skip re-render during streaming flushes ──
// updateMessage only replaces the streaming message's object identity; other
// Message refs stay stable. Custom compare ignores callback identity so parent
// re-renders (new inline arrows) do not force history rows to repaint.
const PROVIDER_COLORS: Record<string, { light: string; dark: string }> = {
  brave: { light: "#9A3412", dark: "#FF6B4A" },
  exa: { light: "#6D28D9", dark: "#A78BFA" },
  "exa-mcp": { light: "#6D28D9", dark: "#A78BFA" },
  tavily: { light: "#0369A1", dark: "#38BDF8" },
};

function getProviderColor(provider: string | undefined, colors: any): string {
  const providerColors = PROVIDER_COLORS[provider ?? ""];
  if (!providerColors) return colors.accent;
  return colors.panelSolid === "#FFFFFF" ? providerColors.light : providerColors.dark;
}

type ChatMessageRowProps = {
  message: Message;
  topGap: number;
  dayLabel: string | null;
  isFirst: boolean;
  isTranslating: boolean;
  translationResult: {
    id: string;
    text: string;
    lang: Locale;
    error?: boolean;
    truncated?: boolean;
  } | null;
  translationExpanded: boolean;
  colors: any;
  /** fontScaleId-stable tokens from the parent — do not subscribe to theme here. */
  typography: Record<string, any>;
  t: TranslateFn;
  onOpenMessageMenu: (
    id: string,
    text: string,
    role: Message["role"],
    streaming?: boolean,
  ) => void;
  onCopyText: (text: string) => void;
  onSpeak?: (id: string, text: string) => void;
  isSpeaking: boolean;
  onCloseTranslation: () => void;
  onRetryTranslate: (id: string, text: string) => void;
  onToggleTranslationExpanded: () => void;
  onOpenMiniapp?: (miniapp: any) => void;
  onCtaPress?: (cta: ChatCta) => void;
};

function chatMessageRowPropsEqual(prev: ChatMessageRowProps, next: ChatMessageRowProps): boolean {
  return (
    prev.message === next.message &&
    prev.topGap === next.topGap &&
    prev.dayLabel === next.dayLabel &&
    prev.isFirst === next.isFirst &&
    prev.isTranslating === next.isTranslating &&
    prev.translationResult === next.translationResult &&
    prev.translationExpanded === next.translationExpanded &&
    prev.colors === next.colors &&
    prev.typography === next.typography &&
    prev.t === next.t &&
    prev.isSpeaking === next.isSpeaking
  );
}

const ChatMessageRow = React.memo(function ChatMessageRow({
  message: m,
  topGap,
  dayLabel,
  isFirst,
  isTranslating,
  translationResult,
  translationExpanded,
  colors,
  typography,
  t,
  onOpenMessageMenu,
  onCopyText,
  onSpeak,
  isSpeaking,
  onCloseTranslation,
  onRetryTranslate,
  onToggleTranslationExpanded,
  onOpenMiniapp,
  onCtaPress,
}: ChatMessageRowProps) {
  const isUser = m.role === "user";
  const hasAttachments = (m.attachments?.length ?? 0) > 0;
  const hasText = !!m.text.trim();
  const dayDivider = dayLabel ? (
    <View
      key={`day-${m.id}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        marginTop: isFirst ? 0 : spacing.lg,
        marginBottom: spacing.sm,
        gap: spacing.sm,
      }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
      <Text style={[typography.bodyXs, { color: colors.muted }]}>
        {dayLabel}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
    </View>
  ) : null;

  if (isUser) {
    return (
      <React.Fragment>
        {dayDivider}
        <View
          style={{
            alignSelf: "flex-end",
            maxWidth: "85%",
            marginTop: dayDivider ? 0 : topGap,
          }}
        >
          {hasAttachments ? (
            <Pressable
              onLongPress={() => onOpenMessageMenu(m.id, m.text, m.role, m.streaming)}
              delayLongPress={350}
              accessibilityHint={t("chat.a11yLongPress")}
            >
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                gap: spacing.xs,
                marginBottom: 4,
                flexGrow: 1,
                justifyContent: "flex-end",
              }}
            >
              {(m.attachments ?? []).map((att) => {
                const { dot, bg } =
                  att.kind === "pdf" || att.kind === "document"
                    ? { dot: colors.compute, bg: colors.computeSoft }
                    : { dot: colors.accent, bg: colors.accentSoft };
                const thumbUri =
                  att.kind === "image" && att.uri
                    ? att.uri
                    : att.kind === "pdf" && att.pages?.[0]
                      ? att.pages[0]
                      : undefined;
                return (
                  <View
                    key={att.id}
                    accessibilityLabel={att.name}
                    style={{
                      width: 56,
                      height: 72,
                      borderRadius: 12,
                      overflow: "hidden",
                      backgroundColor: bg,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {thumbUri ? (
                      <Image
                        source={{ uri: thumbUri }}
                        style={{ width: 56, height: 72 }}
                        resizeMode="cover"
                        accessible={false}
                        importantForAccessibility="no"
                      />
                    ) : att.kind === "image" ? (
                      <ImageIcon size={22} color={dot} />
                    ) : att.kind === "document" ? (
                      <BookOpen size={22} color={dot} />
                    ) : (
                      <FileText size={22} color={dot} />
                    )}
                  </View>
                );
              })}
            </ScrollView>
            </Pressable>
          ) : null}
          {hasText ? (
          <Pressable
            onLongPress={() => onOpenMessageMenu(m.id, m.text, m.role, m.streaming)}
            delayLongPress={350}
            accessibilityLabel={m.text.length > 200 ? m.text.slice(0, 200) : m.text}
            accessibilityHint={t("chat.a11yLongPress")}
            style={{
              backgroundColor: colors.accentSoft,
              borderRadius: radius.lg,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
            }}
          >
            <Text style={[typography.bodyLg, { color: colors.ink }]}>{m.text}</Text>
          </Pressable>
          ) : null}
          {!m.streaming && (hasText || hasAttachments) ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                flexWrap: "wrap",
                justifyContent: "flex-end",
                marginTop: spacing.xs,
              }}
            >
              {hasText ? (
              <MessageActionChip
                icon={<BrandIcon name="copy" size={18} />}
                label={t("common.copy")}
                onPress={() => onCopyText(m.text)}
                colors={colors}
              />
              ) : null}
              <MessageActionChip
                icon={<MoreHorizontal size={14} color={colors.muted} />}
                label={t("chat.more")}
                onPress={() => onOpenMessageMenu(m.id, m.text, m.role, m.streaming)}
                colors={colors}
              />
            </View>
          ) : null}
          {m.edited ? (
            <Text
              style={[
                typography.bodyXs,
                { color: colors.muted, marginTop: spacing.xs, alignSelf: "flex-end" },
              ]}
            >
              {t("chat.edit")}
            </Text>
          ) : null}

          {isTranslating ? (
            <View
              style={{
                marginTop: spacing.xs,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
                alignSelf: "flex-end",
              }}
            >
              <ActivityIndicator size="small" color={colors.muted} />
              <Text style={[typography.bodyXs, { color: colors.muted }]}>
                {t("translate.translating")}
              </Text>
            </View>
          ) : null}

          {translationResult ? (
            <TranslationBlock
              result={translationResult}
              expanded={translationExpanded}
              colors={colors}
              t={t}
              onToggle={onToggleTranslationExpanded}
              onCopy={() => {
                if (translationResult.text) onCopyText(translationResult.text);
              }}
              onClose={onCloseTranslation}
              onRetry={() => void onRetryTranslate(m.id, m.text)}
            />
          ) : null}
        </View>
      </React.Fragment>
    );
  }

  const showCursor = !!m.streaming && !!m.text;
  const showThinking = !!m.statusLabel || !!(m.statusHistory && m.statusHistory.length > 0);

  const segments: MessageSegment[] =
    !m.streaming && m.text
      ? parseMessageSegments(m.text)
      : [{ type: "text", content: m.text }];

  return (
    <React.Fragment>
      {dayDivider}
      <View style={{ gap: 4, marginTop: dayDivider ? 0 : topGap }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              backgroundColor: colors.compute,
            }}
          />
          <Text style={[typography.label, { color: colors.muted }]}>Kalsa</Text>
        </View>

        {showThinking ? (
          <ThinkingBlock
            statusLabel={m.statusLabel}
            statusHistory={m.statusHistory}
            colors={colors}
            t={t}
          />
        ) : null}

        {m.text.trim() || showCursor ? (
          <Pressable
            onLongPress={() => onOpenMessageMenu(m.id, m.text, m.role, m.streaming)}
            delayLongPress={350}
            accessibilityLabel={m.text.length > 200 ? m.text.slice(0, 200) : m.text}
            accessibilityHint={t("chat.a11yLongPress")}
          >
            {segments.map((seg, segIdx) => {
              if (seg.type === "code") {
                return (
                  <CodeFenceBlock
                    key={segIdx}
                    lang={seg.lang}
                    content={seg.content}
                    colors={colors}
                    t={t}
                    onCopyText={onCopyText}
                  />
                );
              }
              // Streaming perf: parseMarkdownBlocks on the full growing text
              // every coalescer flush is O(n²) total. While streaming the
              // contract is already a single plain-text segment (fences and
              // blocks are not complete), so render raw text directly and let
              // the markdown pass run once at finalize. Mid-stream this shows
              // raw text (fences/headings are incomplete anyway); the final
              // markdown pass lands at finalize.
              if (m.streaming) {
                return (
                  <Text
                    key={segIdx}
                    style={[
                      typography.chatBody,
                      { color: colors.quiet ?? colors.ink },
                    ]}
                    onLongPress={() => onOpenMessageMenu(m.id, m.text, m.role, true)}
                  >
                    {seg.content}
                    {segIdx === segments.length - 1 && showCursor ? (
                      <StreamCaret
                        color={colors.accent}
                        lineHeight={
                          typeof typography.chatBody.lineHeight === "number"
                            ? typography.chatBody.lineHeight
                            : undefined
                        }
                      />
                    ) : null}
                  </Text>
                );
              }
              return (
                <MarkdownText
                  key={segIdx}
                  text={seg.content}
                  showCursor={segIdx === segments.length - 1 && showCursor}
                  onLongPress={() => onOpenMessageMenu(m.id, m.text, m.role, m.streaming)}
                  sources={m.sources}
                />
              );
            })}
          </Pressable>
        ) : null}

        {!m.streaming && m.text.trim() ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              flexWrap: "wrap",
              marginTop: spacing.xs,
            }}
          >
            <MessageActionChip
              icon={<BrandIcon name="copy" size={18} />}
              label={t("common.copy")}
              onPress={() => onCopyText(m.text)}
              colors={colors}
            />
            {onSpeak ? (
              <MessageActionChip
                icon={
                  <Volume2
                    size={14}
                    color={isSpeaking ? colors.accent : colors.muted}
                  />
                }
                label={
                  isSpeaking ? t("voice.stopReading") : t("voice.readAloud")
                }
                onPress={() => onSpeak(m.id, m.text)}
                colors={colors}
                active={isSpeaking}
              />
            ) : null}
            <MessageActionChip
              icon={<MoreHorizontal size={14} color={colors.muted} />}
              label={t("chat.more")}
              onPress={() => onOpenMessageMenu(m.id, m.text, m.role, m.streaming)}
              colors={colors}
            />
          </View>
        ) : null}

        {m.interrupted ? (
          <Text style={[typography.bodyXs, { color: colors.muted, marginTop: spacing.xs }]}>
            {t("chat.interrupted")}
          </Text>
        ) : null}

        {isTranslating ? (
          <View
            style={{
              marginTop: spacing.xs,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
            }}
          >
            <ActivityIndicator size="small" color={colors.muted} />
            <Text style={[typography.bodyXs, { color: colors.muted }]}>
              {t("translate.translating")}
            </Text>
          </View>
        ) : null}

        {translationResult ? (
          <TranslationBlock
            result={translationResult}
            expanded={translationExpanded}
            colors={colors}
            t={t}
            onToggle={onToggleTranslationExpanded}
            onCopy={() => {
              if (translationResult.text) onCopyText(translationResult.text);
            }}
            onClose={onCloseTranslation}
            onRetry={() => void onRetryTranslate(m.id, m.text)}
          />
        ) : null}

        {m.miniapp ? (
          <MiniappCard
            miniapp={m.miniapp}
            colors={colors}
            onOpen={onOpenMiniapp ? () => onOpenMiniapp(m.miniapp!) : undefined}
          />
        ) : null}

        {m.sources && m.sources.length > 0 ? (
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.xs, paddingTop: spacing.xs }}
          >
            {m.sources.map((s, sIdx) => {
              const rawUrl = typeof s.url === "string" ? s.url.trim() : "";
              const safe = rawUrl.length > 0 && isSafeHttpUrl(rawUrl);
              const providerColor = getProviderColor(s.provider, colors);
              const hostMatch = safe
                ? /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\/([^/?#]+)/.exec(rawUrl)
                : null;
              const a11yHost =
                hostMatch?.[1] || (s.title && s.title.trim()) || String(sIdx + 1);
              return (
                <Pressable
                  key={s.doi || s.title || String(sIdx)}
                  disabled={!safe}
                  onPress={
                    safe
                      ? () => {
                          void Linking.openURL(rawUrl).catch(() => undefined);
                        }
                      : undefined
                  }
                  accessibilityLabel={`Source ${sIdx + 1}, ${a11yHost}`}
                  accessibilityRole={safe ? "link" : "text"}
                  style={({ pressed }) => ({
                    backgroundColor: colors.panelSolid,
                    borderRadius: radius.sm,
                    borderWidth: 1,
                    borderColor: colors.line,
                    padding: spacing.sm,
                    maxWidth: 220,
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: spacing.xs,
                    opacity: safe ? (pressed ? 0.7 : 1) : 0.55,
                  })}
                >
                  <Text
                    style={[
                      typography.bodyXs,
                      {
                        color: providerColor,
                        backgroundColor: colors.accentSoft,
                        borderRadius: radius.xs,
                        paddingHorizontal: spacing.xxs,
                        overflow: "hidden",
                      },
                    ]}
                  >
                    {sIdx + 1}
                  </Text>
                  <View style={{ flexShrink: 1, minWidth: 0 }}>
                    {s.provider ? (
                      <Text
                        style={[typography.bodyXs, { color: providerColor }]}
                        numberOfLines={1}
                      >
                        {t("errors.sourceVia", {
                          provider:
                            s.provider === "exa-mcp"
                              ? t("settings.providerExaMcp")
                              : s.provider === "exa"
                                ? t("settings.providerExa")
                                : s.provider === "brave"
                                  ? t("settings.providerBrave")
                                  : s.provider === "tavily"
                                    ? t("settings.providerTavily")
                                    : s.provider === "fetch"
                                      ? t("settings.providerFetch")
                                      : s.provider,
                        })}
                      </Text>
                    ) : null}
                    <Text
                      style={[typography.label, { color: colors.ink }]}
                      numberOfLines={2}
                    >
                      {s.title}
                      {s.authors ? ` — ${s.authors}` : ""}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {m.ctas && m.ctas.length > 0 ? (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: spacing.xs,
              paddingTop: spacing.xs,
            }}
          >
            {m.ctas.map((cta, ctaIdx) => (
              <Pressable
                key={cta.id || `${cta.kind}-${ctaIdx}`}
                onPress={() => onCtaPress?.(cta)}
                accessibilityRole="button"
                accessibilityLabel={cta.label}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  backgroundColor:
                    cta.kind === "run_monitor_recovery" ? colors.accentSoft : colors.computeSoft,
                  borderColor:
                    cta.kind === "run_monitor_recovery" ? colors.accent : colors.compute,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  opacity: pressed ? 0.72 : 1,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 5,
                })}
              >
                <ChevronRight
                  size={12}
                  color={
                    cta.kind === "run_monitor_recovery" ? colors.accent : colors.compute
                  }
                />
                <Text
                  style={[
                    typography.bodyXs,
                    {
                      color:
                        cta.kind === "run_monitor_recovery" ? colors.accent : colors.compute,
                      fontFamily: fontFamilies.bodySemi,
                    },
                  ]}
                >
                  {cta.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {m.images && m.images.length > 0 ? (
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.sm }}
          >
            {m.images.map((img) => {
              const safe = isSafeHttpUrl(img.url);
              return (
                <Pressable
                  key={img.id}
                  disabled={!safe}
                  onPress={
                    safe
                      ? () => Linking.openURL(img.url).catch(() => undefined)
                      : undefined
                  }
                  style={{
                    width: 140,
                    borderRadius: radius.md,
                    overflow: "hidden",
                    borderWidth: 1,
                    borderColor: colors.line,
                    backgroundColor: colors.panel,
                    opacity: safe ? 1 : 0.55,
                  }}
                >
                  <Image
                    source={{ uri: img.url }}
                    style={{ width: 140, height: 100 }}
                    resizeMode="cover"
                  />
                  <View
                    style={{
                      padding: 6,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 4,
                    }}
                  >
                    <Text
                      style={[typography.bodyXs, { color: colors.muted, flex: 1 }]}
                      numberOfLines={1}
                    >
                      {img.label}
                    </Text>
                    {safe ? <Download size={12} color={colors.compute} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {m.downloads && m.downloads.length > 0 ? (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: spacing.xs,
              paddingTop: spacing.xs,
            }}
          >
            {m.downloads.map((dl) => {
              const safe = isSafeHttpUrl(dl.url);
              return (
                <Pressable
                  key={dl.id}
                  disabled={!safe}
                  onPress={
                    safe
                      ? () => Linking.openURL(dl.url).catch(() => undefined)
                      : undefined
                  }
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    backgroundColor: colors.computeSoft,
                    borderRadius: radius.pill,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    opacity: safe ? (pressed ? 0.7 : 1) : 0.55,
                  })}
                >
                  {safe ? <Download size={11} color={colors.compute} /> : null}
                  <Text style={[typography.bodyXs, { color: colors.compute }]}>
                    {dl.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    </React.Fragment>
  );
}, chatMessageRowPropsEqual);

/** Volatile translation result card under a message (not part of history). */
function TranslationBlock({
  result,
  expanded,
  colors,
  t,
  onToggle,
  onCopy,
  onClose,
  onRetry,
}: {
  result: { id: string; text: string; lang: Locale; error?: boolean; truncated?: boolean };
  expanded: boolean;
  colors: any;
  t: TranslateFn;
  onToggle: () => void;
  onCopy: () => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  // Badge from result.lang (captured at translate start), not the live locale.
  const langBadge = result.lang === "it" ? "IT" : "EN";
  const [copiedLocal, setCopiedLocal] = useState(false);
  const copiedLocalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the flash timer on unmount (no setState on a dead component).
  useEffect(
    () => () => {
      if (copiedLocalTimer.current) clearTimeout(copiedLocalTimer.current);
    },
    [],
  );

  const handleCopy = () => {
    onCopy();
    setCopiedLocal(true);
    if (copiedLocalTimer.current) clearTimeout(copiedLocalTimer.current);
    copiedLocalTimer.current = setTimeout(() => setCopiedLocal(false), 1500);
  };

  return (
    <View
      style={{
        marginTop: spacing.xs,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.panel,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        }}
      >
        <Pressable
          onPress={onToggle}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs }}
          accessibilityRole="button"
        >
          <Languages size={14} color={colors.muted} />
          <Text style={[typography.bodyXs, { color: colors.muted, flex: 1 }]}>
            {t("translate.label", { lang: langBadge })}
          </Text>
          <View style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}>
            <ChevronDown size={14} color={colors.muted} />
          </View>
        </Pressable>
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel={t("common.close")}>
          <X size={14} color={colors.muted} />
        </Pressable>
      </View>

      {expanded ? (
        <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, gap: spacing.xs }}>
          {result.error ? (
            <>
              <Text style={[typography.bodySm, { color: colors.muted }]}>{t("translate.error")}</Text>
              <Pressable onPress={onRetry} hitSlop={8} style={{ alignSelf: "flex-start" }}>
                <Text style={[typography.bodyXs, { color: colors.compute }]}>{t("translate.retry")}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[typography.bodySm, { color: colors.ink }]}>{result.text}</Text>
              {result.truncated ? (
                <Text style={[typography.bodyXs, { color: colors.muted }]}>
                  {t("translate.truncated")}
                </Text>
              ) : null}
              <Pressable
                onPress={handleCopy}
                hitSlop={8}
                style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4 }}
                accessibilityLabel={copiedLocal ? t("common.copied") : t("common.copy")}
              >
                <BrandIcon name="copy" size={16} />
                <Text style={[typography.bodyXs, { color: colors.compute }]}>
                  {copiedLocal ? t("common.copied") : t("common.copy")}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

// ── Feature 2: Miniapp card component ─────────────────────────────────────
function MiniappCard({
  miniapp,
  colors,
  onOpen,
}: {
  miniapp: { kind: string; title: string; blocks: any[] };
  colors: any;
  onOpen?: () => void;
}) {
  const { t } = useLocale();
  const IconComp = miniappIcon(miniapp.kind);
  return (
    <View
      style={{
        backgroundColor: colors.computeSoft,
        borderColor: colors.compute,
        borderWidth: 0.5,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginTop: 6,
        gap: spacing.xs,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <IconComp size={16} color={colors.compute} />
        <Text style={[typography.bodySm, { color: colors.ink, flex: 1, fontFamily: fontFamilies.bodySemi }]}>
          {miniapp.title}
        </Text>
        <View
          style={{
            backgroundColor: colors.compute,
            borderRadius: radius.pill,
            paddingHorizontal: 6,
            paddingVertical: 2,
          }}
        >
          <Text style={[typography.bodyXs, { color: colors.primaryText, fontFamily: fontFamilies.bodySemi }]}>
            {t("chat.interactive")}
          </Text>
        </View>
      </View>
      <Text style={[typography.bodyXs, { color: colors.muted }]}>
        {t("chat.miniappTap")}
      </Text>
      <Pressable
        onPress={onOpen}
        style={{
          alignSelf: "flex-end",
          opacity: onOpen ? 1 : 0.5,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Text style={[typography.bodySm, { color: colors.compute }]}>{t("chat.openTool")}</Text>
        <ChevronRight size={14} color={colors.compute} />
      </Pressable>
    </View>
  );
}
