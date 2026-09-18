import { useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import type { SurfaceKey } from "../app/surfaces";
import { SURFACES } from "../app/surfaces";
import { SetupProgress } from "./SetupProgress";
import { brainWords, useBrain } from "./useBrain";
import "./surfaces.css";
import "./BrainSurface.css";

// True once this open of the app has tried to bring the brain up. Module
// scope, not component state: the brain page unmounts whenever the user
// opens a settings page, and a second automatic try on the way back would
// override a deliberate turn-off made on the Server page.
let triedBringingUp = false;

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

  useEffect(() => {
    if (triedBringingUp || !state) return;
    triedBringingUp = true;
    if (state.kind === "stopped") void act();
  }, [state, act]);

  const words = brainWords(state, heldFailure);

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
