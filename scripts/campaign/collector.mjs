/**
 * Per-turn collector: parse KALSA_* from a logcat slice, attach
 * user+assistant transcript, stamp timingValid=false when charging,
 * fail loudly if ciswireFlags bit0 ≠ declared compaction bit.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  parseTurnTelemetry,
  lastTelemetry,
  assertCompactionBit,
  stampTimingInvalid,
  isChargingFromDump,
} from "./telemetryParse.mjs";


export function lastUserAssistant(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let user = "";
  let assistant = "";
  for (const m of list) {
    if (!m || typeof m !== "object") continue;
    if (m.role === "user") user = m.text || m.content || "";
    if (m.role === "assistant") assistant = m.text || m.content || "";
  }
  return { user, assistant };
}

export function collectTurn(opts) {
  const logText = opts.logText || "";
  const schemas = opts.telemetry || [];
  const byPrefix = parseTurnTelemetry(logText, schemas);
  const tel = lastTelemetry(byPrefix);
  const interrupted = opts.interrupted === true;
  const charging = Boolean(opts.charging);
  const timingKeys = [];
  for (const s of schemas) {
    for (const k of s.timingInvalidOnCharge || []) timingKeys.push(k);
  }
  const telemetryStamped = {};
  for (const [prefix, rows] of Object.entries(byPrefix)) {
    const schema = schemas.find((s) => s.prefix === prefix) || {};
    telemetryStamped[prefix] = rows.map((r) =>
      stampTimingInvalid(r, charging, schema.timingInvalidOnCharge || []),
    );
  }
  const declaredBit = opts.declaredCompactionBit ?? 0;
  if (tel) assertCompactionBit(tel, declaredBit);
  else if (declaredBit === 1 && !interrupted) {
    throw new Error("TELEMETRY GUARD FAIL: no KALSA_TELEMETRY on ciswire arm (bit0 expected 1)");
  }

  const { user, assistant } = lastUserAssistant(opts.messages || []);
  return {
    i: opts.i,
    arm: opts.armId,
    variant: opts.variantId,
    conv: opts.convId,
    intent: opts.script?.intent,
    script: opts.script || null,
    user,
    assistant,
    transcript: { user, assistant },
    telemetry: telemetryStamped,
    charging,
    timingValid: !charging,
    retried: Boolean(opts.retried),
    interrupted: interrupted || null,
    recovery: opts.recovery || null,
    scores: opts.scores || null,
    evictionHint: evictionHint(telemetryStamped),
  };
}

function evictionHint(tel) {
  const digests = tel.KALSA_DIGEST || [];
  const last = digests.length ? digests[digests.length - 1] : null;
  if (!last) return null;
  return {
    corpusSize: last.corpusSize ?? 0,
    selectedCount: last.selectedCount ?? 0,
    durationMs: last.durationMs,
    durationMsValid: last.timingValid !== false && last.durationMsValid !== false,
  };
}

function parseArgs(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--logcat") o.logcat = argv[++i];
    else if (a === "--messages") o.messages = argv[++i];
    else if (a === "--charging") o.charging = argv[++i] === "true";
    else if (a === "--battery-dump") o.batteryDump = argv[++i];
    else if (a === "--arm-compaction") o.compaction = argv[++i];
    else if (a === "--arm") o.armId = argv[++i];
    else if (a === "--variant") o.variantId = argv[++i];
    else if (a === "--conv") o.convId = argv[++i];
    else if (a === "--turn") o.i = Number(argv[++i]);
    else if (a === "--script") o.script = argv[++i];
    else if (a === "--telemetry") o.telemetry = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--interrupted") o.interrupted = argv[++i] === "true";
    else if (a === "--retried") o.retried = true;
  }
  return o;
}

function main(argv) {
  const a = parseArgs(argv);
  const logText = a.logcat && existsSync(a.logcat) ? readFileSync(a.logcat, "utf8") : "";
  const messages = a.messages && existsSync(a.messages)
    ? JSON.parse(readFileSync(a.messages, "utf8") || "[]")
    : [];
  const charging = a.batteryDump
    ? isChargingFromDump(readFileSync(a.batteryDump, "utf8"))
    : Boolean(a.charging);
  const telemetry = a.telemetry ? JSON.parse(readFileSync(a.telemetry, "utf8")) : [];
  const script = a.script ? JSON.parse(readFileSync(a.script, "utf8")) : null;
  const declared = a.compaction === "ciswire" ? 1 : 0;
  const rec = collectTurn({
    logText,
    messages,
    charging,
    telemetry,
    script,
    i: a.i,
    armId: a.armId,
    variantId: a.variantId,
    convId: a.convId,
    declaredCompactionBit: declared,
    interrupted: a.interrupted,
    retried: a.retried,
  });
  const json = JSON.stringify(rec);
  if (a.out) writeFileSync(a.out, json + "\n");
  else process.stdout.write(json + "\n");
}

if (process.argv[1] && process.argv[1].endsWith("collector.mjs")) {
  try {
    main(process.argv);
  } catch (e) {
    console.error(e.message || e);
    process.exit(2);
  }
}
