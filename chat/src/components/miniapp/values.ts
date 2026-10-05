/**
 * The coercions the miniapp block renderers share: a block arrives as an
 * open record, so every reader takes text, numbers and lists the same way.
 * Ported from the phone renderer's helpers.
 */

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function asArray(value: unknown, maxItems: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, maxItems) : [];
}

export function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatNumber(value: unknown, digits = 3): string {
  const parsed = asNumber(value, Number.NaN);
  if (!Number.isFinite(parsed)) return "--";
  return Number(parsed.toFixed(digits)).toString();
}
