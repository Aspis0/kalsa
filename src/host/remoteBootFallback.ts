/** Fail closed to the local backend when remote settings cannot be read. */
export async function recoverLocalAfterRemoteBootFailure(args: {
  remoteActiveRef: { current: boolean };
  setRemoteActive: (active: boolean) => void;
  recoverLocalBackend: () => Promise<unknown>;
}): Promise<void> {
  args.remoteActiveRef.current = false;
  args.setRemoteActive(false);
  await args.recoverLocalBackend().catch(() => undefined);
}
