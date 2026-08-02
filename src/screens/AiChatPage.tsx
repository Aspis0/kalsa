import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
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
  Grid2x2,
  Image as ImageIcon,
  Languages,
  Menu,
  Plus,
  Send,
  Sparkles,
  Square,
  SquarePen,
  X,
} from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";
import { PdfToImages } from "../components/PdfToImages";
import { normalizeMiniapp, parseMiniappFromText } from "../domain/askAssistant";
import { translateText } from "../engine/LlamaService";
import { getStrings, useLocale, type Locale, type TranslateFn } from "../i18n";
import { useLabTheme } from "../ui/labTheme";
import { spacing, radius } from "../theme/tokens";
import { typography } from "../theme/typography";

const HISTORY_KEY = "kalsa.messages.v1";

export type AiChatSelectedRun = {
  jobId: string;
  organism?: string | null;
  status?: string | null;
  accession?: string | null;
};

export type MessageSource = {
  title: string;
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

function buildQuickTools(t: TranslateFn) {
  return [
    { label: t("chat.toolChat"), Icon: Sparkles },
    { label: t("chat.toolWebsearch"), Icon: Globe },
    { label: t("chat.toolMiniapp"), Icon: ClipboardList },
    { label: t("chat.toolTools"), Icon: Grid2x2 },
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
}: Props) {
  const { colors } = useLabTheme<any>();
  const { t, locale } = useLocale();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const greeting = useMemo(() => greetingForHour(new Date().getHours(), t), [t]);
  const suggestions = useMemo(() => buildSuggestions(t), [t]);
  const quickTools = useMemo(() => buildQuickTools(t), [t]);

  // ── Persistenza conversazione (Fase 1) ──────────────────────────────────
  const [historyLoaded, setHistoryLoaded] = useState(false);
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

  useEffect(() => {
    if (!historyLoaded || !messages.length) return;
    const timer = setTimeout(() => {
      // Normalizza lo stato transitorio: niente streaming parziale persistito
      // (i messaggi in corso vengono saltati del tutto).
      const clean = messages
        .filter((message) => !message.streaming)
        .map((message) => ({
          ...message,
          streaming: undefined,
          statusHistory: undefined,
        }));
      AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(clean)).catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [historyLoaded, messages]);

  // Feature 4: attach state (immagini/foto/PDF → vision)
  const [attachedItems, setAttachedItems] = useState<LocalAttachment[]>([]);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [pdfToRender, setPdfToRender] = useState<{ uri: string; name: string } | null>(null);
  const pdfPagesRef = useRef<string[]>([]);

  // In-app translation (volatile — NOT persisted with history).
  // One translation at a time: a new run replaces the previous result.
  const [messageMenu, setMessageMenu] = useState<{ id: string; text: string } | null>(null);
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

  const MAX_IMAGE_ATTACHMENTS = 5;

  const addImageAttachment = useCallback(async (source: "library" | "camera") => {
    try {
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      // HEIC/WebP non supportati da mtmd: conversione a JPEG + resize cap.
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      setAttachedItems((prev) => {
        if (prev.length >= MAX_IMAGE_ATTACHMENTS) return prev;
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
  }, []);

  const addPdfAttachment = useCallback(async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
        multiple: false,
      });
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
    setPdfToRender((prev) => {
      if (prev) {
        const pages = pdfPagesRef.current;
        if (pages.length) {
          setAttachedItems((current) => {
            if (current.length >= MAX_IMAGE_ATTACHMENTS) return current;
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
  }, []);

  const handlePdfError = useCallback(() => {
    pdfPagesRef.current = [];
    setPdfToRender(null);
  }, []);

  // BLOCKER-1: unmount guard + abort ref
  const mountedRef = useRef(true);
  // BLOCKER-3: synchronous in-flight guard (React state updates are async)
  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
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
      // Also ignore send while a translation holds the engine (silent).
      if (!trimmed || sendingRef.current || translationInFlightRef.current || !historyLoaded) return;
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

      // Track whether any text has streamed — used to decide whether to remove empty placeholder on abort
      let anyTextStreamed = false;

      try {
        if (onSendStream) {
          await onSendStream(
            trimmed,
            {
              onDelta: (_delta, full) => {
                anyTextStreamed = true;
                updateMessage(assistantId, { text: full, statusLabel: undefined });
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
          const msg =
            err?.message?.includes("quota") || err?.message?.includes("limit")
              ? t("chat.queryLimit")
              : t("chat.serviceUnreachable");
          updateMessage(assistantId, { streaming: false, statusLabel: undefined, text: msg });
        }
      } finally {
        // Abort senza testo: rimuovi il placeholder vuoto (niente bubble fantasma).
        if (controller.signal.aborted && !anyTextStreamed) {
          setMessages(prev => prev.filter(m => m.id !== assistantId));
        } else if (!controller.signal.aborted || anyTextStreamed) {
          // Extract miniapp JSON from the final assistant text (local models emit
          // schema miniapp_v1 in the prose / fenced block; cloud path may also
          // call onMiniapp directly).
          setMessages((prev) =>
            prev.map((message) => {
              if (message.id !== assistantId) return message;
              const base = { ...message, streaming: false, statusLabel: undefined };
              if (base.miniapp) return base;
              const extracted = parseMiniappFromText(base.text || "");
              if (!extracted.miniapp) return base;
              return {
                ...base,
                text: extracted.text || base.text,
                miniapp: extracted.miniapp as Message["miniapp"],
              };
            }),
          );
        }
        sendingRef.current = false;
        if (mountedRef.current) setSending(false);
      }
    },
    [historyLoaded, messages, onSendStream, t, updateMessage],
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
    // Abort any in-flight translation (mutex job will stopCompletion).
    translateAbortRef.current?.abort();
    translateAbortRef.current = null;
    translationInFlightRef.current = false;
    // BLOCKER-1 (audit): reset sending state synchronously so composer unlocks immediately
    sendingRef.current = false;
    setSending(false);
    setMessages([]);
    setDraft("");
    // Drop volatile translation UI with the conversation.
    translateRunRef.current += 1;
    setMessageMenu(null);
    setTranslatingId(null);
    setTranslationResult(null);
    setCopiedFlash(false);
    AsyncStorage.removeItem(HISTORY_KEY).catch(() => undefined);
  }, []);

  /** Open message action sheet (Copy + Translate). No-op while streaming / engine busy. */
  const openMessageMenu = useCallback((id: string, text: string, streaming?: boolean) => {
    // Skip while this message streams, a chat turn is in flight, or a translate is running.
    // Use refs (sync) so the window between setState and re-render is also closed.
    if (
      streaming ||
      sending ||
      sendingRef.current ||
      translatingId ||
      translationInFlightRef.current ||
      !text.trim()
    ) {
      return;
    }
    setMessageMenu({ id, text });
  }, [sending, translatingId]);

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

  // ── PDF attach rimosso (Fase 3): nessun endpoint remoto, tutto locale. ──

  // WARN-2: useMemo avoids draft.trim() allocation on every render.
  // Also block while translating (translatingId is the state mirror of translationInFlightRef).
  const canSend = useMemo(
    () => !!draft.trim() && !sending && !translatingId && historyLoaded,
    [draft, historyLoaded, sending, translatingId],
  );

  // ── Attach chip color helper ────────────────────────────────────────────
  function chipColorForKind(kind: LocalAttachment["kind"]) {
    return kind === "pdf" ? { dot: colors.compute, bg: colors.computeSoft } : { dot: colors.accent, bg: colors.accentSoft };
  }

  return (
    // WARN-5: KeyboardAvoidingView keeps the composer above the keyboard on iOS
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.shell }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >

      {/* ── Nav bar ── */}
      <View
        style={{
          paddingTop: insets.top,
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
            const isUser = m.role === "user";
            const prev = idx > 0 ? messages[idx - 1] : null;
            // HIGH-5: correct turn-start detection for any role change
            const isTurnStart = !prev || prev.role !== m.role;
            const topGap = idx === 0 ? 0 : isTurnStart ? spacing.lg : spacing.md;
            const showDayDivider = !prev || !isSameDay(prev.createdAt, m.createdAt);

            const dayDivider = showDayDivider ? (
              <View
                key={`day-${m.id}`}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginTop: idx === 0 ? 0 : spacing.lg,
                  marginBottom: spacing.sm,
                  gap: spacing.sm,
                }}
              >
                <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
                <Text style={[typography.bodyXs, { color: colors.muted }]}>
                  {formatDayLabel(m.createdAt, t, locale)}
                </Text>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
              </View>
            ) : null;

            if (isUser) {
              return (
                <React.Fragment key={m.id}>
                  {dayDivider}
                  <View
                    style={{
                      alignSelf: "flex-end",
                      maxWidth: "84%",
                      marginTop: dayDivider ? 0 : topGap,
                    }}
                  >
                    {/* Feature 4: attachment chips above user bubble */}
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
                        {m.attachments.map(att => {
                          const { dot, bg } = chipColorForKind(att.kind);
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
                      onLongPress={() => openMessageMenu(m.id, m.text, m.streaming)}
                      accessibilityLabel={t("chat.a11yLongPress")}
                      style={{
                        backgroundColor: colors.accentSoft,
                        borderRadius: radius.lg,
                        paddingVertical: spacing.sm,
                        paddingHorizontal: spacing.md,
                      }}
                    >
                      <Text style={[typography.bodyMd, { color: colors.ink }]}>{m.text}</Text>
                    </Pressable>

                    {translatingId === m.id ? (
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

                    {translationResult?.id === m.id ? (
                      <TranslationBlock
                        result={translationResult}
                        expanded={translationExpanded}
                        colors={colors}
                        t={t}
                        onToggle={() => setTranslationExpanded((v) => !v)}
                        onCopy={() => {
                          if (translationResult.text) void copyTextToClipboard(translationResult.text);
                        }}
                        onClose={closeTranslation}
                        onRetry={() => void runTranslate(m.id, m.text)}
                      />
                    ) : null}
                  </View>
                </React.Fragment>
              );
            }

            const showToolStrip = !!m.statusLabel && !m.text;
            const showCursor = !!m.streaming && !!m.text;

            // Feature 3: parse code blocks only when not streaming
            const segments: MessageSegment[] = (!m.streaming && m.text)
              ? parseMessageSegments(m.text)
              : [{ type: "text", content: m.text }];

            return (
              <React.Fragment key={m.id}>
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
                  <Text style={[typography.bodyXs, { color: colors.muted }]}>Kalsa</Text>
                </View>

                {/* Feature 1: status history stamps */}
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
                ) : (
                  (m.text || showCursor) ? (
                  <Pressable
                    onLongPress={() => openMessageMenu(m.id, m.text, m.streaming)}
                    accessibilityLabel={t("chat.a11yLongPress")}
                  >
                    {/* Feature 3: render parsed segments */}
                    {segments.map((seg, segIdx) => {
                      if (seg.type === "code") {
                        return (
                          <View
                            key={segIdx}
                            style={{
                              backgroundColor: colors.panel,
                              borderRadius: radius.md,
                              marginVertical: 4,
                              overflow: "hidden",
                            }}
                          >
                            {/* Code block header */}
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                                paddingHorizontal: spacing.sm,
                                paddingVertical: 4,
                                borderBottomWidth: 1,
                                borderBottomColor: colors.line,
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
                                <Text style={[typography.bodyXs, { color: colors.compute }]}>
                                  {t("common.share")}
                                </Text>
                              </Pressable>
                            </View>
                            {/* Code block body */}
                            <ScrollView
                              horizontal
                              nestedScrollEnabled
                              showsHorizontalScrollIndicator={false}
                            >
                              <Text
                                style={{
                                  fontFamily: MONO_FONT,
                                  fontSize: 13,
                                  color: colors.ink,
                                  padding: spacing.sm,
                                  lineHeight: 20,
                                }}
                              >
                                {seg.content}
                              </Text>
                            </ScrollView>
                          </View>
                        );
                      }
                      // text segment
                      return (
                        <Text key={segIdx} style={[typography.bodyMd, { color: colors.ink }]}>
                          {seg.content}
                          {segIdx === segments.length - 1 && showCursor ? "▋" : ""}
                        </Text>
                      );
                    })}
                  </Pressable>
                  ) : null
                )}

                {translatingId === m.id ? (
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

                {translationResult?.id === m.id ? (
                  <TranslationBlock
                    result={translationResult}
                    expanded={translationExpanded}
                    colors={colors}
                    t={t}
                    onToggle={() => setTranslationExpanded((v) => !v)}
                    onCopy={() => {
                      if (translationResult.text) void copyTextToClipboard(translationResult.text);
                    }}
                    onClose={closeTranslation}
                    onRetry={() => void runTranslate(m.id, m.text)}
                  />
                ) : null}

                {/* Feature 2: miniapp card */}
                {m.miniapp ? (
                  <MiniappCard miniapp={m.miniapp} colors={colors} onOpen={onOpenMiniapp ? () => onOpenMiniapp(m.miniapp!) : undefined} />
                ) : null}

                {m.sources && m.sources.length > 0 ? (
                  // WARN-4: nestedScrollEnabled prevents Android touch conflict
                  <ScrollView
                    horizontal
                    nestedScrollEnabled
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: spacing.xs, paddingTop: spacing.xs }}
                  >
                    {m.sources.map((s, sIdx) => (
                      // HIGH-4: stable key from doi/title, not array index
                      <View
                        key={s.doi || s.title || String(sIdx)}
                        style={{
                          borderRadius: radius.sm,
                          borderWidth: 1,
                          borderColor: colors.line,
                          paddingHorizontal: spacing.xs,
                          paddingVertical: 2,
                          maxWidth: 220,
                        }}
                      >
                        <Text
                          style={[typography.bodyXs, { color: colors.muted }]}
                          numberOfLines={1}
                        >
                          {s.title}
                          {s.authors ? ` — ${s.authors}` : ""}
                        </Text>
                        {s.provider ? (
                          <Text
                            style={[typography.bodyXs, { color: colors.muted, opacity: 0.75, fontSize: 10 }]}
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
                                        : s.provider,
                            })}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </ScrollView>
                ) : null}

                {m.ctas && m.ctas.length > 0 ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, paddingTop: spacing.xs }}>
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
                          backgroundColor: cta.kind === "run_monitor_recovery" ? colors.accentSoft : colors.computeSoft,
                          borderColor: cta.kind === "run_monitor_recovery" ? colors.accent : colors.compute,
                          borderRadius: radius.pill,
                          borderWidth: 1,
                          opacity: pressed ? 0.72 : 1,
                          paddingHorizontal: spacing.sm,
                          paddingVertical: 5,
                        })}
                      >
                        <ChevronRight size={12} color={cta.kind === "run_monitor_recovery" ? colors.accent : colors.compute} />
                        <Text style={[typography.bodyXs, { color: cta.kind === "run_monitor_recovery" ? colors.accent : colors.compute, fontWeight: "600" }]}>
                          {cta.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {/* Result images: tap to open presigned URL in the system browser */}
                {m.images && m.images.length > 0 ? (
                  <ScrollView
                    horizontal
                    nestedScrollEnabled
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.sm }}
                  >
                    {m.images.map((img) => (
                      <Pressable
                        key={img.id}
                        onPress={() => Linking.openURL(img.url).catch(() => undefined)}
                        style={{
                          width: 140,
                          borderRadius: radius.md,
                          overflow: "hidden",
                          borderWidth: 1,
                          borderColor: colors.line,
                          backgroundColor: colors.panel,
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
                          <Download size={12} color={colors.compute} />
                        </View>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}

                {/* Download pills: CSV / ZIP artifacts */}
                {m.downloads && m.downloads.length > 0 ? (
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: spacing.xs,
                      paddingTop: spacing.xs,
                    }}
                  >
                    {m.downloads.map((dl) => (
                      <Pressable
                        key={dl.id}
                        onPress={() => Linking.openURL(dl.url).catch(() => undefined)}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          backgroundColor: colors.computeSoft,
                          borderRadius: radius.pill,
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Download size={11} color={colors.compute} />
                        <Text style={[typography.bodyXs, { color: colors.compute }]}>
                          {dl.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
              </React.Fragment>
            );
          })
        )}
      </ScrollView>

      {/* ── Quick-tools row — only in empty/welcome state ── */}
      {messages.length === 0 ? (
        <View
          style={{
            flexDirection: "row",
            paddingHorizontal: spacing.md,
            paddingBottom: spacing.xs,
            gap: spacing.xs,
          }}
        >
          {quickTools.map((qt) => (
            <Pressable
              key={qt.label}
              disabled
              accessibilityLabel={t("chat.a11yToolComingSoon", { label: qt.label })}
              style={{
                flex: 1,
                alignItems: "center",
                gap: 4,
                paddingVertical: spacing.xs,
                backgroundColor: colors.panel,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.line,
                opacity: 0.55,
              }}
            >
              <qt.Icon size={16} color={colors.muted} />
              <Text
                style={[typography.bodyXs, { color: colors.muted, fontSize: 10 }]}
                numberOfLines={1}
              >
                {qt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* ── Composer ── */}
      <View
        style={{
          backgroundColor: colors.shell,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.sm,
          paddingBottom: spacing.sm + Math.max(0, insets.bottom - 8),
          gap: spacing.xs,
        }}
      >
        {/* Feature 4: context chips row */}
        {pdfToRender ? (
          <View style={{ paddingHorizontal: spacing.md, paddingBottom: 4 }}>
            <PdfToImages
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

        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.xs }}>
          {/* Attach: foto/PDF per la vision */}
          <Pressable
            onPress={() => setAttachSheetOpen(true)}
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
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Plus color={colors.muted} size={18} />
          </Pressable>

          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t("chat.placeholder")}
            placeholderTextColor={colors.muted}
            editable={!sending}
            onSubmitEditing={() => handleSend(draft, attachedItems)}
            returnKeyType="send"
            multiline
            style={{
              flex: 1,
              maxHeight: 120,
              color: colors.ink,
              backgroundColor: colors.inputNativeFill,
              borderRadius: radius.pill,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              fontSize: 15,
              fontFamily: typography.bodyMd.fontFamily as string | undefined,
            }}
          />

          {/* Stop button during streaming; Send when ready; nothing (opacity 0) when empty+idle */}
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
              onPress={() => handleSend(draft, attachedItems)}
              disabled={!canSend}
              accessibilityLabel={t("chat.a11ySend")}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: canSend ? colors.accent : colors.panel,
                alignItems: "center",
                justifyContent: "center",
                opacity: canSend ? (pressed ? 0.85 : 1) : 0.35,
              })}
            >
              <Send color={canSend ? "#ffffff" : colors.muted} size={18} />
            </Pressable>
          )}
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
        <Text style={[typography.bodySm, { color: colors.ink, flex: 1, fontWeight: "600" }]}>
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
          <Text style={[typography.bodyXs, { color: "#ffffff", fontWeight: "600" }]}>
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

