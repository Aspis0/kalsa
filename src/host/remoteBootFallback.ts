/**
 * What the host does when the remote computer is not there to answer: fail
 * closed to the local backend when its settings cannot be read, and decide at
 * boot whether there is a door to answer through at all.
 */
import { doorRequestBase } from "../engine/remote/doorRequestBase";
import { getRemoteDoorConfig } from "../engine/remote/remoteDoorConfig";

export async function recoverLocalAfterRemoteBootFailure(args: {
  remoteActiveRef: { current: boolean };
  setRemoteActive: (active: boolean) => void;
  recoverLocalBackend: () => Promise<unknown>;
}): Promise<void> {
  args.remoteActiveRef.current = false;
  args.setRemoteActive(false);
  await args.recoverLocalBackend().catch(() => undefined);
}

/**
 * Whether the engine has a door it would dial, by the rule the engine dials
 * by: a pairing that owns its own address, or a typed one.
 *
 * It must never be the manual address alone. A paired phone reaches its
 * computer through its pairing record and never writes one, so judging it by
 * the manual address demoted a reachable computer to the phone at every start
 * — and that demotion ran `recoverLocalBackend`, which rewrote the stored
 * choice, so the next start had nothing left to restore. A room that already
 * refused this phone is no door: the engine answers 401 there, so that pairing
 * stays on the phone as before.
 */
export async function hostDoorIsReachable(): Promise<boolean> {
  const door = await getRemoteDoorConfig();
  if (door.pairing !== null && door.pairing.removed) return false;
  return doorRequestBase(door).ok;
}
