import {
  deviceBandwidthForModel,
  modelSpeedAdvisory,
  predictModelTokensPerSecond,
  predictTokensPerSecond,
  recordDeviceBandwidthSample,
} from "./deviceThroughput";

const measuredModel = (quant: string, bytes: number) => ({
  quant,
  weightsBytesPerToken: { bytes, source: "tensor-map" as const },
});

describe("device throughput calibration", () => {
  test("keeps the maximum sample instead of averaging it", () => {
    const model = measuredModel("Q4_K_M", 100);
    let calibration = recordDeviceBandwidthSample({}, model, {
      predictedPerSecond: 10,
      tokensPredicted: 32,
      interrupted: false,
    });
    calibration = recordDeviceBandwidthSample(calibration, model, {
      predictedPerSecond: 20,
      tokensPredicted: 32,
      interrupted: false,
    });
    calibration = recordDeviceBandwidthSample(calibration, model, {
      predictedPerSecond: 15,
      tokensPredicted: 32,
      interrupted: false,
    });

    expect(calibration).toEqual({ q4_k_m: 2_000 });
  });

  test("keeps quantization families separate", () => {
    let calibration = recordDeviceBandwidthSample(
      {},
      measuredModel("Q4_K_M", 100),
      { predictedPerSecond: 20, tokensPredicted: 32, interrupted: false },
    );
    calibration = recordDeviceBandwidthSample(
      calibration,
      measuredModel("Q2_K", 200),
      { predictedPerSecond: 7, tokensPredicted: 32, interrupted: false },
    );

    expect(calibration).toEqual({ q4_k_m: 2_000, q2_k: 1_400 });
    expect(deviceBandwidthForModel(calibration, measuredModel("Q4_K_M", 1))).toBe(
      2_000,
    );
    expect(deviceBandwidthForModel(calibration, measuredModel("Q2_K", 1))).toBe(
      1_400,
    );
  });

  test("rejects short and interrupted samples", () => {
    const model = measuredModel("KEXP", 100);
    expect(
      recordDeviceBandwidthSample({}, model, {
        predictedPerSecond: 20,
        tokensPredicted: 7,
        interrupted: false,
      }),
    ).toEqual({});
    expect(
      recordDeviceBandwidthSample({}, model, {
        predictedPerSecond: 20,
        tokensPredicted: 32,
        interrupted: true,
      }),
    ).toEqual({});
  });

  test("returns null when either calibration ingredient is absent", () => {
    expect(predictTokensPerSecond({}, 2_000)).toBeNull();
    expect(predictModelTokensPerSecond(measuredModel("KEXP", 100), {})).toBeNull();
  });

  test("predicts a hand-calculated rate", () => {
    const model = measuredModel("Q4_K_M", 500);
    expect(predictTokensPerSecond(model, 6_000)).toBe(12);
    expect(predictModelTokensPerSecond(model, { q4_k_m: 6_000 })).toBe(12);
    expect(modelSpeedAdvisory(12)).toBe("degraded");
    expect(modelSpeedAdvisory(null)).toBe("unknown");
  });
});
