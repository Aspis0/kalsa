/**
 * Pure turn-evaluation engine. Semantics lifted from ciswire evaluateTurn:
 * frozen input snapshot, priority-then-declaration order, block short-circuit,
 * rewrites applied only after every condition has run.
 */

export type RuleAction =
  | { kind: "block"; reason: string }
  | { kind: "rewrite"; param: string; value: unknown }
  | { kind: "warn" };

export interface Rule {
  id: string;
  priority: number;
  condition: (input: Readonly<Record<string, unknown>>) => boolean;
  action: RuleAction;
}

export interface RuleTable {
  rules: readonly Rule[];
}

export interface TurnSnapshot {
  toolName: string;
  input: Readonly<Record<string, unknown>>;
}

export interface AppliedRewrite {
  ruleId: string;
  param: string;
  value: unknown;
}

export interface TurnTraceRow {
  ruleId: string;
  conditionResult: boolean;
  priority: number;
  declarationOrder: number;
  fired: boolean;
  shadowed?: boolean;
  shadowedByRule?: string;
  action?: RuleAction;
  error?: string;
}

export interface TurnTrace {
  toolName: string;
  snapshot: TurnSnapshot;
  rows: TurnTraceRow[];
  appliedRewrites: AppliedRewrite[];
}

export interface TurnDecision {
  blocked: boolean;
  reason?: string;
  /** True when a warn rule fired and no block won. Tool still runs. */
  warned: boolean;
  /** Winning rule id (block, warn, or first rewrite); empty when none fired. */
  ruleId: string;
  appliedRewrites: AppliedRewrite[];
  trace: TurnTrace;
}

export function evaluateTurn(
  snapshot: TurnSnapshot,
  table: RuleTable,
): TurnDecision {
  // Frozen for the whole turn — one rule's rewrite cannot be seen by another.
  const frozenInput = Object.freeze({ ...snapshot.input });

  const indexed = table.rules.map((rule, declarationOrder) => ({
    rule,
    declarationOrder,
  }));
  // Declaration order, then priority DESC; ties keep declaration order.
  indexed.sort((a, b) => {
    const dp = b.rule.priority - a.rule.priority;
    if (dp !== 0) return dp;
    return a.declarationOrder - b.declarationOrder;
  });

  const rows: TurnTraceRow[] = [];
  const fired: Array<{
    row: TurnTraceRow;
    rule: Rule;
    declarationOrder: number;
  }> = [];

  for (const { rule, declarationOrder } of indexed) {
    const row: TurnTraceRow = {
      ruleId: rule.id,
      conditionResult: false,
      priority: rule.priority,
      declarationOrder,
      fired: false,
    };
    rows.push(row);
    let conditionResult = false;
    try {
      conditionResult = rule.condition(frozenInput);
    } catch (err) {
      row.error = String(err);
      continue;
    }
    row.conditionResult = conditionResult;
    if (!conditionResult) continue;
    row.fired = true;
    row.action = rule.action;
    fired.push({ row, rule, declarationOrder });
  }

  const appliedRewrites: AppliedRewrite[] = [];
  const blockCandidate = fired.find((entry) => entry.row.action?.kind === "block");

  if (blockCandidate) {
    for (const other of fired) {
      if (other === blockCandidate) continue;
      other.row.shadowed = true;
      other.row.shadowedByRule = blockCandidate.rule.id;
    }
    const action = blockCandidate.row.action;
    const reason = action?.kind === "block" ? action.reason : undefined;
    return {
      blocked: true,
      reason,
      warned: false,
      ruleId: blockCandidate.rule.id,
      appliedRewrites,
      trace: makeTrace(snapshot.toolName, frozenInput, rows, appliedRewrites),
    };
  }

  const warnCandidate = fired.find((entry) => entry.row.action?.kind === "warn");
  if (warnCandidate) {
    for (const other of fired) {
      if (other === warnCandidate) continue;
      if (other.row.action?.kind !== "warn") continue;
      other.row.shadowed = true;
      other.row.shadowedByRule = warnCandidate.rule.id;
    }
  }

  const paramWinners = new Map<string, string>();
  for (const entry of fired) {
    const action = entry.row.action;
    if (!action || action.kind !== "rewrite") continue;
    const existing = paramWinners.get(action.param);
    if (!existing) {
      paramWinners.set(action.param, entry.rule.id);
      appliedRewrites.push({
        ruleId: entry.rule.id,
        param: action.param,
        value: action.value,
      });
    } else {
      entry.row.shadowed = true;
      entry.row.shadowedByRule = existing;
    }
  }

  const ruleId = warnCandidate
    ? warnCandidate.rule.id
    : (appliedRewrites[0]?.ruleId ?? "");
  return {
    blocked: false,
    warned: Boolean(warnCandidate),
    ruleId,
    appliedRewrites,
    trace: makeTrace(snapshot.toolName, frozenInput, rows, appliedRewrites),
  };
}

function makeTrace(
  toolName: string,
  frozenInput: Readonly<Record<string, unknown>>,
  rows: TurnTraceRow[],
  appliedRewrites: AppliedRewrite[],
): TurnTrace {
  return {
    toolName,
    snapshot: { toolName, input: frozenInput },
    rows,
    appliedRewrites,
  };
}
