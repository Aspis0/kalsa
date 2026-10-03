jest.mock("llama.rn", () => ({
  getBackendDevicesInfo: jest.fn(async () => []),
}));

import { getBackendDevicesInfo } from "llama.rn";
import { htpArchFromDevices, readHtpRuntimeArch } from "./htpRuntimeArch";

describe("htpArchFromDevices", () => {
  test("parses the trailing v<NN> of the HTP0 description", () => {
    expect(htpArchFromDevices([{ deviceName: "HTP0", description: "Hexagon v81" }])).toBe(81);
    expect(htpArchFromDevices([{ deviceName: "HTP0", description: "Hexagon v73" }])).toBe(73);
    // Other devices are ignored; HTP0 wins wherever it sits in the list.
    expect(
      htpArchFromDevices([
        { deviceName: "CPU", description: "Ryzen" },
        { deviceName: "GPU", description: "Adreno 840" },
        { deviceName: "HTP0", description: "Hexagon v79" },
      ]),
    ).toBe(79);
  });

  test("no HTP0 device is null", () => {
    expect(htpArchFromDevices([])).toBeNull();
    expect(htpArchFromDevices([{ deviceName: "GPU", description: "Hexagon v81" }])).toBeNull();
  });

  test("an HTP0 without a usable description is null", () => {
    expect(htpArchFromDevices([{ deviceName: "HTP0" }])).toBeNull();
    expect(htpArchFromDevices([{ deviceName: "HTP0", description: "" }])).toBeNull();
  });

  test("a description without a trailing version is null", () => {
    expect(htpArchFromDevices([{ deviceName: "HTP0", description: "Hexagon" }])).toBeNull();
    // A version that is not the trailing token does not count.
    expect(htpArchFromDevices([{ deviceName: "HTP0", description: "v81 (Hexagon)" }])).toBeNull();
    expect(htpArchFromDevices([{ deviceName: "HTP0", description: "Hexagon v8.1" }])).toBeNull();
  });
});

describe("readHtpRuntimeArch", () => {
  test("reads the backend devices once per process and returns the arch", async () => {
    const mock = getBackendDevicesInfo as jest.Mock;
    mock.mockResolvedValue([{ deviceName: "HTP0", description: "Hexagon v81" }]);
    await expect(readHtpRuntimeArch()).resolves.toBe(81);
    await expect(readHtpRuntimeArch()).resolves.toBe(81);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  test("a native failure resolves null, not a throw, and stays memoized", async () => {
    // A fresh module graph: the memo under test is per-process state.
    jest.resetModules();
    const llama = await import("llama.rn");
    (llama.getBackendDevicesInfo as jest.Mock).mockRejectedValue(new Error("native boom"));
    const { readHtpRuntimeArch: fresh } = await import("./htpRuntimeArch");
    await expect(fresh()).resolves.toBeNull();
    await expect(fresh()).resolves.toBeNull();
    expect(llama.getBackendDevicesInfo).toHaveBeenCalledTimes(1);
  });
});
