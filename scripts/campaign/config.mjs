/**
 * Load and validate a campaign JSON. Compaction values other than
 * off|anchored|ciswire are a silent wrong-regime trap (parseContextMode
 * maps on/1/true/missing → anchored). Reject them here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const COMPACTION_OK = new Set(["off", "anchored", "ciswire"]);
const COMPACTION_KEY = "kalsa.context.compaction";
const BOOL_OK = new Set(["0", "1"]);

export function loadCampaign(file) {
  const raw = readFileSync(file, "utf8");
  const cfg = JSON.parse(raw);
  const errors = validateCampaign(cfg);
  if (errors.length) {
    const msg = errors.map((e) => `  - ${e}`).join("\n");
    throw new Error(`campaign config invalid (${file}):\n${msg}`);
  }
  cfg._path = path.resolve(file);
  return cfg;
}

export function validateCampaign(cfg) {
  const err = [];
  if (!cfg || typeof cfg !== "object") return ["root is not an object"];
  for (const k of ["name", "device", "model", "pkg"]) {
    if (!cfg[k] || typeof cfg[k] !== "string") err.push(`missing string ${k}`);
  }
  if (!Array.isArray(cfg.arms) || cfg.arms.length === 0) err.push("arms[] required");
  for (const arm of cfg.arms || []) {
    if (!arm?.id) err.push("arm missing id");
    const flags = arm.flags || {};
    const c = flags[COMPACTION_KEY];
    if (!COMPACTION_OK.has(c)) {
      err.push(
        `arm ${arm.id || "?"}: ${COMPACTION_KEY}=${JSON.stringify(c)} ` +
          `must be off|anchored|ciswire (on/1/true → anchored, not ciswire)`,
      );
    }
    const mem = flags["kalsa.memory.enabled"];
    const th = flags["kalsa.ciswire.toolhelp"];
    if (mem !== undefined && !BOOL_OK.has(String(mem))) {
      err.push(`arm ${arm.id}: kalsa.memory.enabled must be '0'|'1'`);
    }
    if (th !== undefined && !BOOL_OK.has(String(th))) {
      err.push(`arm ${arm.id}: kalsa.ciswire.toolhelp must be '0'|'1'`);
    }
  }
  if (!Array.isArray(cfg.variants) || cfg.variants.length === 0) {
    err.push("variants[] required");
  } else if (cfg.conversations != null) {
    const n = Number(cfg.conversations);
    const nVar = cfg.variants.length;
    if (!Number.isInteger(n) || n < 1 || n % nVar !== 0) {
      err.push(`conversations=${cfg.conversations} must divide evenly by ${nVar} variants (per-arm split)`);
    }
  }
  for (const v of cfg.variants || []) {
    if (!v?.id) err.push("variant missing id");
    const params = v.params || {};
    for (const [k, val] of Object.entries(params)) {
      if (k === "kalsa.bench.winbudget" && val === "PHASE0") continue;
      if (typeof val !== "string") err.push(`variant ${v.id} param ${k} must be string`);
    }
  }
  if (cfg.runOrder && cfg.runOrder !== "random") {
    err.push(`runOrder must be "random" (got ${cfg.runOrder})`);
  }
  if (!Array.isArray(cfg.telemetry)) err.push("telemetry[] required");
  if (!cfg.watchdog || typeof cfg.watchdog.turnTimeoutMs !== "number") {
    err.push("watchdog.turnTimeoutMs required");
  }
  if (!cfg.recovery) err.push("recovery required");
  else {
    if ((cfg.recovery.thermalPause ?? 0) < 3) err.push("recovery.thermalPause must be >= 3");
    if (cfg.recovery.neverUninstall !== true) err.push("recovery.neverUninstall must be true");
    if (cfg.recovery.neverPmClear !== true) err.push("recovery.neverPmClear must be true");
  }
  return err;
}

export function armCompactionBit(arm) {
  const c = arm?.flags?.[COMPACTION_KEY];
  return c === "ciswire" ? 1 : 0;
}

/** conversations is per-arm; split evenly across variants. 6/2 → 3 per cell. */
export function conversationsPerVariant(cfg) {
  const nVar = (cfg.variants || []).length;
  const n = Number(cfg.conversations);
  if (!nVar) throw new Error("variants[] required");
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`conversations must be a positive integer (got ${cfg.conversations})`);
  }
  if (n % nVar !== 0) {
    throw new Error(`conversations=${n} not divisible by ${nVar} variants`);
  }
  return n / nVar;
}

export function loadScript(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(data.turns)) throw new Error(`script missing turns[]: ${file}`);
  return data;
}

export function loadLexicon(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

if (process.argv[1] && process.argv[1].endsWith("config.mjs")) {
  if (process.argv[2] === "--n-per-variant") {
    process.stdout.write(`${conversationsPerVariant(loadCampaign(process.argv[3]))}\n`);
  } else {
    loadCampaign(process.argv[2]);
    process.stdout.write("ok\n");
  }
}
