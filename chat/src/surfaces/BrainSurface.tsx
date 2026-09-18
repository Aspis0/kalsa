import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import type { SurfaceKey } from "../app/surfaces";
import { SURFACES } from "../app/surfaces";
import { MachineCard } from "./MachineCard";
import type { Capability } from "./MachineCard";
import { SetupProgress } from "./SetupProgress";
import { available, invoke } from "../lib/tauri";
import { brainWords, useBrain } from "./useBrain";
import "./surfaces.css";
import "./BrainSurface.css";

// True once this open of the app has had its one automatic attempt to
// bring the brain up. Module scope, not component state: the brain page
// unmounts whenever the user opens a settings page, and a second automatic
// try on the way back would override a deliberate turn-off made on the
// Server page.
let automaticStartUsed = false;

interface BrainSurfaceProps {
  onNavigate: (surface: SurfaceKey) => void;
  // Enter in the bar: opens the chat with the text as its first message.
  onWrite: (text: string) => void;
  // For someone who wants the chat without writing anything.
  onOpenChat: () => void;
}

// The app's home. The brain alone: what the machine is doing, all the
// settings in one place, and one small bar to write in (§2, §5 of
// THE-BRAIN-IS-THE-HOME.md). It also owns the first walk: a machine that
// reads "stopped" is started here, on the spot, so getting ready never
// waits behind a tab. The walk's failures are not retried by themselves —
// they are spoken, and they wait for Try again.
export function BrainSurface({ onNavigate, onWrite, onOpenChat }: BrainSurfaceProps) {
  const { state, liveStep, heldFailure, busy, act } = useBrain();
  const [text, setText] = useState("");
  // Whether this mount carries the opening's one automatic attempt. Spent
  // on first appearance — before any read lands — so nothing the owner does
  // elsewhere inside the first moment (a turn-off on the Server page, say)
  // can be undone by an attempt that fires when the read finally arrives.
  const carriesAutomaticStart = useRef(false);
  // The chooser's answer, read on mount and once more when a turn-on
  // finishes — a real turn-on can change what was measured. There is no
  // second timer here: the machine is measured by the brain itself, and the
  // shared read already says when it moved.
  const [capability, setCapability] = useState<Capability | null>(null);
  const [reads, setReads] = useState(0);
  const previousKind = useRef<string | null>(null);

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
    // nothing about a machine it cannot read.
    if (!available()) return;
    let live = true;
    invoke<Capability>("brain_capability")
      .then((next) => {
        if (live) setCapability(next);
      })
      .catch(() => {
        // A read that failed leaves the card off the page rather than
        // showing a machine that was never measured.
        if (live) setCapability(null);
      });
    return () => {
      live = false;
    };
  }, [reads]);

  useEffect(() => {
    if (!automaticStartUsed) {
      automaticStartUsed = true;
      // The ref survives StrictMode's double invocation; the module flag
      // makes the second run leave the budget spent.
      carriesAutomaticStart.current = true;
    }
  }, []);

  useEffect(() => {
    if (!carriesAutomaticStart.current || !state) return;
    carriesAutomaticStart.current = false;
    if (state.kind === "stopped") void act();
  }, [state, act]);

  const words = brainWords(state, heldFailure, busy);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    onWrite(value);
  }

  return (
    <div className="surface-page brain-page">
      {liveStep ? (
        <SetupProgress step={liveStep} />
      ) : (
        <>
          <div className="brain-presence">
            <p className="surface-verdict">{words.headline}</p>
            <p className="surface-sentence">{words.sentence}</p>
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
          {capability ? <MachineCard capability={capability} /> : null}
        </>
      )}

      <nav className="brain-settings" aria-label="Settings">
        <p className="surface-eyebrow">Settings</p>
        {SURFACES.map((surface) => (
          <button
            type="button"
            key={surface.key}
            className="brain-settings-item"
            onClick={() => onNavigate(surface.key)}
          >
            {surface.label}
          </button>
        ))}
      </nav>

      <form className="brain-bar" onSubmit={submit}>
        <input
          type="text"
          className="brain-bar-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Say something…"
          aria-label="Write to the brain"
          // The bar is what becomes the first message (§3): the name is how
          // the transition finds it.
          style={{ viewTransitionName: "brain-bar" } as CSSProperties}
        />
        <button
          type="submit"
          className="brain-bar-action"
          disabled={text.trim().length === 0}
          aria-label="Send"
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
          Chat
        </button>
      </form>
    </div>
  );
}
