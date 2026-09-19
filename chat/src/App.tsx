import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createStore, titleFor, uid } from "./lib/store";
import { appendTail } from "./lib/tail";
import { isConfigured, loadSettings, loadTheme, saveSettings, saveTheme, themeChoiceMade } from "./lib/settings";
import type { Theme } from "./lib/settings";
import { ChatRequestError, fetchContextSize, serverBase } from "./lib/chat";
import { streamChatCompletion } from "./lib/toolLoop";
import type { ChatErrorKind } from "./lib/chat";
import { loadSampling, samplingWire } from "./lib/sampling";
import { loadThinking, saveThinking, thinkingSupport } from "./lib/thinking";
import type { ChatSettings, Conversation, ConversationMeta, ToolRun } from "./lib/types";
import type { Attachment } from "./lib/attachments";
import { AttachmentError, CONTEXT_RESERVE_TOKENS, buildPinnedContext, extractAttachment, historyTokens } from "./lib/attachments";
import type { SurfaceKey } from "./app/surfaces";
import { SURFACES } from "./app/surfaces";
import { arrivingIn, handoff, leavingGhost } from "./app/handoff";
import { CrescentNav } from "./components/CrescentNav";
import type { CrescentEntry } from "./components/CrescentNav";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Composer } from "./components/Composer";
import { Thread } from "./components/Thread";
import type { FailedState } from "./components/Thread";
import { Sidebar } from "./components/Sidebar";
import { Panel } from "./components/Panel";
import { SettingsForm } from "./components/SettingsForm";
import { BrainSurface } from "./surfaces/BrainSurface";
import { useBrainServer, withBrainDefaults } from "./surfaces/useBrain";
import { useServerFacts } from "./surfaces/useServerFacts";
import { ModelsSurface } from "./surfaces/ModelsSurface";
import { ServerSurface } from "./surfaces/ServerSurface";
import { DevicesSurface } from "./surfaces/DevicesSurface";
import { AdvancedSurface } from "./surfaces/AdvancedSurface";
import { EmptyState } from "./components/EmptyState";
import { executeToolCall, offeredTools } from "./lib/tools/registry";
import "./App.css";

const store = createStore();

// How far the settings path may grow before the oldest step falls off. The
// surfaces' own hops are shallow; the bound is for the general case.
const PATH_LIMIT = 8;

interface Refusal {
  names: string;
  docTokens: number;
  historyTokens: number;
  need: number;
  have: number;
}

function surfaceLabel(surface: SurfaceKey): string {
  if (surface === "brain") return "Home";
  return SURFACES.find((s) => s.key === surface)?.label ?? "Chat";
}

export function App() {
  // The brain is the home: the app opens on it, and the chat is reached by
  // writing in its bar — never by selecting a tab (THE-BRAIN-IS-THE-HOME.md).
  const [surface, setSurface] = useState<SurfaceKey>("brain");
  // The walk of settings surfaces taken to arrive at this one — the brain
  // is the path's root — so back can mean one step, not the whole way home.
  // The chat is not part of the path: leaving it is the crescent's job.
  const [path, setPath] = useState<SurfaceKey[]>([]);
  const [conversations, setConversations] = useState<ConversationMeta[]>(() => store.list());
  const [writeError, setWriteError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<ChatSettings>(() => loadSettings());
  const [navOpen, setNavOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  // One entry per generating conversation (conversation id -> assistant id).
  // Streams are independent: answering in A never blocks sending in B.
  const [streamingByConv, setStreamingByConv] = useState<Record<string, string>>({});
  const [failedById, setFailedById] = useState<Record<string, FailedState>>({});
  const controllers = useRef(new Map<string, AbortController>());
  const [panelOpen, setPanelOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [attachStatus, setAttachStatus] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [ctxInfo, setCtxInfo] = useState<{ endpoint: string; nctx: number | null } | null>(null);
  const nctxCache = useRef(new Map<string, number | null>());
  // In-flight stream buffers, keyed by assistant message id. Text lives here
  // while streaming and renders from here; the disk is written on a throttle
  // plus once at the end — never per token. The stored copy always trails
  // the buffer, so the buffer is authoritative until the run finishes.
  const bufs = useRef(
    new Map<string, { convId: string; content: string; reasoning: string; tail: string; toolRuns: ToolRun[]; timer: ReturnType<typeof setTimeout> | undefined }>(),
  );
  const [live, setLiveState] = useState<Record<string, { convId: string; content: string; reasoning: string; tail: string; toolRuns: ToolRun[] }>>({});
  const [liveMessage, setLiveMessage] = useState("");
  // The message the brain's writing bar became, for the one open move.
  // The composer's unsent text. Going home unmounts the chat, and the
  // draft must survive that round trip, so it lives here.
  const [draft, setDraft] = useState("");

  useEffect(
    () =>
      store.subscribe(() => {
        setConversations(store.list());
        setWriteError(store.getWriteError());
      }),
    [],
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Leaving with a turn in flight must not leave callbacks writing into a dead
  // tree, or a throttle timer firing after the page is gone. Rust is told to
  // stop separately, by the abort hooks the tool calls installed.
  useEffect(
    () => () => {
      controllers.current.forEach((controller) => controller.abort());
      controllers.current.clear();
      bufs.current.forEach((buffer) => {
        if (buffer.timer !== undefined) clearTimeout(buffer.timer);
      });
      bufs.current.clear();
    },
    [],
  );

  // No explicit choice yet: follow the operating system while it changes.
  useEffect(() => {
    if (themeChoiceMade()) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const active = useMemo(() => {
    const conv = activeId ? (store.get(activeId) ?? null) : null;
    if (!conv) return null;
    let changed = false;
    const messages = conv.messages.map((m) => {
      const l = live[m.id];
      if (!l || l.convId !== conv.id) return m;
      changed = true;
      return { ...m, content: l.content, reasoning: l.reasoning, toolRuns: l.toolRuns };
    });
    return changed ? { ...conv, messages } : conv;
    // conversations refreshes on every store notification (index is small).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, activeId, live]);

  const tails = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [id, entry] of Object.entries(live)) out[id] = entry.tail;
    return out;
  }, [live]);

  const streaming = activeId !== null && streamingByConv[activeId] !== undefined;
  const streamingAny = Object.keys(streamingByConv).length > 0;
  // The owner's typed settings win; the brain's own server fills the
  // blanks, so the chat never calls itself unconfigured while the machine
  // is serving.
  const brainServer = useBrainServer();
  const effectiveSettings = useMemo(
    () => withBrainDefaults(settings, brainServer),
    [settings, brainServer],
  );
  const configured = isConfigured(effectiveSettings);
  // The model's own chat template decides whether a thinking switch may be
  // offered at all, and it is read from the one road to `/props`
  // (`useServerFacts`) — the sampler panel reads the same fact the same way.
  const { chatTemplate } = useServerFacts(effectiveSettings.endpoint, effectiveSettings.token);
  const thinkingSupported = thinkingSupport(chatTemplate).enableThinking;
  // Per model, and it follows the model this request will name: the brain's own
  // fills the blank while the machine is serving.
  const [thinking, setThinking] = useState(() => loadThinking(effectiveSettings.model));
  useEffect(() => {
    setThinking(loadThinking(effectiveSettings.model));
  }, [effectiveSettings.model]);
  const attachments: Attachment[] = useMemo(
    () => (activeId ? store.getAttachments(activeId) : []),
    // conversations refreshes on every store notification (index is small).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, activeId],
  );
  const convoTokens = useMemo(() => historyTokens(active?.messages ?? []), [active]);

  // An empty assistant message with no stream behind it is a response that
  // never arrived (failed before, app reloaded since). It must never render
  // as a blank row: surface it as retryable, whatever the original cause —
  // retrying re-runs the request, so a stale cause would only mislead.
  const effectiveFailed: FailedState | null = useMemo(() => {
    if (!active) return null;
    const direct = active.messages.map((m) => failedById[m.id]).find((f) => f !== undefined);
    if (direct) return direct;
    if (streaming) return null;
    const last = active.messages.at(-1);
    // A thinking-only tail is not a failure: the no-answer note owns it.
    if (
      last &&
      last.role === "assistant" &&
      last.content === "" &&
      !last.stopped &&
      !last.reasoning
    ) {
      return { messageId: last.id, kind: "network" };
    }
    return null;
  }, [failedById, active, streaming]);

  async function ensureCtx(): Promise<number | null> {
    const endpoint = effectiveSettings.endpoint;
    const cached = nctxCache.current.get(endpoint);
    if (cached !== undefined) {
      setCtxInfo({ endpoint, nctx: cached });
      return cached;
    }
    setAttachStatus("Checking context size…");
    const nctx = await fetchContextSize(serverBase(endpoint));
    nctxCache.current.set(endpoint, nctx);
    setCtxInfo({ endpoint, nctx });
    setAttachStatus(null);
    return nctx;
  }

  // Refresh the panel's context line when it opens over pinned files.
  useEffect(() => {
    if (!panelOpen || !activeId) return;
    if (store.getAttachments(activeId).every((a) => !a.active)) return;
    if (ctxInfo && ctxInfo.endpoint === effectiveSettings.endpoint) return;
    void ensureCtx();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, activeId, effectiveSettings.endpoint, conversations]);

  async function attachFiles(files: FileList | File[]): Promise<void> {
    const list = Array.from(files);
    if (list.length === 0) return;
    setRefusal(null);
    let convId = activeId;
    if (!convId) {
      const fresh: Conversation = {
        id: uid(),
        title: list[0].name.slice(0, 46),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
      store.put(fresh);
      convId = fresh.id;
      setActiveId(convId);
    }
    const target = convId;
    setAttachStatus(
      list.length === 1 ? `Reading ${list[0].name}…` : `Reading ${list.length} files…`,
    );
    try {
      const extracted: Attachment[] = [];
      for (const file of list) {
        extracted.push(await extractAttachment(file));
      }
      const nctx = await ensureCtx();
      const history = store.get(target)?.messages ?? [];
      const trial = buildPinnedContext(history, extracted, nctx);
      if (trial.status === "refused") {
        setRefusal({
          names: extracted.map((a) => a.name).join(", "),
          docTokens: trial.docTokens,
          historyTokens: trial.historyTokens,
          need: trial.need,
          have: trial.have,
        });
        setAttachStatus(null);
        setLiveMessage("Attachment refused: it does not fit the context.");
        return;
      }
      for (const attachment of extracted) store.putAttachment(target, attachment);
      setAttachStatus(null);
      setPanelOpen(true);
      setLiveMessage(
        extracted.length === 1
          ? `${extracted[0].name} attached.`
          : `${extracted.length} files attached.`,
      );
    } catch (error) {
      if (error instanceof AttachmentError) {
        setAttachStatus(error.message);
      } else {
        setAttachStatus("That file could not be read.");
      }
      setLiveMessage("Attachment failed.");
    }
  }

  const runAssistant = useCallback(
    async (conversationId: string, assistantId: string, currentSettings: ChatSettings) => {
      const conv = store.get(conversationId);
      if (!conv) return;
      const turns = conv.messages
        .filter((m) => m.id !== assistantId && !(m.role === "assistant" && m.content === ""))
        .filter((m) => m.content.length > 0 || m.role === "user");
      const docs = store.getAttachments(conversationId).filter((a) => a.active);
      // Send-time never fetches: the cached size (or unknown) decides, so a
      // request never waits on /props. Unknown means unpruned, never refused.
      const known = nctxCache.current.get(currentSettings.endpoint) ?? null;
      const ctx = buildPinnedContext(turns, docs, known);
      if (ctx.status === "refused") {
        // History outgrew the context after attaching: keep the empty
        // placeholder so the error has a place to live, and say the numbers.
        setFailedById((prev) => ({
          ...prev,
          [assistantId]: {
            messageId: assistantId,
            kind: "oversize",
            detail: `≈${ctx.docTokens.toLocaleString()} file + ≈${ctx.historyTokens.toLocaleString()} history + ≈${CONTEXT_RESERVE_TOKENS.toLocaleString()} kept free for the answer = ≈${ctx.need.toLocaleString()} of ≈${ctx.have.toLocaleString()} context tokens.`,
          },
        }));
        setLiveMessage("The message no longer fits the context.");
        return;
      }
      const history = ctx.wire;
      const controller = new AbortController();
      controllers.current.set(assistantId, controller);
      setStreamingByConv((prev) => ({ ...prev, [conversationId]: assistantId }));
      setFailedById((prev) => {
        if (!(assistantId in prev)) return prev;
        const next = { ...prev };
        delete next[assistantId];
        return next;
      });
      setLiveMessage("Responding. Waiting for the first word.");
      let firstToken = true;
      let thoughtStartedAt: number | null = null;
      let answerStartedAt: number | null = null;

      function persistLive(extra?: { stopped?: boolean; reasoningMs?: number }): void {
        const b = bufs.current.get(assistantId);
        const latest = store.get(conversationId);
        if (!latest) return;
        store.put({
          ...latest,
          updatedAt: Date.now(),
          messages: latest.messages.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: b ? b.content : m.content,
                  reasoning: b ? b.reasoning : m.reasoning,
                  toolRuns: b ? b.toolRuns : m.toolRuns,
                  ...extra,
                }
              : m,
          ),
        });
      }

      function schedulePersist(): void {
        const b = bufs.current.get(assistantId);
        if (!b || b.timer !== undefined) return;
        b.timer = setTimeout(() => {
          b.timer = undefined;
          persistLive();
        }, 500);
      }

      function dropLive(): void {
        const b = bufs.current.get(assistantId);
        if (b?.timer !== undefined) clearTimeout(b.timer);
        bufs.current.delete(assistantId);
        setLiveState((prev) => {
          if (!(assistantId in prev)) return prev;
          const next = { ...prev };
          delete next[assistantId];
          return next;
        });
      }

      function ingest(kind: "content" | "reasoning", text: string): void {
        let b = bufs.current.get(assistantId);
        if (!b) {
          b = { convId: conversationId, content: "", reasoning: "", tail: "", toolRuns: [], timer: undefined };
          bufs.current.set(assistantId, b);
        }
        b[kind] += text;
        if (kind === "reasoning") b.tail = appendTail(b.tail, text);
        const snapshot = { convId: conversationId, content: b.content, reasoning: b.reasoning, tail: b.tail, toolRuns: b.toolRuns };
        setLiveState((prev) => ({ ...prev, [assistantId]: snapshot }));
        schedulePersist();
      }

      // A running tool is replaced by its answer, matched by the call's id:
      // the thread shows the call once, not twice.
      function ingestToolRun(run: ToolRun): void {
        let b = bufs.current.get(assistantId);
        if (!b) {
          b = { convId: conversationId, content: "", reasoning: "", tail: "", toolRuns: [], timer: undefined };
          bufs.current.set(assistantId, b);
        }
        b.toolRuns = b.toolRuns.some((existing) => existing.id === run.id)
          ? b.toolRuns.map((existing) => (existing.id === run.id ? run : existing))
          : [...b.toolRuns, run];
        const snapshot = { convId: conversationId, content: b.content, reasoning: b.reasoning, tail: b.tail, toolRuns: b.toolRuns };
        setLiveState((prev) => ({ ...prev, [assistantId]: snapshot }));
        schedulePersist();
      }
      try {
        await streamChatCompletion({
          endpoint: currentSettings.endpoint,
          token: currentSettings.token,
          model: currentSettings.model,
          messages: history,
          sampling: samplingWire(loadSampling()),
          signal: controller.signal,
          tools: offeredTools(currentSettings.webTools),
          // Read at send time, so the control takes effect on the very next
          // message with no reload.
          thinking: loadThinking(currentSettings.model),
          runTool: executeToolCall,
          onToolRun: ingestToolRun,
          onReasoning: (text) => {
            if (thoughtStartedAt === null) {
              thoughtStartedAt = performance.now();
              setLiveMessage("Thinking.");
            }
            ingest("reasoning", text);
          },
          onToken: (token) => {
            if (firstToken) {
              firstToken = false;
              answerStartedAt = performance.now();
              setLiveMessage("Responding.");
            }
            ingest("content", token);
          },
        });
        const b = bufs.current.get(assistantId);
        const hasThought = (b?.reasoning ?? "") !== "";
        const hasAnswer = (b?.content ?? "") !== "";
        const ms =
          thoughtStartedAt !== null
            ? Math.max(0, Math.round((answerStartedAt ?? performance.now()) - thoughtStartedAt))
            : undefined;
        persistLive(ms !== undefined ? { reasoningMs: ms } : undefined);
        setLiveMessage(
          !hasAnswer && hasThought ? "Thinking complete, no answer arrived." : "Response complete.",
        );
      } catch (error) {
        if (error instanceof ChatRequestError && error.kind === "aborted") {
          persistLive({ stopped: true });
          setLiveMessage("Response stopped. Partial text kept.");
        } else {
          const kind: ChatErrorKind =
            error instanceof ChatRequestError ? error.kind : "network";
          const state: FailedState = {
            messageId: assistantId,
            kind,
            ...(error instanceof ChatRequestError && error.status !== undefined
              ? { status: error.status }
              : {}),
            ...(error instanceof ChatRequestError && error.url ? { url: error.url } : {}),
          };
          persistLive();
          setFailedById((prev) => ({ ...prev, [assistantId]: state }));
          setLiveMessage(
            kind === "truncated"
              ? "The answer stopped halfway. Details shown in the conversation."
              : "The response failed. Error details shown in the conversation.",
          );
        }
      } finally {
        dropLive();
        controllers.current.delete(assistantId);
        setStreamingByConv((prev) => {
          if (prev[conversationId] !== assistantId) return prev;
          const next = { ...prev };
          delete next[conversationId];
          return next;
        });
      }
    },
    [],
  );

  // Creates the turn and starts the stream, configured or not — the bubble
  // belongs to the person, and an answer with nowhere to go fails under it
  // with the error and a way to Settings. Returns the user message's id.
  function sendMessage(text: string): string | null {
    let conv = active;
    if (!conv) {
      conv = {
        id: uid(),
        title: titleFor(text),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
    }
    const assistantId = uid();
    const userId = uid();
    const updated: Conversation = {
      ...conv,
      title: conv.messages.length === 0 ? titleFor(text) : conv.title,
      updatedAt: Date.now(),
      messages: [
        ...conv.messages,
        { id: userId, role: "user", content: text, createdAt: Date.now() },
        { id: assistantId, role: "assistant", content: "", createdAt: Date.now() },
      ],
    };
    store.put(updated);
    setActiveId(updated.id);
    // Writing from the brain's bar lands here too: the chat opens with the
    // text already in the thread.
    openSurface("chat");
    void runAssistant(updated.id, assistantId, effectiveSettings);
    return userId;
  }

  // A stream in ANOTHER conversation never blocks this one; the composer
  // shows Stop (not Send) while its own conversation is generating.
  function send(text: string): boolean {
    return sendMessage(text) !== null;
  }

  // Enter in the brain's bar: the chat opens with the text as the first
  // message, and the bar itself becomes that message (§3) — the move is a FLIP
  // in `app/handoff.ts`, measured before and after the state change. Being
  // unconfigured is a reason the ANSWER will fail, not a reason the bar should
  // not become the message, so there is no fallback here on that account; under
  // reduced motion the same state change happens plainly and nothing moves.
  function writeFromBrain(text: string): void {
    const calm =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const bar = calm ? null : document.querySelector(".brain-bar");
    const before = bar ? bar.getBoundingClientRect() : null;
    // The whole screen changes, and the bar's flight is part of that change:
    // the room here leaves on a copy of itself while the next one arrives.
    if (!calm) leavingGhost(document.querySelector(".stage"));

    let openedId: string | null = null;
    // The commit has to be in the DOM before the bubble can be measured, which
    // is what flushSync is for: not the animation, the measurement.
    flushSync(() => {
      openedId = sendMessage(text);
    });
    if (openedId === null) return;
    // The bubble is in the DOM by now — flushSync committed it — and it is
    // found by its message id, so no state has to be held for the move.
    // The flight is measured and started first: the room's own entrance shifts
    // it down a few pixels, and the mover has to aim at where the bubble will
    // really be, not at where it is passing through. Both start in the same
    // task, so they are one movement on screen.
    handoff(before, document.querySelector(`[data-message-id="${openedId}"]`));
    if (!calm) arrivingIn(document.querySelector(".stage > *"));
  }

  function stop(): void {
    // Only the visible conversation's stream: a sibling keeps generating.
    const assistantId = activeId ? streamingByConv[activeId] : undefined;
    if (assistantId) controllers.current.get(assistantId)?.abort();
  }

  function retry(messageId: string): void {
    if (!active) return;
    if (streamingByConv[active.id] !== undefined) return;
    const latest = store.get(active.id);
    if (!latest) return;
    store.put({
      ...latest,
      messages: latest.messages.map((m) =>
        m.id === messageId
          ? { ...m, content: "", stopped: false, reasoning: "", reasoningMs: undefined }
          : m,
      ),
    });
    void runAssistant(active.id, messageId, effectiveSettings);
  }

  /** Appearance is a preference of the app, not a command in every header:
      it is chosen where the app's other settings are, and applied at once. */
  function chooseTheme(next: Theme): void {
    saveTheme(next);
    setTheme(next);
  }

  function removeConversation(id: string): void {
    const assistantId = streamingByConv[id];
    if (assistantId) controllers.current.get(assistantId)?.abort();
    store.remove(id);
    if (activeId === id) setActiveId(null);
  }

  function newConversation(): void {
    setActiveId(null);
    setDrawerOpen(false);
  }

  // One hop along the surfaces. Hops between settings surfaces extend the
  // walk so back can retrace it one step at a time; the chat is not on the
  // path, so arriving from it the walk starts at the brain.
  function openSurface(next: SurfaceKey): void {
    if (next === surface) return;
    if (next === "brain") {
      setPath([]);
    } else if (next !== "chat") {
      setPath((prev) => {
        if (surface === "chat") return [];
        const grown = [...prev, surface];
        return grown.length > PATH_LIMIT ? grown.slice(grown.length - PATH_LIMIT) : grown;
      });
    }
    setSurface(next);
  }

  // The reverse of a hop: pop the walk's top. Bouncing between two pages
  // therefore never grows it.
  function goBack(): void {
    if (path.length === 0) {
      setSurface("brain");
      return;
    }
    setSurface(path[path.length - 1]);
    setPath(path.slice(0, -1));
  }

  function selectConversation(id: string): void {
    setActiveId(id);
    openSurface("chat");
    setDrawerOpen(false);
  }

  const empty = !active || active.messages.length === 0;
  const title = surface === "chat" ? (active ? active.title : "Crescent Chat") : surfaceLabel(surface);
  // One step back from here: the hop's origin, or the brain from the root.
  const backTarget: SurfaceKey = path.length > 0 ? path[path.length - 1] : "brain";

  // The crescent lives in the chat alone. Its entries are destinations, and
  // the component drops the page you are on and anything that page already
  // offers — see the rule in `CrescentNav`.
  const chatEntries: CrescentEntry[] = [
    { key: "brain", label: "Home", onSelect: () => openSurface("brain") },
    { key: "settings", label: "Settings", onSelect: () => openSurface("settings") },
  ];

  return (
    <div
      className={`shell${streamingAny ? " is-streaming" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (navOpen) setNavOpen(false);
          else if (drawerOpen) setDrawerOpen(false);
          else if (surface === "chat") openSurface("brain");
        }
      }}
    >
      {/* The crescent lives in the chat alone, overlaid at the shell's
          level: an open menu dims the page beneath it, so it must not sit
          inside what gets dimmed. It is a way between pages: the chat's own
          drawer already offers a new conversation and the history, so neither
          is repeated here. */}
      {surface === "chat" ? (
        <CrescentNav
          entries={chatEntries}
          current="chat"
          open={navOpen}
          onOpenChange={setNavOpen}
        />
      ) : null}

      <header className="topbar">
        <div className="topbar-title">
          <button
            type="button"
            className="topbar-btn topbar-drawer-toggle"
            onClick={() => setDrawerOpen((o) => !o)}
            aria-expanded={drawerOpen}
            aria-label="Show conversations"
          >
            Conversations
          </button>
          <span className="topbar-mark" aria-hidden="true" />
          <h1>{title}</h1>
        </div>
        <div className="topbar-actions">
          {/* The app's own settings, in the app's own strip. The row below the
              bar on the home is the machine's (what runs on it, who can reach
              it, how it is launched); this is the door to the app's. One door
              per surface, by the same rule the crescent follows: not on
              Settings itself, where it would do nothing, and not on the chat,
              whose own menu already carries it. */}
          {surface !== "settings" && surface !== "chat" ? (
            <button
              type="button"
              className="topbar-btn topbar-settings"
              onClick={() => openSurface("settings")}
              aria-label="Settings"
            >
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <path
                  d="M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path
                  d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7 3.5 3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
              Settings
            </button>
          ) : null}
          {surface !== "brain" && surface !== "chat" ? (
            <button
              type="button"
              className="topbar-btn"
              onClick={goBack}
              aria-label={`Back to ${surfaceLabel(backTarget)}`}
            >
              {surfaceLabel(backTarget)}
            </button>
          ) : null}
          {surface === "chat" && active ? (
            <button
              type="button"
              className="topbar-btn"
              onClick={() => setPanelOpen((o) => !o)}
              aria-expanded={panelOpen}
              aria-label="Toggle attachments panel"
            >
              Files
            </button>
          ) : null}
        </div>
      </header>

      <main className="stage">
        {writeError ? (
          <div className="storage-banner" role="alert">
            <span>{writeError}</span>
            <button type="button" onClick={() => store.clearWriteError()}>
              Dismiss
            </button>
          </div>
        ) : null}
        <ErrorBoundary>
          {surface === "brain" ? (
            <BrainSurface
              onNavigate={openSurface}
              onWrite={writeFromBrain}
              onOpenChat={() => openSurface("chat")}
            />
          ) : surface === "chat" ? (
            <div className="chat-layout">
              <Sidebar
                conversations={conversations}
                activeId={activeId}
                streamingIds={Object.keys(streamingByConv)}
                drawerOpen={drawerOpen}
                onCloseDrawer={() => setDrawerOpen(false)}
                onSelect={selectConversation}
                onNew={newConversation}
                onRename={(id, newTitle) => store.rename(id, newTitle)}
                onDelete={removeConversation}
              />
              <div
                className="main-col"
                onDragOver={(event) => {
                  if (event.dataTransfer?.types.includes("Files")) {
                    event.preventDefault();
                    setDragging(true);
                  }
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  if (event.dataTransfer?.files.length) void attachFiles(event.dataTransfer.files);
                }}
              >
                {dragging ? (
                  <div className="drop-overlay" aria-hidden="true">
                    <span>Drop files to attach them to this conversation</span>
                  </div>
                ) : null}
                {refusal ? (
                  <div className="refusal-banner" role="alert">
                    <span>
                      <strong>{refusal.names} {refusal.names.includes(",") ? "don't" : "doesn't"} fit.</strong>
                      {` File ≈${refusal.docTokens.toLocaleString()} + history ≈${refusal.historyTokens.toLocaleString()} + ≈${CONTEXT_RESERVE_TOKENS.toLocaleString()} kept free for the answer = ≈${refusal.need.toLocaleString()} of ≈${refusal.have.toLocaleString()} context tokens. Nothing was attached or cut.`}
                    </span>
                    <button type="button" onClick={() => setRefusal(null)}>
                      Dismiss
                    </button>
                  </div>
                ) : null}
                {empty ? (
                  <EmptyState
                    needsSetup={!configured}
                    onOpenSettings={() => openSurface("settings")}
                  />
                ) : (
                  <Thread
                    messages={active.messages}
                    streaming={streaming}
                    failed={effectiveFailed}
                    tails={tails}
                    onRetry={retry}
                    onOpenSettings={() => openSurface("settings")}
                  />
                )}
                {attachStatus ? (
                  <p className="attach-status" role="status">
                    {attachStatus}
                  </p>
                ) : null}
                <Composer
                  thinking={thinkingSupported ? thinking : null}
                  onThinking={(enabled) => {
                    // Saved at once and read at send time: the next message uses
                    // it, with no reload.
                    saveThinking(effectiveSettings.model, enabled);
                    setThinking(enabled);
                  }}
                  streaming={streaming}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSend={send}
                  onStop={stop}
                  onAttach={(files) => void attachFiles(files)}
                />
              </div>
              <Panel
                open={panelOpen && surface === "chat" && active !== null}
                attachments={attachments}
                contextTokens={ctxInfo && ctxInfo.endpoint === effectiveSettings.endpoint ? ctxInfo.nctx : null}
                historyTokens={convoTokens}
                onRemove={(id) => activeId && store.removeAttachment(activeId, id)}
                onReattach={(id) => {
                  if (!activeId) return;
                  const found = store.getAttachments(activeId).find((a) => a.id === id);
                  if (found) store.putAttachment(activeId, { ...found, active: true });
                }}
                onClose={() => setPanelOpen(false)}
              />
            </div>
          ) : surface === "settings" ? (
            <SettingsForm
              initial={settings}
              theme={theme}
              onTheme={chooseTheme}
              onWebTools={(webTools) => {
                // Writes only itself, from the settings that are already
                // stored: the text sitting unsaved in the connection fields is
                // neither committed nor wiped by touching this.
                const next = { ...settings, webTools };
                setSettings(next);
                saveSettings(next);
              }}
              onSave={(next) => {
                setSettings(next);
                saveSettings(next);
                nctxCache.current.clear();
                setCtxInfo(null);
              }}
            />
          ) : surface === "models" ? (
            <ModelsSurface onNavigate={openSurface} />
          ) : surface === "server" ? (
            <ServerSurface />
          ) : surface === "devices" ? (
            <DevicesSurface onNavigate={openSurface} />
          ) : surface === "advanced" ? (
            <AdvancedSurface />
          ) : null}
        </ErrorBoundary>
      </main>

      <p className="visually-hidden" role="status">
        {liveMessage}
      </p>
    </div>
  );
}
