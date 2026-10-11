// The shell: which surface is on screen, the rail between them, and the
// pieces that outlive any one surface — the slot banner,
// the web-call ask, the recovery notice, the screen-reader status line. The surfaces render
// themselves from their own files; the chat's state lives in the `useChat`
// hook (surfaces/useChat.ts), called HERE so it survives the chat page's
// unmounts.

import { useEffect, useState } from "react";
import { loadSettings, loadTheme, saveSettings, saveTheme, themeChoiceMade } from "./lib/settings";
import type { Theme } from "./lib/settings";
import type { ChatSettings } from "./lib/types";
import type { SlotNotice } from "./lib/slotGate";
import type { SurfaceKey } from "./app/surfaces";
import { Rail } from "./components/Rail";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RoomSurface } from "./surfaces/RoomSurface";
import { ChatSurface } from "./surfaces/ChatSurface";
import { useChat } from "./surfaces/useChat";
import { useLanguage } from "./i18n/useLanguage";
import { HelpSurface } from "./surfaces/HelpSurface";
import { TelemetryNotice } from "./components/TelemetryNotice";
import { SettingsForm } from "./components/SettingsForm";
import { BrainSurface } from "./surfaces/BrainSurface";
import { useBrain } from "./surfaces/useBrain";
import { ModelsSurface } from "./surfaces/ModelsSurface";
import { ExpertsSurface } from "./surfaces/ExpertsSurface";
import { DevicesSurface } from "./surfaces/DevicesSurface";
import { WebGateDialog } from "./components/WebGateDialog";
import { RecoveredNotice } from "./components/RecoveredNotice";
import { useEngineRecovery } from "./surfaces/useEngineRecovery";
import { useUpdates } from "./lib/useUpdates";
import { UpdateNotice } from "./components/UpdateNotice";
import "./App.css";

// How far the settings path may grow before the oldest step falls off. The
// surfaces' own hops are shallow; the bound is for the general case.
const PATH_LIMIT = 8;

export function App() {
  const { table } = useLanguage();
  const t = table.shell;
  // The brain is the home: the app opens on it.
  const [surface, setSurface] = useState<SurfaceKey>("brain");
  // The walk of settings surfaces taken to arrive at this one — the brain
  // is the path's root — so back can mean one step, not the whole way home.
  // The chat is not part of the path: leaving it is the rail's job.
  const [path, setPath] = useState<SurfaceKey[]>([]);
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
  const updates = useUpdates(chat.streamingAny);

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

  // Navigation can unmount the focused button, leaving keyboard events on the body.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        // Escape over a held call refuses it: the safest reading of a slam
        // on Escape is "no", never "send it".
        if (chat.gateShown) chat.answerGate(chat.gateShown.id, false);
        else if (chat.listOpen) chat.setListOpen(false);
        else if (surface === "chat" || surface === "room") openSurface("brain");
        else if (surface !== "brain") goBack();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [chat, surface, path]);

  return (
    <div className={`shell${chat.streamingAny ? " is-streaming" : ""}`}>
      <Rail current={surface} onOpen={openSurface} />
      <div className="shell-main">
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
          <div className="stage-notices">
            {engine.recovered ? (
              <RecoveredNotice onSendLog={() => openSurface("help")} onDismiss={engine.dismiss} />
            ) : null}
            <ErrorBoundary>
              <TelemetryNotice />
            </ErrorBoundary>
          </div>
          <ErrorBoundary>
            <UpdateNotice updates={updates} busy={chat.streamingAny} />
            {surface === "brain" ? (
              <BrainSurface onNavigate={openSurface} onOpenChat={() => openSurface("chat")} />
            ) : surface === "chat" ? (
              <ChatSurface chat={chat} restartedAt={engine.restartedAt} />
            ) : surface === "room" ? (
              <RoomSurface />
            ) : surface === "settings" ? (
              <SettingsForm
                initial={settings}
                theme={theme}
                onTheme={chooseTheme}
                updates={updates}
                busy={chat.streamingAny}
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
              <ModelsSurface onNavigate={openSurface} />
            ) : surface === "experts" ? (
              <ExpertsSurface
                // Back is one step when Your AI is the step before, as it is
                // from its own link; arriving from the chat it opens Your AI.
                onBack={() => (path[path.length - 1] === "models" ? goBack() : openSurface("models"))}
                model={settings.model}
                onModelChange={(name) => {
                  // The panel's blur is the one writer of the record; this
                  // only keeps the app's own memory current so the chat uses
                  // the new name without a reload.
                  setSettings({ ...settings, model: name });
                }}
              />
            ) : surface === "devices" ? (
              <DevicesSurface onNavigate={openSurface} />
            ) : null}
          </ErrorBoundary>
        </main>
      </div>

      <p className="visually-hidden" role="status">
        {liveMessage}
      </p>
    </div>
  );
}
