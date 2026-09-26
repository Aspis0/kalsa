import * as SecureStore from "expo-secure-store";
import { isValidNodeHex } from "../remote/road";

const STORAGE_KEY = "kalsa.pairing.credential.v3";

export type SavedPairingCredential = {
  credential: string;
  doorUrl: string;
  /** The paired desktop's iroh node id; null on records saved without one. */
  node: string | null;
};

/** Stores the paired door, lowercase bearer credential and (when valid) the desktop's iroh node. */
export async function savePairingCredential(
  credential: Uint8Array,
  doorUrl: string,
  node?: string,
): Promise<void> {
  if (credential.length !== 32) throw new Error("invalid pairing credential");
  const credentialHex = Array.from(credential, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const record: Record<string, string> = { credential: credentialHex, doorUrl };
  // An unparseable node never fails a pairing that already succeeded; it
  // just leaves this credential on the HTTPS road.
  if (isValidNodeHex(node)) record.node = node;
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(record));
}

export async function getPairingCredential(): Promise<SavedPairingCredential | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (raw == null) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof value.credential !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.credential) ||
      typeof value.doorUrl !== "string"
    ) return null;
    // Records from before the iroh step simply have no node: they read as
    // node null and keep the HTTPS road they always had.
    return {
      credential: value.credential,
      doorUrl: value.doorUrl,
      node: isValidNodeHex(value.node) ? value.node : null,
    };
  } catch {
    return null;
  }
}
