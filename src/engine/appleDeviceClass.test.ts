import { appleDeviceClassForModelId } from "./appleDeviceClass";

const EIGHT_GIB = 8_589_934_592;

describe("appleDeviceClassForModelId", () => {
  it("resolves the enumerated Apple Intelligence iPhones and iPads", () => {
    expect(appleDeviceClassForModelId("iPhone16,1")).toEqual({
      chipClass: "A17 Pro",
      ramBytes: EIGHT_GIB,
    });
    expect(appleDeviceClassForModelId("iPhone17,5")?.chipClass).toBe("A18");
    expect(appleDeviceClassForModelId("iPad13,4")?.chipClass).toBe("M1");
    expect(appleDeviceClassForModelId("iPad16,6")?.chipClass).toBe("M4");
  });

  it("covers the whole iPhone18,x generation by prefix", () => {
    expect(appleDeviceClassForModelId("iPhone18,1")).toEqual({
      chipClass: "A19",
      ramBytes: EIGHT_GIB,
    });
    expect(appleDeviceClassForModelId("iPhone18,9")).toEqual({
      chipClass: "A19",
      ramBytes: EIGHT_GIB,
    });
  });

  it("treats any Mac identifier as the Apple Silicon iPad-build host", () => {
    expect(appleDeviceClassForModelId("Mac15,6")).toEqual({
      chipClass: "Apple Silicon",
      ramBytes: EIGHT_GIB,
    });
    expect(appleDeviceClassForModelId("MacBookPro18,3")?.chipClass).toBe(
      "Apple Silicon",
    );
  });

  it("returns null for unknown, non-Apple or malformed identifiers", () => {
    expect(appleDeviceClassForModelId("iPhone15,4")).toBeNull();
    expect(appleDeviceClassForModelId("iPad13,1")).toBeNull();
    expect(appleDeviceClassForModelId("SM-S911B")).toBeNull();
    expect(appleDeviceClassForModelId("")).toBeNull();
    expect(appleDeviceClassForModelId(null)).toBeNull();
    expect(appleDeviceClassForModelId(undefined)).toBeNull();
  });
});
