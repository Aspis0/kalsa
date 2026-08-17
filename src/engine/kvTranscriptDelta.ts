/**
 * Pure delta-rule helpers. No module state.
 */

export type KvRebuildReason =
  | "prefix_mismatch"
  | "fresh"
  | "system_prompt_changed"
  | "history_rewritten"
  | "kv_cleared"
  | "session_restore"
  | "completion_failed"
  | "eot_unknown"
  | "tool_round"
  | "commit_mismatch"
  | "context_full"
  | "truncated"
  | "media"
  | "pprev_sentinel";

export type AdvanceDecision =
  | { kind: "rebuild"; reason: KvRebuildReason }
  | { kind: "delta"; delta: string };

type RoleMsg = { role: string };

/** Dual 32-bit fingerprint (FNV-1a + sdbm). Smoke alarm, not a MAC. */
export function transcriptFingerprint(s: string): string {
  let fnv = 0x811c9dc5;
  let sdbm = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    fnv ^= c;
    fnv = Math.imul(fnv, 16777619);
    sdbm = c + (sdbm << 6) + (sdbm << 16) - sdbm;
  }
  return `${fnv >>> 0}:${sdbm >>> 0}`;
}

/** Last assistant inclusive; if none, leading non-user/non-tool. */
export function messagesThroughLastAssistant<T extends RoleMsg>(msgs: T[]): T[] {
  let lastAsst = -1;
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i]!.role === "assistant") {
      lastAsst = i;
      break;
    }
  }
  if (lastAsst >= 0) return msgs.slice(0, lastAsst + 1);
  const leading: T[] = [];
  for (const msg of msgs) {
    if (msg.role === "user" || msg.role === "tool") break;
    leading.push(msg);
  }
  return leading;
}

export function sliceDelta(pNew: string, pPrev: string): string | null {
  if (!pNew.startsWith(pPrev)) return null;
  if (pPrev.length > 0) {
    const last = pPrev.charCodeAt(pPrev.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) return null;
  }
  return pNew.slice(pPrev.length);
}

const DIVERGE_WIN = 80;

/** First UTF-16 offset where pPrev and pNew differ, plus a capped window each. */
export function firstDiverge(
  pNew: string,
  pPrev: string,
): { offset: number; prevWin: string; newWin: string } {
  const n = Math.min(pPrev.length, pNew.length);
  let i = 0;
  while (i < n && pPrev.charCodeAt(i) === pNew.charCodeAt(i)) i += 1;
  const half = DIVERGE_WIN / 2;
  const from = Math.max(0, i - half);
  return {
    offset: i,
    prevWin: pPrev.slice(from, from + DIVERGE_WIN),
    newWin: pNew.slice(from, from + DIVERGE_WIN),
  };
}

export function decideAdvance(args: {
  t: string;
  pPrev: string;
  pNew: string;
  envHash: string;
  envHashForT: string | undefined;
  lastPPrev: string | null;
  kvHoldsChatSession: boolean;
  pendingReason?: KvRebuildReason;
  commitLen?: number;
  commitFp?: string;
}): AdvanceDecision {
  const delta = sliceDelta(args.pNew, args.pPrev);
  if (delta === null) return { kind: "rebuild", reason: "prefix_mismatch" };
  if (
    args.commitLen !== undefined &&
    args.commitFp !== undefined &&
    (args.t.length !== args.commitLen ||
      transcriptFingerprint(args.t) !== args.commitFp)
  ) {
    return { kind: "rebuild", reason: "commit_mismatch" };
  }
  if (args.pendingReason) {
    return { kind: "rebuild", reason: args.pendingReason };
  }
  if (args.t === "") return { kind: "rebuild", reason: "fresh" };
  if (args.envHashForT !== undefined && args.envHashForT !== args.envHash) {
    return { kind: "rebuild", reason: "system_prompt_changed" };
  }
  if (args.lastPPrev !== null && !args.pPrev.startsWith(args.lastPPrev)) {
    return { kind: "rebuild", reason: "history_rewritten" };
  }
  if (!args.kvHoldsChatSession && args.t.length > 0) {
    return { kind: "rebuild", reason: "kv_cleared" };
  }
  return { kind: "delta", delta };
}

/** Bytes to append after raw emitted. Zero tokens → nothing (no EOT). */
export function generationSuffix(
  emitted: string,
  eot: string,
  stoppingWord: string,
  stoppedWord: string,
): string {
  if (emitted.length === 0) return "";
  if (eot.length > 0) {
    if (emitted.endsWith(eot)) return "";
    return eot;
  }
  const word = stoppingWord || stoppedWord || "";
  if (word.length > 0 && !emitted.endsWith(word)) return word;
  return "";
}

/** Native refusal / abort → do not commit. context_full wins (prompt not accepted). */
export function refuseReasonFromResult(flags: {
  context_full?: boolean;
  truncated?: boolean;
  interrupted?: boolean;
}): KvRebuildReason | null {
  if (flags.context_full) return "context_full";
  if (flags.truncated) return "truncated";
  if (flags.interrupted) return "completion_failed";
  return null;
}
