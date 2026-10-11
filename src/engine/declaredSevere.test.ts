import { headroomAt } from "./declaredSevere";

describe("headroomAt", () => {
  test("gives the S23 and Xiaomi 14 lines from their SEVERE thresholds", () => {
    expect(headroomAt(38.1, 42.0)).toBe(0.87);
    expect(headroomAt(41.7, 42.0)).toBe(0.99);
    expect(headroomAt(38.1, 66.5)).toBe(0.053);
    expect(headroomAt(41.7, 66.5)).toBe(0.173);
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
