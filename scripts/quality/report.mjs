#!/usr/bin/env node
/**
 * Score a bake-off run and print the tables. Pure: reads the JSONL the runner
 * wrote, never launches a model — re-scoring is free, re-running is not.
 *
 *   node scripts/quality/report.mjs [--out <dir>]
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { scoreAnswer, splitThinking, detectLanguage } from "./score.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const argOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const outDir = path.resolve(ROOT, argOf("--out") ?? "results/quality");

const qdoc = JSON.parse(readFileSync(path.join(ROOT, "scripts/quality/questions.json"), "utf8"));
const byId = new Map(qdoc.questions.map((q) => [q.id, q]));
const LANGS = qdoc.languages;

const cells = new Map();
for (const file of readdirSync(outDir).filter((f) => f.endsWith(".jsonl")).sort()) {
  const rows = readFileSync(path.join(outDir, file), "utf8").split("\n")
    .filter((l) => l.trim()).map((l) => JSON.parse(l));
  if (rows.length) cells.set(path.basename(file, ".jsonl"), rows);
}

const pct = (n, d) => (d ? ((100 * n) / d).toFixed(0) + "%" : "—");
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const summaries = [];
for (const [cellId, rows] of cells) {
  const scored = rows.map((r) => {
    const q = byId.get(r.qid);
    const { thinking, answer } = splitThinking(r.content ?? "");
    // A model that spent the whole budget thinking and never answered has failed,
    // but not in the same way as one that answered wrongly. Keep the two apart:
    // folding them together would let the token cap masquerade as model quality.
    let verdict;
    if (r.error) verdict = { pass: false, reason: r.error };
    else if (!q) verdict = { pass: false, reason: "unknown question" };
    else if (!answer.trim() && r.finish === "length") verdict = { pass: false, reason: "NO ANSWER — thinking filled the budget", noAnswer: true };
    else verdict = scoreAnswer(q, r.lang, r.content ?? "");
    const spoken = detectLanguage(answer);
    return { ...r, verdict, thinkChars: thinking.length, answerChars: answer.length,
             drifted: spoken !== null && spoken !== r.lang, spoken };
  });
  const passes = scored.filter((s) => s.verdict.pass).length;
  summaries.push({
    cellId,
    model: rows[0].model, quant: rows[0].quant, kv: `${rows[0].kvK}/${rows[0].kvV}`, budget: rows[0].budget,
    n: scored.length, passes,
    byLang: Object.fromEntries(LANGS.map((l) => {
      const ls = scored.filter((s) => s.lang === l);
      return [l, { n: ls.length, pass: ls.filter((s) => s.verdict.pass).length }];
    })),
    meanThinkChars: Math.round(mean(scored.map((s) => s.thinkChars))),
    meanAnswerChars: Math.round(mean(scored.map((s) => s.answerChars))),
    meanTokens: Math.round(mean(scored.map((s) => s.timings?.predicted_n ?? 0))),
    meanTokS: mean(scored.map((s) => s.timings?.predicted_per_second ?? 0)).toFixed(1),
    truncated: scored.filter((s) => s.finish === "length").length,
    noAnswer: scored.filter((s) => s.verdict.noAnswer).length,
    drifted: scored.filter((s) => s.drifted).length,
    scored,
  });
}

console.log("## Overall\n");
console.log("| cell | model | quant | kv | budget | score | wrong lang | think chars | answer chars | tok | truncated | no answer |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const s of summaries) {
  console.log(`| ${s.cellId} | ${s.model} | ${s.quant} | ${s.kv} | ${s.budget} | **${s.passes}/${s.n}** ${pct(s.passes, s.n)} | ${s.drifted} | ${s.meanThinkChars} | ${s.meanAnswerChars} | ${s.meanTokens} | ${s.truncated} | ${s.noAnswer} |`);
}

console.log("\n## By language\n");
console.log(`| cell | ${LANGS.join(" | ")} |`);
console.log(`|---|${LANGS.map(() => "---").join("|")}|`);
for (const s of summaries) {
  console.log(`| ${s.cellId} | ${LANGS.map((l) => `${s.byLang[l].pass}/${s.byLang[l].n}`).join(" | ")} |`);
}

console.log("\n## By question (pass count across languages)\n");
const qids = qdoc.questions.map((q) => q.id);
console.log(`| cell | ${qids.join(" | ")} |`);
console.log(`|---|${qids.map(() => "---").join("|")}|`);
for (const s of summaries) {
  const cellCounts = qids.map((qid) => {
    const qs = s.scored.filter((x) => x.qid === qid);
    return `${qs.filter((x) => x.verdict.pass).length}/${qs.length}`;
  });
  console.log(`| ${s.cellId} | ${cellCounts.join(" | ")} |`);
}

console.log("\n## Failures\n");
for (const s of summaries) {
  const fails = s.scored.filter((x) => !x.verdict.pass);
  if (!fails.length) continue;
  console.log(`\n### ${s.cellId} — ${fails.length} failures`);
  for (const f of fails) {
    const { answer } = splitThinking(f.content ?? "");
    console.log(`- **${f.qid}/${f.lang}** — ${f.verdict.reason}\n  > ${answer.replace(/\s+/g, " ").slice(0, 220)}`);
  }
}
