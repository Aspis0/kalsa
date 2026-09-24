/** Fill the draft from a template, then return focus to the composer. */
export function applyTemplateSelection(
  prompt: string,
  changeDraft: (value: string) => void,
  focusComposer: () => void,
): void {
  changeDraft(prompt);
  focusComposer();
}
