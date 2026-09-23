/** Runs an attachment action only while this host is in local mode. */
export function runHostAttachment<T>(
  remoteActive: boolean,
  onRemoteRefusal: () => void,
  action: () => T,
): T | undefined {
  if (remoteActive) {
    onRemoteRefusal();
    return undefined;
  }
  return action();
}
