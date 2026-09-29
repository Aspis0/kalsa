/**
 * The moment the CURRENT pairing was completed — the confirmation poll's
 * "paired" verdict, i.e. the desk answered Allow. The chat compares failed
 * remote turns against this stamp: a failure older than it belongs to a
 * previous pairing and must render as past, never as this pairing's state.
 * Stored beside the credential (SecureStore keeps the pairing's facts in
 * one home); the value itself is not secret.
 */
import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "kalsa.pairing.completedAt.v1";

/** Record a completed pairing. The write failing must not fail the pairing:
 *  the caller fire-and-forgets, and an absent stamp only means nothing is
 *  ever marked stale. */
export async function markPairingCompleted(at: number = Date.now()): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, String(at));
}

/** The stored stamp, or null when absent, corrupt or unreadable. */
export async function getPairingCompletedAt(): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}
