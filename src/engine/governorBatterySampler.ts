import { NativeModules } from "react-native";

type GovernorBatteryNativeModule = {
  readHighRate?: () => Promise<unknown>;
  startSampling?: (outputPath: string, intervalMs: number) => Promise<void>;
  stopSampling?: () => Promise<void>;
};

function nativeModule(): GovernorBatteryNativeModule | undefined {
  return NativeModules.GovernorBattery as GovernorBatteryNativeModule | undefined;
}

/** Read direct battery-gauge properties; unsupported values remain explicit. */
export function readGovernorBatteryHighRate(): Promise<unknown> {
  const module = nativeModule();
  if (!module?.readHighRate) {
    return Promise.reject(new Error("GovernorBattery.readHighRate is unavailable"));
  }
  return module.readHighRate();
}

/** Start the native battery trace loop. */
export function startGovernorBatterySampling(
  outputPath: string,
  intervalMs: number,
): Promise<void> {
  const module = nativeModule();
  if (!module?.startSampling) {
    return Promise.reject(new Error("GovernorBattery.startSampling is unavailable"));
  }
  return module.startSampling(outputPath, intervalMs);
}

/** Stop the native battery trace loop; an unavailable module is already stopped. */
export function stopGovernorBatterySampling(): Promise<void> {
  const module = nativeModule();
  if (!module?.stopSampling) return Promise.resolve();
  return module.stopSampling();
}
