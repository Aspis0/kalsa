import { CONTEXT_RESERVE_TOKENS } from "../lib/attachments";
import { useLanguage } from "../i18n/useLanguage";

interface BudgetMeterProps {
  contextTokens: number | null;
  docTokens: number;
  historyTokens: number;
}

/**
 * The context budget in the refusal's own terms: documents, conversation,
 * reserve, what is left. Unknown stays unknown — no bar at a made-up scale.
 * Static widths, no animation: it re-renders, never moves by itself.
 */
export function BudgetMeter({ contextTokens, docTokens, historyTokens }: BudgetMeterProps) {
  const { table, tag } = useLanguage();
  const t = table.files;
  // One formatter for every term, so the separators agree with the words.
  const fmt = (n: number): string => `≈${new Intl.NumberFormat(tag).format(n)}`;
  if (contextTokens === null) {
    return <p className="budget-unknown">{t.budgetUnknown}</p>;
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
          {t.filesTerm(fmt(docTokens))}
        </span>
        {" · "}
        <span data-term="history" data-n={historyTokens}>
          {t.conversationTerm(fmt(historyTokens))}
        </span>
        {" · "}
        <span data-term="reserve" data-n={reserve}>
          {t.reservedTerm(fmt(reserve))}
        </span>
        {" · "}
        {left >= 0 ? (
          <span data-term="left" data-n={left}>
            {t.leftTerm(fmt(left))}
          </span>
        ) : (
          <span data-term="left" data-n={left} className="budget-over">
            {t.overTerm(fmt(-left))}
          </span>
        )}{" "}
        <span data-term="total" data-n={contextTokens}>{t.ofTotal(fmt(contextTokens))}</span>
      </p>
    </div>
  );
}
