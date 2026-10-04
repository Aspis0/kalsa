// The lab's summarizer (one responsibility: turn raw jsonl into the report's
// numbers). Usage: node summarize.mjs /tmp/lab-receipts/raw/lfm.jsonl [--gt-dir DIR]
// Prints synthetic and CORD sections separately, per condition.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { scoreDocument } from "./score.mjs";

const arg = (n, d) => {
  const at = process.argv.indexOf(`--${n}`);
  return at === -1 ? d : process.argv[at + 1];
};
const imagesDir = arg("images", "/tmp/lab-receipts/images");
const gtDir = arg("gt-dir", "/tmp/lab-receipts/clean");

function gtFor(id) {
  const beside = join(imagesDir, `${id}.json`);
  const clean = join(gtDir, `${id}.json`);
  return JSON.parse(readFileSync(existsSync(beside) ? beside : clean, "utf8"));
}

function summarize(file) {
  const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const forSection = (section) => {
    const out = {};
    for (const condition of ["A", "B", "C"]) {
      const rs = rows.filter((r) => r.condition === condition && (section === "syn" ? r.id.startsWith("syn-") : r.id.startsWith("cord-")));
      const scored = rs.map((r) => ({ r, s: scoreDocument(r.parsed, gtFor(r.id)) }));
      const fieldTotals = {};
      const fieldOk = {};
      const fieldOmitted = {};
      let fully = 0, malformed = 0, unsure = 0;
      let silentDocs = 0, silentFields = 0;
      let secs = 0, promptTok = 0, completionTok = 0, f1Sum = 0, f1N = 0;
      for (const { r, s } of scored) {
        secs += r.calls.reduce((a, c) => a + c.wallMs, 0) / 1000;
        promptTok += r.calls[0]?.usage?.prompt_tokens ?? 0;
        if (s.items) { f1Sum += s.items.f1; f1N += 1; }
        completionTok += r.calls.reduce((a, c) => a + (c.usage?.completion_tokens ?? 0), 0);
        if (s.outcome === "malformed") { malformed += 1; continue; }
        if (s.outcome === "unsure") unsure += 1;
        if (s.fullyCorrect) fully += 1;
        if (s.silentErrors.length > 0) { silentDocs += 1; silentFields += s.silentErrors.length; }
        for (const [name, verdict] of Object.entries(s.fields)) {
          fieldTotals[name] = (fieldTotals[name] ?? 0) + 1;
          if (verdict === "right") fieldOk[name] = (fieldOk[name] ?? 0) + 1;
          if (verdict === "omitted") fieldOmitted[name] = (fieldOmitted[name] ?? 0) + 1;
        }
      }
      const n = scored.length;
      out[condition] = {
        n, fully, malformed, unsure,
        silentDocs, silentFields,
        secsPerDoc: (secs / Math.max(1, n)).toFixed(1),
        promptTok, completionTok, meanItemF1: f1N ? (f1Sum / f1N).toFixed(2) : null,
        fields: Object.fromEntries(Object.entries(fieldTotals).map(([k, t]) => [k, `${fieldOk[k] ?? 0}/${t}${fieldOmitted[k] ? ` (${fieldOmitted[k]} omitted)` : ""}`])),
      };
    }
    return out;
  };
  // Trap behaviour under C: flagged (UNSURE naming the check) vs "fixed"
  // (a value delivered that differs from what was printed) vs delivered.
  const traps = { sum: [], iban: [] };
  for (const r of rows.filter((r) => r.condition === "C" && r.gtTrap)) {
    const gt = gtFor(r.id);
    const printed = r.gtTrap === "sum" ? (gt.totale_stampata ?? gt.totale) : gt.iban_stampato;
    const raw = r.gtTrap === "sum" ? r.parsed?.totale : r.parsed?.iban;
    const delivered = r.outcome === "answer" && raw !== undefined && raw !== null && raw !== "" ? raw : null;
    const normalized = r.gtTrap === "iban" && typeof delivered === "string" ? delivered.replace(/\s+/g, "").toUpperCase() : delivered;
    traps[r.gtTrap].push({
      id: r.id,
      outcome: r.outcome,
      // The trap is DETECTED only when C refuses while naming its check.
      flagged: r.outcome === "unsure" && String(r.unsureReason ?? "").includes(r.gtTrap === "sum" ? "somma" : "IBAN"),
      // "fixed": a value delivered that differs from what was printed.
      fixed: normalized != null && String(normalized) !== String(printed),
      // Omission evades the validator: nothing was delivered to check.
      evaded: delivered === null,
      delivered: normalized, printed, unsureReason: r.unsureReason ?? null,
    });
  }
  return { syn: forSection("syn"), cord: forSection("cord"), traps };
}

const file = process.argv[2];
const s = summarize(file);
const pct = (a, b) => (b === 0 ? "—" : `${Math.round((100 * a) / b)}%`);
for (const section of ["syn", "cord"]) {
  console.log(`\n=== ${section} ===`);
  console.log("cond | fully | malformed | unsure | silentDocs(fields) | s/doc | itemF1 | fields (right/n, omitted marked)");
  for (const c of ["A", "B", "C"]) {
    const d = s[section][c];
    console.log(
      `  ${c}  | ${d.fully}/${d.n} ${pct(d.fully, d.n)} | ${d.malformed} | ${d.unsure} | ${d.silentDocs}(${d.silentFields}) | ${d.secsPerDoc}s | ${d.meanItemF1 ?? "-"} | ` +
      Object.entries(d.fields).map(([k, v]) => `${k} ${v}`).join(", "),
    );
  }
}
console.log("\n=== traps under C ===");
for (const kind of ["sum", "iban"]) {
  const list = s.traps[kind];
  const flagged = list.filter((t) => t.flagged).length;
  const fixed = list.filter((t) => t.fixed).length;
  const evaded = list.filter((t) => t.evaded).length;
  const asPrinted = list.filter((t) => !t.evaded && !t.fixed && t.outcome === "answer").length;
  console.log(`${kind}: ${flagged}/${list.length} flagged, ${evaded}/${list.length} evaded by omission, ${asPrinted} delivered-as-printed, ${fixed} "fixed"`);
  for (const t of list) console.log(`  ${t.id}: ${t.outcome}${t.flagged ? " FLAGGED" : ""}${t.evaded ? " EVADED(omitted)" : ""}${t.fixed ? " FIXED->" + t.delivered + " (printed " + t.printed + ")" : ""}${t.unsureReason ? " :: " + String(t.unsureReason).slice(0, 70) : ""}`);
}
