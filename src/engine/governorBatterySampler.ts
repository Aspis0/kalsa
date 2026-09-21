import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules } from "react-native";

type GovernorBatteryNativeModule = {
  readHighRate?: () => Promise<unknown>;
  startSampling?: (outputPath: string, intervalMs: number) => Promise<void>;
  stopSampling?: () => Promise<void>;
};

/** Bench switch, same style as kalsa.bench.thermo: only "1" turns the trace on. */
export const BENCH_ENERGY_TRACE_KEY = "kalsa.bench.energy_trace";

/** The fuel gauge smooths over roughly a second, so faster polling adds nothing. */
const TRACE_INTERVAL_MS = 1000;

function nativeModule(): GovernorBatteryNativeModule | undefined {
  return NativeModules.GovernorBattery as GovernorBatteryNativeModule | undefined;
}

export function energyTraceRequested(raw: string | null): boolean {
  return raw === "1";
}

export async function readBenchEnergyTraceEnabled(): Promise<boolean> {
  try {
    return energyTraceRequested(await AsyncStorage.getItem(BENCH_ENERGY_TRACE_KEY));
  } catch {
    return false;
  }
}

/**
 * One file per turn under the app's own files directory. The name carries the
 * wall clock and the per-process turn id; the host joins it to KALSA_TELEMETRY
 * by turn id and by the CSV's own wall_clock_ms column.
 */
export function energyTraceFilePath(
  baseDir: string,
  turnId: string,
  nowMs: number,
): string {
  return `${baseDir}energy/${nowMs}-t${turnId}.csv`;
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

/**
 * Start one turn's trace, but only when the bench switch is set: a shipped
 * build never reaches the native module. A start failure is not a turn failure.
 */
export async function startGovernorBatteryTrace(
  baseDir: string,
  turnId: string,
): Promise<boolean> {
  if (!baseDir) return false;
  if (!(await readBenchEnergyTraceEnabled())) return false;
  try {
    await startGovernorBatterySampling(
      energyTraceFilePath(baseDir, turnId, Date.now()),
      TRACE_INTERVAL_MS,
    );
    return true;
  } catch {
    return false;
  }
}

/** Stop the trace bracketing a turn; a failing stop must not fail the turn. */
export async function stopGovernorBatteryTrace(): Promise<void> {
  try {
    await stopGovernorBatterySampling();
  } catch {
    // The native sampler flushes every row, so a failed stop loses no datum.
  }
}
