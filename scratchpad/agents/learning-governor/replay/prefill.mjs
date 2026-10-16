/**
 * Prefill attribution from the M4 row fields: what the route chose for the
 * prefill against the device that actually ran the layers, and the prefill rate
 * per device.
 */
const GPU_DEVICE = /^GPU/i;

/**
 * "gpu" every chunk named a GPU device, "npu" none did, "mixed" some did,
 * "absent" the row predates the M4 fields (or named no device). The DEVICE
 * decides, not engine_prefill: on a phone NPU load the route label reads GPU
 * while Hexagon runs the matmuls (llama-ext.h:517-524), which is exactly the
 * case the field exists to express.
 */
export function prefillDeviceCase(row) {
  const devices = Array.isArray(row.prefill_dev) ? row.prefill_dev : null;
  if (devices === null || devices.length === 0) return "absent";
  const gpu = devices.filter((device) => GPU_DEVICE.test(device)).length;
  if (gpu === devices.length) return "gpu";
  return gpu === 0 ? "npu" : "mixed";
}

/**
 * How the route label and the device relate, stated plainly rather than as a
 * pass/fail: the device agrees, the route says GPU while the layers ran
 * somewhere else (the expected NPU mislabel), or the row names no device.
 */
export function prefillAgreement(row) {
  const devices = Array.isArray(row.prefill_dev) ? row.prefill_dev : null;
  const route = typeof row.engine_prefill === "string" ? row.engine_prefill : null;
  if (devices === null || devices.length === 0) return "no device named (the row predates the M4 fields)";
  const listed = devices.join(",");
  if (route === null) return `no route label, layers on ${listed}`;
  if (GPU_DEVICE.test(route) && devices.every((device) => !GPU_DEVICE.test(device))) {
    return `route says ${route}, layers ran on ${listed} (expected NPU mislabel)`;
  }
  if (GPU_DEVICE.test(route)) return `device agrees with the route (${route} on ${listed})`;
  return `route ${route}, layers on ${listed}`;
}

/**
 * One row's own prefill numbers. A row with no prefill time has no rate at all
 * - not a rate of zero - so `prefillTokPerSec` is null and the row is left out
 * of the device totals instead of contributing its prompt tokens to a divisor
 * it did not measure.
 */
const perRow = (row, index) => {
  const hasTime = typeof row.prefill_ms === "number";
  const promptTokens = typeof row.prompt_n === "number" ? row.prompt_n : 0;
  return {
    index,
    turn: row.t,
    route: typeof row.engine_prefill === "string" ? row.engine_prefill : null,
    devices: Array.isArray(row.prefill_dev) ? row.prefill_dev : null,
    case: prefillDeviceCase(row),
    hasTime,
    promptTokens,
    prefillMs: hasTime ? row.prefill_ms : null,
    prefillTokPerSec: hasTime && row.prefill_ms > 0 ? (promptTokens * 1000) / row.prefill_ms : null,
    agreement: prefillAgreement(row),
  };
};

/**
 * Totals per DEVICE, because the device is what the heat question asks about.
 * A "mixed" row named both a GPU and a non-GPU chunk, so no single device owns
 * its prompt tokens; it is reported on its own instead of being assigned.
 */
export function prefillAttribution(rows) {
  const perRowData = rows.map(perRow);
  const timed = perRowData.filter((row) => row.hasTime);
  const devices = new Map();
  for (const row of timed) {
    if (row.case === "absent" || row.case === "mixed") continue;
    const entry = devices.get(row.case) ?? { device: row.case, rows: 0, promptTokens: 0, prefillMs: 0 };
    entry.rows += 1;
    entry.promptTokens += row.promptTokens;
    entry.prefillMs += row.prefillMs;
    devices.set(row.case, entry);
  }
  return {
    rows: rows.length,
    rowsMissingM4: perRowData.filter((row) => !row.hasTime).length,
    rowsWithM4: timed.length,
    deviceCases: Object.fromEntries(
      ["gpu", "npu", "mixed", "absent"].map((name) => [
        name,
        perRowData.filter((row) => row.case === name).length,
      ]),
    ),
    perRow: timed,
    unattributable: timed.filter((row) => row.case === "absent" || row.case === "mixed"),
    devices: [...devices.values()].map((entry) => ({
      ...entry,
      prefillTokPerSec: entry.prefillMs > 0 ? (entry.promptTokens * 1000) / entry.prefillMs : null,
    })),
    agreements: [...new Set(perRowData.filter((row) => row.hasTime).map((row) => row.agreement))],
  };
}