import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { SurfaceKey } from "../app/surfaces";
import { SURFACES } from "../app/surfaces";
import { MachineCard } from "./MachineCard";
import type { Capability } from "./MachineCard";
import { FirstRun } from "./FirstRun";
import { SetupProgress } from "./SetupProgress";
import { available, invoke } from "../lib/tauri";
import { lastKnown } from "../lib/slotGate";
import { brainWords, useBrain } from "./useBrain";
import { useLanguage } from "../i18n/useLanguage";
import "./surfaces.css";
import "./BrainSurface.css";

// The opening's one automatic attempt to bring the brain up, as a fact of
// this open of the app: it stays pending until the capability read can act
// on it. Module scope, not component state — the brain page unmounts whenever
// the user opens a settings page, and the legacy check can outlive a mount —
// so leaving the page must neither lose the attempt nor spend it twice: a
// second automatic try would override a deliberate turn-off made on the
// Server page.
let automaticStartPending = true;

interface BrainSurfaceProps {
  onNavigate: (surface: SurfaceKey) => void;
  // Enter in the bar: opens the chat with the text as its first message.
  onWrite: (text: string) => void;
  // For someone who wants the chat without writing anything.
  onOpenChat: () => void;
  // The room, beside the chat in the bar.
  onOpenRoom: () => void;
}

// A first run is a machine with no stored choice. An install from before
// the choice has its model checked first (`migrating`) and may become one.
function firstRun(capability: Capability | null): boolean {
  return capability !== null && capability.kind !== "migrating" && !capability.chosen;
}

// The app's home. The brain alone: what the machine is doing, all the
// settings in one place, and one small bar to write in (§2, §5 of
// THE-BRAIN-IS-THE-HOME.md). It also owns the first walk: a machine that
// reads "stopped" is started here, on the spot, so getting ready never
// waits behind a tab. The walk's failures are not retried by themselves —
// they are spoken, and they wait for Try again.
export function BrainSurface({ onNavigate, onWrite, onOpenChat, onOpenRoom }: BrainSurfaceProps) {
  const { table } = useLanguage();
  const bar = table.brainBar;
  const { state, liveStep, heldFailure, stopFailure, busy, act, chooseModel } = useBrain();
  const [text, setText] = useState("");
  // The chooser's answer, read on mount and whenever a turn-on lands — the
  // walk can change what was measured, and a first walk can end having only
  // measured, which is exactly when the card must appear. There is no second
  // timer here: the machine is measured by the brain itself, and the shared
  // read already says when it moved.
  const [capability, setCapability] = useState<Capability | null>(null);
  const [reads, setReads] = useState(0);
  const previousKind = useRef<string | null>(null);
  // The last answer that landed, as the legacy check sees it: a read that
  // fails mid-check leaves this as it was, so the polling below keeps asking.
  const migrating = useRef(false);

  useEffect(() => {
    const kind = state?.kind ?? null;
    const previous = previousKind.current;
    previousKind.current = kind;
    // Read again whenever the brain ARRIVES at running, from wherever. Keyed
    // on an observed `starting` it missed a start fast enough to be read as
    // stopped and then running — one poll a second is not much — and the
    // card then said "this computer has not been measured yet" under "On"
    // for the life of the mount. `null` is the first observation, which the
    // mount read below already covers.
    if (previous !== null && previous !== "running" && kind === "running") {
      setReads((count) => count + 1);
    }
  }, [state]);

  useEffect(() => {
    // Outside the Tauri webview there is no chooser to ask: the page says
    // nothing about a machine it cannot read. A walk in flight would answer
    // stale, so the read waits for it to land (`busy` falling re-runs this).
    if (!available() || busy) return;
    let live = true;
    invoke<Capability>("brain_capability")
      .then((next) => {
        if (!live) return;
        migrating.current = next.kind === "migrating";
        setCapability(next);
      })
      .catch(() => {
        // A read that failed is not a machine that was never measured: the
        // answer before it stands, and only a page that never had one stays
        // blank — which is what keeps a failed first read off the screen.
        if (live) setCapability((previous) => lastKnown(previous, null));
      });
    return () => {
      live = false;
    };
  }, [reads, busy]);

  // Ask again until an answer lands: the legacy check takes about a minute,
  // and a read that fails — before the first answer or in the middle of the
  // check — keeps the 1 s timer going. `reads` is in the dependencies so a
  // failure on an already-blank answer reschedules too; one timer per run,
  // cleared on the way out.
  useEffect(() => {
    if (!available()) return;
    if (capability !== null && !migrating.current) return;
    const timer = window.setTimeout(() => setReads((count) => count + 1), 1000);
    return () => window.clearTimeout(timer);
  }, [capability, reads]);

  useEffect(() => {
    if (!automaticStartPending || !state || capability === null) return;
    if (capability.kind === "migrating") return;
    automaticStartPending = false;
    if (state.kind === "stopped" && !firstRun(capability)) void act();
  }, [state, act, capability]);

  const power = table.power;
  const words = brainWords(state, heldFailure, busy, table);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    onWrite(value);
  }

  // The read in flight is a blank: nothing on this page is true yet, and
  // "Off" with a Turn on button would promise a start the first run must
  // not make.
  if (capability === null) {
    return <div className="surface-page brain-page" />;
  }

  if (capability.kind === "migrating") {
    return (
      <div className="surface-page brain-page brain-first-run">
        <p className="surface-verdict">{table.setup.checkingModel}</p>
      </div>
    );
  }

  // The first run owns the page until a model is picked.
  if (firstRun(capability)) {
    return (
      <FirstRun
        capability={capability}
        liveStep={liveStep}
        starting={state?.kind === "starting"}
        onChoose={(token) => chooseModel(token)}
        onChecked={() => setReads((count) => count + 1)}
      />
    );
  }

  return (
    <div className="surface-page brain-page">
      {liveStep ? (
        <SetupProgress step={liveStep} />
      ) : (
        <>
          <div className="brain-presence">
            <p className="surface-verdict">{words.headline}</p>
            {/* A refused turn-off takes the sentence, on the page the button
                was pressed on. The hook produced it all along and only the
                Server page read it, so the owner pressed Turn off here,
                nothing happened, and here said nothing about it. */}
            <p className="surface-sentence">{stopFailure ? power.stopFailure : words.sentence}</p>
            <div className="surface-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={!words.enabled || busy}
                onClick={() => void act()}
              >
                {words.button}
              </button>
            </div>
          </div>
          {/* Not during the first walk: the page is showing progress then,
              and a measurement taken before it finished would be stale. */}
          {capability ? (
          <MachineCard
            capability={capability}
            running={state?.kind === "running" ? state.model : null}
            busy={busy}
            onChoose={(token) => void chooseModel(token)}
          />
        ) : null}
        </>
      )}

      {/* The machine, not the app: what runs on this computer, who can reach
          it, how it is launched. The app's own settings are behind the
          crescent in the chat — they mean something with the brain off, and a
          row called "Settings" holding an entry called "Settings" said
          neither. */}
      <nav className="brain-settings" aria-label={bar.thisComputer}>
        {/* The row says what it is, in its own voice: the chips under it are
            the machine's, and that is what makes the word in the header legible
            as the app's. It used to be the quiet uppercase eyebrow used for
            section labels, which read as a footnote over four buttons. */}
        <div className="brain-machine">
          <p className="brain-machine-label">{bar.thisComputer}</p>
        </div>
        {SURFACES.filter((surface) => surface.group === "machine").map((surface) => (
          <button
            type="button"
            key={surface.key}
            className="brain-settings-item"
            onClick={() => onNavigate(surface.key)}
          >
            {table.chrome.pages[surface.key] ?? surface.key}
          </button>
        ))}
      </nav>

      <form className="brain-bar" onSubmit={submit}>
        <input
          type="text"
          className="brain-bar-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={bar.placeholder}
          aria-label={bar.writeAria}
        />
        <button
          type="submit"
          className="brain-bar-action"
          disabled={text.trim().length === 0 || busy}
          aria-label={bar.send}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path
              d="M8 2.2v10.6M3.8 7 8 2.8 12.2 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button type="button" className="brain-bar-action brain-bar-chat" onClick={onOpenChat}>
          {bar.chat}
        </button>
        <button type="button" className="brain-bar-action brain-bar-chat" onClick={onOpenRoom}>
          {bar.room}
        </button>
      </form>
    </div>
  );
}
