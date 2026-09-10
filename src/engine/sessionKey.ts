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

export type PromptEnvInputs = {
  locale: string;
  hasTools: boolean;
  toolNames: readonly string[];
  blockFormat: string;
  facts: readonly string[];
};

function normalizedNames(names: readonly string[]): string {
  return [...new Set(names.filter((name) => name.length > 0))].sort().join("\u0000");
}

/** Return the prompt-env fields that changed between two live completions. */
export function promptEnvChangedFields(
  previous: PromptEnvInputs,
  next: PromptEnvInputs,
): string[] {
  const changed: string[] = [];
  if (previous.locale !== next.locale) changed.push("locale");
  if (previous.hasTools !== next.hasTools) changed.push("hasTools");
  if (normalizedNames(previous.toolNames) !== normalizedNames(next.toolNames)) {
    changed.push("toolNames");
  }
  if (previous.blockFormat !== next.blockFormat) changed.push("blockFormat");
  if (previous.facts.join("\n") !== next.facts.join("\n")) changed.push("facts");
  return changed;
}

/** Build a cheap GGUF identity from Expo's byte size and second-based mtime. */
export function modelFileIdFromInfo(
  info: { exists?: unknown; size?: unknown; modificationTime?: unknown },
  declaredSha?: string,
): string | null {
  if (
    info.exists !== true ||
    typeof info.size !== "number" ||
    !Number.isFinite(info.size) ||
    info.size < 0 ||
    typeof info.modificationTime !== "number" ||
    !Number.isFinite(info.modificationTime)
  ) {
    return null;
  }
  const digest = typeof declaredSha === "string" && declaredSha.length > 0
    ? `:${declaredSha}`
    : "";
  return `${Math.trunc(info.size)}:${Math.round(info.modificationTime * 1000)}${digest}`;
}

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
