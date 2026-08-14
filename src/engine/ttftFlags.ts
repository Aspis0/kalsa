/**
 * Flags that revert P1-1 memory-facts-tail (V2-0.1) and P1-2 disk-gate
 * (V2-0.2) without deleting that code. Default = new (fixed) behavior.
 * Set false to restore the old policy.
 *
 * V2-1: EAGER_ENGINE_INIT + claimEagerKick (one-shot per process+generation).
 */

/**
 * Memory facts ride the last user message (format B / user-prefix), not the
 * system prompt. A new fact then re-encodes only that tail — the stable
 * history prefix (and its KV) stays valid. Set false to restore facts-in-system
 * (a fact change invalidates the entire prefix).
 */
export const MEMORY_FACTS_ON_USER_TAIL = true;

/**
 * Re-send each completed format-B last-user prefix as later engine history.
 * Without this, llama.rn prefix-match dies at the previous user every turn.
 * Set false to restore ephemeral last-user-only injection.
 */
export const BAKE_FORMAT_B_USER_PREFIX = true;

/**
 * extractMemory must not leave chat KV cleared. Snapshot (or reuse the
 * just-saved .kvs) around the extract completion, then restore. Set false to
 * restore clearCache + kvHoldsChatSession=false (next turn 100% cold).
 */
export const EXTRACT_MEMORY_PRESERVE_CHAT_KV = true;

/**
 * Disk-gate on used tokens (n_past / history estimate), not full nCtx.
 * nCtx * 64 KiB * 1.5 is ~1.5 GiB at 16k — low-storage phones never saved.
 * Set false to restore that nCtx-sized check. Estimate lives in
 * sessionPersistence (resolveSessionDiskTokens / sessionDiskBytesRequired).
 */
export const SESSION_DISK_GATE_USED_TOKENS = true;

/**
 * Boot-kick chat engine load after the download probe (V2-1).
 * Set false to restore lazy first-send init.
 */
export const EAGER_ENGINE_INIT = true;

/**
 * One-shot eager-init claim. Survives AppShell remounts in the same JS process.
 * Returns true once per `${modelId}@${generation}`. A new generation (real
 * model switch) may claim again. Same key → false.
 */
let eagerKickKey: string | null = null;

export function claimEagerKick(modelId: string, generation: number): boolean {
  const key = `${modelId}@${generation}`;
  if (eagerKickKey === key) return false;
  eagerKickKey = key;
  return true;
}
