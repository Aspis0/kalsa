/**
 * When a surviving load marker blocks the model. The marker alone says only
 * that a load did not settle; the Android exit record decides whether that
 * process died during the load (crash, ANR, low memory) or was simply killed
 * (app update, swipe, force-stop). Exit records are injected; no native module.
 */
import type { ExitInfo, ExitReason } from "../../modules/kalsa-lifecycle/src";
import {
  clearLoadMarker,
  guardedLoad,
  readLoadMarker,
  writeLoadMarker,
  type ExitReader,
  type LoadMarkerStore,
} from "./loadMarker";

const MODEL = "lfm2.5-2.6b";
const MARKER_KEY = `kalsa.load.dead.${MODEL}`;
const STAMP = 1_700_000_000_000;

const makeStore = (): LoadMarkerStore => {
  const map = new Map<string, string>();
  return {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
    removeItem: async (key) => {
      map.delete(key);
    },
  };
};

const exitAt = (
  reason: ExitReason,
  timestampMs: number,
  importance = 100,
): ExitReader => {
  const record: ExitInfo = { reason, importance, timestampMs };
  return () => record;
};

/** Writes the marker at the fixed STAMP, as the load's first step does. */
async function stampedMarker(): Promise<LoadMarkerStore> {
  const store = makeStore();
  jest.spyOn(Date, "now").mockReturnValue(STAMP);
  await writeLoadMarker(store, MODEL);
  jest.restoreAllMocks();
  return store;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a process killed by the OS or the user is not a death of the load", () => {
  test.each<ExitReason>(["user_requested", "user_stopped", "other"])(
    "%s after the stamp → not refused, marker cleared",
    async (reason) => {
      const store = await stampedMarker();
      const readExit = exitAt(reason, STAMP + 1_000);
      expect(await readLoadMarker(store, MODEL, readExit)).toBe(false);
      expect(await store.getItem(MARKER_KEY)).toBeNull();
    },
  );
});

describe("a death of the load blocks the model", () => {
  test.each<ExitReason>(["crash", "crash_native", "anr"])(
    "%s after the stamp → refused",
    async (reason) => {
      const store = await stampedMarker();
      expect(
        await readLoadMarker(store, MODEL, exitAt(reason, STAMP + 1_000)),
      ).toBe(true);
    },
  );

  test("low-memory kill after the stamp, app in the foreground → refused", async () => {
    const store = await stampedMarker();
    expect(
      await readLoadMarker(store, MODEL, exitAt("low_memory", STAMP + 1_000, 100)),
    ).toBe(true);
  });

  test("low-memory kill after the stamp, app in the background → still refused", async () => {
    const store = await stampedMarker();
    expect(
      await readLoadMarker(store, MODEL, exitAt("low_memory", STAMP + 1_000, 400)),
    ).toBe(true);
  });

  test("exit info unavailable → refused, as before", async () => {
    const store = await stampedMarker();
    expect(await readLoadMarker(store, MODEL, () => null)).toBe(true);
  });

  test("a crash from before the stamp (an older process) → not refused", async () => {
    const store = await stampedMarker();
    expect(
      await readLoadMarker(store, MODEL, exitAt("crash", STAMP - 1_000)),
    ).toBe(false);
    expect(await store.getItem(MARKER_KEY)).toBeNull();
  });
});

describe("legacy marker (\"1\", no stamp)", () => {
  test("an unclean exit blocks it", async () => {
    const store = makeStore();
    await store.setItem(MARKER_KEY, "1");
    expect(await readLoadMarker(store, MODEL, exitAt("crash", STAMP))).toBe(true);
  });

  test("a clean exit clears it", async () => {
    const store = makeStore();
    await store.setItem(MARKER_KEY, "1");
    expect(
      await readLoadMarker(store, MODEL, exitAt("user_requested", STAMP)),
    ).toBe(false);
    expect(await store.getItem(MARKER_KEY)).toBeNull();
  });
});

describe("a confirmed death holds until the user or a good load clears it", () => {
  test("crash confirmed → later clean exit → still refused, exit record not read again", async () => {
    const store = await stampedMarker();
    expect(
      await readLoadMarker(store, MODEL, exitAt("crash", STAMP + 1_000)),
    ).toBe(true);
    const laterClean = jest.fn(exitAt("user_requested", STAMP + 5_000));
    expect(await readLoadMarker(store, MODEL, laterClean)).toBe(true);
    expect(laterClean).not.toHaveBeenCalled();
    expect(await store.getItem(MARKER_KEY)).toBe(
      JSON.stringify({ at: STAMP, confirmed: true }),
    );
  });

  test("confirmed → an exit record older than the stamp still refuses", async () => {
    const store = await stampedMarker();
    await readLoadMarker(store, MODEL, exitAt("crash", STAMP + 1_000));
    expect(
      await readLoadMarker(store, MODEL, exitAt("other", STAMP - 1_000)),
    ).toBe(true);
  });

  test("confirmed → the user's retry clears it → the model loads", async () => {
    const store = await stampedMarker();
    await readLoadMarker(store, MODEL, exitAt("crash", STAMP + 1_000));
    await clearLoadMarker(store, MODEL);
    expect(
      await readLoadMarker(store, MODEL, exitAt("crash", STAMP + 9_000)),
    ).toBe(false);
    await expect(
      guardedLoad(store, MODEL, async () => "loaded"),
    ).resolves.toBe("loaded");
    expect(await store.getItem(MARKER_KEY)).toBeNull();
  });

  test("confirmed legacy marker is kept as confirmed, not re-judged", async () => {
    const store = makeStore();
    await store.setItem(MARKER_KEY, "1");
    await readLoadMarker(store, MODEL, exitAt("crash", STAMP));
    const laterClean = jest.fn(exitAt("user_requested", STAMP + 5_000));
    expect(await readLoadMarker(store, MODEL, laterClean)).toBe(true);
    expect(laterClean).not.toHaveBeenCalled();
  });
});

describe("a load in flight in this runtime is never judged from the exit record", () => {
  test("its live marker stays present, whatever an old exit record says", async () => {
    const store = makeStore();
    let settle: () => void = () => undefined;
    jest.spyOn(Date, "now").mockReturnValue(STAMP);
    const inFlight = guardedLoad(
      store,
      MODEL,
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    jest.restoreAllMocks();
    const predating = jest.fn(exitAt("crash", STAMP - 1_000));
    expect(await readLoadMarker(store, MODEL, predating)).toBe(true);
    expect(predating).not.toHaveBeenCalled();
    expect(await store.getItem(MARKER_KEY)).not.toBeNull();
    settle();
    await inFlight;
    expect(await store.getItem(MARKER_KEY)).toBeNull();
  });

  test("after the load settles, a leftover marker follows the normal rules", async () => {
    const store = makeStore();
    await store.setItem(MARKER_KEY, JSON.stringify({ at: STAMP }));
    expect(
      await readLoadMarker(store, MODEL, exitAt("crash", STAMP - 1_000)),
    ).toBe(false);
    expect(await store.getItem(MARKER_KEY)).toBeNull();
  });
});
