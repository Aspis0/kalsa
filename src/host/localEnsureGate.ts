/** A local model intent cannot start a local loader while the facade is remote. */
export function runLocalEnsureGate(
  remoteBackendActive: boolean,
  ensureLocal: () => Promise<boolean>,
): Promise<boolean> {
  return remoteBackendActive ? Promise.resolve(false) : ensureLocal();
}
