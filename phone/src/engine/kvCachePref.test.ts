jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  KV_CACHE_CHOICES,
  KV_CACHE_KEY,
  kvCacheChoiceById,
  readKvCacheChoice,
  writeKvCacheChoice,
} from "./kvCachePref";

describe("KV cache preference", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockReset();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockReset();
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  test("the two rows are the shipped pairs, nothing speculative", () => {
    expect(KV_CACHE_CHOICES).toEqual([
      { id: "standard", k: "q8_0", v: "q4_0" },
      { id: "high", k: "q8_0", v: "q8_0" },
    ]);
  });

  test("unset reads as null, so the registry profile keeps winning", async () => {
    expect(await readKvCacheChoice()).toBeNull();
  });

  test("round-trips a chosen row and reads back its pair", async () => {
    await writeKvCacheChoice("high");
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(KV_CACHE_KEY, "high");
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("high");
    expect(await readKvCacheChoice()).toEqual({ id: "high", k: "q8_0", v: "q8_0" });
  });

  test("an unknown stored id reads as unset, not as an unpriceable cache type", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("q4_0/q4_0");
    expect(await readKvCacheChoice()).toBeNull();
    expect(kvCacheChoiceById("nope")).toBeNull();
  });

  test("a failed write reports false and never throws", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error("volume full"));
    await expect(writeKvCacheChoice("high")).resolves.toBe(false);
  });
});
