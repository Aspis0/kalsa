#!/usr/bin/env node
/**
 * The statistics behind the bake-off tables. Separate from report.mjs, which
 * only counts: this file is what decides whether a difference is real.
 *
 * Every number quoted in a findings row should come from here rather than be
 * transcribed out of a chat, so that re-running the command reproduces the row.
 *
 *   node scripts/bench/quality/analyse.mjs [--out <dir>]
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { scoreAnswer, splitThinking, detectLanguage } from "./score.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const args = process.argv.slice(2);
const argOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const outDir = path.resolve(ROOT, argOf("--out") ?? "results/quality");

const qdoc = JSON.parse(readFileSync(path.join(ROOT, "scripts/bench/quality/questions.json"), "utf8"));
const byId = new Map(qdoc.questions.map((q) => [q.id, q]));

/**
 * Decode tok/s on the Jelly (G99). The first two are MEASURED in-app and unplugged
 * (KALSA.md §7.28 / §7.27). The rest are PREDICTED from the 9.11 GB/s effective
 * bandwidth that the 2.6B's own measurement implies, divided by file size — the
 * same arithmetic reproduces the 2.6B's 5.47 to within 1%, but a prediction is not
 * a measurement and the table marks it.
 */
const PHONE_TOK_S = {
  "lfm25-2.6b": { tps: 5.47, measured: true },
  "lfm25-8b-kexp": { tps: 7.05, measured: true },
  "lfm25-2.6b-qad": { tps: 5.72, measured: false },
  "lfm25-1.2b": { tps: 12.46, measured: false },
  "lfm25-1.2b-qad": { tps: 13.09, measured: false },
};

const cells = new Map();
for (const f of readdirSync(outDir).filter((f) => f.endsWith(".jsonl")).sort()) {
  const rows = readFileSync(path.join(outDir, f), "utf8").split("\n")
    .filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((r) => byId.has(r.qid));
  if (rows.length) cells.set(path.basename(f, ".jsonl"), rows);
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Per row: pass/fail, whether it drifted, and how many tokens went into thinking. */
function analyse(rows) {
  return rows.map((r) => {
    const q = byId.get(r.qid);
    const { thinking, answer } = splitThinking(r.content ?? "");
    const noAnswer = !answer.trim() && r.finish === "length";
    const pass = !r.error && !noAnswer && scoreAnswer(q, r.lang, r.content ?? "").pass;
    const spoken = detectLanguage(answer);
    const total = thinking.length + answer.length;
    const tok = r.timings?.predicted_n ?? 0;
    return {
      key: `${r.qid}:${r.lang}`, qid: r.qid, lang: r.lang, pass,
      // The engine reports one token count for the whole completion, so the
      // thinking share is apportioned by characters. Good enough to say whether
      // a 256-token budget binds; not a substitute for a real per-part count.
      thinkTok: total ? (tok * thinking.length) / total : 0,
      tok, spoken, drifted: spoken !== null && spoken !== r.lang,
    };
  });
}
const A = new Map([...cells].map(([k, v]) => [k, analyse(v)]));

function binomTwoSided(x, y) {
  const n = x + y;
  if (n === 0) return 1;
  const lo = Math.min(x, y);
  let c = 0;
  for (let i = 0; i <= lo; i++) {
    let term = 1;
    for (let j = 0; j < i; j++) term = (term * (n - j)) / (j + 1);
    c += term;
  }
  return Math.min(1, (c / 2 ** n) * 2);
}

/** McNemar on the questions both cells answered — they are the same questions, so pair them. */
function paired(a, b, field) {
  const ma = new Map(A.get(a).map((r) => [r.key, r]));
  const mb = new Map(A.get(b).map((r) => [r.key, r]));
  let x = 0, y = 0, n = 0;
  for (const [k, ra] of ma) {
    const rb = mb.get(k); if (!rb) continue;
    n++;
    const va = field === "pass" ? ra.pass : ra.drifted;
    const vb = field === "pass" ? rb.pass : rb.drifted;
    if (va && !vb) x++; else if (!va && vb) y++;
  }
  return { x, y, p: binomTwoSided(x, y), n };
}

console.log("## Per cell\n");
console.log("| cell | score | drift | think tok med | think tok max | >256 | >512 | total tok med | Jelly seconds (median) |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const [cell, rs] of A) {
  const model = cells.get(cell)[0].model;
  const th = rs.map((r) => r.thinkTok);
  const withLang = rs.filter((r) => r.spoken !== null);
  const tokMed = median(rs.map((r) => r.tok));
  const phone = PHONE_TOK_S[model];
  console.log(`| ${cell} | ${rs.filter((r) => r.pass).length}/${rs.length} | ${rs.filter((r) => r.drifted).length}/${withLang.length} | `
    + `${median(th).toFixed(0)} | ${Math.max(...th).toFixed(0)} | ${th.filter((x) => x > 256).length} | ${th.filter((x) => x > 512).length} | `
    + `${tokMed} | ${phone ? (tokMed / phone.tps).toFixed(1) + " s" + (phone.measured ? "" : " (pred)") : "—"} |`);
}

console.log("\n## Paired comparisons (McNemar, exact two-sided)\n");
const ids = [...A.keys()];
const pairsOf = (pred) => ids.flatMap((a, i) => ids.slice(i + 1).filter((b) => pred(a, b)).map((b) => [a, b]));
const sameModel = (a, b) => cells.get(a)[0].model === cells.get(b)[0].model;
console.log("| A | B | A wins | B wins | p | on |");
console.log("|---|---|---|---|---|---|");
for (const [a, b] of pairsOf(() => true)) {
  const r = paired(a, b, "pass");
  if (r.x + r.y === 0) continue;
  console.log(`| ${a} | ${b} | ${r.x} | ${r.y} | ${r.p.toFixed(3)} | ${r.n} |`);
}

console.log("\n## Paired language drift\n");
console.log("| A | B | drifts only in A | only in B | p |");
console.log("|---|---|---|---|---|");
for (const [a, b] of pairsOf(sameModel)) {
  const r = paired(a, b, "drift");
  console.log(`| ${a} | ${b} | ${r.x} | ${r.y} | ${r.p.toFixed(3)} |`);
}

console.log("\n## Where the drift is (all cells pooled)\n");
const pool = [...A.values()].flat().filter((r) => r.spoken !== null);
const tally = (keyOf) => {
  const m = new Map();
  for (const r of pool) {
    const k = keyOf(r);
    const e = m.get(k) ?? { n: 0, d: 0 };
    e.n++; if (r.drifted) e.d++;
    m.set(k, e);
  }
  return [...m].sort((p, q) => q[1].d / q[1].n - p[1].d / p[1].n);
};
console.log("| question | drifted | | language asked | drifted |");
console.log("|---|---|---|---|---|");
const byQ = tally((r) => r.qid), byL = tally((r) => r.lang);
for (let i = 0; i < Math.max(byQ.length, byL.length); i++) {
  const q = byQ[i], l = byL[i];
  console.log(`| ${q ? q[0] : ""} | ${q ? `${q[1].d}/${q[1].n} (${(100 * q[1].d / q[1].n).toFixed(0)}%)` : ""} | | `
    + `${l ? l[0] : ""} | ${l ? `${l[1].d}/${l[1].n} (${(100 * l[1].d / l[1].n).toFixed(0)}%)` : ""} |`);
}
