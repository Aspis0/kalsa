jest.mock("llama.rn", () => ({
  getBackendDevicesInfo: jest.fn(async () => []),
}));

import { htpArchFromDevices } from "./htpRuntimeArch";

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
  // The kept arch is per-process state: every test gets a fresh module graph.
  async function freshModules() {
    jest.resetModules();
    const llama = await import("llama.rn");
    const { readHtpRuntimeArch } = await import("./htpRuntimeArch");
    return { read: readHtpRuntimeArch, devices: llama.getBackendDevicesInfo as jest.Mock };
  }

  test("keeps a read arch for the process", async () => {
    const { read, devices } = await freshModules();
    devices.mockResolvedValue([{ deviceName: "HTP0", description: "Hexagon v81" }]);
    await expect(read()).resolves.toBe(81);
    await expect(read()).resolves.toBe(81);
    expect(devices).toHaveBeenCalledTimes(1);
  });

  test("a native failure resolves null and the next call reads again", async () => {
    const { read, devices } = await freshModules();
    devices.mockRejectedValueOnce(new Error("native boom"));
    devices.mockResolvedValueOnce([{ deviceName: "HTP0", description: "Hexagon v73" }]);
    await expect(read()).resolves.toBeNull();
    await expect(read()).resolves.toBe(73);
    expect(devices).toHaveBeenCalledTimes(2);
  });
});
