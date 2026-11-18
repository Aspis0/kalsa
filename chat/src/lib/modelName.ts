import type { English } from "../i18n/en/all";

// Every catalog display name is written maker then model ("Alibaba Qwen 3.6");
// the page says the model first, the mockup's way. A one-word name has no
// maker to move.
function split(displayName: string): { model: string; maker: string | null } {
  const space = displayName.indexOf(" ");
  return space <= 0
    ? { model: displayName, maker: null }
    : { model: displayName.slice(space + 1), maker: displayName.slice(0, space) };
}

/** "Qwen 3.6": the name in a sentence or a title. */
export function modelOnly(displayName: string): string {
  return split(displayName).model;
}

/** "Qwen 3.6 by Alibaba": the card's small line. */
export function modelByMaker(t: English["machine"], displayName: string): string {
  const { model, maker } = split(displayName);
  return maker ? t.byMaker(model, maker) : model;
}
