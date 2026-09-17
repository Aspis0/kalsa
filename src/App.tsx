import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStore, titleFor, uid } from "./lib/store";
import { isConfigured, loadSettings, loadTheme, saveSettings, saveTheme } from "./lib/settings";
import type { Theme } from "./lib/settings";
import { ChatRequestError, streamChatCompletion } from "./lib/chat";
import type { ChatErrorKind } from "./lib/chat";
import type { ChatSettings, Conversation } from "./lib/types";
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
  const [conversations, setConversations] = useState<Conversation[]>(() => store.list());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<ChatSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [failed, setFailed] = useState<FailedState | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => store.subscribe(() => setConversations(store.list())), []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const streaming = streamingId !== null;
  const configured = isConfigured(settings);

  // An empty assistant message with no stream behind it is a response that
  // never arrived (failed before, app reloaded since). It must never render
  // as a blank row: surface it as retryable, whatever the original cause —
  // retrying re-runs the request, so a stale cause would only mislead.
  const effectiveFailed: FailedState | null = useMemo(() => {
    if (failed) return failed;
    if (!active || streaming) return null;
    const last = active.messages.at(-1);
    if (last && last.role === "assistant" && last.content === "" && !last.stopped) {
      return { messageId: last.id, kind: "network" };
    }
    return null;
  }, [failed, active, streaming]);

  useEffect(() => {
    setConfirmDelete(false);
    setFailed((f) => (f && active?.messages.some((m) => m.id === f.messageId) ? f : null));
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAssistant = useCallback(
    async (conversationId: string, assistantId: string, currentSettings: ChatSettings) => {
      const conv = store.get(conversationId);
      if (!conv) return;
      const history = conv.messages
        .filter((m) => m.id !== assistantId && !(m.role === "assistant" && m.content === "" && m.id !== assistantId))
        .filter((m) => m.content.length > 0 || m.role === "user")
        .map((m) => ({ role: m.role, content: m.content }));
      const controller = new AbortController();
      abortRef.current = controller;
      setStreamingId(assistantId);
      setFailed(null);
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
          setFailed({ messageId: assistantId, kind });
          setLiveMessage("The response failed. Error details shown in the conversation.");
        }
      } finally {
        abortRef.current = null;
        setStreamingId(null);
      }
    },
    [],
  );

  function send(text: string): boolean {
    if (streaming) return false;
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
    abortRef.current?.abort();
  }

  function retry(): void {
    if (!active || !effectiveFailed || streaming) return;
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
    abortRef.current?.abort();
    store.remove(active.id);
    setActiveId(null);
    setConfirmDelete(false);
  }

  const empty = !active || active.messages.length === 0;

  return (
    <div
      className="shell"
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
        <ErrorBoundary>
          {empty ? (
          <EmptyState needsSetup={!configured} onOpenSettings={() => setSettingsOpen(true)} />
        ) : (
          <Thread
            messages={active.messages}
            streaming={streamingId !== null && active.messages.some((m) => m.id === streamingId)}
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
