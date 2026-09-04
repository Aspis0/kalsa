/**
 * Per-prefix telemetry parse. Absent ciswireFlags → 0 (emitters omit when 0).
 * Memory-off lines keep sentinels (-1) as emitted. KALSA_DIGEST is only
 * expected on ciswire arms.
 */

export const CISWIRE_FLAG_COMPACTION = 1;

export function parsePrefixedLines(text, prefix) {
  const needle = `${prefix} `;
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const i = line.lastIndexOf(needle);
    if (i < 0) continue;
    const payload = line.slice(i + needle.length).trim();
    if (!payload) continue;
    try {
      const obj = JSON.parse(payload);
      if (obj && typeof obj === "object") out.push(obj);
    } catch {
      /* malformed: skip */
    }
  }
  return out;
}

export function applySchema(obj, schema) {
  const next = { ...obj };
  for (const k of schema.absentZero || []) {
    if (next[k] === undefined || next[k] === null) next[k] = 0;
  }
  return next;
}

export function ciswireFlagsOf(obj) {
  const v = obj?.ciswireFlags;
  if (v === undefined || v === null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function compactionBit(flags) {
  return (ciswireFlagsOf({ ciswireFlags: flags }) & CISWIRE_FLAG_COMPACTION) ? 1 : 0;
}

/** True if any AC/USB/Wireless powered line is true. */
export function isChargingFromDump(dump) {
  const t = String(dump || "");
  return /(?:AC|USB|Wireless) powered:\s*true/i.test(t);
}

export function stampTimingInvalid(obj, charging, keys) {
  if (!charging) {
    return { ...obj, timingValid: true };
  }
  const next = { ...obj, timingValid: false };
  for (const k of keys || []) {
    if (k in next) next[`${k}Valid`] = false;
  }
  return next;
}

export function parseTurnTelemetry(logText, schemas) {
  const byPrefix = {};
  for (const schema of schemas || []) {
    const rows = parsePrefixedLines(logText, schema.prefix).map((o) =>
      applySchema(o, schema),
    );
    byPrefix[schema.prefix] = rows;
  }
  return byPrefix;
}

export function lastTelemetry(byPrefix) {
  const rows = byPrefix.KALSA_TELEMETRY || [];
  return rows.length ? rows[rows.length - 1] : null;
}

export function assertCompactionBit(telemetryObj, declaredBit) {
  const got = compactionBit(ciswireFlagsOf(telemetryObj));
  const want = declaredBit ? 1 : 0;
  if (got !== want) {
    const flags = ciswireFlagsOf(telemetryObj);
    throw new Error(
      `TELEMETRY GUARD FAIL: ciswireFlags=${flags} bit0=${got} declared compaction bit=${want}`,
    );
  }
}
