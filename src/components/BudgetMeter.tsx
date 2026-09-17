import { CONTEXT_RESERVE_TOKENS } from "../lib/attachments";

interface BudgetMeterProps {
  contextTokens: number | null;
  docTokens: number;
  historyTokens: number;
}

function fmt(n: number): string {
  return `≈${n.toLocaleString()}`;
}

/**
 * The context budget in the refusal's own terms: documents, conversation,
 * reserve, what is left. Unknown stays unknown — no bar at a made-up scale.
 * Static widths, no animation: it re-renders, never moves by itself.
 */
export function BudgetMeter({ contextTokens, docTokens, historyTokens }: BudgetMeterProps) {
  if (contextTokens === null) {
    return <p className="budget-unknown">Context size unknown — files attach unchecked.</p>;
  }
  const reserve = CONTEXT_RESERVE_TOKENS;
  const left = contextTokens - docTokens - historyTokens - reserve;
  const pct = (n: number): string => `${Math.min(100, Math.max(0, (n / contextTokens) * 100)).toFixed(1)}%`;
  return (
    <div className="budget">
      <div className="budget-bar" aria-hidden="true">
        <span className="budget-docs" style={{ width: pct(docTokens) }} />
        <span className="budget-history" style={{ width: pct(historyTokens) }} />
        <span className="budget-reserve" style={{ width: pct(reserve) }} />
      </div>
      <p className="budget-terms">
        <span data-term="docs" data-n={docTokens}>
          {fmt(docTokens)} files
        </span>
        {" · "}
        <span data-term="history" data-n={historyTokens}>
          {fmt(historyTokens)} conversation
        </span>
        {" · "}
        <span data-term="reserve" data-n={reserve}>
          {fmt(reserve)} reserved
        </span>
        {" · "}
        {left >= 0 ? (
          <span data-term="left" data-n={left}>
            {fmt(left)} left
          </span>
        ) : (
          <span data-term="left" data-n={left} className="budget-over">
            {fmt(-left)} over
          </span>
        )}{" "}
        of <span data-term="total" data-n={contextTokens}>{fmt(contextTokens)}</span>
      </p>
    </div>
  );
}
