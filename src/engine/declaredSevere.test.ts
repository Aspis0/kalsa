import type { DeviceProfile } from "./deviceProfile";
import { headroomAt, pacingHeadroomLines } from "./declaredSevere";

describe("headroomAt", () => {
  test("gives the S23 and Xiaomi 14 lines from their SEVERE thresholds", () => {
    expect(headroomAt(38.1, 42.0)).toBe(0.87);
    expect(headroomAt(41.7, 42.0)).toBe(0.99);
    expect(headroomAt(39.0, 66.5)).toBe(0.083);
    expect(headroomAt(42.6, 66.5)).toBe(0.203);
  });

  // These two fixtures pin Math.round against floor (0.086) and ceil (0.084).
  test("rounds down when the fourth decimal is below 5", () => {
    expect(headroomAt(39.0, 66.5)).toBe(0.083);
  });

  test("rounds up when the fourth decimal is 5 or more", () => {
    expect(headroomAt(39.1, 66.5)).toBe(0.087);
  });

  test("reads 1.0 at SEVERE and 0.0 thirty degrees below it", () => {
    expect(headroomAt(42.0, 42.0)).toBe(1);
    expect(headroomAt(12.0, 42.0)).toBe(0);
  });

  test("floors at 0 below SEVERE - 30 rather than sending a negative line", () => {
    expect(headroomAt(38.1, 70)).toBe(0);
    expect(headroomAt(0, 42)).toBe(0);
  });
});

describe("pacingHeadroomLines", () => {
  const phone = (modelName: string) => ({ modelName }) as DeviceProfile;

  test("gives the S23 the shared default pair, since its row declares no lines", () => {
    expect(pacingHeadroomLines(phone("SM-S911U"))).toEqual({
      decode_pacing_headroom_start: 0.87,
      decode_pacing_headroom_full: 0.99,
    });
  });

  test("gives the Xiaomi 14 the lines its own row declares", () => {
    expect(pacingHeadroomLines(phone("23127PN0CG"))).toEqual({
      decode_pacing_headroom_start: 0.083,
      decode_pacing_headroom_full: 0.203,
    });
  });

  test("returns null for a model with no row", () => {
    expect(pacingHeadroomLines(phone("Pixel 7"))).toBeNull();
  });
});
