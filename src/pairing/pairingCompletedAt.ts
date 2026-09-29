/**
 * The moment the CURRENT pairing was completed — the confirmation poll's
 * "paired" verdict, i.e. the desk answered Allow. The chat compares failed
 * remote turns against this stamp: a failure older than it belongs to a
 * previous pairing and must render as past, never as this pairing's state.
 * Stored beside the credential (SecureStore keeps the pairing's facts in
 * one home); the value itself is not secret.
 *
 * Completing a pairing also notifies the subscribers: the open conversation
 * re-marks its live message list without a reload (returning from pairing
 * does not re-run the history load — the conversation never changed). A
 * single-purpose subscription on this one module, not a general bus: the
 * only event is "a pairing just completed".
 */
import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "kalsa.pairing.completedAt.v1";

type PairingCompletedListener = () => void;

const listeners = new Set<PairingCompletedListener>();

/** React to a completed pairing; the returned function unsubscribes. */
export function subscribePairingCompleted(
  listener: PairingCompletedListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Record a completed pairing and notify the subscribers. The write failing
 *  must not fail the pairing: the caller fire-and-forgets, and an absent
 *  stamp only means nothing is ever marked stale. */
export async function markPairingCompleted(at: number = Date.now()): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, String(at));
  // A listener throwing must not break the pairing that already succeeded.
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
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
