/**
 * Append-only tool-gate audit. Numbers and codes only — never query text,
 * never user content. Written only when the toolhelp flag is ON (caller
 * must not invoke this on the flag-off path).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export const GATE_AUDIT_KEY = "kalsa.ciswire.gateAudit";
export const GATE_AUDIT_CAP = 500;

export type GateAuditAction = "block" | "warn" | "rewrite" | "none";
export type GateAuditOutcome = "blocked" | "warned" | "passed";

export type GateAuditRecord = {
  turnId?: string;
  toolName: string;
  ruleId: string;
  action: GateAuditAction;
  outcome: GateAuditOutcome;
};

let writeChain: Promise<void> = Promise.resolve();

function isAction(value: unknown): value is GateAuditAction {
  return value === "block" || value === "warn" || value === "rewrite" || value === "none";
}

function isOutcome(value: unknown): value is GateAuditOutcome {
  return value === "blocked" || value === "warned" || value === "passed";
}

function sanitize(record: GateAuditRecord): GateAuditRecord {
  const out: GateAuditRecord = {
    toolName: String(record.toolName ?? ""),
    ruleId: String(record.ruleId ?? ""),
    action: isAction(record.action) ? record.action : "none",
    outcome: isOutcome(record.outcome) ? record.outcome : "passed",
  };
  if (typeof record.turnId === "string" && record.turnId) {
    out.turnId = record.turnId;
  }
  return out;
}

function parseList(raw: string | null): GateAuditRecord[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: GateAuditRecord[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Partial<GateAuditRecord>;
      if (typeof rec.toolName !== "string") continue;
      out.push(
        sanitize({
          turnId: rec.turnId,
          toolName: rec.toolName,
          ruleId: typeof rec.ruleId === "string" ? rec.ruleId : "",
          action: rec.action as GateAuditAction,
          outcome: rec.outcome as GateAuditOutcome,
        }),
      );
    }
    return out;
  } catch {
    return [];
  }
}

async function appendNow(record: GateAuditRecord): Promise<void> {
  const raw = await AsyncStorage.getItem(GATE_AUDIT_KEY);
  const list = parseList(raw);
  list.push(sanitize(record));
  const rotated = list.length > GATE_AUDIT_CAP ? list.slice(-GATE_AUDIT_CAP) : list;
  await AsyncStorage.setItem(GATE_AUDIT_KEY, JSON.stringify(rotated));
}

export async function appendGateAudit(record: GateAuditRecord): Promise<void> {
  writeChain = writeChain.then(
    () => appendNow(record),
    () => appendNow(record),
  );
  try {
    await writeChain;
  } catch {
    /* audit is best-effort — never fail the tool */
  }
}

export async function readGateAudit(): Promise<readonly GateAuditRecord[]> {
  const raw = await AsyncStorage.getItem(GATE_AUDIT_KEY);
  return parseList(raw);
}

/** Test helper: wipe the log. */
export async function clearGateAudit(): Promise<void> {
  writeChain = writeChain.then(
    () => AsyncStorage.removeItem(GATE_AUDIT_KEY).then(() => undefined),
    () => AsyncStorage.removeItem(GATE_AUDIT_KEY).then(() => undefined),
  );
  await writeChain;
}
