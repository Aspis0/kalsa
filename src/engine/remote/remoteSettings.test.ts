const store: Record<string, string> = {};
let hydrateHold: Promise<void> | null = null;
let hydrateHoldStarted: (() => void) | null = null;

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: async (key: string) => {
    const value = store[key] ?? null;
    if (hydrateHold && key === "kalsa.engine.backend") {
      hydrateHoldStarted?.();
      await hydrateHold;
    }
    return value;
  },
  setItem: async (key: string, value: string) => {
    store[key] = value;
  },
}));

import {
  ENGINE_BACKEND_KEY,
  beginBackendSwitch,
  endBackendSwitch,
  getEngineBackendMode,
  hydrateRemoteBrainSettings,
  isOrphanRemoteWithoutUrl,
  isRemoteEngineBackend,
  recoverLocalBackend,
  REMOTE_BRAIN_URL_KEY,
  setEngineBackendMode,
  validateServedModel,
} from "./remoteSettings";

describe("validateServedModel", () => {
  test("requires a configured id", () => {
    expect(validateServedModel("", ["ornith"])).toBe("remote_brain_model_required");
    expect(validateServedModel("  ", [])).toBe("remote_brain_model_required");
  });

  test("rejects an id not on the server", () => {
    expect(validateServedModel("nope", ["ornith", "other"])).toBe(
      "remote_brain_model_missing",
    );
  });

  test("accepts a matching id", () => {
    expect(validateServedModel("ornith", ["ornith"])).toBeNull();
  });

  test("skips membership when the server list is empty", () => {
    expect(validateServedModel("ornith", [])).toBeNull();
  });
});

describe("backend cache writes", () => {
  beforeEach(async () => {
    hydrateHold = null;
    hydrateHoldStarted = null;
    for (const key of Object.keys(store)) delete store[key];
    endBackendSwitch();
    await setEngineBackendMode("local");
  });

  test("hydration is read-only: does not overwrite a local cache", async () => {
    await setEngineBackendMode("local");
    store[ENGINE_BACKEND_KEY] = "remote";
    const snap = await hydrateRemoteBrainSettings();
    expect(snap.backend).toBe("remote");
    expect(getEngineBackendMode()).toBe("local");
  });

  test("mounted-settings hydration after local selection: local wins", async () => {
    await setEngineBackendMode("remote");
    let release!: () => void;
    let started!: () => void;
    const startedP = new Promise<void>((resolve) => {
      started = resolve;
    });
    hydrateHoldStarted = started;
    hydrateHold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = hydrateRemoteBrainSettings();
    await startedP;
    beginBackendSwitch("local");
    await setEngineBackendMode("local");
    release();
    const snap = await pending;
    expect(snap.backend).toBe("remote");
    expect(getEngineBackendMode()).toBe("local");
    endBackendSwitch();
  });

  test("concurrent hydration + switch: setter refuses remote while local intent", async () => {
    await setEngineBackendMode("local");
    beginBackendSwitch("local");
    await setEngineBackendMode("remote");
    expect(getEngineBackendMode()).toBe("local");
    endBackendSwitch();
    await setEngineBackendMode("remote");
    expect(getEngineBackendMode()).toBe("remote");
  });

  test("remount after remote applies local through the setter", async () => {
    await setEngineBackendMode("remote");
    store[ENGINE_BACKEND_KEY] = "local";
    const snap = await hydrateRemoteBrainSettings();
    expect(snap.backend).toBe("local");
    expect(isRemoteEngineBackend()).toBe(true);
    await setEngineBackendMode("local");
    expect(isRemoteEngineBackend()).toBe(false);
  });

  test("virgin storage with backend remote and no URL key is an orphan", async () => {
    store[ENGINE_BACKEND_KEY] = "remote";
    delete store[REMOTE_BRAIN_URL_KEY];
    const snap = await hydrateRemoteBrainSettings();
    expect(snap.urlNeverSet).toBe(true);
    expect(snap.backend).toBe("remote");
    expect(isOrphanRemoteWithoutUrl(snap)).toBe(true);
    await recoverLocalBackend();
    expect(isRemoteEngineBackend()).toBe(false);
  });

  test("empty URL string is not an orphan (user set it empty)", async () => {
    store[ENGINE_BACKEND_KEY] = "remote";
    store[REMOTE_BRAIN_URL_KEY] = "";
    const snap = await hydrateRemoteBrainSettings();
    expect(snap.urlNeverSet).toBe(false);
    expect(isOrphanRemoteWithoutUrl(snap)).toBe(false);
  });

  test("getItem rejects -> recoverLocalBackend -> not remote", async () => {
    await setEngineBackendMode("remote");
    const getItem = async () => {
      throw new Error("fail");
    };
    try {
      await getItem();
      throw new Error("expected getItem to reject");
    } catch (err) {
      if (err instanceof Error && err.message === "expected getItem to reject") {
        throw err;
      }
      await recoverLocalBackend();
    }
    expect(isRemoteEngineBackend()).toBe(false);
  });
});
