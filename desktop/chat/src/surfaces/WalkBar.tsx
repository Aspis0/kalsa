import "./WalkBar.css";

/** The walk's bar (RULES.md "Tree progress"): 560×14, the phase's own percent
    as its fill, a moving segment when the phase has none, amber on failure. */
export function WalkBar({ pct, label, valueText = null, failed = false }: { pct: number | null; label: string; valueText?: string | null; failed?: boolean }) {
  const shown = pct === null ? null : Math.min(Math.max(pct, 0), 100);
  return (
    <div
      className={`walk-bar${shown === null ? " is-indeterminate" : ""}${failed ? " is-failed" : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      // An indeterminate bar has no value to name: its not knowing IS the
      // information (the phase carries no fraction).
      aria-valuenow={shown ?? undefined}
      aria-valuetext={valueText ?? undefined}
    >
      <span className="walk-bar-fill" style={shown === null ? undefined : { width: `${shown}%` }} />
    </div>
  );
}
