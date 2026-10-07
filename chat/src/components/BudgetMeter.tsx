import { CONTEXT_RESERVE_TOKENS } from "../lib/attachments";
import { fitView } from "../lib/fit";
import { useLanguage } from "../i18n/useLanguage";

interface BudgetMeterProps {
  contextTokens: number | null;
  /** How many files are attached: the unknown-size warning is about them. */
  fileCount: number;
  docTokens: number;
  historyTokens: number;
  /** Attached pictures: 560 tokens each (IMAGE_TOKENS), counted with the
      files until the send moves them into history. */
  imageCount: number;
  imageTokens: number;
}

/**
 * The fit's one sentence, and only when it matters: nothing at all while the
 * conversation has room, the almost-full warning once the free share of the
 * window runs low, and the unknown/too-much sentences the bar used to carry.
 * No figures — they are measures of text the owner cannot check.
 */
export function BudgetMeter({
  contextTokens,
  fileCount,
  docTokens,
  historyTokens,
  imageCount,
  imageTokens,
}: BudgetMeterProps) {
  const { table } = useLanguage();
  const t = table.files;
  const view = fitView(
    contextTokens,
    fileCount + imageCount,
    docTokens + imageTokens,
    historyTokens,
    CONTEXT_RESERVE_TOKENS,
  );
  if (view === "hidden" || view === "quiet") return null;
  if (view === "unknown") return <p className="budget-unknown">{t.budgetUnknown}</p>;
  if (view === "over") return <p className="budget-over">{t.budgetOver}</p>;
  return <p className="budget-almost">{t.budgetAlmostFull}</p>;
}
