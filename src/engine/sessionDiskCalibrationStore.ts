import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  mergeSessionDiskCalibrations,
  type SessionDiskCalibration,
} from "./sessionDiskCalibration";

export const SESSION_DISK_CALIBRATION_STORAGE_KEY = "kalsa.session.disk.v1";

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
    const merged = mergeSessionDiskCalibrations(persisted, calibration);
    await AsyncStorage.setItem(
      SESSION_DISK_CALIBRATION_STORAGE_KEY,
      JSON.stringify(merged),
    );
  };
  writeChain = writeChain.then(write, write).catch(() => undefined);
  return writeChain;
}
