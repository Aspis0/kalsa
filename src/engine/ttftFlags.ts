/**
 * Flags that revert P1-1 memory-facts-tail (V2-0.1) without deleting that code.
 * Default = new (fixed) behavior. Set false to restore the old policy.
 *
 * Do not add other v2 flags here until their steps land.
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
