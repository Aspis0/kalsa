import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  applySessionDiskCalibration,
  mergeSessionDiskCalibrations,
  type SessionDiskCalibration,
} from "./sessionDiskCalibration";

/**
 * v2 (2026-09-17): v1 stored `fileBytes / usedTokens`, which charges a
 * session file's fixed ~439 KB (recurrent state + per-cell metadata) to the
 * token count. One ~19-token write taught this store 29,910 B/token for
 * LFM2.5 against a true slope of ~6,672, and the old monotone maximum made it
 * permanent. The key changes so devices carrying that number start clean.
 *
 * Dropping it is only safe because sessionBytesPerTokenForModel now falls back
 * to the catalog's measured kvBytesPerToken rather than to a dense 64 KiB
 * ceiling: a rate is learned only from a write that SUCCEEDED, so a device
 * whose fallback is too large to pass the gate would never calibrate at all.
 */
export const SESSION_DISK_CALIBRATION_STORAGE_KEY = "kalsa.session.disk.v2";

let writeChain: Promise<void> = Promise.resolve();

export async function loadSessionDiskCalibration(): Promise<SessionDiskCalibration> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_DISK_CALIBRATION_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return mergeSessionDiskCalibrations(parsed as Partial<SessionDiskCalibration>);
  } catch {
    return {};
  }
}

export function saveSessionDiskCalibration(
  calibration: SessionDiskCalibration,
): Promise<void> {
  const write = async () => {
    const persisted = await loadSessionDiskCalibration();
    // Update wins per key. Merging by maximum here would discard exactly the
    // corrections this call exists to persist.
    const next = applySessionDiskCalibration(persisted, calibration);
    await AsyncStorage.setItem(
      SESSION_DISK_CALIBRATION_STORAGE_KEY,
      JSON.stringify(next),
    );
  };
  writeChain = writeChain.then(write, write).catch(() => undefined);
  return writeChain;
}
