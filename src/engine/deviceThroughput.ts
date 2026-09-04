import type { ModelInfo } from "./ModelRegistry";

export type DeviceBandwidthCalibration = Record<string, number>;

export type DecodeMeasurement = {
  predictedPerSecond: number;
  tokensPredicted: number;
  interrupted: boolean;
};

export type ModelSpeedAdvisory =
  | "unknown"
  | "below_floor"
  | "degraded"
  | "meets_floor";

export const MIN_CALIBRATION_TOKENS = 8;
export const MODEL_SPEED_DEGRADED_FLOOR = 10;
export const MODEL_SPEED_FLOOR = 20;

type ModelWeightSource = {
  weightsBytesPerToken?: ModelInfo["weightsBytesPerToken"] | null;
};
type ThroughputModel = Pick<ModelInfo, "quant"> & ModelWeightSource;

/** Registry quant labels are the calibration families; normalize casing only. */
export function quantizationFamilyFor(
  model: Pick<ModelInfo, "quant">,
): string | null {
  if (typeof model.quant !== "string") return null;
  const family = model.quant.trim().toLowerCase();
  return family.length > 0 ? family : null;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validWeightBytesPerToken(model: ModelWeightSource): number | null {
  const value = model.weightsBytesPerToken?.bytes;
  return positiveFinite(value) ? value : null;
}

function validMeasurement(sample: DecodeMeasurement): boolean {
  return (
    !sample.interrupted &&
    Number.isFinite(sample.tokensPredicted) &&
    sample.tokensPredicted >= MIN_CALIBRATION_TOKENS &&
    positiveFinite(sample.predictedPerSecond)
  );
}

/** Keep the best observed device ceiling for the model's quant family. */
export function recordDeviceBandwidthSample(
  calibration: DeviceBandwidthCalibration,
  model: ThroughputModel,
  sample: DecodeMeasurement,
): DeviceBandwidthCalibration {
  const family = quantizationFamilyFor(model);
  const bytesPerToken = validWeightBytesPerToken(model);
  if (!family || bytesPerToken === null || !validMeasurement(sample)) {
    return calibration;
  }

  const achievedBytesPerSecond = sample.predictedPerSecond * bytesPerToken;
  if (!positiveFinite(achievedBytesPerSecond)) return calibration;

  const previous = calibration[family];
  if (positiveFinite(previous) && previous >= achievedBytesPerSecond) {
    return calibration;
  }
  return { ...calibration, [family]: achievedBytesPerSecond };
}

/** Merge persisted and in-memory ceilings without ever lowering a ceiling. */
export function mergeDeviceBandwidthCalibrations(
  ...calibrations: Array<Partial<DeviceBandwidthCalibration> | null | undefined>
): DeviceBandwidthCalibration {
  const merged: DeviceBandwidthCalibration = {};
  for (const calibration of calibrations) {
    if (calibration == null || typeof calibration !== "object") continue;
    for (const [family, value] of Object.entries(calibration)) {
      if (!family || !positiveFinite(value)) continue;
      if (!positiveFinite(merged[family]) || value > merged[family]) {
        merged[family] = value;
      }
    }
  }
  return merged;
}

/** Pure prediction: missing model bytes or device calibration means unknown. */
export function predictTokensPerSecond(
  model: ModelWeightSource,
  deviceBandwidthBytesPerSecond: number | null | undefined,
): number | null {
  const bytesPerToken = validWeightBytesPerToken(model);
  if (bytesPerToken === null || !positiveFinite(deviceBandwidthBytesPerSecond)) {
    return null;
  }
  const predicted = deviceBandwidthBytesPerSecond / bytesPerToken;
  return positiveFinite(predicted) ? predicted : null;
}

export function deviceBandwidthForModel(
  calibration: DeviceBandwidthCalibration | null | undefined,
  model: Pick<ModelInfo, "quant">,
): number | null {
  const family = quantizationFamilyFor(model);
  if (!family || calibration == null) return null;
  const value = calibration[family];
  return positiveFinite(value) ? value : null;
}

export function predictModelTokensPerSecond(
  model: ThroughputModel,
  calibration: DeviceBandwidthCalibration | null | undefined,
): number | null {
  return predictTokensPerSecond(
    model,
    deviceBandwidthForModel(calibration, model),
  );
}

export function modelSpeedAdvisory(
  predictedTokensPerSecond: number | null,
): ModelSpeedAdvisory {
  if (!positiveFinite(predictedTokensPerSecond)) return "unknown";
  if (predictedTokensPerSecond >= MODEL_SPEED_FLOOR) return "meets_floor";
  if (predictedTokensPerSecond >= MODEL_SPEED_DEGRADED_FLOOR) return "degraded";
  return "below_floor";
}
