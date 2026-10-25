/**
 * Tests for the bench-only zone-probe boot gate: the AsyncStorage key decides
 * whether the native probe runs and whether the KALSA_ZONE_PROBE line is
 * logged. AsyncStorage and the thermal module wrapper are mocked — this file
 * must stay loadable in node jest.
 */

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
  },
}));

jest.mock("../../modules/kalsa-thermal/src", () => ({
  __esModule: true,
  probeThermalZones: jest.fn(async () => ({})),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { probeThermalZones } from "../../modules/kalsa-thermal/src";
import { BENCH_ZONE_PROBE_KEY, maybeRunZoneProbe } from "./zoneProbe";

describe("maybeRunZoneProbe gate", () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test("key absent → no probe call, no log line", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    await maybeRunZoneProbe();
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(BENCH_ZONE_PROBE_KEY);
    expect(probeThermalZones).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("key other than '1' → no probe call, no log line", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("0");
    await maybeRunZoneProbe();
    expect(probeThermalZones).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("key '1' → exactly one probe call and one KALSA_ZONE_PROBE log", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("1");
    (probeThermalZones as jest.Mock).mockResolvedValue({ sysfs: { zones: 5 } });
    await maybeRunZoneProbe();
    expect(probeThermalZones).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      'KALSA_ZONE_PROBE {"sysfs":{"zones":5}}',
    );
  });

  test("storage failure → silent no-op", async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error("boom"));
    await maybeRunZoneProbe();
    expect(probeThermalZones).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("probe failure → silent, no log line", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("1");
    (probeThermalZones as jest.Mock).mockRejectedValue(new Error("boom"));
    await expect(maybeRunZoneProbe()).resolves.toBeUndefined();
    expect(logSpy).not.toHaveBeenCalled();
  });
});
