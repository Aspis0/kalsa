import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  mergeDeviceBandwidthCalibrations,
  type DeviceBandwidthCalibration,
} from "./deviceThroughput";

export const DEVICE_BANDWIDTH_STORAGE_KEY = "kalsa.device.bandwidth.v1";

let writeChain: Promise<void> = Promise.resolve();

export async function loadDeviceBandwidthCalibration(): Promise<DeviceBandwidthCalibration> {
  try {
    const raw = await AsyncStorage.getItem(DEVICE_BANDWIDTH_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return mergeDeviceBandwidthCalibrations(
      parsed as Partial<DeviceBandwidthCalibration>,
    );
  } catch {
    return {};
  }
}

/** Serialize writes and merge with storage so an early completion cannot erase an older ceiling. */
export function saveDeviceBandwidthCalibration(
  calibration: DeviceBandwidthCalibration,
): Promise<void> {
  const write = async () => {
    const persisted = await loadDeviceBandwidthCalibration();
    const merged = mergeDeviceBandwidthCalibrations(persisted, calibration);
    await AsyncStorage.setItem(DEVICE_BANDWIDTH_STORAGE_KEY, JSON.stringify(merged));
  };
  writeChain = writeChain.then(write, write).catch(() => undefined);
  return writeChain;
}
