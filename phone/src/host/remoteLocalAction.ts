/** Run an action that is available only with the local engine. */
export function runHostLocalAction<T>(
  remoteBackend: boolean,
  refuse: () => void,
  action: () => T,
): T | undefined {
  if (remoteBackend) {
    refuse();
    return undefined;
  }
  return action();
}
