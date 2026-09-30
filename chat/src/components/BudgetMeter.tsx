import { CONTEXT_RESERVE_TOKENS } from "../lib/attachments";
import { useLanguage } from "../i18n/useLanguage";

interface BudgetMeterProps {
  contextTokens: number | null;
  docTokens: number;
  historyTokens: number;
}

/**
 * The fit bar: labelled segments, never figures — the numbers behind them
 * are measures of text the owner cannot check. Unknown stays unknown — no
 * bar at a made-up scale. Static widths, no animation: it re-renders, never
 * moves by itself.
 */
export function BudgetMeter({ contextTokens, docTokens, historyTokens }: BudgetMeterProps) {
  const { table } = useLanguage();
  const t = table.files;
  if (contextTokens === null) {
    return <p className="budget-unknown">{t.budgetUnknown}</p>;
  }
  const reserve = CONTEXT_RESERVE_TOKENS;
  const left = contextTokens - docTokens - historyTokens - reserve;
  if (left < 0) {
    return <p className="budget-over">{t.budgetOver}</p>;
  }
  const pct = (n: number): string => `${Math.min(100, Math.max(0, (n / contextTokens) * 100)).toFixed(1)}%`;
  return (
    <div className="budget">
      <div className="budget-bar" aria-hidden="true">
        <span className="budget-docs" style={{ width: pct(docTokens) }} />
        <span className="budget-history" style={{ width: pct(historyTokens) }} />
        <span className="budget-reserve" style={{ width: pct(reserve) }} />
      </div>
      <p className="budget-terms">
        <span data-term="docs">{t.budgetFiles}</span>
        {" · "}
        <span data-term="history">{t.budgetEarlier}</span>
        {" · "}
        <span data-term="reserve">{t.budgetKept}</span>
        {" · "}
        <span data-term="left">{t.budgetFree}</span>
      </p>
    </div>
  );
}
