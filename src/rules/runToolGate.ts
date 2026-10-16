/**
 * Single tool-gate path. Callers: AppShell executeTool only.
 * Flag OFF: web_search/web_fetch tables only, no audit, warn ignored.
 * Flag ON: full registry, audit, warn prepend enabled.
 */

import { getStrings, type Locale } from "../i18n";
import { evaluateTurn, type TurnDecision } from "./evaluate";
import {
  appendGateAudit,
  type GateAuditAction,
  type GateAuditOutcome,
} from "./gateAuditLog";
import { resolveToolGateTable } from "./toolGateRegistry";

export type ToolGateResult = {
  blocked: boolean;
  text?: string;
  warnNote?: string;
  decision?: TurnDecision;
};

function snapshotInput(
  toolName: string,
  args: Record<string, unknown>,
  lastUserMessage: string,
  memoryFacts: readonly string[],
): Record<string, unknown> {
  if (toolName === "web_search" || toolName === "web_fetch") {
    return {
      ...(toolName === "web_fetch"
        ? {
            // Model tool args are JSON-serializable; String() matches webFetchTool.
            url: typeof args.url === "string" ? args.url : String(args.url ?? ""),
          }
        : {}),
      query: typeof args.query === "string" ? args.query : String(args.query ?? ""),
      lastUserMessage,
      memoryFacts,
    };
  }
  return { ...args, lastUserMessage, memoryFacts };
}

function blockText(
  toolName: string,
  reason: string | undefined,
  locale: Locale,
): string {
  const strings = getStrings(locale);
  if (toolName === "web_search") {
    if (reason === "empty-query") return strings.errors.emptySearchQuery;
    if (reason === "sensitive-pattern-in-query") {
      return strings.errors.webSearchSensitiveBlocked;
    }
    if (reason === "gate-error") return strings.errors.webSearchGateFailed;
    return strings.errors.webSearchPrivacyBlocked;
  }
  if (reason === "empty-range" || reason === "malformed-range") {
    return strings.errors.calendarRangeInvalid;
  }
  return strings.errors.toolPrivacyBlocked;
}

function auditAction(decision: TurnDecision): GateAuditAction {
  if (decision.blocked) return "block";
  if (decision.warned) return "warn";
  if (decision.appliedRewrites.length > 0) return "rewrite";
  return "none";
}

function auditOutcome(decision: TurnDecision): GateAuditOutcome {
  if (decision.blocked) return "blocked";
  if (decision.warned) return "warned";
  return "passed";
}

export function prependWarnNote(resultText: string, note: string): string {
  if (!note) return resultText;
  return `${note}\n\n${resultText}`;
}

export function applyWarnToResult<T extends { text: string }>(
  result: T,
  warnNote?: string,
): T {
  if (!warnNote) return result;
  return { ...result, text: prependWarnNote(result.text, warnNote) };
}

export async function runToolGate(opts: {
  toolName: string;
  args: Record<string, unknown>;
  lastUserMessage: string;
  memoryFacts: readonly string[];
  toolhelpOn: boolean;
  locale: Locale;
  turnId?: string;
}): Promise<ToolGateResult> {
  const table = resolveToolGateTable(opts.toolName, opts.toolhelpOn);
  if (!table) return { blocked: false };

  let decision: TurnDecision;
  try {
    decision = evaluateTurn(
      {
        toolName: opts.toolName,
        input: snapshotInput(
          opts.toolName,
          opts.args,
          opts.lastUserMessage,
          opts.memoryFacts,
        ),
      },
      table,
    );
  } catch {
    // Privacy gates fail closed if evaluation itself cannot complete.
    if (opts.toolhelpOn) {
      await appendGateAudit({
        turnId: opts.turnId,
        toolName: opts.toolName,
        ruleId: "gate-error",
        action: "block",
        outcome: "blocked",
      });
    }
    return {
      blocked: true,
      text: blockText(opts.toolName, "gate-error", opts.locale),
    };
  }

  if (opts.toolhelpOn) {
    await appendGateAudit({
      turnId: opts.turnId,
      toolName: opts.toolName,
      ruleId: decision.ruleId,
      action: auditAction(decision),
      outcome: auditOutcome(decision),
    });
  }

  if (decision.blocked) {
    return {
      blocked: true,
      text: blockText(opts.toolName, decision.reason, opts.locale),
      decision,
    };
  }

  const warnNote =
    opts.toolhelpOn && decision.warned
      ? getStrings(opts.locale).results.toolWarnedPrivacy
      : undefined;
  return { blocked: false, warnNote, decision };
}
