import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "kalsa.pairing.credential.v3";

export type SavedPairingCredential = { credential: string; doorUrl: string };

/** Pairing credentials are kept separate until the live door path is integrated. */
export async function savePairingCredential(
  credential: Uint8Array,
  doorUrl: string,
): Promise<void> {
  if (credential.length !== 32) throw new Error("invalid pairing credential");
  const credentialHex = Array.from(credential, (byte) => byte.toString(16).padStart(2, "0")).join("");
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ credential: credentialHex, doorUrl }));
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
    return { credential: value.credential, doorUrl: value.doorUrl };
  } catch {
    return null;
  }
}
