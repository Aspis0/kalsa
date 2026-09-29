import * as SecureStore from "expo-secure-store";
import { isValidNodeHex, type Road } from "../remote/road";
import {
  decodePairingRecord,
  encodePairingRecord,
  type SavedPairingCredential,
} from "./pairingRecord";

const STORAGE_KEY = "kalsa.pairing.credential.v3";

/**
 * The ACTIVE pairing — the one chat's door reads. A completed ceremony
 * overwrites it wholesale; keeping several computers side by side is the
 * per-room map's job (roomPairingStore), one successful room info at a time.
 */
export async function savePairingCredential(
  credential: Uint8Array,
  doorUrl: string,
  pairing?: { node?: string; pairedVia?: Road },
): Promise<void> {
  if (credential.length !== 32) throw new Error("invalid pairing credential");
  const credentialHex = Array.from(credential, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const node = isValidNodeHex(pairing?.node) ? pairing.node : null;
  const via = pairing?.pairedVia;
  // An unparseable node never fails a pairing that already succeeded; it
  // just leaves this credential on the HTTPS road, with no pairing road
  // ever recorded — the door then refuses to fall back anywhere.
  const record: SavedPairingCredential = {
    credential: credentialHex,
    doorUrl,
    node,
    pairedVia: node !== null && (via === "iroh" || via === "https") ? via : null,
  };
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(encodePairingRecord(record)));
}

export async function getPairingCredential(): Promise<SavedPairingCredential | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (raw == null) return null;
    return decodePairingRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Stamp the active record with the room the first successful room info
 * named; every other field survives untouched. No readable record means
 * nothing to stamp — the write is skipped rather than inventing one.
 */
export async function setPairingRoomId(roomId: string): Promise<void> {
  const record = await getPairingCredential();
  if (record === null) return;
  await SecureStore.setItemAsync(
    STORAGE_KEY,
    JSON.stringify(encodePairingRecord({ ...record, roomId })),
  );
}
