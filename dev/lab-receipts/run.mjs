// The lab's runner (one responsibility: drive the conditions over the
// dataset, one document at a time, and record everything raw).
//
//   node run.mjs --base http://127.0.0.1:18150 --model <alias> --tag lfm \
//        --images /tmp/lab-receipts/images --gt-dir /tmp/lab-receipts/clean \
//        --out /tmp/lab-receipts/raw
//
// Ground truth for cord-* lives beside the images (the extractor wrote it
// there); syn-* ground truth lives in --gt-dir (the generator's clean dir).
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extract, replyText } from "./engine.mjs";
import { SYSTEM, FREE_PROMPT, SCHEMA, SCHEMA_PROMPT, reaskPrompt } from "./prompts.mjs";
import { validate } from "./validators.mjs";

const arg = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : process.argv[at + 1];
};

/** A's loose parse: the first balanced JSON object in the reply. */
function looseJson(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

async function main() {
  const base = arg("base") ?? "http://127.0.0.1:18150";
  const model = arg("model");
  const tag = arg("tag");
  const imagesDir = arg("images") ?? "/tmp/lab-receipts/images";
  const gtDir = arg("gt-dir") ?? "/tmp/lab-receipts/clean";
  const outDir = arg("out") ?? "/tmp/lab-receipts/raw";
  if (!model || !tag) throw new Error("--model and --tag are required");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${tag}.jsonl`);
  // Resume: a run cut short by an engine death continues where it stopped;
  // every record already written is skipped by id+condition key.
  const done = new Set(
    existsSync(outPath)
      ? readFileSync(outPath, "utf8").trim().split("\n").filter(Boolean).map((l) => {
          const r = JSON.parse(l);
          return `${r.id}/${r.condition}`;
        })
      : [],
  );
  const ids = readFileSync(join(imagesDir, "order.txt"), "utf8")
    .trim().split("\n")
    .map((line) => line.replace(/\.(jpg|png)$/, ""));
  const gtFor = (id) => {
    const beside = join(imagesDir, `${id}.json`);
    const clean = join(gtDir, `${id}.json`);
    return JSON.parse(readFileSync(existsSync(beside) ? beside : clean, "utf8"));
  };

  for (const id of ids) {
    const gt = gtFor(id);
    const imagePath = join(imagesDir, id.startsWith("syn-") ? `${id}.jpg` : `${id}.png`);
    for (const condition of ["A", "B", "C"]) {
      if (done.has(`${id}/${condition}`)) continue;
      const useSchema = condition !== "A";
      const first = await extract({
        base, model, system: SYSTEM,
        prompt: useSchema ? SCHEMA_PROMPT : FREE_PROMPT,
        imagePath,
        responseFormat: useSchema ? SCHEMA : undefined,
      });
      const record = {
        tag, condition, id, gtTrap: gt.trap ?? null, gtKind: gt.kind,
        calls: [{ status: first.status, wallMs: first.wallMs, usage: first.body?.usage ?? null, prompt: useSchema ? SCHEMA_PROMPT : FREE_PROMPT, responseFormat: useSchema ? "json_schema" : null }],
        reply: replyText(first),
      };
      let parsed = looseJson(record.reply);
      let outcome = "answer";
      let validation = null;
      if (parsed === null) {
        outcome = "malformed";
      } else if (condition === "C") {
        validation = validate(parsed);
        if (validation.failures.length > 0) {
          const reask = await extract({
            base, model, system: SYSTEM, prompt: reaskPrompt(validation.failures), imagePath,
            responseFormat: SCHEMA,
          });
          record.calls.push({ status: reask.status, wallMs: reask.wallMs, usage: reask.body?.usage ?? null, prompt: reaskPrompt(validation.failures), responseFormat: "json_schema", afterFailures: validation.failures });
          const second = looseJson(replyText(reask));
          if (second === null) {
            parsed = null;
            outcome = "unsure";
            record.unsureReason = "la seconda risposta non era JSON: " + validation.failures.join("; ");
          } else {
            const secondValidation = validate(second);
            if (secondValidation.failures.length > 0) {
              parsed = second;
              validation = secondValidation;
              outcome = "unsure";
              record.unsureReason = secondValidation.failures.join("; ");
            } else {
              parsed = second;
              validation = secondValidation;
              record.reaskFixed = true;
            }
          }
        }
      }
      if (parsed !== null) {
        parsed.__outcome = outcome;
        if (validation?.parsed?.dataIso) parsed.__dataIso = validation.parsed.dataIso;
        if (validation?.parsed?.scadenzaIso) parsed.__scadenzaIso = validation.parsed.scadenzaIso;
      }
      record.parsed = parsed;
      record.outcome = outcome;
      appendFileSync(outPath, JSON.stringify(record) + "\n");
      const secs = (record.calls.reduce((a, c) => a + c.wallMs, 0) / 1000).toFixed(1);
      console.log(`${tag} ${condition} ${id} ${record.calls.map((c) => c.status).join("/")} ${secs}s ${outcome}${record.unsureReason ? " (" + record.unsureReason.slice(0, 60) + ")" : ""}`);
    }
  }
}

main();
