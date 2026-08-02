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
  Download,
  FileText,
  Globe,
  Grid2x2,
  Image as ImageIcon,
  Menu,
  Plus,
  Send,
  Sparkles,
  Square,
  SquarePen,
  X,
} from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
// La legacy API di expo-file-system (readAsStringAsync / EncodingType) vive in
// `/legacy`; SDK 57 la espone ancora, la migrazione alla File API è un leftover.
import * as FileSystem from "expo-file-system/legacy";
import { useLabTheme } from "../ui/labTheme";
import { spacing, radius } from "../theme/tokens";
import { typography } from "../theme/typography";
import { UNIFIED_AI_CHAT, UNIFIED_AI_ENDPOINT } from "../mobile/aiGatewayConfig";

const HISTORY_KEY = "ai-chat.messages.v1";

export type AiChatSelectedRun = {
  jobId: string;
  organism?: string | null;
  status?: string | null;
  accession?: string | null;
};

export type MessageSource = { title: string; authors?: string; doi?: string };

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

// ── Feature 4: attached item type ──────────────────────────────────────────
type AttachedItem = {
  id: string;
  type: "rna-seq" | "labbook" | "file";
  label: string;
  contextId?: string;
  // Feature: file attachments (PDF) carry the server-extracted text here.
  // rna-seq/labbook items leave this undefined.
  text?: string;
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
  attachments?: AttachedItem[];
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
    attachments?: Array<{ title: string; text: string }>,
  ) => Promise<void>;
  selectedRun?: AiChatSelectedRun | null;
  prefillText?: string | null;
  onClearSelectedRun?: () => void;
  userName?: string | null;
  onOpenMiniapp?: (miniapp: any) => void;
  onCtaPress?: (cta: ChatCta) => void;
  // PDF attach: bio JWT getter (reused from the app's token store) for the
  // free /v1/ai/extract-pdf endpoint. When absent, the Files row stays inert.
  getBioToken?: () => Promise<string | null>;
};

type SuggestionItem = {
  text: string;
  sub: string;
  colorKey: "compute" | "accent";
  Icon: React.ComponentType<{ size: number; color: string }>;
};

const SUGGESTIONS: SuggestionItem[] = [
  {
    text: "Explain a concept clearly",
    sub: "Chat · local model",
    colorKey: "compute",
    Icon: Sparkles,
  },
  {
    text: "Search the web: latest news on [topic]",
    sub: "Websearch · coming soon (Phase 2)",
    colorKey: "accent",
    Icon: Globe,
  },
  {
    text: "Build a comparison table",
    sub: "Miniapp · interactive table",
    colorKey: "accent",
    Icon: BarChart2,
  },
  {
    text: "Summarize this text",
    sub: "Chat · long input",
    colorKey: "compute",
    Icon: BookOpen,
  },
];

const QUICK_TOOLS = [
  { label: "Chat", Icon: Sparkles },
  { label: "Websearch", Icon: Globe },
  { label: "Miniapp", Icon: ClipboardList },
  { label: "Tools", Icon: Grid2x2 },
];

// ── Feature 2: miniapp icon map ─────────────────────────────────────────────
function miniappIcon(kind: string): React.ComponentType<{ size: number; color: string }> {
  // Mapping generico: il modello sceglie il kind; icone bio rimosse.
  switch (kind) {
    case "calculator":
    case "comparison":
      return BarChart2;
    case "planner":
      return ClipboardList;
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

function greetingForHour(h: number): string {
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function formatDayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) {
    return `Today · ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function isSameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// Module-level counter — avoids Date.now() collisions when two IDs
// are generated in the same millisecond within the same synchronous block.
let _msgIdCounter = 0;
function nextMsgId(prefix: string): string {
  return `${prefix}-${++_msgIdCounter}`;
}

// PDF extract endpoint, derived from the unified chat stream URL by swapping the
// trailing `/chat/stream` segment for `/extract-pdf`. Falls back to the canonical
// production URL if the chat endpoint has an unexpected shape.
const PDF_EXTRACT_ENDPOINT =
  typeof UNIFIED_AI_ENDPOINT === "string" && UNIFIED_AI_ENDPOINT.endsWith("/chat/stream")
    ? UNIFIED_AI_ENDPOINT.replace(/\/chat\/stream$/, "/extract-pdf")
    : "https://api.aspis-bio.com/v1/ai/extract-pdf";

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILE_ATTACHMENTS = 5;

/** Sanitizza lo storico persistito: ogni campo (anche annidato) è validato, niente crash su payload corrotti. */
function sanitizeHistoryMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return [];
  const result: Message[] = [];
  const MAX_TEXT = 100_000;
  const MAX_ITEMS = 100;
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id) continue;
    if (record.role !== "user" && record.role !== "assistant") continue;
    if (typeof record.text !== "string") continue;
    const message: Message = {
      id: record.id,
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
            "Source",
          ...(typeof s.authors === "string" ? { authors: s.authors.slice(0, 300) } : {}),
          ...(typeof s.doi === "string" ? { doi: s.doi.slice(0, 300) } : {}),
          ...(typeof s.url === "string" ? { url: s.url.slice(0, 2000) } : {}),
        }));
    }
    if (record.miniapp && typeof record.miniapp === "object" && !Array.isArray(record.miniapp)) {
      const miniapp = record.miniapp as Record<string, unknown>;
      if (typeof miniapp.kind === "string" && typeof miniapp.title === "string") {
        message.miniapp = {
          kind: miniapp.kind.slice(0, 100),
          title: miniapp.title.slice(0, 300),
          blocks: Array.isArray(miniapp.blocks) ? miniapp.blocks.slice(0, MAX_ITEMS) : [],
          ...(Array.isArray(miniapp.actions) ? { actions: miniapp.actions.slice(0, 50) } : {}),
          ...(miniapp.computed && typeof miniapp.computed === "object" ? { computed: miniapp.computed } : {}),
          ...(miniapp.state && typeof miniapp.state === "object" ? { state: miniapp.state } : {}),
          ...(typeof miniapp.schema === "string" ? { schema: miniapp.schema } : {}),
        } as Message["miniapp"];
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
          type: a.type === "rna-seq" || a.type === "labbook" || a.type === "file" ? a.type : "file",
          label: typeof a.label === "string" ? a.label.slice(0, 500) : "Attachment",
          ...(typeof a.contextId === "string" ? { contextId: a.contextId.slice(0, 200) } : {}),
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
          label: typeof i.label === "string" ? i.label.slice(0, 300) : "Image",
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
          label: typeof d.label === "string" ? d.label.slice(0, 300) : "Download",
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
  onCtaPress,
  getBioToken,
}: Props) {
  const { colors } = useLabTheme<any>();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const [greeting] = useState<string>(() => greetingForHour(new Date().getHours()));

  // ── Persistenza conversazione (Fase 1) ──────────────────────────────────
  const [historyLoaded, setHistoryLoaded] = useState(false);
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(HISTORY_KEY)
      .then((raw) => {
        if (!mounted || !raw) return;
        try {
          const parsed = JSON.parse(raw);
          const valid = sanitizeHistoryMessages(parsed);
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

  // Feature 4: attach state
  const [attachedItems, setAttachedItems] = useState<AttachedItem[]>([]);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  // PDF attach: brief, non-modal status banner above the composer.
  const [attachNotice, setAttachNotice] = useState<string | null>(null);

  // BLOCKER-1: unmount guard + abort ref
  const mountedRef = useRef(true);
  // BLOCKER-3: synchronous in-flight guard (React state updates are async)
  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (prefillText) setDraft(prefillText);
  }, [prefillText]);

  // Auto-dismiss the attach notice after a few seconds.
  useEffect(() => {
    if (!attachNotice) return;
    const t = setTimeout(() => {
      if (mountedRef.current) setAttachNotice(null);
    }, 3500);
    return () => clearTimeout(t);
  }, [attachNotice]);

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
    async (text: string, currentAttachments?: AttachedItem[]) => {
      const trimmed = text.trim();
      // BLOCKER-3: synchronous ref check — not subject to React batching
      if (!trimmed || sendingRef.current || !historyLoaded) return;
      sendingRef.current = true;
      setSending(true);

      // Snapshot attachments at send time
      const snapshotAttachments = currentAttachments ?? [];
      // Ephemeral gateway attachments: file-type items with extracted text.
      // Cap at 5, guard each text at 6000 chars (server enforces the same).
      const gatewayAttachments = snapshotAttachments
        .filter((a) => a.type === "file" && typeof a.text === "string" && a.text.trim())
        .slice(0, 5)
        .map((a) => ({ title: a.label || "Attachment", text: (a.text as string).slice(0, 6000) }));

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
            statusLabel: "Thinking…",
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
              // BLOCKER-4: also clear statusLabel when sources arrive
              onSources: (sources) =>
                updateMessage(assistantId, { sources, streaming: false, statusLabel: undefined }),
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
                    label: action.label ? `Open ${action.label}` : "Open output picker",
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
              // Feature 2: miniapp handler
              onMiniapp: (miniapp) =>
                updateMessage(assistantId, { miniapp, streaming: false }),
              // RNA-seq job context: store result images/downloads on this message.
              onImages: (imgs, dls) =>
                updateMessage(assistantId, { images: imgs, downloads: dls }),
            },
            controller.signal,
            gatewayAttachments.length > 0 ? gatewayAttachments : undefined,
          );
        } else {
          updateMessage(assistantId, {
            streaming: false,
            statusLabel: undefined,
            text: "Backend not wired.",
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
              ? "You've reached your query limit for today."
              : "Couldn't reach the AI service. Please try again.";
          updateMessage(assistantId, { streaming: false, statusLabel: undefined, text: msg });
        }
      } finally {
        // Finalize only if we didn't already remove the placeholder (abort + no text case)
        if (!controller.signal.aborted || anyTextStreamed) {
          updateMessage(assistantId, { streaming: false, statusLabel: undefined });
        }
        sendingRef.current = false;
        if (mountedRef.current) setSending(false);
      }
    },
    [historyLoaded, onSendStream, updateMessage],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    // BLOCKER-1 (audit): reset sending state synchronously so composer unlocks immediately
    sendingRef.current = false;
    setSending(false);
    setMessages([]);
    setDraft("");
    AsyncStorage.removeItem(HISTORY_KEY).catch(() => undefined);
  }, []);

  // ── PDF attach: pick → validate → extract → attach ──────────────────────
  const [pdfLoading, setPdfLoading] = useState(false);
  const pdfLoadingRef = useRef(false);
  const handlePickPdf = useCallback(async () => {
    // Only the unified gateway consumes attachments; bail otherwise.
    if (!UNIFIED_AI_CHAT) return;
    if (pdfLoadingRef.current) return;
    // Cap on the number of attached files.
    const fileCount = attachedItems.filter((a) => a.type === "file").length;
    if (fileCount >= MAX_FILE_ATTACHMENTS) {
      setAttachNotice(`You can attach up to ${MAX_FILE_ATTACHMENTS} files.`);
      return;
    }

    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch {
      setAttachNotice("Couldn't open the file picker.");
      return;
    }
    if (picked.canceled) return;
    const asset = picked.assets?.[0];
    if (!asset) return;

    // Validate: PDF by mime or extension; size ≤ 10 MB.
    const isPdf =
      asset.mimeType === "application/pdf" || /\.pdf$/i.test(asset.name ?? "");
    if (!isPdf) {
      setAttachNotice("Please choose a PDF file.");
      return;
    }
    if (typeof asset.size === "number" && asset.size > MAX_PDF_BYTES) {
      setAttachNotice("That PDF is larger than 10 MB.");
      return;
    }

    pdfLoadingRef.current = true;
    setPdfLoading(true);
    setAttachNotice(null);
    try {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const token = getBioToken ? await getBioToken() : null;
      const doRequest = (authToken: string | null) =>
        fetch(PDF_EXTRACT_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ filename: asset.name, data_b64: base64 }),
        });
      let response = await doRequest(token);
      // Refresh-on-401: the bio JWT may have expired between calls.
      if (response.status === 401 && getBioToken) {
        const refreshed = await getBioToken().catch(() => null);
        if (refreshed && refreshed !== token) {
          response = await doRequest(refreshed);
        }
      }
      const data = response.ok ? await response.json().catch(() => null) : null;
      if (!data || data.ok !== true || typeof data.text !== "string" || !data.text.trim()) {
        setAttachNotice("Couldn't read that PDF.");
        return;
      }
      const label = (typeof data.title === "string" && data.title.trim()) || asset.name || "PDF";
      if (mountedRef.current) {
        setAttachedItems((prev) => {
          const existingFiles = prev.filter((a) => a.type === "file").length;
          if (existingFiles >= MAX_FILE_ATTACHMENTS) return prev;
          return [
            ...prev,
            { id: nextMsgId("file"), type: "file", label, text: data.text as string },
          ];
        });
        setAttachNotice(`Attached ${label}`);
      }
      setAttachSheetOpen(false);
    } catch {
      setAttachNotice("Couldn't read that PDF.");
    } finally {
      pdfLoadingRef.current = false;
      if (mountedRef.current) setPdfLoading(false);
    }
  }, [attachedItems, getBioToken]);

  // WARN-2: useMemo avoids draft.trim() allocation on every render
  const canSend = useMemo(() => !!draft.trim() && !sending && historyLoaded, [draft, historyLoaded, sending]);

  // ── Attach chip color helper ────────────────────────────────────────────
  function chipColorForType(type: AttachedItem["type"]) {
    if (type === "rna-seq") return { dot: colors.compute, bg: colors.computeSoft };
    if (type === "labbook") return { dot: colors.accent, bg: colors.accentSoft };
    return { dot: colors.muted, bg: colors.panel };
  }

  return (
    // WARN-5: KeyboardAvoidingView keeps the composer above the keyboard on iOS
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.shell }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
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
          {/* Left: hamburger (history drawer — coming soon) */}
          <Pressable
            disabled
            accessibilityLabel="Chat history (coming soon)"
            style={{
              width: 36,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
              opacity: 0.35,
            }}
          >
            <Menu size={20} color={colors.ink} />
          </Pressable>

          {/* Center: model chip */}
          <View style={{ flex: 1, alignItems: "center" }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                backgroundColor: colors.computeSoft,
                borderColor: colors.compute,
                borderWidth: 0.5,
                borderRadius: radius.pill,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <View
                style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: colors.good }}
              />
              <Text style={[typography.bodyXs, { color: colors.compute, fontWeight: "600" }]}>
                Aspis AI
              </Text>
              <ChevronDown size={12} color={colors.compute} />
            </View>
          </View>

          {/* Right: new chat */}
          <Pressable
            onPress={clearChat}
            hitSlop={8}
            accessibilityLabel="New chat"
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
            Selected run: {selectedRun.accession || selectedRun.jobId}
            {selectedRun.organism ? ` · ${selectedRun.organism}` : ""}
            {selectedRun.status ? ` · ${selectedRun.status}` : ""}
          </Text>
          {onClearSelectedRun ? (
            <Pressable onPress={onClearSelectedRun} hitSlop={8} accessibilityLabel="Clear selected run">
              <Text style={[typography.bodyXs, { color: colors.muted }]}>Clear</Text>
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
              What do you want to investigate today?
            </Text>

            {/* Suggestion cards */}
            {SUGGESTIONS.map((s) => {
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
                  {formatDayLabel(m.createdAt)}
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
                          const { dot, bg } = chipColorForType(att.type);
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
                              {att.type === "file" ? (
                                <FileText size={11} color={dot} />
                              ) : (
                                <View
                                  style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: 999,
                                    backgroundColor: dot,
                                  }}
                                />
                              )}
                              <Text style={[typography.bodyXs, { color: colors.ink }]}>
                                {att.label}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                    <View
                      style={{
                        backgroundColor: colors.accentSoft,
                        borderRadius: radius.lg,
                        paddingVertical: spacing.sm,
                        paddingHorizontal: spacing.md,
                      }}
                    >
                      <Text style={[typography.bodyMd, { color: colors.ink }]}>{m.text}</Text>
                    </View>
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
                  <Text style={[typography.bodyXs, { color: colors.muted }]}>Aspis AI</Text>
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
                    onLongPress={() => {
                      if (m.text) Share.share({ message: m.text });
                    }}
                    accessibilityLabel="Long press to copy or share"
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
                                onPress={() => Share.share({ message: seg.content })}
                                hitSlop={8}
                              >
                                <Text style={[typography.bodyXs, { color: colors.compute }]}>
                                  Copy
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
          {QUICK_TOOLS.map((qt) => (
            <Pressable
              key={qt.label}
              disabled
              accessibilityLabel={`${qt.label} context (coming soon)`}
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
        {attachNotice ? (
          <View
            style={{
              backgroundColor: colors.panel,
              borderRadius: radius.md ?? 8,
              paddingHorizontal: spacing.sm,
              paddingVertical: 6,
              marginBottom: 4,
            }}
          >
            <Text style={[typography.bodyXs, { color: colors.muted }]}>{attachNotice}</Text>
          </View>
        ) : null}

        {attachedItems.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.xs, paddingBottom: 4 }}
          >
            {attachedItems.map(item => {
              const { dot, bg } = chipColorForType(item.type);
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
                  {item.type === "file" ? (
                    <FileText size={11} color={dot} />
                  ) : (
                    <View
                      style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: dot }}
                    />
                  )}
                  <Text style={[typography.bodyXs, { color: colors.ink }]}>{item.label}</Text>
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
          {/* Feature 4: Plus opens attach sheet */}
          <Pressable
            onPress={() => setAttachSheetOpen(true)}
            accessibilityLabel="Add context"
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
            placeholder="Ask Aspis a question…"
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
              accessibilityLabel="Stop generation"
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
              accessibilityLabel="Send"
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

      {/* ── Feature 4: Attach sheet ── */}
      <AttachSheet
        visible={attachSheetOpen}
        onClose={() => setAttachSheetOpen(false)}
        colors={colors}
        filesEnabled={false}
        pdfLoading={pdfLoading}
        onPickFile={handlePickPdf}
      />
    </KeyboardAvoidingView>
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
            Interactive
          </Text>
        </View>
      </View>
      <Text style={[typography.bodyXs, { color: colors.muted }]}>
        Interactive miniapp · tap to open
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
        <Text style={[typography.bodySm, { color: colors.compute }]}>Open tool</Text>
        <ChevronRight size={14} color={colors.compute} />
      </Pressable>
    </View>
  );
}

// ── Feature 4: Attach sheet component ─────────────────────────────────────
function AttachSheet({
  visible,
  onClose,
  colors,
  filesEnabled,
  pdfLoading,
  onPickFile,
}: {
  visible: boolean;
  onClose: () => void;
  colors: any;
  filesEnabled: boolean;
  pdfLoading: boolean;
  onPickFile: () => void;
}) {
  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        onRequestClose={onClose}
      >
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Pressable
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" }}
            onPress={onClose}
          />
          <View
            style={{
              backgroundColor: colors.shell,
              borderTopLeftRadius: radius.xl ?? 24,
              borderTopRightRadius: radius.xl ?? 24,
              paddingBottom: 32,
            }}
          >
          {/* Grab handle */}
          <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 8 }}>
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: colors.line,
              }}
            />
          </View>

          {/* Title row */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: spacing.md,
              paddingBottom: spacing.sm,
            }}
          >
            <Text style={[typography.bodySm, { color: colors.ink, fontWeight: "700", flex: 1 }]}>
              Add context
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={18} color={colors.muted} />
            </Pressable>
          </View>

          {/* Section: From phone */}
          <Text
            style={[
              typography.bodyXs,
              {
                color: colors.muted,
                paddingHorizontal: spacing.md,
                paddingTop: spacing.md,
                paddingBottom: 4,
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: 0.8,
              },
            ]}
          >
            From phone
          </Text>

          {/* Camera (disabled) */}
          <Pressable
            disabled
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm + 2,
              opacity: 0.4,
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                backgroundColor: colors.panel,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Camera size={16} color={colors.muted} />
            </View>
            <Text style={[typography.bodySm, { color: colors.ink }]}>Camera</Text>
          </Pressable>

          {/* Photos (disabled) */}
          <Pressable
            disabled
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm + 2,
              opacity: 0.4,
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                backgroundColor: colors.panel,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ImageIcon size={16} color={colors.muted} />
            </View>
            <Text style={[typography.bodySm, { color: colors.ink }]}>Photos</Text>
          </Pressable>

          {/* Files (PDF → extract → ephemeral context). Enabled only when the
              unified gateway flag is on AND a bio token getter is wired. */}
          <Pressable
            disabled={!filesEnabled || pdfLoading}
            onPress={filesEnabled ? onPickFile : undefined}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm + 2,
              backgroundColor: filesEnabled && pressed ? colors.panelBright : "transparent",
              opacity: filesEnabled ? 1 : 0.4,
            })}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                backgroundColor: colors.panel,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {pdfLoading ? (
                <ActivityIndicator size="small" color={colors.muted} />
              ) : (
                <FileText size={16} color={colors.muted} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodySm, { color: colors.ink }]}>Files</Text>
              <Text style={[typography.bodyXs, { color: colors.muted }]}>
                {pdfLoading
                  ? "Reading PDF…"
                  : filesEnabled
                    ? "PDF, up to 10 MB"
                    : "Available with the new assistant"}
              </Text>
            </View>
          </Pressable>
          </View>
        </View>
      </Modal>

    </>
  );
}
