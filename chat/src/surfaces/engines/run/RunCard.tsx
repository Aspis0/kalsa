import type { ReactNode } from "react";

export type Dot = "ring" | "busy" | "on" | "err";

/** The frame every state of the engine panel shares: a dot, a label, a short line, and the actions. */
export function RunCard({
  dot,
  label,
  sub,
  actions,
  children,
}: {
  dot: Dot;
  label: string;
  sub?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="run-card" aria-live="polite">
      <div className="run-head">
        <span className={`run-dot ${dot}`} aria-hidden="true" />
        <h2 className="run-label">{label}</h2>
        {sub ? <span className="run-sub">{sub}</span> : null}
        <span className="run-sp" />
        {actions}
      </div>
      {children ? <div className="run-body">{children}</div> : null}
    </section>
  );
}
