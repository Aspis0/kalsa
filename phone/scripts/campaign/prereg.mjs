/**
 * Pre-registered analysis: 15 primary contrasts (3 factors × 5 axes),
 * Holm on that family only. Conversation is the analysis unit.
 *
 * δ80 two-sided α=0.05 = 2.802·σ·√(2/n)
 * Holm first-rank (m=15) ≈ 1.09σ pooled / 1.54σ per variant
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

export const FACTORS = ["compaction", "memory", "toolhelp"];
export const PRIMARY_AXES = ["echo-rate", "hedge-rate", "drift", "tool-call-rate", "recall"];
export const HOLM_M = 15;
export const HOLM_FIRST_ALPHA = 0.05 / HOLM_M;

/** z_{0.025} + z_{0.80} */
export const Z80_A05 = 2.802;
/** z_{0.05/(2·15)} + z_{0.80} ≈ 2.935 + 0.842 */
export const Z80_HOLM_FIRST = 3.777;

export function loadPrereg(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function primaryContrasts(factors = FACTORS, axes = PRIMARY_AXES) {
  const out = [];
  for (const factor of factors) {
    for (const axis of axes) {
      out.push({ factor, axis, family: "primary" });
    }
  }
  return out;
}

export function holmAlphas(m = HOLM_M, alpha = 0.05) {
  const ranks = [];
  for (let i = 1; i <= m; i++) ranks.push({ rank: i, alpha: alpha / (m - i + 1) });
  return ranks;
}

export function delta80(sigma, n, zSum = Z80_A05) {
  return zSum * sigma * Math.sqrt(2 / n);
}

export function computeDetectionFloors(sigmaByAxis, nPooled = 24, nVariant = 12) {
  const out = {};
  for (const [axis, spec] of Object.entries(sigmaByAxis)) {
    const sigma = typeof spec === "number" ? spec : spec.sigma;
    const status = typeof spec === "number" ? "PENDING_PHASE0" : spec.status || "PENDING_PHASE0";
    out[axis] = {
      sigma,
      nPooled,
      nVariant,
      status,
      delta80Pooled: delta80(sigma, nPooled),
      delta80Variant: delta80(sigma, nVariant),
      holmFirstPooledSigma: Z80_HOLM_FIRST * Math.sqrt(2 / nPooled),
      holmFirstVariantSigma: Z80_HOLM_FIRST * Math.sqrt(2 / nVariant),
      holmFirstPooled: delta80(sigma, nPooled, Z80_HOLM_FIRST),
      holmFirstVariant: delta80(sigma, nVariant, Z80_HOLM_FIRST),
    };
  }
  return out;
}

export function provisionalFloors(prereg) {
  const floors = prereg.floors || {};
  const sigma = {};
  for (const [axis, s] of Object.entries(floors.provisionalSigma || {})) {
    sigma[axis] = { sigma: s, status: floors.status || "PENDING_PHASE0" };
  }
  return computeDetectionFloors(sigma, floors.nPooled || 24, floors.nVariant || 12);
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function sampleSd(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function conversationAxes(turns) {
  const echo = [];
  const hedge = [];
  const drift = [];
  const tool = [];
  const recall = [];
  for (const t of turns) {
    const sc = t.scores || {};
    const p = sc.response_profile || {};
    if (typeof p.echoRate === "number") echo.push(p.echoRate);
    if (typeof p.hedgePer100 === "number") hedge.push(p.hedgePer100 / 100);
    if (typeof p.languageDrift === "boolean") drift.push(p.languageDrift ? 1 : 0);
    const toolSc = sc.tool;
    if (toolSc && toolSc.requested) tool.push(toolSc.called ? 1 : 0);
    const rec = sc.recall;
    if (rec && rec.rate != null) recall.push(rec.rate);
  }
  return {
    "echo-rate": echo.length ? mean(echo) : 0,
    "hedge-rate": hedge.length ? mean(hedge) : 0,
    drift: drift.length ? mean(drift) : 0,
    "tool-call-rate": tool.length ? mean(tool) : 0,
    recall: recall.length ? mean(recall) : 0,
  };
}

export function readJsonl(file) {
  return readFileSync(file, "utf8")
    .split(/\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

export function floorsFromR1(jsonlFiles, prereg) {
  const byAxis = { "echo-rate": [], "hedge-rate": [], drift: [], "tool-call-rate": [], recall: [] };
  for (const f of jsonlFiles) {
    const turns = readJsonl(f).filter((t) => !t.retried && t.event !== "RECOVERY");
    const ax = conversationAxes(turns);
    for (const k of Object.keys(byAxis)) byAxis[k].push(ax[k]);
  }
  const n = jsonlFiles.length;
  const floorsSpec = prereg.floors || {};
  const sigma = {};
  let status = n >= 2 ? "FROM_R1" : "PENDING_PHASE0";
  for (const axis of PRIMARY_AXES) {
    const sd = sampleSd(byAxis[axis]);
    if (sd == null || !Number.isFinite(sd)) {
      status = "PENDING_PHASE0";
      sigma[axis] = { sigma: floorsSpec.provisionalSigma?.[axis] ?? 0.082, status: "PENDING_PHASE0" };
    } else {
      sigma[axis] = { sigma: sd, status: "FROM_R1" };
    }
  }
  const computed = computeDetectionFloors(sigma, floorsSpec.nPooled || 24, floorsSpec.nVariant || 12);
  return { status, nConversations: n, axes: computed };
}

function floorsCli(argv) {
  const r1Dir = argv[argv.indexOf("--r1-dir") + 1];
  const preregFile = argv[argv.indexOf("--prereg") + 1];
  const outFile = argv[argv.indexOf("--out") + 1];
  const prereg = loadPrereg(preregFile);
  const files = existsSync(r1Dir)
    ? readdirSync(r1Dir)
        .filter((n) => n.endsWith(".jsonl"))
        .map((n) => path.join(r1Dir, n))
    : [];
  const result = floorsFromR1(files, prereg);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(outFile + "\n");
}

const here = process.argv[1] && process.argv[1].endsWith("prereg.mjs");
if (here && process.argv[2] === "--floors") {
  floorsCli(process.argv);
} else if (here) {
  const contrasts = primaryContrasts();
  console.log(JSON.stringify({ m: contrasts.length, holmFirst: HOLM_FIRST_ALPHA, contrasts }, null, 2));
}
