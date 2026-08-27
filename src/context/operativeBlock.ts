/**
 * Compact operative block for chat turns (language / web_search / honesty / miniapp).
 * Same text for all placement formats — only position in the message list changes.
 * Optional frozen digest + rolling summary (ConversationCompactor / PIANO V4.2).
 */

import { getStrings, type Locale } from "../i18n";
import {
  DEFAULT_COMPACTOR_CONFIG,
  replaceLiteral,
  SUMMARY_BUDGET_CHARS,
  truncateBudget,
} from "./compactor";

/** Optional frozen context injected into the operative block. */
export type OperativeBlockContext = {
  digest?: string | null;
  summary?: string | null;
};

function isContext(
  value: string | null | OperativeBlockContext | undefined,
): value is OperativeBlockContext {
  return value !== null && value !== undefined && typeof value === "object";
}

/**
 * Build the operative instruction block in the settings language.
 * @param locale Settings locale ("en" | "it")
 * @param summaryOrCtx Legacy `summary: string | null`, or `{ digest, summary }`
 */
export function buildOperativeBlock(
  locale: Locale,
  summaryOrCtx: string | null | OperativeBlockContext = null,
): string {
  const s = getStrings(locale).operativeBlock;
  const parts = [s.language, s.webSearch, s.honesty, s.miniapp];

  let digest: string | null = null;
  let summary: string | null = null;
  if (isContext(summaryOrCtx)) {
    digest =
      typeof summaryOrCtx.digest === "string" ? summaryOrCtx.digest : null;
    summary =
      typeof summaryOrCtx.summary === "string" ? summaryOrCtx.summary : null;
  } else if (typeof summaryOrCtx === "string") {
    summary = summaryOrCtx;
  }

  const digestTrimmed = digest?.trim() ?? "";
  if (digestTrimmed.length > 0) {
    const capped = truncateBudget(
      digestTrimmed,
      DEFAULT_COMPACTOR_CONFIG.digestBudgetChars,
    );
    parts.push(replaceLiteral(s.digest, "{digest}", capped));
  }

  const summaryTrimmed = summary?.trim() ?? "";
  if (summaryTrimmed.length > 0) {
    const capped = truncateBudget(summaryTrimmed, SUMMARY_BUDGET_CHARS);
    parts.push(replaceLiteral(s.summary, "{summary}", capped));
  }

  return parts.join(" ");
}

/** True when digest or summary would add content to the operative block. */
export function hasOperativeContext(
  ctx: OperativeBlockContext | null | undefined,
): boolean {
  if (!ctx) return false;
  const d = typeof ctx.digest === "string" ? ctx.digest.trim() : "";
  const s = typeof ctx.summary === "string" ? ctx.summary.trim() : "";
  return d.length > 0 || s.length > 0;
}
