/**
 * Settings draft vs storage. Empty URL/token from an unhydrated form must
 * never reach AsyncStorage / SecureStore.
 *
 * Dirty is tracked PER FIELD: an edit in one field must not throw away the
 * stored value of the others — dropping the whole hydration left URL and token
 * empty, and committing that empty token deletes the user's credential.
 */

export type RemoteSettingsField = "url" | "serverModel" | "maxTokens" | "token";

export function shouldHydrateField(input: {
  cancelled: boolean;
  dirty: ReadonlySet<RemoteSettingsField>;
  field: RemoteSettingsField;
}): boolean {
  return !input.cancelled && !input.dirty.has(input.field);
}

export function canCommitRemoteSettings(hydratedReady: boolean): boolean {
  return hydratedReady;
}
