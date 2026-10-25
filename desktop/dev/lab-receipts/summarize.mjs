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
    for (const condition of ["A", "B", "C", "D"]) {
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
  // Trap behaviour under the validated conditions: mutually exclusive classes
  // decided by the FIRST attempt's validation — calls[1].afterFailures holds
  // it when a re-ask happened; absent means the first attempt passed.
  const traps = { sum: [], iban: [] };
  for (const r of rows.filter((r) => (r.condition === "C" || r.condition === "D") && r.gtTrap)) {
    const gt = gtFor(r.id);
    const printed = r.gtTrap === "sum" ? (gt.totale_stampata ?? gt.totale) : (gt.iban_stampato ?? gt.iban);
    const checkWord = r.gtTrap === "sum" ? "somma" : "IBAN";
    const firstFailures = r.calls[1]?.afterFailures ?? [];
    const fired = firstFailures.some((f) => f.includes(checkWord));
    let klass;
    let delivered = null;
    if (r.outcome === "malformed") {
      klass = "malformed";
    } else if (fired) {
      // The check fired on the first attempt; the re-ask either still failed
      // (UNSURE: the honest refusal) or produced a passing proposal (the model
      // ALTERED the document to satisfy the validator — a silent fix).
      klass = r.outcome === "unsure" ? "flagged-by-validator" : "fixed-after-reask";
    } else {
      const raw = r.gtTrap === "sum" ? r.parsed?.totale : r.parsed?.iban;
      delivered = r.outcome === "answer" && raw !== undefined && raw !== null && raw !== "" ? raw : null;
      if (delivered === null) klass = "evaded-by-omission";
      else if (String(delivered) === String(printed)) klass = "delivered-as-printed";
      else klass = "fixed-silently";
    }
    traps[r.gtTrap].push({
      id: r.id, condition: r.condition, klass,
      delivered: delivered ?? (r.outcome === "answer" ? (r.gtTrap === "sum" ? r.parsed?.totale : r.parsed?.iban) : null),
      printed, unsureReason: r.unsureReason ?? null,
    });
  }
  return { syn: forSection("syn"), cord: forSection("cord"), traps };
}

const file = process.argv[2];
const s = summarize(file);
const pct = (a, b) => (b === 0 ? "—" : `${Math.round((100 * a) / b)}%`);
const TRAP_CLASSES = ["flagged-by-validator", "fixed-after-reask", "delivered-as-printed", "fixed-silently", "evaded-by-omission", "malformed"];
for (const section of ["syn", "cord"]) {
  console.log(`\n=== ${section} ===`);
  console.log("cond | fully | malformed | unsure | silentDocs(fields) | s/doc | itemF1 | fields (right/n, omitted marked)");
  for (const c of ["A", "B", "C", "D"]) {
    const d = s[section][c];
    console.log(
      `  ${c}  | ${d.fully}/${d.n} ${pct(d.fully, d.n)} | ${d.malformed} | ${d.unsure} | ${d.silentDocs}(${d.silentFields}) | ${d.secsPerDoc}s | ${d.meanItemF1 ?? "-"} | ` +
      Object.entries(d.fields).map(([k, v]) => `${k} ${v}`).join(", "),
    );
  }
}
console.log("\n=== traps under C/D (mutually exclusive classes) ===");
for (const kind of ["sum", "iban"]) {
  for (const cond of ["C", "D"]) {
    const list = s.traps[kind].filter((t) => t.condition === cond);
    if (!list.length) continue;
    const counts = Object.fromEntries(TRAP_CLASSES.map((k) => [k, list.filter((t) => t.klass === k).length]));
    console.log(`${kind} ${cond}: ` + TRAP_CLASSES.filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(", "));
  }
}
for (const kind of ["sum", "iban"]) {
  for (const t of s.traps[kind]) {
    console.log(`  ${t.id} ${t.condition} ${t.klass}${t.delivered != null ? " (delivered " + t.delivered + ", printed " + t.printed + ")" : ""}${t.unsureReason ? " :: " + String(t.unsureReason).slice(0, 90) : ""}`);
  }
}
