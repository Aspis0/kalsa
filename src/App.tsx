import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStore, titleFor, uid } from "./lib/store";
import { isConfigured, loadSettings, loadTheme, saveSettings, saveTheme, themeChoiceMade } from "./lib/settings";
import type { Theme } from "./lib/settings";
import { ChatRequestError, streamChatCompletion } from "./lib/chat";
import type { ChatErrorKind } from "./lib/chat";
import type { ChatSettings, Conversation, ConversationMeta } from "./lib/types";
import { CrescentNav } from "./components/CrescentNav";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Composer } from "./components/Composer";
import { Thread } from "./components/Thread";
import type { FailedState } from "./components/Thread";
import { Settings } from "./components/Settings";
import { EmptyState } from "./components/EmptyState";
import "./App.css";

const store = createStore();

export function App() {
  const [conversations, setConversations] = useState<ConversationMeta[]>(() => store.list());
  const [writeError, setWriteError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<ChatSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  // One entry per generating conversation (conversation id -> assistant id).
  // Streams are independent: answering in A never blocks sending in B.
  const [streamingByConv, setStreamingByConv] = useState<Record<string, string>>({});
  const [failedById, setFailedById] = useState<Record<string, FailedState>>({});
  const controllers = useRef(new Map<string, AbortController>());
  const [liveMessage, setLiveMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const active = useMemo(
    () => (activeId ? (store.get(activeId) ?? null) : null),
    // conversations refreshes on every store notification (index is small).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, activeId],
  );
  const streaming = activeId !== null && streamingByConv[activeId] !== undefined;
  const streamingAny = Object.keys(streamingByConv).length > 0;
  const configured = isConfigured(settings);

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
    if (last && last.role === "assistant" && last.content === "" && !last.stopped) {
      return { messageId: last.id, kind: "network" };
    }
    return null;
  }, [failedById, active, streaming]);

  useEffect(() => {
    setConfirmDelete(false);
  }, [activeId]);

  const runAssistant = useCallback(
    async (conversationId: string, assistantId: string, currentSettings: ChatSettings) => {
      const conv = store.get(conversationId);
      if (!conv) return;
      const history = conv.messages
        .filter((m) => m.id !== assistantId && !(m.role === "assistant" && m.content === "" && m.id !== assistantId))
        .filter((m) => m.content.length > 0 || m.role === "user")
        .map((m) => ({ role: m.role, content: m.content }));
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
      try {
        await streamChatCompletion({
          endpoint: currentSettings.endpoint,
          token: currentSettings.token,
          model: currentSettings.model,
          messages: history,
          signal: controller.signal,
          onToken: (token) => {
            if (firstToken) {
              firstToken = false;
              setLiveMessage("Responding.");
            }
            const latest = store.get(conversationId);
            if (!latest) return;
            store.put({
              ...latest,
              updatedAt: Date.now(),
              messages: latest.messages.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + token } : m,
              ),
            });
          },
        });
        const done = store.get(conversationId);
        if (done) store.put({ ...done, updatedAt: Date.now() });
        setLiveMessage("Response complete.");
      } catch (error) {
        if (error instanceof ChatRequestError && error.kind === "aborted") {
          const latest = store.get(conversationId);
          if (latest) {
            store.put({
              ...latest,
              updatedAt: Date.now(),
              messages: latest.messages.map((m) =>
                m.id === assistantId ? { ...m, stopped: true } : m,
              ),
            });
          }
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
          setFailedById((prev) => ({ ...prev, [assistantId]: state }));
          setLiveMessage(
            kind === "truncated"
              ? "The answer stopped halfway. Details shown in the conversation."
              : "The response failed. Error details shown in the conversation.",
          );
        }
      } finally {
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
      setSettingsOpen(true);
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

  function retry(): void {
    if (!active || !effectiveFailed) return;
    if (streamingByConv[active.id] !== undefined) return;
    const assistantId = effectiveFailed.messageId;
    const latest = store.get(active.id);
    if (!latest) return;
    store.put({
      ...latest,
      messages: latest.messages.map((m) =>
        m.id === assistantId ? { ...m, content: "", stopped: false } : m,
      ),
    });
    void runAssistant(active.id, assistantId, settings);
  }

  function toggleTheme(): void {
    setTheme((t) => {
      const next: Theme = t === "light" ? "dark" : "light";
      saveTheme(next);
      return next;
    });
  }

  function removeActive(): void {
    if (!active) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const assistantId = streamingByConv[active.id];
    if (assistantId) controllers.current.get(assistantId)?.abort();
    store.remove(active.id);
    setActiveId(null);
    setConfirmDelete(false);
  }

  const empty = !active || active.messages.length === 0;

  return (
    <div
      className={`shell${streamingAny ? " is-streaming" : ""}`}
      onKeyDown={(event) => {
        // Escape closes the crescent from anywhere (the nav is a sibling of
        // the composer, so its own key handler cannot hear this).
        if (event.key === "Escape" && navOpen) setNavOpen(false);
      }}
    >
      <CrescentNav
        conversations={conversations}
        activeId={activeId}
        open={navOpen}
        onOpenChange={setNavOpen}
        onSelect={setActiveId}
        onNew={() => setActiveId(null)}
      />

      <header className="topbar">
        <div className="topbar-title">
          <span className="topbar-mark" aria-hidden="true" />
          <h1>{active ? active.title : "Crescent Chat"}</h1>
        </div>
        <div className="topbar-actions">
          {active ? (
            <button
              type="button"
              className={`topbar-btn${confirmDelete ? " topbar-btn-danger" : ""}`}
              onClick={removeActive}
            >
              {confirmDelete ? "Confirm delete" : "Delete"}
            </button>
          ) : null}
          <button type="button" className="topbar-btn" onClick={() => setActiveId(null)}>
            New chat
          </button>
          <button
            type="button"
            className="topbar-btn"
            onClick={toggleTheme}
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
          >
            {theme === "light" ? "Dark" : "Light"}
          </button>
          <button type="button" className="topbar-btn" onClick={() => setSettingsOpen(true)}>
            Settings
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
          {empty ? (
          <EmptyState needsSetup={!configured} onOpenSettings={() => setSettingsOpen(true)} />
        ) : (
          <Thread
            messages={active.messages}
            streaming={streaming}
            failed={effectiveFailed}
            onRetry={retry}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
          <Composer streaming={streaming} onSend={send} onStop={stop} />
        </ErrorBoundary>
      </main>

      <p className="visually-hidden" role="status">
        {liveMessage}
      </p>

      {settingsOpen ? (
        <Settings
          initial={settings}
          onSave={(next) => {
            setSettings(next);
            saveSettings(next);
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}
