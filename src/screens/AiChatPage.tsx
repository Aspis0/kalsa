import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BarChart2,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  FileText,
  Globe,
  Image as ImageIcon,
  Languages,
  Menu,
  Mic,
  Plus,
  Send,
  Sparkles,
  Square,
  SquarePen,
  Volume2,
  X,
} from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";
import { PdfToImages } from "../components/PdfToImages";
import { MarkdownText } from "../chat/MarkdownText";
import { isSafeHttpUrl } from "../util/url";
import { isBenchCommand, tryHandleBenchCommand } from "../bench/benchConfig";
import { normalizeMiniapp, parseMiniappFromText } from "../domain/askAssistant";
import { classifyChatContent, type ContentFilterReason } from "../domain/contentFilter";
import { translateText } from "../engine/LlamaService";
import { createStreamCoalescer } from "../engine/streamCoalescer";
import { getStrings, useLocale, type Locale, type TranslateFn } from "../i18n";
import { useLabTheme } from "../ui/labTheme";
import { spacing, radius } from "../theme/tokens";
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
import { shouldShowLongChatNudge } from "../chat/longChatEstimate";

const HISTORY_KEY = "kalsa.messages.v1";

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
export type LocalAttachment = {
  id: string;
  kind: "image" | "pdf";
  name: string;
  uri: string;
  pages?: string[];
  pageCount?: number;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  /** Terminal marker: generation was interrupted mid-stream (partial text kept). */
  interrupted?: boolean;
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
};

type VoiceUiState = "idle" | "listening" | "transcribing";

type Props = {
  onSendStream?: (
    text: string,
    callbacks: StreamCallbacks,
    signal: AbortSignal,
    attachments?: LocalAttachment[],
    history?: unknown[],
  ) => Promise<void>;
  selectedRun?: AiChatSelectedRun | null;
  prefillText?: string | null;
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
   * Resolved n_ctx for the loaded (or selected) model — from AppShell's
   * resolveContextProfile. Used by the long-chat nudge as its token ceiling.
   * Omitted → longChatEstimate.LONG_CHAT_DEFAULT_N_CTX.
   */
  engineCtx?: number;
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

const MONO_FONT = Platform.OS === "ios" ? "Menlo" : "monospace";

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
      }));
      if (message.streaming && allowStreamingPartial) {
        return {
          ...message,
          streaming: undefined,
          statusLabel: undefined,
          statusHistory: undefined,
          interrupted: true,
          attachments,
        };
      }
      return {
        ...message,
        streaming: undefined,
        statusHistory: undefined,
        attachments,
      };
    });
}

/** Immediate history write (AppState / unmount / throttle) — fire-and-forget. */
function persistMessagesNow(
  messagesSnapshot: Message[],
  opts?: { allowStreamingPartial?: boolean },
): void {
  if (!messagesSnapshot.length) return;
  const clean = buildPersistableMessages(messagesSnapshot, opts);
  if (!clean.length) return;
  AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(clean)).catch(() => undefined);
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
    // Gli stati transitori non vengono mai ripristinati: niente spinner eterni.
    if (typeof record.statusLabel === "string") message.statusLabel = record.statusLabel.slice(0, 200);
    if (Array.isArray(record.statusHistory) && record.statusHistory.length <= MAX_ITEMS) {
      message.statusHistory = record.statusHistory
        .filter((s): s is string => typeof s === "string")
        .slice(0, MAX_ITEMS);
    }
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
          kind: a.kind === "pdf" || a.kind === "image" ? a.kind : "image",
          name: typeof a.name === "string" ? a.name.slice(0, 300) : strings.common.attachment,
          // Le URI sono cache temporanea: non persistite (non disponibili al reload).
          uri: "",
          ...(typeof a.pageCount === "number" && a.pageCount > 0
            ? { pageCount: Math.min(a.pageCount, 10) }
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
  onClearSelectedRun,
  userName,
  onOpenMiniapp,
  onMenuPress,
  onCtaPress,
  voiceReady = false,
  ttsEnabled = true,
  engineCtx,
}: Props) {
  const { colors } = useLabTheme<any>();
  // Shadows the module-level `typography` import for this component only
  // (AttachSheetRow/TranslationBlock/MiniappCard below keep the static one —
  // they always remount together with AiChatPage on a font-scale change, see
  // AppShell's key={fontScaleId}). Reading it from context here makes the
  // chat text reactive without depending on that remount.
  const typography = useTypography();
  const { t, locale } = useLocale();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  /** One-shot long-chat nudge for this conversation; reset on clearChat. */
  const [longChatNudgeShown, setLongChatNudgeShown] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [voiceUi, setVoiceUi] = useState<VoiceUiState>("idle");
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
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
  const scrollViewRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const greeting = useMemo(() => greetingForHour(new Date().getHours(), t), [t]);
  const suggestions = useMemo(() => buildSuggestions(t), [t]);

  // ── Persistenza conversazione (Fase 1) ──────────────────────────────────
  const [historyLoaded, setHistoryLoaded] = useState(false);
  /** Always mirrors latest messages for flush paths (AppState / unmount / throttle). */
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  /** Throttle for mid-stream safety-net persists (at most once / 10s). */
  const lastPartialPersistAtRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(HISTORY_KEY)
      .then((raw) => {
        if (!mounted || !raw) return;
        try {
          const parsed = JSON.parse(raw);
          // locale is already resolved (App gates on localeReady).
          const valid = sanitizeHistoryMessages(parsed, locale);
          if (valid.length) setMessages(valid);
        } catch {
          // storico corrotto: ignora e riparti pulito
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setHistoryLoaded(true);
      });
    return () => {
      mounted = false;
    };
    // Load once on mount; locale is stable after LocaleProvider ready gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced normal path: skip while any turn is streaming so the 400ms quiet
  // gap cannot clobber a throttled/AppState partial (drops streaming messages).
  // Partials are owned exclusively by the 10s throttle + AppState/unmount flushes;
  // on completion (streaming cleared) this path resumes and overwrites the partial.
  useEffect(() => {
    if (!historyLoaded || !messages.length) return;
    if (messages.some((m) => m.streaming)) return;
    const timer = setTimeout(() => {
      // X4: attachments[].uri/pages stripped inside buildPersistableMessages.
      persistMessagesNow(messages);
    }, 400);
    return () => clearTimeout(timer);
  }, [historyLoaded, messages]);

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
    persistMessagesNow(messages, { allowStreamingPartial: true });
  }, [historyLoaded, messages]);

  // Feature 4: attach state (immagini/foto/PDF → vision)
  const [attachedItems, setAttachedItems] = useState<LocalAttachment[]>([]);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [pdfToRender, setPdfToRender] = useState<{ uri: string; name: string } | null>(null);
  const pdfPagesRef = useRef<string[]>([]);

  // In-app translation (volatile — NOT persisted with history).
  // One translation at a time: a new run replaces the previous result.
  const [messageMenu, setMessageMenu] = useState<{
    id: string;
    text: string;
    role: Message["role"];
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
  const longChat = useMemo(
    () => shouldShowLongChatNudge(messages, engineCtx),
    [messages, engineCtx],
  );

  useEffect(() => {
    if (longChat && !longChatNudgeShown) setLongChatNudgeShown(true);
  }, [longChat, longChatNudgeShown]);

  const showVoiceNote = useCallback((text: string) => {
    setVoiceNote(text);
    if (voiceNoteTimer.current) clearTimeout(voiceNoteTimer.current);
    voiceNoteTimer.current = setTimeout(() => setVoiceNote(null), 4000);
  }, []);

  /** Invalidate any in-flight voice run and hard-reset capture/TTS UI. */
  const invalidateVoice = useCallback(() => {
    voiceRunIdRef.current += 1;
    voiceBusyRef.current = false;
    voiceStopInFlightRef.current = false;
    setVoiceUi("idle");
    void cancelCapture();
    void TtsService.stop();
    setSpeakingId(null);
  }, []);

  /**
   * Stop capture (if any) and transcribe into draft.
   * Honours voiceRunId: late results after cancel/send/clearChat are dropped.
   */
  const stopAndTranscribe = useCallback(
    async (runId: number, fromLimit: boolean) => {
      // Serialize stop+transcribe (user tap vs 60s limit).
      if (voiceStopInFlightRef.current) return;
      voiceStopInFlightRef.current = true;
      voiceBusyRef.current = true;
      setVoiceUi("transcribing");
      if (fromLimit) {
        showVoiceNote(t("voice.limitReached"));
      }
      try {
        const pcm = await stopCapture();
        // Dropped if user cancelled / cleared / backgrounded mid-stop.
        if (voiceRunIdRef.current !== runId) return;
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
        if (voiceRunIdRef.current !== runId) return;
        if (error instanceof WhisperModelMissingError) {
          showVoiceNote(t("voice.modelMissing"));
        } else {
          showVoiceNote(t("voice.error"));
        }
      } finally {
        voiceStopInFlightRef.current = false;
        if (voiceRunIdRef.current === runId) {
          setVoiceUi("idle");
          voiceBusyRef.current = false;
        }
      }
    },
    [locale, showVoiceNote, t],
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
  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        const snap = messagesRef.current;
        if (
          snap.some(
            (m) => m.streaming && typeof m.text === "string" && m.text.trim().length > 0,
          )
        ) {
          persistMessagesNow(snap, { allowStreamingPartial: true });
        }
        if (isCapturing() || voiceBusyRef.current || voiceUi !== "idle") {
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
  }, [invalidateVoice, voiceUi]);

  /** Tap mic: start listening; tap again: stop + transcribe into draft. */
  const handleMicPress = useCallback(async () => {
    if (sending) return;

    // Stop path (user tap or already listening)
    if (isCapturing() || voiceUi === "listening") {
      const runId = voiceRunIdRef.current;
      await stopAndTranscribe(runId, false);
      return;
    }

    // Guard concurrent start (transcribing / busy).
    if (voiceBusyRef.current || voiceUi !== "idle") return;

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
      setVoiceUi("listening");
      setVoiceNote(null);
      // Keep voiceBusyRef true for the whole listening window so handleSend /
      // attach see a sync block even before React re-renders voiceUi.
      // Stop path (mic tap) does not gate on voiceBusyRef.
    } catch (error) {
      if (voiceRunIdRef.current !== runId) return;
      if (error instanceof CaptureBusyError) {
        showVoiceNote(t("voice.error"));
      } else {
        showVoiceNote(t("voice.error"));
      }
      setVoiceUi("idle");
      void cancelCapture();
      voiceBusyRef.current = false;
    } finally {
      // On failure / cancel mid-start, clear busy. On success (listening),
      // leave busy true until stopAndTranscribe finishes.
      if (voiceRunIdRef.current === runId && !isCapturing()) {
        voiceBusyRef.current = false;
      }
    }
  }, [
    locale,
    sending,
    showVoiceNote,
    stopAndTranscribe,
    t,
    voiceReady,
    voiceUi,
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
      setAttachSheetOpen(false);
    } catch {
      // picker annullato/errore: ignora
    }
  }, [showVoiceNote, t]);

  const addPdfAttachment = useCallback(async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
        multiple: false,
      });
      // Audit follow-up: same nav-away-during-picker race as addImageAttachment.
      if (!mountedRef.current) return;
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      setAttachSheetOpen(false);
      pdfPagesRef.current = [];
      setPdfToRender({ uri: asset.uri, name: asset.name ?? "document.pdf" });
    } catch {
      // ignora
    }
  }, []);

  const handlePdfPage = useCallback((_index: number, imageUri: string) => {
    pdfPagesRef.current.push(imageUri);
  }, []);

  const handlePdfDone = useCallback(() => {
    // Audit follow-up: the WebView bridge callback can fire after unmount
    // (nav away mid-conversion) — guard like the rest of the file's async
    // completions before touching state.
    if (!mountedRef.current) return;
    setPdfToRender((prev) => {
      if (prev) {
        const pages = pdfPagesRef.current;
        if (pages.length) {
          setAttachedItems((current) => {
            if (current.length >= MAX_IMAGE_ATTACHMENTS) {
              // U8: cap already reached — surface a notice instead of silently
              // discarding the converted PDF (composer would otherwise look
              // like the attach just did nothing).
              showVoiceNote(t("errors.attachmentLimitReached", { max: MAX_IMAGE_ATTACHMENTS }));
              return current;
            }
            return [
              ...current,
              { id: nextMsgId("pdf"), kind: "pdf", name: prev.name, uri: prev.uri, pages, pageCount: pages.length },
            ];
          });
        }
        pdfPagesRef.current = [];
      }
      return null;
    });
  }, [showVoiceNote, t]);

  const handlePdfError = useCallback(() => {
    // Audit follow-up: same WebView bridge as handlePdfDone (30s page timer
    // or async FS failure can fire fail() after nav-away) — guard before
    // touching state.
    if (!mountedRef.current) return;
    pdfPagesRef.current = [];
    setPdfToRender(null);
  }, []);

  // BLOCKER-1: unmount guard + abort ref
  const mountedRef = useRef(true);
  // BLOCKER-3: synchronous in-flight guard (React state updates are async)
  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * U1: generation token for a send turn (same idiom as voiceRunIdRef /
   * translateRunRef). clearChat() aborts + synchronously resets
   * sendingRef/setSending; without this token the aborted handleSend's own
   * finally block resets them again later, clobbering a newer turn's state.
   * Incremented at the top of handleSend and in clearChat; every place that
   * resets sending state must check the captured id still equals current.
   */
  const sendRunIdRef = useRef(0);

  useEffect(() => {
    return () => {
      // Flush partial from ref BEFORE abort: updateMessage no-ops once unmounted,
      // and finally may never rewrite state — ref still holds latest streamed text.
      persistMessagesNow(messagesRef.current, { allowStreamingPartial: true });
      mountedRef.current = false;
      abortRef.current?.abort();
      translateAbortRef.current?.abort();
      translationInFlightRef.current = false;
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
    if (prefillText) setDraft(prefillText);
  }, [prefillText]);

  // HIGH-2: only scroll when a new message is added, not on every streaming delta
  const messageCount = messages.length;
  useEffect(() => {
    if (messageCount > 0) {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }
  }, [messageCount]);

  // HIGH-1: targeted update — supports both patch object and function-form updater
  const updateMessage = useCallback(
    (id: string, patchOrFn: Partial<Message> | ((prev: Message) => Partial<Message>)) => {
      if (!mountedRef.current) return;
      setMessages(prev => {
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

  // HIGH-3: useCallback so onPress closures in suggestion cards don't hold stale `sending`
  const handleSend = useCallback(
    async (text: string, currentAttachments?: LocalAttachment[]) => {
      const trimmed = text.trim();
      // BLOCKER-3: synchronous ref check — not subject to React batching.
      // Also ignore send while a translation holds the engine (silent),
      // or while voice is listening/transcribing (voiceBusyRef is sync).
      // Audit follow-up: also belt-and-braces block while a PDF conversion
      // is in flight — the composer-side guards (onSubmitEditing, send
      // button) already block this, but handleSend can also be invoked
      // directly (suggestion cards) so it needs its own check too.
      if (
        !trimmed ||
        sendingRef.current ||
        translationInFlightRef.current ||
        voiceBusyRef.current ||
        !!pdfToRender ||
        !historyLoaded
      ) {
        return;
      }

      // U1: this turn's generation token. clearChat() may abort + reset
      // sending state while this async turn (bench / filter / stream) is
      // still in flight — every reset below must check this id first so a
      // stale turn can never clobber a newer one's sending state.
      const runId = ++sendRunIdRef.current;

      // Debug bench knobs via chat (adb input text; no root / no extra perms).
      // Does not call the model. History may keep the exchange for harness logs.
      // Accept /bench … and slash-free bench:… (Git Bash mangles leading / via adb).
      if (isBenchCommand(trimmed)) {
        voiceRunIdRef.current += 1;
        sendingRef.current = true;
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
        // Audit follow-up: clearChat() may fire during the await above —
        // gate the push on the same generation token used for the sending
        // reset, otherwise the stale bench Q&A reappears in the cleared chat.
        if (mountedRef.current && sendRunIdRef.current === runId) {
          setMessages((prev) => [
            ...prev,
            {
              id: userMsgId,
              role: "user",
              text: trimmed,
              createdAt: now,
            },
            {
              id: assistantId,
              role: "assistant",
              text: reply,
              streaming: false,
              createdAt: now + 1,
            },
          ]);
        }
        if (sendRunIdRef.current === runId) {
          sendingRef.current = false;
          if (mountedRef.current) setSending(false);
        }
        return;
      }

      // X2: pre-send content gate (src/domain/contentFilter.js). Blocking
      // categories (block / safety_block → shouldCallProvider === false)
      // never reach the model — append the localized decline and stop.
      // "warn" (mild profanity) and "allow" keep shouldCallProvider true and
      // fall through to the normal stream below.
      const classification = classifyChatContent(trimmed);
      if (!classification.shouldCallProvider) {
        voiceRunIdRef.current += 1;
        sendingRef.current = true;
        setSending(true);
        setDraft("");
        const gateAttachments = currentAttachments ?? [];
        const userMsgId = nextMsgId("u");
        const assistantId = nextMsgId("a");
        const now = Date.now();
        // Audit follow-up: gate for symmetry with the bench branch above —
        // currently synchronous (no await before this point) so inert today,
        // but future-proofs against this branch growing an await.
        if (mountedRef.current && sendRunIdRef.current === runId) {
          setMessages((prev) => [
            ...prev,
            {
              id: userMsgId,
              role: "user",
              text: trimmed,
              createdAt: now,
              attachments: gateAttachments.length > 0 ? gateAttachments : undefined,
            },
            {
              id: assistantId,
              role: "assistant",
              text: contentFilterMessage(classification.reason, t),
              streaming: false,
              createdAt: now + 1,
            },
          ]);
        }
        setAttachedItems([]);
        if (sendRunIdRef.current === runId) {
          sendingRef.current = false;
          if (mountedRef.current) setSending(false);
        }
        return;
      }

      // Invalidate any in-flight transcription so a late result cannot rewrite draft
      // after this send clears it.
      voiceRunIdRef.current += 1;
      sendingRef.current = true;
      setSending(true);

      // Snapshot attachments at send time
      const snapshotAttachments = currentAttachments ?? [];

      // BLOCKER-2: module counter, no Date.now() collision
      const userMsgId = nextMsgId("u");
      const assistantId = nextMsgId("a");

      const now = Date.now();
      if (mountedRef.current) {
        setMessages(prev => [
          ...prev,
          {
            id: userMsgId,
            role: "user",
            text: trimmed,
            createdAt: now,
            attachments: snapshotAttachments.length > 0 ? snapshotAttachments : undefined,
          },
          {
            id: assistantId,
            role: "assistant",
            text: "",
            streaming: true,
            statusLabel: t("chat.thinking"),
            statusHistory: [],
            createdAt: now,
          },
        ]);
      }
      setDraft("");
      // Clear attached items after send
      setAttachedItems([]);

      const controller = new AbortController();
      abortRef.current = controller;

      // Track whether any text has streamed — used to decide whether to remove empty placeholder on abort.
      // Set on onDelta (not on coalescer flush) so abort-before-first-flush still keeps the bubble.
      let anyTextStreamed = false;
      // ~30 fps UI flush: llama.rn is 5–15 tok/s; setState every token is wasteful.
      // Coalescer overwrites with the latest full text and flushes on a 33 ms cadence.
      const streamCoalescer = createStreamCoalescer((fullText) => {
        updateMessage(assistantId, { text: fullText, statusLabel: undefined });
      });

      try {
        if (onSendStream) {
          await onSendStream(
            trimmed,
            {
              onDelta: (_delta, full) => {
                anyTextStreamed = true;
                streamCoalescer.push(full);
              },
              // Feature 1: append to history AND set current label
              onStatus: (status) =>
                updateMessage(assistantId, prev => ({
                  statusLabel: status.label,
                  statusHistory: [...(prev.statusHistory ?? []), status.label],
                })),
              // BLOCKER-4: sources non chiudono lo streaming (il round tool
              // può continuare): aggiorna solo sources e statusLabel.
              onSources: (sources) =>
                updateMessage(assistantId, { sources, statusLabel: undefined }),
              onActions: (payload: any) => {
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
                  updateMessage(assistantId, prev => ({ ctas: [...(prev.ctas ?? []), ...ctas] }));
                }
              },
              onCta: (payload: ChatCta) => {
                if (!payload?.kind || !payload?.label) return;
                updateMessage(assistantId, prev => ({ ctas: [...(prev.ctas ?? []), payload] }));
              },
              // Miniapp callback: store only (do NOT end streaming).
              // streaming:false + final text extraction stay in the finally block
              // after await onSendStream. LlamaService currently never emits this;
              // cloud/unified clients may. Invalid payloads are ignored.
              onMiniapp: (miniapp) => {
                const normalized = normalizeMiniapp(miniapp);
                if (!normalized) return;
                updateMessage(assistantId, {
                  miniapp: normalized as Message["miniapp"],
                });
              },
              // RNA-seq job context: store result images/downloads on this message.
              onImages: (imgs, dls) =>
                updateMessage(assistantId, { images: imgs, downloads: dls }),
            },
            controller.signal,
            snapshotAttachments.length > 0 ? snapshotAttachments : undefined,
            messages,
          );
        } else {
          updateMessage(assistantId, {
            streaming: false,
            statusLabel: undefined,
            text: t("chat.backendNotWired"),
          });
        }
      } catch (err: any) {
        if (controller.signal.aborted) {
          // BLOCKER-2 (audit): aborted with no streamed content → remove empty placeholder
          if (!anyTextStreamed && mountedRef.current) {
            setMessages(prev => prev.filter(m => m.id !== assistantId));
          }
          // If partial text was streamed, the finally block finalizes it cleanly — no action needed
        } else if (mountedRef.current) {
          // BLOCKER-5: surface error as chat text instead of leaving zombie spinner
          // Flush any pending stream text first, then overwrite with the error message.
          streamCoalescer.finalize();
          const msg =
            err?.message?.includes("quota") || err?.message?.includes("limit")
              ? t("chat.queryLimit")
              : t("chat.serviceUnreachable");
          updateMessage(assistantId, { streaming: false, statusLabel: undefined, text: msg });
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
        if (controller.signal.aborted && !anyTextStreamed) {
          setMessages(prev => prev.filter(m => m.id !== assistantId));
        } else if (!controller.signal.aborted || anyTextStreamed) {
          // Extract miniapp JSON from the final assistant text (local models emit
          // schema miniapp_v1 in the prose / fenced block; cloud path may also
          // call onMiniapp directly).
          // Abort-with-partial → interrupted marker; successful completion clears it.
          // Gate on sendRunId so a clearChat mid-turn cannot resurrect wiped history
          // via messagesRef + persistMessagesNow (clearChat bumps sendRunId first).
          if (sendRunIdRef.current === runId) {
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
            const applyFinalize = (prev: Message[]): Message[] => {
              return prev.map((message) => {
                if (message.id !== assistantId) return message;
                const base: Message = {
                  ...message,
                  streaming: false,
                  statusLabel: undefined,
                  interrupted: wasInterrupted ? true : undefined,
                };
                if (base.miniapp) return base;
                const extracted = parseMiniappFromText(base.text || "");
                if (!extracted.miniapp) return base;
                return {
                  ...base,
                  text: extracted.text || base.text,
                  miniapp: extracted.miniapp as Message["miniapp"],
                };
              });
            };
            if (mountedRef.current) {
              // Stash the updater's return value so persist uses the same array
              // scheduled into React state (includes any queued final delta —
              // the updater receives the queue-applied prev).
              let finalized: Message[] | null = null;
              setMessages((prev) => {
                // clearChat bumped sendRunId: skip persist + ref write and keep
                // the cleared (or newer) prev — do not resurrect wiped history.
                if (sendRunIdRef.current !== runId) {
                  return prev;
                }
                finalized = applyFinalize(prev);
                // Keep ref in lockstep so AppState/unmount flushes cannot re-read
                // a pre-finalize streaming bubble during the pre-commit window.
                messagesRef.current = finalized;
                // Persist from the stashed snapshot. Eager path: runs sync
                // when setMessages is called. Deferred path (pending final
                // onDelta lanes): runs at render after React applies the
                // queued delta first — still the correct composed result.
                persistMessagesNow(finalized);
                return finalized;
              });
            } else if (sendRunIdRef.current === runId) {
              const next = applyFinalize(messagesRef.current);
              messagesRef.current = next;
              persistMessagesNow(next);
            }
          }
        }
        // U1: only reset the global sending indicators if this is still the
        // latest turn — clearChat() already reset them synchronously for a
        // newer turn, and this stale finally must not clobber it.
        if (sendRunIdRef.current === runId) {
          sendingRef.current = false;
          if (mountedRef.current) setSending(false);
        }
      }
    },
    [historyLoaded, messages, onSendStream, pdfToRender, t, updateMessage],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
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
    abortRef.current?.abort();
    // U1: invalidate any in-flight send turn so its later finally/bench/gate
    // reset cannot clobber the synchronous reset below.
    sendRunIdRef.current += 1;
    // Abort any in-flight translation (mutex job will stopCompletion).
    translateAbortRef.current?.abort();
    translateAbortRef.current = null;
    translationInFlightRef.current = false;
    // BLOCKER-1 (audit): reset sending state synchronously so composer unlocks immediately
    sendingRef.current = false;
    setSending(false);
    setMessages([]);
    // Sync ref immediately so AppState/unmount/throttle flushes cannot
    // re-persist pre-clear messages during the Fabric pre-commit window.
    messagesRef.current = [];
    setLongChatNudgeShown(false);
    setDraft("");
    // U9: reset any in-flight PDF conversion so a stale WebView/instance never
    // resurfaces attachments or a stuck "Reading pages…" composer state.
    setPdfToRender(null);
    pdfPagesRef.current = [];
    setAttachSheetOpen(false);
    // Audit follow-up: also drop already-queued attachments — otherwise a
    // stale chip (image/PDF picked before "New chat") rides into the fresh
    // conversation and gets sent with the next message.
    setAttachedItems([]);
    // Voice: invalidate transcription token, cancel capture, stop TTS, clear UI.
    voiceRunIdRef.current += 1;
    voiceBusyRef.current = false;
    voiceStopInFlightRef.current = false;
    setVoiceUi("idle");
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
    AsyncStorage.removeItem(HISTORY_KEY).catch(() => undefined);
  }, []);

  /** Open message action sheet (Copy + Translate + Read aloud). No-op while streaming / engine busy. */
  const openMessageMenu = useCallback(
    (id: string, text: string, role: Message["role"], streaming?: boolean) => {
      // Skip while this message streams, a chat turn is in flight, or a translate is running.
      // Refs ONLY (no state reads): ChatMessageRow's memo comparator ignores
      // callback identity, so a state-capturing closure would freeze inside
      // memoized rows (user rows created mid-send froze sending=true and their
      // long-press menu died — hostile-review finding 1a). sendingRef /
      // translationInFlightRef mirror the state synchronously and keep this
      // callback identity-stable, which is what makes the memo safe.
      if (
        streaming ||
        sendingRef.current ||
        translationInFlightRef.current ||
        !text.trim()
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
      setCopiedFlash(true);
      setTimeout(() => setCopiedFlash(false), 1500);
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
      !!draft.trim() &&
      !sending &&
      !translatingId &&
      historyLoaded &&
      !voiceBlocksComposer &&
      // Audit follow-up: block submission while a PDF conversion is in
      // flight — otherwise the late handlePdfDone queues the PDF chip into
      // the NEXT message instead of the one being sent now.
      !pdfToRender,
    [draft, historyLoaded, pdfToRender, sending, translatingId, voiceBlocksComposer],
  );

  // ── Attach chip color helper ────────────────────────────────────────────
  function chipColorForKind(kind: LocalAttachment["kind"]) {
    return kind === "pdf" ? { dot: colors.compute, bg: colors.computeSoft } : { dot: colors.accent, bg: colors.accentSoft };
  }

  return (
    // react-native-keyboard-controller KAV (not core RN). Edge-to-edge is
    // mandatory since SDK 53 / Android 15: soft-input adjustResize behaves like
    // adjustNothing, so core KeyboardAvoidingView under-compensates and leaves
    // the composer half-hidden under the IME (Android 16 field bug). This KAV
    // tracks IME WindowInsetsAnimation natively and works on both platforms
    // with behavior="padding". No keyboardVerticalOffset — the KAV is the
    // bottom-anchored last child of a full-height column.
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.shell }}
      behavior="padding"
    >

      {/* ── Nav bar ── */}
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
          {/* Left: hamburger → drawer (settings) */}
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

          {/* Center spacer — model name/status lives in AppShell header */}
          <View style={{ flex: 1 }} />

          {/* Right: export chat */}
          <Pressable
            onPress={exportChat}
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
            <Download size={18} color={colors.muted} />
          </Pressable>

          {/* Right: new chat */}
          <Pressable
            onPress={clearChat}
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
            <SquarePen size={18} color={colors.muted} />
          </Pressable>
        </View>
      </View>

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
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 160 }}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        // HIGH-2: scroll to bottom as content grows during streaming (animated:false avoids queue thrash)
        onContentSizeChange={() => {
          if (sending) scrollViewRef.current?.scrollToEnd({ animated: false });
        }}
      >
        {messages.length === 0 ? (
          <View style={{ paddingHorizontal: spacing.xs, paddingTop: spacing.xl }}>
            {/* Greeting */}
            <Text style={[typography.displayMd, { color: colors.ink, marginBottom: spacing.xs }]}>
              {greeting}
              {userName ? (
                <Text style={{ color: colors.accent }}>{`, ${userName}`}</Text>
              ) : null}
              {"."}
            </Text>
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
                  onPress={() => handleSend(s.text, attachedItems)}
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
          </View>
        ) : (
          messages.map((m, idx) => {
            const prev = idx > 0 ? messages[idx - 1] : null;
            const isTurnStart = !prev || prev.role !== m.role;
            const topGap = idx === 0 ? 0 : isTurnStart ? spacing.lg : spacing.md;
            const showDayDivider = !prev || !isSameDay(prev.createdAt, m.createdAt);
            const dayLabel = showDayDivider ? formatDayLabel(m.createdAt, t, locale) : null;
            return (
              <ChatMessageRow
                key={m.id}
                message={m}
                topGap={topGap}
                dayLabel={dayLabel}
                isFirst={idx === 0}
                isTranslating={translatingId === m.id}
                translationResult={translationResult?.id === m.id ? translationResult : null}
                translationExpanded={translationExpanded}
                colors={colors}
                t={t}
                onOpenMessageMenu={openMessageMenu}
                onCopyText={(text) => { void copyTextToClipboard(text); }}
                onCloseTranslation={closeTranslation}
                onRetryTranslate={runTranslate}
                onToggleTranslationExpanded={toggleTranslationExpanded}
                onOpenMiniapp={onOpenMiniapp}
                onCtaPress={onCtaPress}
              />
            );
          })
        )}
      </ScrollView>

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

        {attachedItems.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.xs, paddingBottom: 4 }}
          >
            {attachedItems.map(item => {
              const { dot, bg } = chipColorForKind(item.kind);
              return (
                <View
                  key={item.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    backgroundColor: bg,
                    borderRadius: radius.pill,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                  }}
                >
                  {item.kind === "pdf" ? (
                    <FileText size={11} color={dot} />
                  ) : (
                    <ImageIcon size={11} color={dot} />
                  )}
                  <Text numberOfLines={1} style={[typography.bodyXs, { color: colors.ink, maxWidth: 140 }]}>
                    {item.name}
                  </Text>
                  <Pressable
                    onPress={() =>
                      setAttachedItems(prev => prev.filter(a => a.id !== item.id))
                    }
                    hitSlop={8}
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
                handleSend(draft, attachedItems);
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

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: spacing.xs,
            }}
          >
            {/* Left: attach and other action icons */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              {/* Attach: foto/PDF per la vision — blocked during voice capture/transcribe */}
              {/* U2: also blocked while a PDF conversion is in flight — reusing the
                  attach sheet mid-conversion is what causes the stuck-composer bug. */}
              <Pressable
                onPress={() => {
                  if (voiceBusyRef.current || voiceUi !== "idle" || pdfToRender) return;
                  setAttachSheetOpen(true);
                }}
                disabled={sending || voiceBlocksComposer || !!pdfToRender}
                accessibilityLabel={t("chat.a11yAttach")}
                style={({ pressed }) => ({
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: colors.panel,
                  borderWidth: 1,
                  borderColor: colors.line,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity:
                    sending || voiceBlocksComposer || pdfToRender ? 0.45 : pressed ? 0.7 : 1,
                })}
              >
                <Plus color={colors.muted} size={18} />
              </Pressable>
            </View>

            {/* Right: mic + send/stop */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              {/* Mic: tap to talk → stop → draft (on-device whisper).
                  Disabled while sending/transcribing; stays pressable when model
                  missing so the user still gets the download hint. Listening stays
                  enabled so the user can stop. */}
              <Pressable
                onPress={() => {
                  void handleMicPress();
                }}
                disabled={sending || voiceUi === "transcribing"}
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
                  backgroundColor:
                    voiceUi === "listening"
                      ? (colors.bad ?? "#c0392b")
                      : colors.panel,
                  borderWidth: 1,
                  borderColor: voiceUi === "listening" ? (colors.bad ?? "#c0392b") : colors.line,
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
                <Mic
                  color={
                    voiceUi === "listening" ? colors.primaryText : colors.muted
                  }
                  size={18}
                />
              </Pressable>

              {/* Stop button during streaming; Send when ready; dimmed when empty+idle */}
              {sending ? (
                <Pressable
                  onPress={handleStop}
                  accessibilityLabel={t("chat.a11yStop")}
                  style={({ pressed }) => ({
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: colors.panel,
                    borderWidth: 1,
                    borderColor: colors.line,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Square size={16} color={colors.ink} />
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => {
                    if (pdfToRender) return;
                    handleSend(draft, attachedItems);
                  }}
                  disabled={!canSend}
                  accessibilityLabel={t("chat.a11ySend")}
                  accessibilityElementsHidden={!canSend}
                  importantForAccessibility={canSend ? "yes" : "no-hide-descendants"}
                  style={({ pressed }) => ({
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: colors.accent,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: canSend ? (pressed ? 0.85 : 1) : 0,
                  })}
                >
                  <Send color={colors.primaryText} size={18} />
                </Pressable>
              )}
            </View>
          </View>
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
                <AttachSheetRow
                  icon={<Copy size={18} color={colors.ink} />}
                  label={copiedFlash ? t("common.copied") : t("common.copy")}
                  onPress={() => {
                    // Keep menu open ~400ms with "Copied!" so feedback is visible.
                    void (async () => {
                      await copyTextToClipboard(messageMenu.text);
                      setTimeout(() => setMessageMenu(null), 400);
                    })();
                  }}
                  colors={colors}
                />
                <AttachSheetRow
                  icon={<Languages size={18} color={colors.ink} />}
                  label={t("translate.title")}
                  onPress={() => {
                    void runTranslate(messageMenu.id, messageMenu.text);
                  }}
                  colors={colors}
                />
                {messageMenu.role === "assistant" ? (
                  <AttachSheetRow
                    icon={
                      <Volume2
                        size={18}
                        color={speakingId === messageMenu.id ? colors.accent : colors.ink}
                      />
                    }
                    label={
                      speakingId === messageMenu.id
                        ? t("voice.stopReading")
                        : t("voice.readAloud")
                    }
                    onPress={() => {
                      void handleReadAloud(messageMenu.id, messageMenu.text);
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
                  label={t("chat.pdfDocument")}
                  onPress={() => void addPdfAttachment()}
                  colors={colors}
                />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </KeyboardAvoidingView>
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


// ── Memoized chat row: history rows skip re-render during streaming flushes ──
// updateMessage only replaces the streaming message's object identity; other
// Message refs stay stable. Custom compare ignores callback identity so parent
// re-renders (new inline arrows) do not force history rows to repaint.
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
  t: TranslateFn;
  onOpenMessageMenu: (
    id: string,
    text: string,
    role: Message["role"],
    streaming?: boolean,
  ) => void;
  onCopyText: (text: string) => void;
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
    prev.t === next.t
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
  t,
  onOpenMessageMenu,
  onCopyText,
  onCloseTranslation,
  onRetryTranslate,
  onToggleTranslationExpanded,
  onOpenMiniapp,
  onCtaPress,
}: ChatMessageRowProps) {
  const isUser = m.role === "user";
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
          {m.attachments && m.attachments.length > 0 ? (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: spacing.xs,
                marginBottom: 4,
                justifyContent: "flex-end",
              }}
            >
              {m.attachments.map((att) => {
                const { dot, bg } =
                  att.kind === "pdf"
                    ? { dot: colors.compute, bg: colors.computeSoft }
                    : { dot: colors.accent, bg: colors.accentSoft };
                return (
                  <View
                    key={att.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      backgroundColor: bg,
                      borderRadius: radius.pill,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                    }}
                  >
                    {att.kind === "pdf" ? (
                      <FileText size={11} color={dot} />
                    ) : (
                      <ImageIcon size={11} color={dot} />
                    )}
                    <Text style={[typography.bodyXs, { color: colors.ink }]} numberOfLines={1}>
                      {att.name}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
          <Pressable
            onLongPress={() => onOpenMessageMenu(m.id, m.text, m.role, m.streaming)}
            accessibilityLabel={t("chat.a11yLongPress")}
            style={{
              backgroundColor: colors.accentSoft,
              borderRadius: radius.lg,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
            }}
          >
            <Text style={[typography.chatBody, { color: colors.ink }]}>{m.text}</Text>
          </Pressable>

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

  const showToolStrip = !!m.statusLabel && !m.text;
  const showCursor = !!m.streaming && !!m.text;

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

        {m.statusHistory && m.statusHistory.length > 0
          ? m.statusHistory.map((label, i) => (
              <View
                key={i}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  paddingVertical: 1,
                }}
              >
                <Check size={12} color={colors.muted} />
                <Text
                  style={[
                    typography.bodyXs,
                    { color: colors.muted, fontFamily: MONO_FONT },
                  ]}
                >
                  {label}
                </Text>
              </View>
            ))
          : null}

        {showToolStrip ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              paddingVertical: 2,
            }}
          >
            <ActivityIndicator size="small" color={colors.muted} />
            <Text style={[typography.bodyXs, { color: colors.muted }]}>{m.statusLabel}</Text>
          </View>
        ) : m.text || showCursor ? (
          <Pressable
            onLongPress={() => onOpenMessageMenu(m.id, m.text, m.role, m.streaming)}
            accessibilityLabel={t("chat.a11yLongPress")}
          >
            {segments.map((seg, segIdx) => {
              if (seg.type === "code") {
                return (
                  <View
                    key={segIdx}
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
                      <Text style={[typography.bodyXs, { color: colors.muted }]}>
                        {seg.lang}
                      </Text>
                      <Pressable
                        onPress={() => {
                          void Share.share({ message: seg.content }).catch(() => undefined);
                        }}
                        hitSlop={8}
                        accessibilityLabel={t("common.share")}
                      >
                        <Text style={[typography.bodyXs, { color: colors.accent }]}>
                          {t("common.share")}
                        </Text>
                      </Pressable>
                    </View>
                    <ScrollView
                      horizontal
                      nestedScrollEnabled
                      showsHorizontalScrollIndicator={false}
                    >
                      <Text
                        style={[
                          typography.monoSm,
                          {
                            fontFamily: MONO_FONT,
                            color: colors.ink,
                            padding: spacing.sm,
                          },
                        ]}
                      >
                        {seg.content}
                      </Text>
                    </ScrollView>
                  </View>
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
                        color: colors.accent,
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
                        style={[typography.bodyXs, { color: colors.muted }]}
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

  const handleCopy = () => {
    onCopy();
    setCopiedLocal(true);
    setTimeout(() => setCopiedLocal(false), 1500);
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
                <Copy size={12} color={colors.compute} />
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

