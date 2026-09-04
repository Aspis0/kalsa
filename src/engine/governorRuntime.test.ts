jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null) },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  GOVERNOR_ENABLED_KEY,
  initWithGovernorFallback,
  readGovernorEnabled,
} from "./governorRuntime";

describe("governor runtime gate", () => {
  beforeEach(() => jest.clearAllMocks());

  test("defaults the feature flag off and uses CPU params", async () => {
    const init = jest.fn(
      async (params: { n_gpu_layers: number; governor?: unknown }) => params,
    );
    const cpuParams = { n_gpu_layers: 0 };
    const result = await initWithGovernorFallback({
      enabled: false,
      governorParams: { governor: { enabled: true }, n_gpu_layers: 99 },
      cpuParams,
      init,
      nativeLog: () => "",
    });
    expect(result.retried).toBe(false);
    expect(init).toHaveBeenCalledWith(cpuParams);
    expect(init.mock.calls[0][0]).not.toHaveProperty("governor");
    expect((await readGovernorEnabled())).toBe(false);
  });

  test("retries once after a native governor fallback", async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
      key === GOVERNOR_ENABLED_KEY ? "true" : null,
    );
    const init = jest
      .fn()
      .mockRejectedValueOnce(new Error("native load failed"))
      .mockResolvedValueOnce({ ok: true });
    const log = jest.fn();
    const result = await initWithGovernorFallback({
      enabled: true,
      governorParams: { governor: { enabled: true }, n_gpu_layers: 99 },
      cpuParams: { n_gpu_layers: 0, n_parallel: 1 },
      init,
      nativeLog: () => 'KALSA_GOVERNOR_FALLBACK {stage:"init"}',
      log,
    });
    expect(result).toMatchObject({ retried: true, value: { ok: true } });
    expect(init.mock.calls[0][0]).toHaveProperty("governor");
    expect(init).toHaveBeenNthCalledWith(2, { n_gpu_layers: 0, n_parallel: 1 });
    expect(log).toHaveBeenCalledWith("KALSA_GOVERNOR_FALLBACK_RETRY {ok:true}");
  });
});
