import {
  clearLoadMarker,
  pickFallbackModel,
  pickStartModel,
  readLastGoodModelId,
  readLoadMarker,
  writeLastGoodModelId,
  writeLoadMarker,
  type LoadMarkerStore,
} from "./loadMarker";

/** In-memory stand-in for AsyncStorage — no RN dependency. */
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

describe("loadMarker", () => {
  test("death during load → marker present → next launch falls back", async () => {
    const store = makeStore();
    // Written before Qwen's load started; the process died mid-load.
    await writeLoadMarker(store, "qwen");
    expect(await readLoadMarker(store, "qwen")).toBe(true);
    expect(
      pickStartModel({
        savedId: "qwen",
        savedMarked: await readLoadMarker(store, "qwen"),
        lastGoodId: "lfm",
        defaultId: "def",
      }),
    ).toBe("lfm");
  });

  test("successful load → marker cleared → no fallback", async () => {
    const store = makeStore();
    await writeLoadMarker(store, "qwen");
    // Load succeeded: AppShell clears the marker and records last-good.
    await clearLoadMarker(store, "qwen");
    await writeLastGoodModelId(store, "qwen");
    expect(await readLoadMarker(store, "qwen")).toBe(false);
    expect(await readLastGoodModelId(store)).toBe("qwen");
    expect(
      pickStartModel({
        savedId: "qwen",
        savedMarked: await readLoadMarker(store, "qwen"),
        lastGoodId: "qwen",
        defaultId: "def",
      }),
    ).toBe("qwen");
  });

  test("marker for model A does not block model B", async () => {
    const store = makeStore();
    await writeLoadMarker(store, "A");
    expect(await readLoadMarker(store, "B")).toBe(false);
    expect(
      pickStartModel({
        savedId: "B",
        savedMarked: await readLoadMarker(store, "B"),
        lastGoodId: "A",
        defaultId: "def",
      }),
    ).toBe("B");
  });

  test("selection change clears the marker", async () => {
    const store = makeStore();
    await writeLoadMarker(store, "qwen");
    // What selectModel does for the re-asserted selection.
    await clearLoadMarker(store, "qwen");
    expect(await readLoadMarker(store, "qwen")).toBe(false);
  });

  test("pickStartModel: marked selection without a distinct last-good → default", () => {
    expect(
      pickStartModel({
        savedId: "qwen",
        savedMarked: true,
        lastGoodId: "qwen",
        defaultId: "def",
      }),
    ).toBe("def");
    expect(
      pickStartModel({
        savedId: "qwen",
        savedMarked: true,
        lastGoodId: null,
        defaultId: "def",
      }),
    ).toBe("def");
  });

  test("pickFallbackModel: never the model that just failed; null over a self-fallback", () => {
    expect(pickFallbackModel({ refusedId: "qwen", lastGoodId: "lfm", defaultId: "def" })).toBe("lfm");
    expect(pickFallbackModel({ refusedId: "qwen", lastGoodId: "qwen", defaultId: "def" })).toBe("def");
    expect(pickFallbackModel({ refusedId: "qwen", lastGoodId: null, defaultId: "def" })).toBe("def");
    expect(pickFallbackModel({ refusedId: "def", lastGoodId: null, defaultId: "def" })).toBeNull();
  });
});
