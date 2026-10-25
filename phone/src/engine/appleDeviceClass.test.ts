import { appleDeviceClassForModelId } from "./appleDeviceClass";

describe("appleDeviceClassForModelId", () => {
  it("resolves the enumerated Apple Intelligence iPhones and iPads", () => {
    expect(appleDeviceClassForModelId("iPhone16,1")).toEqual({
      chipClass: "A17 Pro",
    });
    expect(appleDeviceClassForModelId("iPhone17,5")?.chipClass).toBe("A18");
    expect(appleDeviceClassForModelId("iPad13,4")?.chipClass).toBe("M1");
    expect(appleDeviceClassForModelId("iPad16,6")?.chipClass).toBe("M4");
  });

  it("maps the iPhone 17 family by exact identifier", () => {
    // Sources in appleDeviceClass.ts header: Apple tech specs (chips),
    // adamawolf gist (identifiers).
    expect(appleDeviceClassForModelId("iPhone18,1")).toEqual({
      chipClass: "A19 Pro",
    });
    expect(appleDeviceClassForModelId("iPhone18,2")).toEqual({
      chipClass: "A19 Pro",
    });
    expect(appleDeviceClassForModelId("iPhone18,3")).toEqual({
      chipClass: "A19",
    });
    expect(appleDeviceClassForModelId("iPhone18,4")).toEqual({
      chipClass: "A19 Pro",
    });
    expect(appleDeviceClassForModelId("iPhone18,5")).toEqual({
      chipClass: "A19",
    });
  });

  it("returns null for unmapped identifiers inside a mapped generation (no prefix guessing)", () => {
    expect(appleDeviceClassForModelId("iPhone18,9")).toBeNull();
    expect(appleDeviceClassForModelId("iPhone18,6")).toBeNull();
    expect(appleDeviceClassForModelId("iPhone19,1")).toBeNull();
  });

  it("treats any Mac identifier as the Apple Silicon iPad-build host", () => {
    expect(appleDeviceClassForModelId("Mac15,6")).toEqual({
      chipClass: "Apple Silicon",
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
