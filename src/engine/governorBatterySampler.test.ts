jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null) },
}));

jest.mock("react-native", () => ({
  NativeModules: {
    GovernorBattery: {
      readHighRate: jest.fn(async () => ({})),
      startSampling: jest.fn(async () => undefined),
      stopSampling: jest.fn(async () => undefined),
    },
  },
}));

import * as fs from "fs";
import * as path from "path";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules } from "react-native";
import {
  BENCH_ENERGY_TRACE_KEY,
  energyTraceFilePath,
  energyTraceRequested,
  readBenchEnergyTraceEnabled,
  startGovernorBatteryTrace,
  stopGovernorBatteryTrace,
} from "./governorBatterySampler";

const getItem = AsyncStorage.getItem as jest.Mock;
const battery = NativeModules.GovernorBattery as {
  startSampling: jest.Mock;
  stopSampling: jest.Mock;
};

const KOTLIN_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "..", "native", "GovernorBatteryModule.kt"),
  "utf8",
);

/** Concatenate a Kotlin const that may span several `"…" +` lines. */
function stringConstant(source: string, name: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`const val ${name}\\b`).test(line),
  );
  if (start < 0) throw new Error(`${name} is not declared in the native module`);
  const parts: string[] = [];
  for (let i = start; i < lines.length && i < start + 30; i += 1) {
    parts.push(...(lines[i].match(/"[^"]*"/g) ?? []));
    if (parts.length > 0 && !lines[i].trimEnd().endsWith("+")) break;
  }
  if (parts.length === 0) throw new Error(`${name} has no string literal`);
  return parts.map((part) => part.slice(1, -1)).join("");
}

/** Top-level elements of the `listOf(…)` inside sampleRow. */
function rowFields(source: string): string[] {
  const fnStart = source.indexOf("private fun sampleRow(");
  if (fnStart < 0) throw new Error("sampleRow is not declared in the native module");
  const body = source.slice(fnStart);
  const listStart = body.indexOf("listOf(");
  if (listStart < 0) throw new Error("sampleRow has no listOf row");
  const inner = body.slice(listStart + "listOf(".length);

  let depth = 0;
  let end = -1;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      if (depth === 0) {
        end = i;
        break;
      }
      depth -= 1;
    }
  }
  if (end < 0) throw new Error("sampleRow listOf is unbalanced");

  const fields: string[] = [];
  let nested = 0;
  let current = "";
  for (const ch of inner.slice(0, end)) {
    if (ch === "(") nested += 1;
    else if (ch === ")") nested -= 1;
    if (ch === "," && nested === 0) {
      fields.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) fields.push(current.trim());
  return fields;
}

beforeEach(() => {
  jest.clearAllMocks();
  getItem.mockResolvedValue(null);
  battery.startSampling.mockResolvedValue(undefined);
  battery.stopSampling.mockResolvedValue(undefined);
});

describe("energy trace gate", () => {
  it("only the exact bench value '1' requests the trace", () => {
    for (const raw of [null, "", "0", "true", "on", " 1", "kalsa"]) {
      expect(energyTraceRequested(raw)).toBe(false);
    }
    expect(energyTraceRequested("1")).toBe(true);
  });

  it("reads the bench switch from AsyncStorage", async () => {
    await expect(readBenchEnergyTraceEnabled()).resolves.toBe(false);
    expect(getItem).toHaveBeenCalledWith(BENCH_ENERGY_TRACE_KEY);

    getItem.mockResolvedValue("1");
    await expect(readBenchEnergyTraceEnabled()).resolves.toBe(true);
  });

  it("stays off when the storage read fails", async () => {
    getItem.mockRejectedValue(new Error("RKStorage is locked"));
    await expect(readBenchEnergyTraceEnabled()).resolves.toBe(false);
  });

  it("a shipped build never starts a native sampling session", async () => {
    await expect(startGovernorBatteryTrace("/app/files/", "7")).resolves.toBe(false);
    expect(battery.startSampling).not.toHaveBeenCalled();
    expect(battery.stopSampling).not.toHaveBeenCalled();
  });

  it("an unreadable switch never starts a native sampling session", async () => {
    getItem.mockRejectedValue(new Error("RKStorage is locked"));
    await expect(startGovernorBatteryTrace("/app/files/", "7")).resolves.toBe(false);
    expect(battery.startSampling).not.toHaveBeenCalled();
    expect(battery.stopSampling).not.toHaveBeenCalled();
  });

  it("starts one trace file per turn when the switch is set", async () => {
    getItem.mockResolvedValue("1");
    await expect(startGovernorBatteryTrace("/app/files/", "7")).resolves.toBe(true);
    expect(battery.startSampling).toHaveBeenCalledTimes(1);
    const [outputPath, intervalMs] = battery.startSampling.mock.calls[0];
    expect(outputPath).toMatch(/^\/app\/files\/energy\/\d+-t7\.csv$/);
    // The fuel gauge smooths over ~1 s; the native floor is 200 ms.
    expect(intervalMs).toBe(1000);
  });

  it("refuses to start without a files directory", async () => {
    getItem.mockResolvedValue("1");
    await expect(startGovernorBatteryTrace("", "7")).resolves.toBe(false);
    expect(battery.startSampling).not.toHaveBeenCalled();
  });

  it("a failing native start is not a turn failure", async () => {
    getItem.mockResolvedValue("1");
    battery.startSampling.mockRejectedValue(new Error("no native module"));
    await expect(startGovernorBatteryTrace("/app/files/", "7")).resolves.toBe(false);
  });

  it("a failing native stop is not a turn failure", async () => {
    battery.stopSampling.mockRejectedValue(new Error("thread already gone"));
    await expect(stopGovernorBatteryTrace()).resolves.toBeUndefined();
  });
});

describe("energy trace path", () => {
  it("is predictable and cannot collide with another turn", () => {
    const first = energyTraceFilePath("/app/files/", "3", 1_700_000_000_000);
    expect(first).toBe("/app/files/energy/1700000000000-t3.csv");
    expect(energyTraceFilePath("/app/files/", "3", 1_700_000_001_000)).not.toBe(first);
    expect(energyTraceFilePath("/app/files/", "4", 1_700_000_000_000)).not.toBe(first);
    expect(energyTraceFilePath("/app/files/", "3", 1_700_000_000_000)).toBe(first);
  });
});

describe("native trace CSV schema", () => {
  const columns = stringConstant(KOTLIN_SOURCE, "TRACE_COLUMNS").split(",");
  const schema = stringConstant(KOTLIN_SOURCE, "TRACE_SCHEMA_HEADER");
  const fields = rowFields(KOTLIN_SOURCE);

  /** Which column each element of sampleRow's listOf feeds, in writer order. */
  const COLUMN_OF_FIELD: Record<string, string> = {
    "uptimeSeconds.toString()": "t_s",
    "uptimeMs.toString()": "elapsed_realtime_ms",
    "wallClockMs.toString()": "wall_clock_ms",
    "propertyCsvValue(reading.current)": "current_uA",
    "propertyCsvValue(reading.chargeCounter)": "charge_counter_uAh",
    "propertyCsvValue(voltageMv)": "voltage_mV",
    "reading.current.status": "current_status",
    "reading.chargeCounter.status": "charge_counter_status",
    "voltageMv.status": "voltage_status",
  };

  it("writes exactly one field per declared column", () => {
    expect(fields).toHaveLength(columns.length);
  });

  it("writes the declared columns in the declared order", () => {
    const written = fields.map(
      (field) => COLUMN_OF_FIELD[field] ?? `UNDECLARED(${field})`,
    );
    expect(written).toEqual(columns);
  });

  it("keeps the column order a parser was written against", () => {
    expect(columns).toEqual([
      "t_s",
      "elapsed_realtime_ms",
      "wall_clock_ms",
      "current_uA",
      "charge_counter_uAh",
      "voltage_mV",
      "current_status",
      "charge_counter_status",
      "voltage_status",
    ]);
  });

  it("declares the schema version and the voltage unit", () => {
    expect(schema).toContain("schema=kalsa-governor-battery-trace-v2");
    expect(schema).toMatch(/voltage_mV=[^;]*millivolt/i);
    // The current unit is the property's documented one, not a measured one.
    expect(schema).toMatch(/current_uA=[^;]*calibrat/i);
  });

  it("writes the schema line first and only for an empty file", () => {
    const emptyCheck = KOTLIN_SOURCE.indexOf("val isEmpty = !file.exists()");
    const schemaWrite = KOTLIN_SOURCE.indexOf("writer.write(TRACE_SCHEMA_HEADER)");
    const columnsWrite = KOTLIN_SOURCE.indexOf("writer.write(TRACE_COLUMNS)");
    expect(emptyCheck).toBeGreaterThan(-1);
    expect(schemaWrite).toBeGreaterThan(emptyCheck);
    expect(columnsWrite).toBeGreaterThan(schemaWrite);
  });
});
