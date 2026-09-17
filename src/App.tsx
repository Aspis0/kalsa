import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStore, titleFor, uid } from "./lib/store";
import { appendTail } from "./lib/tail";
import { isConfigured, loadSettings, loadTheme, saveSettings, saveTheme, themeChoiceMade } from "./lib/settings";
import type { Theme } from "./lib/settings";
import { ChatRequestError, fetchContextSize, serverBase, streamChatCompletion } from "./lib/chat";
import type { ChatErrorKind } from "./lib/chat";
import type { ChatSettings, Conversation, ConversationMeta } from "./lib/types";
import type { Attachment } from "./lib/attachments";
import { AttachmentError, CONTEXT_RESERVE_TOKENS, buildPinnedContext, extractAttachment, historyTokens } from "./lib/attachments";
import type { SurfaceKey } from "./app/surfaces";
import { SURFACES } from "./app/surfaces";
import { CrescentNav } from "./components/CrescentNav";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Composer } from "./components/Composer";
import { Thread } from "./components/Thread";
import type { FailedState } from "./components/Thread";
import { Sidebar } from "./components/Sidebar";
import { Panel } from "./components/Panel";
import { SettingsForm } from "./components/SettingsForm";
import { PLACEHOLDER_LINES, SurfacePlaceholder } from "./components/SurfacePlaceholder";
import { EmptyState } from "./components/EmptyState";
import "./App.css";

const store = createStore();

interface Refusal {
  names: string;
  docTokens: number;
  historyTokens: number;
  need: number;
  have: number;
}

function surfaceLabel(surface: SurfaceKey): string {
  return SURFACES.find((s) => s.key === surface)?.label ?? "Chat";
}

export function App() {
  const [surface, setSurface] = useState<SurfaceKey>("chat");
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
    new Map<string, { convId: string; content: string; reasoning: string; tail: string; timer: ReturnType<typeof setTimeout> | undefined }>(),
  );
  const [live, setLiveState] = useState<Record<string, { convId: string; content: string; reasoning: string; tail: string }>>({});
  const [liveMessage, setLiveMessage] = useState("");

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
      return { ...m, content: l.content, reasoning: l.reasoning };
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
  const configured = isConfigured(settings);
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
    const endpoint = settings.endpoint;
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
    if (ctxInfo && ctxInfo.endpoint === settings.endpoint) return;
    void ensureCtx();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, activeId, settings.endpoint, conversations]);

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
          b = { convId: conversationId, content: "", reasoning: "", tail: "", timer: undefined };
          bufs.current.set(assistantId, b);
        }
        b[kind] += text;
        if (kind === "reasoning") b.tail = appendTail(b.tail, text);
        const snapshot = { convId: conversationId, content: b.content, reasoning: b.reasoning, tail: b.tail };
        setLiveState((prev) => ({ ...prev, [assistantId]: snapshot }));
        schedulePersist();
      }
      try {
        await streamChatCompletion({
          endpoint: currentSettings.endpoint,
          token: currentSettings.token,
          model: currentSettings.model,
          messages: history,
          signal: controller.signal,
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

  function send(text: string): boolean {
    // A stream in ANOTHER conversation never blocks this one; the composer
    // shows Stop (not Send) while its own conversation is generating.
    if (!configured) {
      setSurface("settings");
      return false;
    }
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
    const updated: Conversation = {
      ...conv,
      title: conv.messages.length === 0 ? titleFor(text) : conv.title,
      updatedAt: Date.now(),
      messages: [
        ...conv.messages,
        { id: uid(), role: "user", content: text, createdAt: Date.now() },
        { id: assistantId, role: "assistant", content: "", createdAt: Date.now() },
      ],
    };
    store.put(updated);
    setActiveId(updated.id);
    void runAssistant(updated.id, assistantId, settings);
    return true;
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
    void runAssistant(active.id, messageId, settings);
  }

  function toggleTheme(): void {
    setTheme((t) => {
      const next: Theme = t === "light" ? "dark" : "light";
      saveTheme(next);
      return next;
    });
  }

  function removeConversation(id: string): void {
    const assistantId = streamingByConv[id];
    if (assistantId) controllers.current.get(assistantId)?.abort();
    store.remove(id);
    if (activeId === id) setActiveId(null);
  }

  function selectConversation(id: string): void {
    setActiveId(id);
    setSurface("chat");
    setDrawerOpen(false);
  }

  const empty = !active || active.messages.length === 0;
  const title = surface === "chat" ? (active ? active.title : "Crescent Chat") : surfaceLabel(surface);

  return (
    <div
      className={`shell${streamingAny ? " is-streaming" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (navOpen) setNavOpen(false);
          else if (drawerOpen) setDrawerOpen(false);
        }
      }}
    >
      <CrescentNav
        activeSurface={surface}
        open={navOpen}
        onOpenChange={setNavOpen}
        onSelect={setSurface}
      />

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
          <button
            type="button"
            className="topbar-btn"
            onClick={toggleTheme}
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
          >
            {theme === "light" ? "Dark" : "Light"}
          </button>
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
          {surface === "chat" ? (
            <div className="chat-layout">
              <Sidebar
                conversations={conversations}
                activeId={activeId}
                streamingIds={Object.keys(streamingByConv)}
                drawerOpen={drawerOpen}
                onCloseDrawer={() => setDrawerOpen(false)}
                onSelect={selectConversation}
                onNew={() => {
                  setActiveId(null);
                  setDrawerOpen(false);
                }}
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
                    onOpenSettings={() => setSurface("settings")}
                  />
                ) : (
                  <Thread
                    messages={active.messages}
                    streaming={streaming}
                    failed={effectiveFailed}
                    tails={tails}
                    onRetry={retry}
                    onOpenSettings={() => setSurface("settings")}
                  />
                )}
                {attachStatus ? (
                  <p className="attach-status" role="status">
                    {attachStatus}
                  </p>
                ) : null}
                <Composer streaming={streaming} onSend={send} onStop={stop} onAttach={(files) => void attachFiles(files)} />
              </div>
              <Panel
                open={panelOpen && surface === "chat" && active !== null}
                attachments={attachments}
                contextTokens={ctxInfo && ctxInfo.endpoint === settings.endpoint ? ctxInfo.nctx : null}
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
              onSave={(next) => {
                setSettings(next);
                saveSettings(next);
                nctxCache.current.clear();
                setCtxInfo(null);
              }}
            />
          ) : (
            <SurfacePlaceholder title={surfaceLabel(surface)} line={PLACEHOLDER_LINES[surfaceLabel(surface)] ?? ""} />
          )}
        </ErrorBoundary>
      </main>

      <p className="visually-hidden" role="status">
        {liveMessage}
      </p>
    </div>
  );
}
