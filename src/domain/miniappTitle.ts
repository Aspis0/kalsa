// The title a miniapp is shown under.

/** A calculator built without a title is stored with none, so the view names
 *  it in the interface's language. Every other miniapp shows the title it has. */
export function miniappDisplayTitle(
  miniapp: { kind: string; title: string },
  calculatorName: string,
): string {
  if (miniapp.title || miniapp.kind !== "quick_calculator") return miniapp.title;
  return calculatorName;
}
