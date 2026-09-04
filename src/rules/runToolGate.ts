/**
 * Single tool-gate path. Callers: AppShell executeTool only.
 * Flag OFF: web_search table only, no audit, warn ignored.
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

const FACT_CAP = 10;

export type ToolGateResult = {
  blocked: boolean;
  text?: string;
  warnNote?: string;
  decision?: TurnDecision;
};

function asFacts(facts: readonly string[]): string[] {
  return facts.slice(0, FACT_CAP);
}

function snapshotInput(
  toolName: string,
  args: Record<string, unknown>,
  lastUserMessage: string,
  memoryFacts: readonly string[],
): Record<string, unknown> {
  const facts = asFacts(memoryFacts);
  if (toolName === "web_search") {
    return {
      query: typeof args.query === "string" ? args.query : String(args.query ?? ""),
      lastUserMessage,
      memoryFacts: facts,
    };
  }
  return { ...args, lastUserMessage, memoryFacts: facts };
}

function blockText(
  toolName: string,
  reason: string | undefined,
  locale: Locale,
): string {
  const strings = getStrings(locale);
  if (toolName === "web_search") {
    if (reason === "empty-query") return strings.errors.emptySearchQuery;
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

  const decision = evaluateTurn(
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
