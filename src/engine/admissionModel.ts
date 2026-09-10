/**
 * Resolve the catalog model that the next send will actually load. A lost id
 * scopes recovery in the caller; it never overrides the selected model.
 */
export function resolveAdmissionModel(input: {
  activeModelId: string | null;
  lostModelId: string | null;
  selectedModelId: string;
}): { mid: string; alreadyResidentPossible: boolean } {
  if (input.activeModelId === input.selectedModelId) {
    return { mid: input.selectedModelId, alreadyResidentPossible: true };
  }
  return { mid: input.selectedModelId, alreadyResidentPossible: false };
}
