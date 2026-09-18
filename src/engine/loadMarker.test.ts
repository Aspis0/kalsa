import {
  clearLoadMarker,
  guardedLoad,
  hasOtherDownloadedModel,
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

const isMarkedIn = (store: LoadMarkerStore) => (id: string) =>
  readLoadMarker(store, id);

describe("guardedLoad (the marker survives ONLY a death)", () => {
  test("marker is present inside the load and cleared after success", async () => {
    const store = makeStore();
    let markerDuringLoad = false;
    await guardedLoad(store, "qwen", async () => {
      markerDuringLoad = await readLoadMarker(store, "qwen");
    });
    expect(markerDuringLoad).toBe(true);
    expect(await readLoadMarker(store, "qwen")).toBe(false);
  });

  test("a SURVIVED failure clears the marker too", async () => {
    const store = makeStore();
    await expect(
      guardedLoad(store, "qwen", async () => {
        throw new Error("initEngine rejected");
      }),
    ).rejects.toThrow("initEngine rejected");
    // Code ran after the failed load → the process is alive → no marker.
    expect(await readLoadMarker(store, "qwen")).toBe(false);
  });

  test("a marker whose process never settled reaches the next launch", async () => {
    // The death case cannot run code afterwards — modeled here by the write
    // without any settlement. The start picker must skip such a model.
    const store = makeStore();
    await writeLoadMarker(store, "qwen");
    expect(
      await pickStartModel({
        savedId: "qwen",
        lastGoodId: "lfm",
        defaultId: "def",
        isMarked: isMarkedIn(store),
      }),
    ).toBe("lfm");
  });

  test("storage failures inside the lifecycle never fail the load", async () => {
    const store = makeStore();
    const broken: LoadMarkerStore = {
      getItem: store.getItem,
      setItem: async () => {
        throw new Error("disk full");
      },
      removeItem: async () => {
        throw new Error("disk full");
      },
    };
    await expect(guardedLoad(broken, "qwen", async () => "loaded")).resolves.toBe(
      "loaded",
    );
  });
});

describe("start / fallback pickers (never pick a model we know died)", () => {
  test("death during load → marker present → next launch falls back", async () => {
    const store = makeStore();
    await writeLoadMarker(store, "qwen");
    expect(
      await pickStartModel({
        savedId: "qwen",
        lastGoodId: "lfm",
        defaultId: "def",
        isMarked: isMarkedIn(store),
      }),
    ).toBe("lfm");
  });

  test("successful load → marker cleared → no fallback", async () => {
    const store = makeStore();
    await guardedLoad(store, "qwen", async () => undefined);
    await writeLastGoodModelId(store, "qwen");
    expect(
      await pickStartModel({
        savedId: "qwen",
        lastGoodId: "qwen",
        defaultId: "def",
        isMarked: isMarkedIn(store),
      }),
    ).toBe("qwen");
    expect(await readLastGoodModelId(store)).toBe("qwen");
  });

  test("marker for model A does not block model B", async () => {
    const store = makeStore();
    await writeLoadMarker(store, "A");
    expect(await readLoadMarker(store, "B")).toBe(false);
    expect(
      await pickStartModel({
        savedId: "B",
        lastGoodId: "A",
        defaultId: "def",
        isMarked: isMarkedIn(store),
      }),
    ).toBe("B");
  });

  test("explicit user act clears the marker: the refused model starts again", async () => {
    const store = makeStore();
    await writeLoadMarker(store, "qwen");
    // The app loads nothing on its own; the refusal stands until the user acts.
    expect(
      await pickStartModel({
        savedId: "qwen",
        lastGoodId: null,
        defaultId: "qwen",
        isMarked: isMarkedIn(store),
      }),
    ).toBeNull();
    // The user's explicit act (reload tap or re-selection) — never automatic.
    await clearLoadMarker(store, "qwen");
    expect(
      await pickStartModel({
        savedId: "qwen",
        lastGoodId: null,
        defaultId: "qwen",
        isMarked: isMarkedIn(store),
      }),
    ).toBe("qwen");
  });

  test("lastGood null, default marked → no model", async () => {
    const store = makeStore();
    // The saved model died (that is why the picker hunts a fallback) and the
    // default died too: no candidate survives → load nothing at all.
    await writeLoadMarker(store, "qwen");
    await writeLoadMarker(store, "def");
    expect(
      await pickStartModel({
        savedId: "qwen",
        lastGoodId: null,
        defaultId: "def",
        isMarked: isMarkedIn(store),
      }),
    ).toBeNull();
  });

  test("marked lastGood is skipped; unmarked default wins", async () => {
    const store = makeStore();
    await writeLoadMarker(store, "qwen");
    await writeLoadMarker(store, "lfm");
    expect(
      await pickStartModel({
        savedId: "qwen",
        lastGoodId: "lfm",
        defaultId: "def",
        isMarked: isMarkedIn(store),
      }),
    ).toBe("def");
  });

  test("every candidate marked → no load at all", async () => {
    const store = makeStore();
    await writeLoadMarker(store, "qwen");
    await writeLoadMarker(store, "lfm");
    await writeLoadMarker(store, "def");
    expect(
      await pickStartModel({
        savedId: "qwen",
        lastGoodId: "lfm",
        defaultId: "def",
        isMarked: isMarkedIn(store),
      }),
    ).toBeNull();
  });

  test("fallback skips a marked lastGood and never returns the refused id", async () => {
    const store = makeStore();
    await writeLoadMarker(store, "lfm");
    expect(
      await pickFallbackModel({
        refusedId: "qwen",
        lastGoodId: "lfm",
        defaultId: "def",
        isMarked: isMarkedIn(store),
      }),
    ).toBe("def");
    await writeLoadMarker(store, "def");
    expect(
      await pickFallbackModel({
        refusedId: "qwen",
        lastGoodId: "lfm",
        defaultId: "def",
        isMarked: isMarkedIn(store),
      }),
    ).toBeNull();
  });

  test("fallback: lastGood null, default marked → no model", async () => {
    const store = makeStore();
    await writeLoadMarker(store, "def");
    expect(
      await pickFallbackModel({
        refusedId: "qwen",
        lastGoodId: null,
        defaultId: "def",
        isMarked: isMarkedIn(store),
      }),
    ).toBeNull();
  });

  test("fallback: unmarked lastGood ≠ refused wins", async () => {
    const store = makeStore();
    expect(
      await pickFallbackModel({
        refusedId: "qwen",
        lastGoodId: "lfm",
        defaultId: "def",
        isMarked: isMarkedIn(store),
      }),
    ).toBe("lfm");
  });
});

describe("hasOtherDownloadedModel (which refusal message is honest)", () => {
  test("another model on disk → true", () => {
    expect(hasOtherDownloadedModel(["qwen", "lfm"], "qwen")).toBe(true);
  });

  test("only the refused model on disk → false", () => {
    expect(hasOtherDownloadedModel(["qwen"], "qwen")).toBe(false);
  });

  test("nothing on disk → false", () => {
    expect(hasOtherDownloadedModel([], "qwen")).toBe(false);
  });
});
