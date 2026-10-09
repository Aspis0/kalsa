// The shell: which surface is on screen, the ways between them, the topbar,
// and the pieces that outlive any one surface — the slot banner, the web-call
// ask, the recovery notice, the screen-reader status line. The surfaces render
// themselves from their own files; the chat's state lives in the `useChat`
// hook (surfaces/useChat.ts), called HERE so it survives the chat page's
// unmounts.

import { useEffect, useState } from "react";
import { loadSettings, loadTheme, saveSettings, saveTheme, themeChoiceMade } from "./lib/settings";
import type { Theme } from "./lib/settings";
import type { ChatSettings } from "./lib/types";
import type { SlotNotice } from "./lib/slotGate";
import type { SurfaceKey } from "./app/surfaces";
import { CrescentNav } from "./components/CrescentNav";
import type { CrescentEntry } from "./components/CrescentNav";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RoomSurface } from "./surfaces/RoomSurface";
import { ChatSurface } from "./surfaces/ChatSurface";
import { useChat } from "./surfaces/useChat";
import { useLanguage } from "./i18n/useLanguage";
import type { Table } from "./i18n";
import { HelpSurface } from "./surfaces/HelpSurface";
import { TelemetryNotice } from "./components/TelemetryNotice";
import { SettingsForm } from "./components/SettingsForm";
import { BrainSurface } from "./surfaces/BrainSurface";
import { useBrain } from "./surfaces/useBrain";
import { ModelsSurface } from "./surfaces/ModelsSurface";
import { ServerSurface } from "./surfaces/ServerSurface";
import { DevicesSurface } from "./surfaces/DevicesSurface";
import { WebGateDialog } from "./components/WebGateDialog";
import { RecoveredNotice } from "./components/RecoveredNotice";
import { useEngineRecovery } from "./surfaces/useEngineRecovery";
import "./App.css";

// How far the settings path may grow before the oldest step falls off. The
// surfaces' own hops are shallow; the bound is for the general case.
const PATH_LIMIT = 8;

function surfaceLabel(surface: SurfaceKey, table: Table): string {
  if (surface === "brain") return table.chrome.home;
  if (surface === "room") return table.chrome.room;
  if (surface === "chat") return table.chrome.chat;
  // The settings surfaces' names live with the chrome words, keyed as this
  // lookup reads them.
  return table.chrome.pages[surface] ?? table.chrome.chat;
}

export function App() {
  const { table } = useLanguage();
  const chrome = table.chrome;
  const t = table.shell;
  // The brain is the home: the app opens on it, and the chat is reached by
  // writing in its bar — never by selecting a tab (THE-BRAIN-IS-THE-HOME.md).
  const [surface, setSurface] = useState<SurfaceKey>("brain");
  // The walk of settings surfaces taken to arrive at this one — the brain
  // is the path's root — so back can mean one step, not the whole way home.
  // The chat is not part of the path: leaving it is the crescent's job.
  const [path, setPath] = useState<SurfaceKey[]>([]);
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  // The chat's state, held here so it survives the chat page's unmounts.
  // The two shell pieces it fills as it runs: the screen-reader status line
  // and the slot banner the stage shows wherever its sentence arrived.
  const [liveMessage, setLiveMessage] = useState("");
  const [slotNotice, setSlotNotice] = useState<SlotNotice | null>(null);
  // The app's own settings — the surfaces that write them are rendered here,
  // and the chat reads them through the hook.
  const [settings, setSettings] = useState<ChatSettings>(() => loadSettings());
  const chat = useChat({ openSurface, announce: setLiveMessage, setSlotNotice, settings });

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

  // The engine dying under a running app and coming back by itself: the
  // notice is rendered at the stage's level so it survives navigation.
  const { state } = useBrain();
  const engine = useEngineRecovery(state?.kind ?? null);

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

  /** Appearance is a preference of the app, not a command in every header:
      it is chosen where the app's other settings are, and applied at once. */
  function chooseTheme(next: Theme): void {
    saveTheme(next);
    setTheme(next);
  }

  const title =
    surface === "chat" ? (chat.active ? chat.active.title || t.untitled : t.crescentChat) : surfaceLabel(surface, table);
  // One step back from here: the hop's origin, or the brain from the root.
  const backTarget: SurfaceKey = path.length > 0 ? path[path.length - 1] : "brain";

  // The gate's own sentence, when it owes one: only a hand-over the door
  // refused, which has no caller to return its answer to. Shown through the same
  // banner as the opens this shell asked for. An app-owned code speaks the
  // table; anything else is the door's own sentence, shown as it arrived.
  const rawNotice: SlotNotice | null = slotNotice ?? chat.slot.notice;
  const notice = rawNotice
    ? {
        failed: rawNotice.failed,
        text:
          rawNotice.own === "hold-waiting"
            ? t.holdWaiting
            : rawNotice.own === "hold-expired"
              ? t.holdExpired
              : rawNotice.own === "door-silent"
                ? t.doorSilent
                : rawNotice.message,
      }
    : null;

  // The crescent's entries are destinations, and the component drops the page
  // you are on and anything that page already offers — see the rule in
  // `CrescentNav`.
  const chatEntries: CrescentEntry[] = [
    { key: "brain", label: chrome.home, onSelect: () => openSurface("brain") },
    // The way back to the chat from the room: dropped on the chat itself.
    { key: "chat", label: chrome.chat, onSelect: () => openSurface("chat") },
    // The room, between the chat and the settings: the host's view of the
    // house's shared conversation.
    { key: "room", label: chrome.room, onSelect: () => openSurface("room") },
    { key: "settings", label: chrome.settings, onSelect: () => openSurface("settings") },
    { key: "help", label: chrome.pages.help, onSelect: () => openSurface("help") },
  ];

  // Navigation can unmount the focused button, leaving keyboard events on the body.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        // Escape over a held call refuses it: the safest reading of a slam
        // on Escape is "no", never "send it".
        if (chat.gateShown) chat.answerGate(chat.gateShown.id, false);
        else if (navOpen) setNavOpen(false);
        else if (chat.drawerOpen) chat.setDrawerOpen(false);
        else if (surface === "chat" || surface === "room") openSurface("brain");
        else if (surface === "settings" || surface === "help") goBack();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [chat, navOpen, surface, path]);

  return (
    <div className={`shell${chat.streamingAny ? " is-streaming" : ""}`}>
      {/* The crescent lives in the chat and the room, overlaid at the
          shell's level: an open menu dims the page beneath it, so it must
          not sit inside what gets dimmed. It is a way between pages: the
          entries drop the page you are on (the component's own rule), and
          the chat's drawer already offers a new conversation and the
          history, so neither is repeated here. */}
      {surface === "chat" || surface === "room" ? (
        <CrescentNav
          entries={chatEntries}
          current={surface}
          open={navOpen}
          onOpenChange={setNavOpen}
        />
      ) : null}

      <header className="topbar">
        <div className="topbar-title">
          <button
            type="button"
            className="topbar-btn topbar-drawer-toggle"
            onClick={() => chat.setDrawerOpen((o) => !o)}
            aria-expanded={chat.drawerOpen}
            aria-label={chrome.showConversations}
          >
            {t.conversations}
          </button>
          <span className="topbar-mark" aria-hidden="true" />
          <h1>{title}</h1>
        </div>
        <div className="topbar-actions">
          {/* The app's own settings, in the app's own strip. The row below the
              bar on the home is the machine's (what runs on it, who can reach
              it, how it is launched); this is the door to the app's. One door
              per surface, by the same rule the crescent follows: not on
              Settings itself, where it would do nothing, and not on the chat
              or the room, whose own menu already carries it. */}
          {surface !== "settings" && surface !== "chat" && surface !== "room" ? (
            <button
              type="button"
              className="topbar-btn topbar-settings"
              onClick={() => openSurface("settings")}
              aria-label={chrome.settingsAria}
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
              {chrome.settings}
            </button>
          ) : null}
          {surface !== "settings" && surface !== "chat" && surface !== "room" && surface !== "help" ? (
            <button
              type="button"
              className="topbar-btn"
              onClick={() => openSurface("help")}
              aria-label={chrome.pages.help}
            >
              <span aria-hidden="true">?</span>
            </button>
          ) : null}
          {surface !== "brain" && surface !== "chat" ? (
            <button
              type="button"
              className="topbar-btn"
              onClick={goBack}
              aria-label={t.backTo(surfaceLabel(backTarget, table))}
            >
              {surfaceLabel(backTarget, table)}
            </button>
          ) : null}
          {surface === "chat" && chat.active ? (
            <button
              type="button"
              className="topbar-btn"
              onClick={() => chat.setPanelOpen((o) => !o)}
              aria-expanded={chat.panelOpen}
              aria-label={t.toggleFilesAria}
            >
              {t.files}
            </button>
          ) : null}
        </div>
      </header>

      <main className="stage">
        {chat.storageFull ? (
          <div className="storage-banner" role="alert">
            <span>{t.storageFull}</span>
            <button type="button" onClick={chat.dismissStorageFull}>
              {t.dismiss}
            </button>
          </div>
        ) : null}
        {/* The door's own sentence about this device's slot, where it arrived.
            A refusal is an alert — the chat it names did not open — while a
            door built without the tier is a status: the chat opened, and the
            sentence only says what the door cannot do. Neither is rewritten
            here: the door distinguishes a slot that is empty from one whose
            state is unknown, and a friendlier sentence would lose that. */}
        {notice ? (
          <div
            className={notice.failed ? "storage-banner" : "refusal-banner"}
            role={notice.failed ? "alert" : "status"}
          >
            <span>{notice.text}</span>
            <button
              type="button"
              onClick={() => {
                setSlotNotice(null);
                chat.dismissSlotNotice();
              }}
            >
              {t.dismiss}
            </button>
          </div>
        ) : null}
        {/* The ask lives at the stage's level, not inside the chat layout: a
            call can still be held after the owner navigates home, and the ask
            must stay on screen and answerable until it is answered. */}
        {chat.gateShown ? (
          <WebGateDialog id={chat.gateShown.id} check={chat.gateShown.check} waiting={chat.gateWaiting} onAnswer={chat.answerGate} />
        ) : null}
        {engine.recovered ? (
          <RecoveredNotice onSendLog={() => openSurface("models")} onDismiss={engine.dismiss} />
        ) : null}
        <ErrorBoundary>
          <TelemetryNotice />
          {surface === "brain" ? (
            <BrainSurface
              onNavigate={openSurface}
              onWrite={chat.writeFromBrain}
              onOpenChat={() => openSurface("chat")}
              onOpenRoom={() => openSurface("room")}
            />
          ) : surface === "chat" ? (
            <ChatSurface chat={chat} />
          ) : surface === "room" ? (
            <RoomSurface />
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
                // The form holds only the fields it knows; the record may
                // carry fields this version does not — a save must not
                // rewrite them away.
                const merged = { ...settings, ...next };
                setSettings(merged);
                saveSettings(merged);
                chat.clearContextCache();
              }}
            />
          ) : surface === "help" ? (
            <HelpSurface />
          ) : surface === "models" ? (
            <ModelsSurface
              onNavigate={openSurface}
              model={settings.model}
              onModelChange={(name) => {
                // The panel's blur is the one writer of the record; this
                // only keeps the app's own memory current so the chat uses
                // the new name without a reload.
                setSettings({ ...settings, model: name });
              }}
            />
          ) : surface === "server" ? (
            <ServerSurface />
          ) : surface === "devices" ? (
            <DevicesSurface onNavigate={openSurface} />
          ) : null}
        </ErrorBoundary>
      </main>

      <p className="visually-hidden" role="status">
        {liveMessage}
      </p>
    </div>
  );
}
