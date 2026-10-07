/**
 * checklist → a single `checklist` block, 1..12 items, each `{id, title}`.
 * Accepts `steps: string[]` OR `items: Array<string | {id?, title, body?}>`.
 * The id keys the ticked state, so it must be stable for the life of the
 * stored envelope: a provided id is kept, everything else mints `item-N`.
 */

import { asString, asStringCapped, envelope, isPlainObject, isUnsafeId, MAX_ID_CHARS } from "./slots";
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

  const items: Record<string, unknown>[] = [];
  const taken = new Set<string>();
  let minted = 0;
  for (const entry of raw) {
    // Plain-string steps are capped too: an oversized step rejects the whole
    // build rather than emitting a title the 64 KiB guard might keep.
    let title: string | null;
    let given: string | null = null;
    if (typeof entry === "string") {
      title = asStringCapped(entry);
    } else if (isPlainObject(entry)) {
      // The timeline shape's `body` is folded into the title: nothing reads
      // a hidden field the renderer never drew.
      title = asStringCapped(entry.title) ?? asStringCapped(entry.body);
      given = asString(entry.id);
    } else {
      title = null;
    }
    if (!title) return null;
    // A provided id that is missing, unsafe to store, over the cap, or a
    // duplicate is replaced by a minted one: the id only keys the ticked
    // state, and two items answering to the same key would tick together.
    let id = given !== null && given.length <= MAX_ID_CHARS && !isUnsafeId(given) ? given : null;
    while (!id || taken.has(id)) id = `item-${(minted += 1)}`;
    taken.add(id);
    items.push({ id, title });
  }

  return envelope(
    "checklist",
    asString(slots.title) ?? "",
    [{ type: "checklist", title: asString(slots.title), items }],
  );
}
