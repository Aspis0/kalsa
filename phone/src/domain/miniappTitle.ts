// How a miniapp is named for people and for files: its own title when the
// person gave one, else the interface's name for its kind.

/** Titles the phone stored when none was given, in English. Old builds wrote
 *  them into the envelope, so a saved one is no title the person chose. */
const GENERIC_DEFAULT_TITLE = "Miniapp";
const FORMER_DEFAULT_TITLES: Record<string, string[]> = {
  quick_calculator: ["Calculator"],
  compare_data: ["Comparison"],
  reading_quiz: ["Quiz"],
  checklist: ["Checklist"],
};

/** The i18n key naming each kind that has a default title. */
type KindNameKey = "renderer.calculator" | "renderer.kindCompareData" | "renderer.kindReadingQuiz" | "renderer.kindChecklist";
const KIND_NAME_KEYS: Record<string, KindNameKey> = {
  quick_calculator: "renderer.calculator",
  compare_data: "renderer.kindCompareData",
  reading_quiz: "renderer.kindReadingQuiz",
  checklist: "renderer.kindChecklist",
};

/** The title the person gave, or "" when the stored one is a default. */
function ownTitle(miniapp: { kind: string; title: string }): string {
  const title = miniapp.title.trim();
  const isDefault = title === GENERIC_DEFAULT_TITLE || (FORMER_DEFAULT_TITLES[miniapp.kind] ?? []).includes(title);
  return isDefault ? "" : title;
}

/** The title a miniapp is shown under. A kind with a name shows that name when
 *  the title is missing or a default; any other miniapp shows its stored title. */
export function miniappDisplayTitle(
  miniapp: { kind: string; title: string },
  t: (key: KindNameKey) => string,
): string {
  const own = ownTitle(miniapp);
  if (own) return own;
  const key = KIND_NAME_KEYS[miniapp.kind];
  return key ? t(key) : miniapp.title.trim();
}

function sanitizeFileStem(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
      .slice(0, 40) || "miniapp"
  );
}

/** The file name stem for an export: the kind and the person's own title, or
 *  just the name the interface gives an unnamed miniapp. */
export function miniappFileStem(miniapp: { kind: string; title: string }, displayTitle: string): string {
  const named = sanitizeFileStem(displayTitle);
  if (!ownTitle(miniapp)) return named;
  return `${sanitizeFileStem(miniapp.kind)}-${named}`;
}
