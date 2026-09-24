jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  GOVERNOR_ENABLED_KEY,
  governorRuntimeFallbackReason,
  initWithGovernorFallback,
  isGovernorFallback,
  mayRetryRuntimeGovernorFallback,
  readGovernorEnabled,
  shouldRuntimeGovernorFallback,
  writeGovernorEnabled,
} from "./governorRuntime";

describe("governor runtime gate", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockReset();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockReset();
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

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

  test("does not reuse a stale governor fallback for a later load error", () => {
    const stale = 'KALSA_GOVERNOR_FALLBACK {stage:"init"}';
    expect(isGovernorFallback(new Error("Failed to load model"), stale, stale)).toBe(false);
  });

  test("classifies a governor fallback captured after the load epoch", () => {
    const stale = 'KALSA_GOVERNOR_FALLBACK {stage:"old"}';
    const current = `${stale}\nKALSA_GOVERNOR_FALLBACK {stage:"params"}`;
    expect(isGovernorFallback(new Error("native load failed"), current, stale)).toBe(true);
  });

  test("reads false when nothing is stored", async () => {
    expect(await readGovernorEnabled()).toBe(false);
  });

  test("round-trips a write followed by a read", async () => {
    const store = new Map<string, string>();
    (AsyncStorage.getItem as jest.Mock).mockImplementation(
      async (key: string) => store.get(key) ?? null,
    );
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
      store.set(key, value);
    });

    await writeGovernorEnabled(true);
    expect(await readGovernorEnabled()).toBe(true);

    await writeGovernorEnabled(false);
    expect(await readGovernorEnabled()).toBe(false);
  });

  test("logs a failed write and does not throw", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("disk full"));

    await expect(writeGovernorEnabled(true)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(GOVERNOR_ENABLED_KEY);

    warn.mockRestore();
  });
});

// Literals on purpose, never the module's constant: if the prefix drifts, the
// positive cases must go red instead of drifting with it.
describe("shouldRuntimeGovernorFallback", () => {
  const rejection = new Error("Governor decode failed: governor is failed");
  const freshLocalTurn = {
    isLocalTurn: true,
    aborted: false,
    fallbackUsedForModel: false,
  };

  test("fires on the governor rejection of a fresh local turn", () => {
    expect(
      shouldRuntimeGovernorFallback({ error: rejection, ...freshLocalTurn }),
    ).toBe(true);
  });

  test("takes the reason from after the prefix only", () => {
    expect(governorRuntimeFallbackReason(rejection)).toBe("governor is failed");
    expect(
      governorRuntimeFallbackReason(new Error("Governor decode failed: rc=-2")),
    ).toBe("rc=-2");
  });

  test("sanitizes the reason before it can reach the log line", () => {
    const noisy = `governor is failed ${"x".repeat(400)}\n\t"quoted" C:\\models\\x.gguf`;
    const reason = governorRuntimeFallbackReason(
      new Error(`Governor decode failed: ${noisy}`),
    );
    expect(reason).not.toBeNull();
    // Safe charset, length cap: a future binding must not be able to put
    // free text or paths into logcat behind the prefix.
    expect(reason).toMatch(/^[A-Za-z0-9 _.,:+=\/-]{0,120}$/);
    expect(
      governorRuntimeFallbackReason(
        new Error("Governor decode failed: bad\treason\nnow"),
      ),
    ).toBe("badreasonnow");
  });

  test("ignores errors that are not the governor rejection", () => {
    const others = [
      new Error("Generation was interrupted."),
      new Error('KALSA_GOVERNOR_FALLBACK {"stage":"init"}'),
      new Error("Governor mode does not support beam search"),
      new Error("context full"),
    ];
    for (const error of others) {
      expect(shouldRuntimeGovernorFallback({ error, ...freshLocalTurn })).toBe(
        false,
      );
    }
    expect(governorRuntimeFallbackReason(new Error("context full"))).toBeNull();
  });

  test("never on a remote (Brain) turn", () => {
    expect(
      shouldRuntimeGovernorFallback({
        error: rejection,
        ...freshLocalTurn,
        isLocalTurn: false,
      }),
    ).toBe(false);
  });

  test("never once the turn was aborted or stopped", () => {
    expect(
      shouldRuntimeGovernorFallback({
        error: rejection,
        ...freshLocalTurn,
        aborted: true,
      }),
    ).toBe(false);
  });

  test("never after the model already fell back once", () => {
    expect(
      shouldRuntimeGovernorFallback({
        error: rejection,
        ...freshLocalTurn,
        fallbackUsedForModel: true,
      }),
    ).toBe(false);
  });
});

describe("mayRetryRuntimeGovernorFallback", () => {
  const intact = {
    signalAborted: false,
    turnStillCurrent: true,
    modelStillLoaded: true,
  };

  test("allows the retry while turn, model and signal are intact", () => {
    expect(mayRetryRuntimeGovernorFallback(intact)).toBe("retry");
  });

  test("ends a current turn when the signal aborted", () => {
    expect(
      mayRetryRuntimeGovernorFallback({ ...intact, signalAborted: true }),
    ).toBe("ended");
  });

  test("reports stale once a newer turn became current", () => {
    expect(
      mayRetryRuntimeGovernorFallback({ ...intact, turnStillCurrent: false }),
    ).toBe("stale");
  });

  test("a model change on the current turn ends it, not stale", () => {
    expect(
      mayRetryRuntimeGovernorFallback({ ...intact, modelStillLoaded: false }),
    ).toBe("ended");
  });

  test("stale outranks ended", () => {
    expect(
      mayRetryRuntimeGovernorFallback({
        signalAborted: true,
        turnStillCurrent: false,
        modelStillLoaded: false,
      }),
    ).toBe("stale");
  });
});
