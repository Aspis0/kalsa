import { useEffect, useRef, useState } from "react";
import "./ThoughtCloud.css";

interface ThoughtCloudProps {
  messageId: string;
  reasoning: string;
  reasoningMs?: number;
  /** Reasoning tokens are still arriving and no answer yet. */
  working: boolean;
  /** Answer text has started arriving. */
  answered: boolean;
}

function lastLine(reasoning: string): string {
  const lines = reasoning.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines.at(-1) ?? "").slice(-140);
}

function summary(reasoningMs?: number): string {
  if (reasoningMs === undefined) return "Thinking";
  if (reasoningMs < 1000) return "Thought for less than a second";
  const seconds = Math.round(reasoningMs / 100) / 10;
  return `Thought for ${seconds} s`;
}

/**
 * The model's thinking as a thought bubble above its answer: a lumpy cloud,
 * a trail of bubbles between the cloud and the first line of the reply —
 * this thought produced that sentence. Collapsed always, unless opened.
 *
 * The trail moves with meaning: while thinking, bubbles rise from the answer
 * into the cloud; when the answer starts, they settle down once and stop.
 * At rest nothing moves. The rise pace follows the real token rate (measured
 * here, written to a CSS variable at most ~3 times a second, never per
 * token). Transform and opacity only, always.
 */
export function ThoughtCloud({ messageId, reasoning, reasoningMs, working, answered }: ThoughtCloudProps) {
  const [open, setOpen] = useState(false);
  const [settling, setSettling] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rose = useRef(false);
  const arrivals = useRef<number[]>([]);
  const lastTempoWrite = useRef(0);
  const bodyId = `thought-${messageId}`;
  const ticker = lastLine(reasoning);

  const rising = working && !answered;

  // The settle gesture plays once, on the rise -> answer transition.
  useEffect(() => {
    if (rising) {
      rose.current = true;
      return;
    }
    if (!rose.current) return;
    rose.current = false;
    if (!answered) return;
    setSettling(true);
    const t = window.setTimeout(() => setSettling(false), 1500);
    return () => window.clearTimeout(t);
  }, [rising, answered]);

  // Heartbeat, not decoration: bubble pace tracks reasoning token rate.
  // Direct DOM write, throttled — no re-render, at most ~3 writes a second.
  useEffect(() => {
    if (!rising) return;
    const now = performance.now();
    arrivals.current = [...arrivals.current.filter((t) => now - t < 2000), now];
    if (now - lastTempoWrite.current < 350) return;
    lastTempoWrite.current = now;
    const rate = arrivals.current.length / 2;
    const period = Math.min(2.4, Math.max(0.7, 1.8 / Math.max(rate, 0.6)));
    wrapRef.current?.style.setProperty("--bubble-period", `${period.toFixed(2)}s`);
  }, [reasoning, rising]);

  const phase = rising ? "thought-rise" : settling ? "thought-settle" : "thought-rest";

  return (
    <div ref={wrapRef} className={`thought ${phase}${working ? " thought-working" : ""}`}>
      <button
        type="button"
        className="thought-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="thought-face">
          {working ? ticker || "Thinking…" : summary(reasoningMs)}
        </span>
        <span className="thought-toggle">{open ? "Hide ▲" : "Show thinking ▼"}</span>
      </button>
      {open ? (
        <div className="thought-body" id={bodyId} role="region" aria-label="Model thinking" tabIndex={0}>
          {reasoning}
        </div>
      ) : null}
      <div className="thought-trail" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
