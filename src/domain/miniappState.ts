// The state a mini app keeps in its envelope (`miniapp.state`): the readers
// that resolve it against a block, and the transitions the widgets write
// through. State is keyed by stable ids — the checklist builder's item ids,
// falling back to the item's position when a hand-written block gave none —
// never by anything that moves when the conversation is replayed.

import { isPlainObject } from "./miniappBuilderCommon";

/** The checklist items a block holds, ids resolved: the builder's `{id,
 *  title}` items, or a hand-written block whose items have no id and fall
 *  back to their index — stable in a stored payload just as much. */
export function checklistItems(
  block: Record<string, unknown>,
): Array<{ id: string; title: string }> {
  const items = Array.isArray(block.items) ? block.items : [];
  return items.flatMap((entry, index) => {
    if (!isPlainObject(entry)) return [];
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (!title) return [];
    return [{ id: typeof entry.id === "string" && entry.id ? entry.id : String(index), title }];
  });
}

/** True when the checklist item with this id is ticked. */
export function isItemTicked(state: unknown, itemId: string): boolean {
  const checked = isPlainObject(state) && isPlainObject(state.checked) ? state.checked : {};
  return checked[itemId] === true;
}

/** Tick or untick one checklist item; unticking removes the key, so the
 *  state never grows a graveyard of `false`s. */
export function toggleChecklistItem(
  state: Record<string, unknown>,
  itemId: string,
  ticked: boolean,
): Record<string, unknown> {
  const checked = { ...(isPlainObject(state.checked) ? state.checked : {}) };
  if (ticked) checked[itemId] = true;
  else delete checked[itemId];
  return { ...state, checked };
}
