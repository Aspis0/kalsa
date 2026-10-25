// The aggregator (one responsibility: one model's jsonl into the lab's
// numbers). False-call rate, miss rate, wrong-template rate, invalid-args
// rate over the should_call set, median latency, leak count; borderline
// items listed apart.
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("usage: node summarize.mjs <tag.jsonl>");
const records = readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const labelled = records.filter((r) => r.kind !== "borderline");
const shouldCall = labelled.filter((r) => r.kind === "should_call");
const shouldNot = labelled.filter((r) => r.kind === "should_not");
const border = records.filter((r) => r.kind === "borderline");

const rate = (n, d) => (d === 0 ? "n/a" : `${n}/${d} = ${(100 * n / d).toFixed(0)}%`);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s[Math.floor(s.length / 2)];
};

const falseCalls = shouldNot.filter((r) => r.verdict.verdict === "false_call");
const misses = shouldCall.filter((r) => r.verdict.verdict === "miss");
const wrongTemplate = shouldCall.filter((r) => r.verdict.verdict === "wrong_template");
const invalidArgs = shouldCall.filter((r) => r.verdict.verdict === "invalid_args");
const hits = shouldCall.filter((r) => r.verdict.verdict === "hit");
const leaks = records.filter((r) => r.verdict.leak.leak);
const nameWords = records.filter((r) => r.verdict.leak.nameTokens.length > 0);

console.log(`records: ${records.length} (should_call ${shouldCall.length}, should_not ${shouldNot.length}, borderline ${border.length})`);
console.log(`hits:            ${rate(hits.length, shouldCall.length)}`);
console.log(`false-call rate: ${rate(falseCalls.length, shouldNot.length)}`);
console.log(`miss rate:       ${rate(misses.length, shouldCall.length)}`);
console.log(`wrong-template:  ${rate(wrongTemplate.length, shouldCall.length)}`);
console.log(`invalid-args:    ${rate(invalidArgs.length, shouldCall.length)}`);
console.log(`median latency:  ${median(records.map((r) => r.wallMs))} ms (min ${Math.min(...records.map((r) => r.wallMs))}, max ${Math.max(...records.map((r) => r.wallMs))})`);
console.log(`id leaks:        ${leaks.length}${leaks.length ? " -> " + leaks.map((r) => r.id + ":" + r.verdict.leak.leakTokens.join("|")).join(", ") : ""}`);
console.log(`template-name words in text (checklist/template/slot): ${nameWords.length}${nameWords.length ? " -> " + nameWords.map((r) => r.id + ":" + r.verdict.leak.nameTokens.join("|")).join(", ") : ""}`);

if (border.length) {
  console.log("borderline:");
  for (const r of border) console.log(`  ${r.id} -> ${r.verdict.verdict}${r.verdict.calledTemplate ? ` (${r.verdict.calledTemplate})` : ""}`);
}
for (const [name, group] of [["false calls", falseCalls], ["misses", misses], ["wrong template", wrongTemplate], ["invalid args", invalidArgs]]) {
  if (group.length) {
    console.log(`${name}:`);
    for (const r of group) console.log(`  ${r.id} -> ${r.verdict.verdict}${r.refusal ? ` (${r.refusal.slice(0, 120)})` : ""}`);
  }
}
