export type SessionDiskCalibration = Record<string, number>;

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function sessionBytesPerTokenForModel(
  calibration: SessionDiskCalibration | null | undefined,
  modelId: string,
): number | null {
  if (!calibration || !modelId) return null;
  const value = calibration[modelId];
  return positiveFinite(value) ? value : null;
}

export function recordSessionDiskSample(
  calibration: SessionDiskCalibration,
  input: {
    ok: boolean;
    modelId: string;
    fileBytes: unknown;
    usedTokens: unknown;
  },
): SessionDiskCalibration {
  if (
    input.ok !== true ||
    !input.modelId ||
    !positiveFinite(input.fileBytes) ||
    !positiveFinite(input.usedTokens)
  ) {
    return calibration;
  }
  const bytesPerToken = input.fileBytes / input.usedTokens;
  if (!positiveFinite(bytesPerToken)) return calibration;

  const previous = calibration[input.modelId];
  if (positiveFinite(previous) && previous >= bytesPerToken) return calibration;
  return { ...calibration, [input.modelId]: bytesPerToken };
}

export function mergeSessionDiskCalibrations(
  ...calibrations: Array<Partial<SessionDiskCalibration> | null | undefined>
): SessionDiskCalibration {
  const merged: SessionDiskCalibration = {};
  for (const calibration of calibrations) {
    if (calibration == null || typeof calibration !== "object") continue;
    for (const [modelId, value] of Object.entries(calibration)) {
      if (!modelId || !positiveFinite(value)) continue;
      if (!positiveFinite(merged[modelId]) || value > merged[modelId]) {
        merged[modelId] = value;
      }
    }
  }
  return merged;
}
