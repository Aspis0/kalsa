// Tables from result files (one responsibility: aggregate rows into markdown).
// Every Task A reply is re-scored here from its stored text against
// ground-truth.json, so older runs and newer runs use the same rule.
// usage: node report.mjs gemma-default [more-run-names...]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReply, scoreGuide } from "./score.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const truth = JSON.parse(readFileSync(join(here, "ground-truth.json"), "utf8"));
const imageById = new Map(truth.images.map((img) => [img.id, img]));

const pct = (k, n) => (n ? `${Math.round((100 * k) / n)}% (${k}/${n})` : "–");
const median = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? Math.round(v[Math.floor(v.length / 2)] * 10) / 10 : null;
};
const decodeTps = (r) => (r.timings?.predictedN && r.timings?.predictedMs ? r.timings.predictedN / (r.timings.predictedMs / 1000) : null);
const isFirstPassA = (r) => (r.variant === "A-it" || r.variant === "A-en") && r.reply;

function rescore(row) {
  if (!isFirstPassA(row)) return row;
  const img = imageById.get(row.image);
  const task = img.tasks.find((t) => t.id === row.task);
  return { ...row, score: scoreGuide(parseReply(row.reply), task.expected, img.native) };
}

const widthsOf = (rows) => [...new Set(rows.map((r) => r.width))].sort((a, b) => b - a);

function guideTable(rows, variant) {
  const out = [];
  for (const width of widthsOf(rows)) {
    const rs = rows.filter((r) => r.variant === variant && r.width === width && r.score);
    if (!rs.length) continue;
    const n = rs.length;
    out.push(guideLine(width, rs));
  }
  const all = rows.filter((r) => r.variant === variant && r.score);
  if (all.length) out.push(guideLine("all", all));
  return out;
}

function guideLine(width, rs) {
  const n = rs.length;
  return `| ${width} | ${n} | ${pct(rs.filter((r) => r.score.labelStrict).length, n)} | ${pct(rs.filter((r) => r.score.labelOk).length, n)} | ${pct(rs.filter((r) => r.score.wrongElement).length, n)} | ${pct(rs.filter((r) => r.score.gridOk).length, n)} | ${pct(rs.filter((r) => r.score.strict).length, n)} | ${pct(rs.filter((r) => r.score.tolerant).length, n)} | ${median(rs.map((r) => r.timings?.promptMs))} | ${median(rs.map((r) => r.wallMs))} | ${median(rs.map(decodeTps))} |`;
}

function readTable(rows, variant, kind) {
  const out = [];
  for (const width of widthsOf(rows)) {
    const rs = rows.filter((r) => r.variant === variant && r.width === width && r.score);
    if (!rs.length) continue;
    const n = rs.length;
    const sim = (rs.reduce((a, r) => a + (r.score.similarity ?? 0), 0) / n).toFixed(2);
    const ok = kind === "contains" ? rs.filter((r) => r.score.contains).length : rs.filter((r) => r.score.exact).length;
    out.push(`| ${width} | ${n} | ${pct(ok, n)} | ${kind === "contains" ? "–" : sim} | ${median(rs.map((r) => r.timings?.promptMs))} | ${median(rs.map((r) => r.wallMs))} | ${median(rs.map(decodeTps))} |`);
  }
  return out;
}

function tokenTable(rows) {
  const out = [];
  for (const width of widthsOf(rows)) {
    const per = [];
    for (const r of rows.filter((x) => x.variant === "A-it" && x.width === width && x.timings?.totalN)) {
      const twin = rows.find((x) => x.variant === "twin-A" && x.image === r.image && x.task === r.task && x.width === width);
      if (twin?.timings?.totalN) per.push(r.timings.totalN - twin.timings.totalN);
    }
    if (!per.length) continue;
    out.push(`| ${width} | ${per.length} | ${Math.min(...per)} | ${median(per)} | ${Math.max(...per)} |`);
  }
  return out;
}

function cacheLine(rows) {
  const a = rows.find((r) => r.variant === "cache-repeat-1");
  const b = rows.find((r) => r.variant === "cache-repeat-2");
  if (!a || !b) return "not run";
  return `cold: prompt_n ${a.timings.promptN}, cache_n ${a.timings.cacheN}, prompt_ms ${Math.round(a.timings.promptMs)}; repeat (same image, same request): prompt_n ${b.timings.promptN}, cache_n ${b.timings.cacheN}, prompt_ms ${Math.round(b.timings.promptMs)}`;
}

const GUIDE_HEAD = "| width | n | label strict | label lenient | wrong element | grid cell | strict point | tolerant point (±2%) | prefill ms med | wall ms med | decode tok/s med |\n|---|---:|---|---|---|---|---|---|---:|---:|---:|";
const READ_HEAD = "| width | n | exact | similarity | prefill ms med | wall ms med | decode tok/s med |\n|---|---:|---|---:|---:|---:|---:|";

for (const runName of process.argv.slice(2)) {
  const file = JSON.parse(readFileSync(join(here, "results", `${runName}.json`), "utf8"));
  const rows = file.rows.map(rescore);
  console.log(`\n## ${runName} — ${file.model}, thinking ${file.thinking ? "on" : "off"}, rows ${rows.length}\n`);
  console.log("### Task A, Italian first pass\n");
  console.log(GUIDE_HEAD);
  guideTable(rows, "A-it").forEach((l) => console.log(l));
  console.log("\n### Task A, English first pass\n");
  console.log(GUIDE_HEAD);
  guideTable(rows, "A-en").forEach((l) => console.log(l));
  console.log("\n### Task B, reading (standard prompt)\n");
  console.log(READ_HEAD);
  readTable(rows, "B-std", "exact").forEach((l) => console.log(l));
  console.log("\n### Task B, reading (line by line; exact column = expected text contained in the joined lines)\n");
  console.log(READ_HEAD);
  readTable(rows, "B-lines", "contains").forEach((l) => console.log(l));
  console.log("\n### Image tokens (total prompt tokens with the image minus the text-only twin, Italian task A)\n");
  console.log("| width | n | min | median | max |\n|---|---:|---:|---:|---:|");
  tokenTable(rows).forEach((l) => console.log(l));
  console.log(`\nCache check: ${cacheLine(rows)}\n`);
}
