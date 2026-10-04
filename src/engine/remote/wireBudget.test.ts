import {
  WIRE_BODY_BUDGET,
  fitsWireBody,
  selectWireImages,
  wireBodyBytes,
  wireImageBytes,
} from "./wireBudget";

const MiB = 1024 * 1024;
/** What one 1 MiB picture weighs on the wire, in the budget's own units. */
const ONE_MIB_WIRE = wireImageBytes(MiB);

describe("wire arithmetic", () => {
  test("a picture's base64 weight is its own bytes grown by 4/3, plus its JSON frame", () => {
    expect(wireImageBytes(0)).toBe(64);
    expect(wireImageBytes(3)).toBe(68);
    expect(wireImageBytes(750_000)).toBe(1_000_064);
  });

  test("the body is weighed in UTF-8 bytes, not UTF-16 code units", () => {
    expect(wireBodyBytes("abc")).toBe(3);
    expect(wireBodyBytes("漢字")).toBe(6);
    expect(wireBodyBytes("🙂")).toBe(4);
  });
});

describe("selectWireImages", () => {
  test("keeps the newest and demotes the oldest first", () => {
    const images = [{ bytes: MiB }, { bytes: MiB }, { bytes: MiB }];
    // Room for the current turn's own picture and nothing older.
    const tight = selectWireImages(images, WIRE_BODY_BUDGET - ONE_MIB_WIRE, 1);
    expect([...tight.rides]).toEqual([2]);
    expect(tight.imageBytes).toBe(ONE_MIB_WIRE);
    // Room for all three: the oldest is not dropped to spare the newest.
    const roomy = selectWireImages(images, WIRE_BODY_BUDGET - 3 * ONE_MIB_WIRE, 1);
    expect([...roomy.rides].sort()).toEqual([0, 1, 2]);
  });

  test("a picture that does not fit ends the walk — an older, smaller one cannot pass it", () => {
    const images = [{ bytes: 100_000 }, { bytes: 5 * MiB }];
    const pick = selectWireImages(images, WIRE_BODY_BUDGET - 200_000, 0);
    expect(pick.rides.size).toBe(0);
    expect(pick.imageBytes).toBe(0);
  });

  test("the current turn's own pictures always ride, and a body they alone break is a refusal", () => {
    const images = [{ bytes: MiB }];
    const nonImageBytes = WIRE_BODY_BUDGET - 1_000;
    const pick = selectWireImages(images, nonImageBytes, 1);
    expect([...pick.rides]).toEqual([0]);
    expect(fitsWireBody(nonImageBytes, pick.imageBytes)).toBe(false);
    expect(fitsWireBody(WIRE_BODY_BUDGET - ONE_MIB_WIRE, ONE_MIB_WIRE)).toBe(true);
  });
});
