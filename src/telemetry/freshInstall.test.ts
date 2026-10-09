/**
 * The alpha default, pinned at the load path: a fresh install (nothing stored
 * anywhere) loads enabled, and anything the user turned off stays off — the
 * default applies only when no OFF record exists.
 */
import { OPTED_OUT_KEY, OPTED_OUT_KEY_A, OPTED_OUT_KEY_B, OPTED_OUT_POINTER_KEY, PENDING_OFF_KEY, QUARANTINE_KEY, STATE_KEY_A, STATE_KEY_B, STATE_POINTER_KEY } from "./config";
import {
  __resetTelemetryForTests,
  getTelemetryEnabled,
  initTelemetry,
  reportTelemetry,
  setTelemetryEnabled,
  type StorageLike,
  type TelemetryDeps,
} from "./telemetry";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));
jest.mock("react-native", () => ({}));

function memoryStorage(): { store: Map<string, string>; storage: StorageLike } {
  const store = new Map<string, string>();
  const storage: StorageLike = {
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => {
      store.set(key, value);
    },
    removeItem: async (key) => {
      store.delete(key);
    },
  };
  return { store, storage };
}

function depsFor(storage: StorageLike): Partial<TelemetryDeps> {
  return {
    storage,
    fetchImpl: (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch,
    now: () => 1_700_000_000_000,
    getAppState: () => "active",
    getAppVersion: () => "1.0.0",
    getDeviceContext: () => ({
      platform: "android",
      ramTier: null,
      totalMemoryBytes: null,
      osVersion: null,
      modelId: null,
      hadWebTools: false,
    }),
  };
}

beforeEach(() => {
  __resetTelemetryForTests();
});

test("a fresh install loads enabled", async () => {
  const { storage } = memoryStorage();
  await initTelemetry(depsFor(storage));
  expect(await getTelemetryEnabled()).toBe(true);
});

test("an explicit off stays off after reload", async () => {
  const { storage } = memoryStorage();
  await initTelemetry(depsFor(storage));
  expect(await getTelemetryEnabled()).toBe(true);
  expect(await setTelemetryEnabled(false)).toBe(true);

  __resetTelemetryForTests();
  await initTelemetry(depsFor(storage));
  expect(await getTelemetryEnabled()).toBe(false);
});

test("a stored off envelope stays off even when the OFF markers are gone", async () => {
  const { store, storage } = memoryStorage();
  await initTelemetry(depsFor(storage));
  expect(await setTelemetryEnabled(false)).toBe(true);

  for (const key of [
    OPTED_OUT_KEY_A,
    OPTED_OUT_KEY_B,
    OPTED_OUT_POINTER_KEY,
    OPTED_OUT_KEY,
    QUARANTINE_KEY,
    PENDING_OFF_KEY,
  ]) {
    store.delete(key);
  }

  __resetTelemetryForTests();
  await initTelemetry(depsFor(storage));
  expect(await getTelemetryEnabled()).toBe(false);
});

test("OFF physically clears both journal slots and the pointer of queued reports", async () => {
  const { store, storage } = memoryStorage();
  await initTelemetry({
    ...depsFor(storage),
    // 503 keeps the report queued instead of draining it away.
    fetchImpl: (async () => new Response("err", { status: 503 })) as unknown as typeof fetch,
  });
  expect(await setTelemetryEnabled(true)).toBe(true);
  reportTelemetry({ code: "web.fetch", detail: "timeout" });
  await new Promise((resolve) => setTimeout(resolve, 60));

  const queueLength = (key: string): number => {
    const raw = store.get(key);
    if (raw === undefined) return -1;
    return (JSON.parse(raw) as { queue: unknown[] }).queue.length;
  };
  // A report is physically queued in one of the two slots before OFF.
  expect(Math.max(queueLength(STATE_KEY_A), queueLength(STATE_KEY_B))).toBeGreaterThan(0);

  expect(await setTelemetryEnabled(false)).toBe(true);

  for (const key of [STATE_KEY_A, STATE_KEY_B]) {
    const raw = store.get(key);
    expect(typeof raw).toBe("string");
    const env = JSON.parse(String(raw)) as { queue: unknown[]; dead: unknown[] };
    expect(env.queue).toHaveLength(0);
    expect(env.dead).toHaveLength(0);
  }
  expect(store.get(STATE_POINTER_KEY)).toBeUndefined();
});
