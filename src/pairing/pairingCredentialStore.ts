import * as SecureStore from "expo-secure-store";
import { isValidNodeHex, type Road } from "../remote/road";

const STORAGE_KEY = "kalsa.pairing.credential.v3";

export type SavedPairingCredential = {
  credential: string;
  doorUrl: string;
  /** The paired desktop's iroh node id; null on records saved without one. */
  node: string | null;
  /** The road the pairing ceremony itself used; null when unknown. */
  pairedVia: Road | null;
};

export async function savePairingCredential(
  credential: Uint8Array,
  doorUrl: string,
  pairing?: { node?: string; pairedVia?: Road },
): Promise<void> {
  if (credential.length !== 32) throw new Error("invalid pairing credential");
  const credentialHex = Array.from(credential, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const record: Record<string, string> = { credential: credentialHex, doorUrl };
  // An unparseable node never fails a pairing that already succeeded; it
  // just leaves this credential on the HTTPS road, with no pairing road
  // ever recorded — the door then refuses to fall back anywhere.
  if (isValidNodeHex(pairing?.node)) {
    record.node = pairing.node;
    const via = pairing?.pairedVia;
    if (via === "iroh" || via === "https") {
      record.pairedVia = via;
    }
  }
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
    // node null and keep the HTTPS road they always had. A record with a
    // node but no pairedVia never authorises an HTTPS door fallback.
    return {
      credential: value.credential,
      doorUrl: value.doorUrl,
      node: isValidNodeHex(value.node) ? value.node : null,
      pairedVia:
        value.pairedVia === "iroh" || value.pairedVia === "https" ? value.pairedVia : null,
    };
  } catch {
    return null;
  }
}
