/**
 * checklist → a single `timeline` block, 1..12 entries. Accepts
 * `steps: string[]` OR `items: Array<string | {title, body?}>` and normalizes
 * them to the timeline renderer shape.
 */

import { asString, asStringCapped, envelope, isPlainObject } from "./slots";
import type { Miniapp } from "./types";

const MAX_STEPS = 12;

export function buildChecklist(slots: Record<string, unknown>): Miniapp | null {
  const rawSteps = slots.steps;
  const rawItems = slots.items;
  const raw = Array.isArray(rawSteps)
    ? rawSteps
    : Array.isArray(rawItems)
      ? rawItems
      : undefined;

  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_STEPS) {
    return null;
  }

  const steps: Record<string, unknown>[] = [];
  for (const entry of raw) {
    // Plain-string steps are capped too: an oversized step rejects the whole
    // build rather than emitting a title the 64 KiB guard might keep.
    const title = asStringCapped(entry);
    if (title) {
      steps.push({ title });
      continue;
    }
    if (!isPlainObject(entry)) return null;
    // The timeline renderer only shows title/label/time, so never store a
    // `body` field the UI ignores: promote `body` to the visible title only
    // when no title is given, then drop it.
    const stepTitle = asStringCapped(entry.title) ?? asStringCapped(entry.body);
    if (!stepTitle) return null;
    steps.push({ title: stepTitle });
  }

  return envelope(
    "checklist",
    asString(slots.title) ?? "Checklist",
    [{ type: "timeline", title: asString(slots.title), steps }],
  );
}
