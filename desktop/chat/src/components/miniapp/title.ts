/**
 * Which title the miniapp view shows: the saved one, unless an earlier build
 * stored that kind's English default — then the interface's own name.
 */

/** The English default each named kind's builder stored when no title was
 *  given. A saved title equal to it reads as no title. */
const FORMER_DEFAULT_TITLES: Record<string, string> = {
  compare_data: "Comparison",
  quick_calculator: "Calculator",
  reading_quiz: "Quiz",
  checklist: "Checklist",
};

/** The title the view shows: a saved title that is not the kind's former
 *  English default, else the interface's name for the kind, else the kind. */
export function displayTitle(title: string, kind: string, named: Record<string, string>): string {
  // `kind` comes from the model, so only own keys count ("constructor" is not a name).
  const former = Object.hasOwn(FORMER_DEFAULT_TITLES, kind) ? FORMER_DEFAULT_TITLES[kind] : undefined;
  const saved = title && title !== former ? title : "";
  return saved || (Object.hasOwn(named, kind) ? named[kind] : "") || kind;
}
