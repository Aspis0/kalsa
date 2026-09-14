/**
 * Settings draft vs storage. Empty URL/token from an unhydrated form must
 * never reach AsyncStorage / SecureStore, and a late hydrate must not
 * overwrite edits the user already started.
 */

export function shouldApplyRemoteHydration(input: {
  cancelled: boolean;
  dirty: boolean;
}): boolean {
  return !input.cancelled && !input.dirty;
}

export function canCommitRemoteSettings(hydratedReady: boolean): boolean {
  return hydratedReady;
}
