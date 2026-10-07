/**
 * Slot coercion for the miniapp builders: strict, so a bad slot returns null
 * instead of a half-built block. Shared by all six template builders.
 */

import type { Miniapp } from "./types";
import type { MiniappTemplateId } from "./templates";

/** Max chars for a single required slot string before the whole build is
 *  rejected. Backstopped by the per-block 64 KiB guard in `build.ts`. */
const MAX_SLOT_CHARS = 4000;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Non-empty trimmed string, or null. */
export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Non-empty trimmed string capped at MAX_SLOT_CHARS; null when empty or over
 *  the cap. Rejects oversized required fields loudly instead of emitting them. */
export function asStringCapped(value: unknown): string | null {
  const raw = asString(value);
  return raw === null || raw.length > MAX_SLOT_CHARS ? null : raw;
}

/** Array of non-empty strings capped at MAX_SLOT_CHARS, or null when any entry
 *  is not a string or is over the cap. */
export function asStringArrayCapped(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value) {
    const cleaned = asStringCapped(entry);
    if (cleaned === null) return null;
    out.push(cleaned);
  }
  return out;
}

/** Longest id a builder accepts for a field or checklist item: ids key the
 *  stored state, and past this they are noise, not identity. */
export const MAX_ID_CHARS = 64;

/** Ids that would write along an object's prototype chain instead of its own
 *  keys — an item or field with one can never be ticked or edited, so a
 *  builder never accepts one. */
export function isUnsafeId(id: string): boolean {
  return id === "__proto__" || id === "constructor" || id === "prototype";
}

/** Integer answer index that addresses a real option (0..length-1), else undefined. */
export function safeAnswerIndex(raw: unknown, optionCount: number): number | undefined {
  const asInt = (n: number) =>
    Number.isInteger(n) && n >= 0 && n < optionCount ? n : undefined;
  if (typeof raw === "number") return asInt(raw);
  if (typeof raw === "string" && /^\s*-?\d+\s*$/.test(raw)) {
    return asInt(Number(raw));
  }
  return undefined;
}

export function envelope(
  templateId: MiniappTemplateId,
  title: string,
  blocks: Array<Record<string, unknown>>,
): Miniapp {
  return {
    schema: "miniapp_v1",
    kind: templateId,
    title: title || "Miniapp",
    blocks,
  };
}
