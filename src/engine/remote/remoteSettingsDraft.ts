/**
 * Settings draft vs storage. Empty URL/token from an unhydrated form must
 * never reach AsyncStorage / SecureStore.
 *
 * Dirty is tracked PER FIELD: an edit in one field must not throw away the
 * stored value of the others — dropping the whole hydration left URL and token
 * empty, and committing that empty token deletes the user's credential.
 */

export type RemoteSettingsField = "url" | "serverModel" | "maxTokens" | "token";

/** Per field: true only when hydration produced the stored value. */
export type RemoteHydrationResult = Readonly<
  Partial<Record<RemoteSettingsField, boolean>>
>;

/**
 * A field may be written only when hydration produced its stored value or the
 * user edited it. Writing a field whose hydration FAILED stores a default the
 * user never chose: for the token that default is "", which SecureStore reads
 * as "delete the credential".
 */
export function canCommitField(input: {
  field: RemoteSettingsField;
  hydrated: RemoteHydrationResult;
  dirty: ReadonlySet<RemoteSettingsField>;
}): boolean {
  return input.hydrated[input.field] === true || input.dirty.has(input.field);
}

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
