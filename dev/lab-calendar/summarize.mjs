// The lab's summarizer (one responsibility: raw jsonl → the report tables).
// Per model × condition: tool-choice by kind, window classes with widths and
// offset-less counts, per-field exactness with required-field omissions,
// silent errors (the confident-wrong class), over-calling, seconds per item.
import { readFileSync } from "node:fs";

const file = process.argv[2];
const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const byCondition = {};
for (const r of rows) (byCondition[r.condition] ??= []).push(r);

for (const condition of ["A", "B", "C"]) {
  const rs = byCondition[condition] ?? [];
  if (!rs.length) continue;
  const kinds = {};
  for (const kind of ["read", "create", "clarify", "trap", "notool"]) {
    const k = rs.filter((r) => r.kind === kind);
    if (!k.length) continue;
    const toolChoice = {
      right: k.filter((r) => r.verdict.toolChoice === "right").length,
      ask: k.filter((r) => r.verdict.toolChoice === "ask").length,
      wrongTool: k.filter((r) => r.verdict.toolChoice === "wrong-tool").length,
      callWhereNone: k.filter((r) => r.verdict.toolChoice === "call-where-none").length,
      callWhereAsk: k.filter((r) => r.verdict.toolChoice === "call-where-ask").length,
      noCall: k.filter((r) => r.verdict.toolChoice === "no-call").length,
    };
    const wrongDaySilent = k.filter((r) => r.verdict.silent).length;
    console.log(
      `${condition} ${kind.padEnd(7)} n=${k.length} right=${toolChoice.right} ask=${toolChoice.ask} ` +
      `wrongTool=${toolChoice.wrongTool} callWhereNone=${toolChoice.callWhereNone} callWhereAsk=${toolChoice.callWhereAsk} ` +
      `noCall=${toolChoice.noCall} | silent=${wrongDaySilent}`,
    );
  }
  const reads = rs.filter((r) => r.kind === "read" && r.verdict.window);
  if (reads.length) {
    const cls = reads.reduce((a, r) => ((a[r.verdict.window] = (a[r.verdict.window] ?? 0) + 1), a), {});
    const noOff = reads.filter((r) => r.verdict.noOffset).length;
    const wide = reads.filter((r) => r.verdict.window === "covers" && (r.verdict.widthDays ?? 0) > 1);
    console.log(
      `${condition} windows: ${JSON.stringify(cls)} | offset-less ${noOff}/${reads.length} | covers wider than the ask ${wide.length}` +
      (wide.length ? ` (${wide.map((r) => r.id + ":" + r.verdict.widthDays + "d").join(",")})` : ""),
    );
  }
  const creates = rs.filter((r) => r.kind === "create");
  if (creates.length) {
    const f = { title: [0, 0, 0], start: [0, 0, 0], end: [0, 0, 0], allDay: [0, 0, 0] };
    for (const r of creates) {
      const fields = r.verdict.fields;
      if (!fields) { for (const k of Object.keys(f)) f[k][1] += 1; continue; } // unsure/no proposal: counted as not-right, not-silent
      for (const k of Object.keys(f)) {
        const v = fields[k] ?? "omitted";
        f[k][v === "right" ? 0 : v === "wrong" ? 1 : 2] += 1;
      }
    }
    const noOff = creates.filter((r) => r.verdict.noOffset).length;
    const unsure = creates.filter((r) => r.outcome === "unsure").length;
    console.log(
      `${condition} creates: title ${f.title[0]}r/${f.title[1]}w/${f.title[2]}om  start ${f.start[0]}r/${f.start[1]}w/${f.start[2]}om  ` +
      `end ${f.end[0]}r/${f.end[1]}w/${f.end[2]}om  allDay ${f.allDay[0]}r/${f.allDay[1]}w/${f.allDay[2]}om | offset-less ${noOff} | UNSURE ${unsure}`,
    );
  }
  const secs = rs.reduce((a, r) => a + r.calls.reduce((x, c) => x + (c.wallMs ?? 0), 0), 0) / 1000;
  const overcall = rs.filter((r) => r.calls.some((c) => c.name === "web_search")).length;
  console.log(`${condition} totals: ${rs.length} items, ${overcall} web_search calls, ${(secs / rs.length).toFixed(1)} s/item`);
  console.log("");
}
