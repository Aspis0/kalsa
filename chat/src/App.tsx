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
import { MailSettingsPage } from "./components/mail/MailSettingsPage";
import { modelOnly } from "./lib/modelName";
import { BrainSurface } from "./surfaces/BrainSurface";
import { useBrain } from "./surfaces/useBrain";
import { ModelsSurface } from "./surfaces/ModelsSurface";
import { ExpertsSurface } from "./surfaces/ExpertsSurface";
import { DevicesSurface } from "./surfaces/DevicesSurface";
import { WebGateDialog } from "./components/WebGateDialog";
import { RecoveredNotice } from "./components/RecoveredNotice";
import { useEngineRecovery } from "./surfaces/useEngineRecovery";
import { useUpdates } from "./lib/useUpdates";
import { startPhoneChatRunner } from "./lib/phone/phoneRunner";
import { UpdateNotice } from "./components/UpdateNotice";
import { Icon } from "./components/Icon";
import "./components/NoticeBanner.css";
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

  // A paired phone's turn runs in this window whichever page is shown.
  useEffect(() => startPhoneChatRunner(), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Automatic — no choice stored — follows the operating system while it
  // changes, including after Settings drops a choice made earlier.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      if (!themeChoiceMade()) setTheme(mq.matches ? "dark" : "light");
    };
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
        else if (updates.state.notice) updates.dismissNotice();
        else if (surface === "chat" || surface === "room") openSurface("brain");
        else if (surface !== "brain") goBack();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [chat, surface, path, updates]);

  return (
    <div className={`shell${chat.streamingAny ? " is-streaming" : ""}`}>
      <Rail current={surface} onOpen={openSurface} />
      <div className="shell-main">
        <main className="stage">
          {chat.storageFull ? (
            <div className="notice-banner is-warn" data-notice="storage" role="alert">
              <span className="notice-banner-icon">
                <Icon name="hdd" size={20} />
              </span>
              <span className="notice-banner-text">{t.storageFull}</span>
              <button type="button" className="notice-banner-btn" onClick={chat.dismissStorageFull}>
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
              className={notice.failed ? "notice-banner is-warn" : "notice-banner"}
              data-notice={notice.failed ? "slot-failed" : "slot"}
              role={notice.failed ? "alert" : "status"}
            >
              <span className="notice-banner-icon">
                <Icon name={notice.failed ? "alert" : "clock"} size={20} />
              </span>
              <span className="notice-banner-text">{notice.text}</span>
              <button
                type="button"
                className="notice-banner-btn"
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
            <UpdateNotice key={surface === "brain" ? "sheet" : "banner"} updates={updates} busy={chat.streamingAny} sheet={surface === "brain"} />
            {surface === "brain" ? (
              <BrainSurface onNavigate={openSurface} onOpenChat={() => openSurface("chat")} updates={updates} />
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
                aiName={state?.kind === "running" && state.model ? modelOnly(state.model) : null}
                onOpenAi={() => openSurface("models")}
                onOpenMail={() => openSurface("mail")}
                onWebTools={(webTools) => {
                  // Writes only itself, from the settings that are already
                  // stored: the text sitting unsaved in the connection fields is
                  // neither committed nor wiped by touching this.
                  const next = { ...settings, webTools };
                  setSettings(next);
                  saveSettings(next);
                }}
              />
            ) : surface === "mail" ? (
              <MailSettingsPage onBack={goBack} />
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
                  // the new name without a reload. The context sizes the chat
                  // has read belong to the model it was talking to.
                  setSettings({ ...settings, model: name });
                  chat.clearContextCache();
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
