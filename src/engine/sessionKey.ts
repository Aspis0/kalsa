/**
 * On-disk KV session identity: model + conversation + prompt-env hash.
 *
 * Prompt-env hash is computePromptEnvHash (locale / memory / tools). Engine
 * knobs and KV cache types stay in SessionMeta and still fail closed with a
 * named mismatch — they are not duplicated here.
 */

const SEP = "__";

/**
 * Path-safe and injective: `[A-Za-z0-9-]` stay, everything else is `_` + 4 hex
 * code units. `a/b` and `a_b` therefore cannot share a stem.
 */
export function sanitizeSessionSegment(value: string): string {
  if (typeof value !== "string" || value.length === 0) return "";
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 45
    ) {
      out += value[i];
    } else {
      out += `_${code.toString(16).padStart(4, "0")}`;
    }
  }
  return out;
}

/**
 * File stem (no directory, no .kvs). Null when any part is empty after sanitize.
 */
export function sessionStem(
  modelId: string,
  conversationId: string,
  promptEnvHash: string,
): string | null {
  const model = sanitizeSessionSegment(modelId);
  const conv = sanitizeSessionSegment(conversationId);
  const env = sanitizeSessionSegment(promptEnvHash);
  if (!model || !conv || !env) return null;
  return `${model}${SEP}${conv}${SEP}${env}`;
}

export type ParsedSessionStem = {
  modelId: string;
  conversationId: string;
  promptEnvHash: string;
};

/**
 * Parse a `.kvs` file name (not sidecars). Null for legacy `${modelId}.kvs`.
 * Splits on the last two SEP so a model id that still contains `__` round-trips.
 */
export function parseSessionStem(fileName: string): ParsedSessionStem | null {
  if (typeof fileName !== "string" || !fileName.endsWith(".kvs")) return null;
  if (
    fileName.endsWith(".kvs.meta") ||
    fileName.endsWith(".kvs.tmp") ||
    fileName.endsWith(".kvs.bak")
  ) {
    return null;
  }
  const base = fileName.slice(0, -".kvs".length);
  const second = base.lastIndexOf(SEP);
  if (second <= 0) return null;
  const first = base.lastIndexOf(SEP, second - 1);
  if (first < 0) return null;
  const modelId = base.slice(0, first);
  const conversationId = base.slice(first + SEP.length, second);
  const promptEnvHash = base.slice(second + SEP.length);
  if (!modelId || !conversationId || !promptEnvHash) return null;
  return { modelId, conversationId, promptEnvHash };
}

/** Pre-pool file: `${modelId}.kvs` with no conversation/env in the name. */
export function isLegacySessionFileName(fileName: string): boolean {
  if (typeof fileName !== "string" || !fileName.endsWith(".kvs")) return false;
  if (
    fileName.endsWith(".kvs.meta") ||
    fileName.endsWith(".kvs.tmp") ||
    fileName.endsWith(".kvs.bak")
  ) {
    return false;
  }
  return !fileName.slice(0, -".kvs".length).includes(SEP);
}

/** Pre-pool filename stem: same replaces as sessionPersistence.sanitizeModelId. */
export function legacySessionStem(modelId: string): string {
  if (typeof modelId !== "string") return "";
  return modelId.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
}
