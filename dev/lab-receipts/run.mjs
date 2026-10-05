// The lab's runner (one responsibility: drive the conditions over the
// dataset, one document at a time, and record everything raw).
//
//   node run.mjs --base http://127.0.0.1:18150 --model <alias> --tag lfm \
//        --images /tmp/lab-receipts/images --gt-dir /tmp/lab-receipts/clean \
//        --out /tmp/lab-receipts/raw [--ids syn-000,syn-024] [--conditions A,B,C,D]
//
// Conditions: A free text (parse what comes back); B the same words under
// response_format json_schema (every field REQUIRED, nullable); C = B plus the
// validators, one named re-ask, then UNSURE; D = A plus the normalizer and the
// same validators/re-ask — the free-text + code-decides combination.
// Ground truth for cord-* lives beside the images; syn-* in --gt-dir.
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extract, replyText } from "./engine.mjs";
import { SYSTEM, FREE_PROMPT, SCHEMA_PROMPT, SCHEMA, reaskPrompt } from "./prompts.mjs";
import { validate } from "./validators.mjs";
import { looseJson, normalize } from "./normalize.mjs";

const arg = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : process.argv[at + 1];
};

async function main() {
  const base = arg("base") ?? "http://127.0.0.1:18150";
  const model = arg("model");
  const tag = arg("tag");
  const imagesDir = arg("images") ?? "/tmp/lab-receipts/images";
  const gtDir = arg("gt-dir") ?? "/tmp/lab-receipts/clean";
  const outDir = arg("out") ?? "/tmp/lab-receipts/raw";
  const onlyIds = arg("ids") ? arg("ids").split(",") : null;
  const onlyConditions = arg("conditions") ? arg("conditions").split(",") : ["A", "B", "C", "D"];
  // --no-think: the model's template supports enable_thinking (Gemma 4 E4B
  // does; LFM's templates do not) — the app's own thinking-off path, used so
  // the thinking channel cannot eat the generation budget before the JSON.
  const noThink = process.argv.includes("--no-think");
  const templateKwargs = noThink ? { enable_thinking: false } : undefined;
  if (!model || !tag) throw new Error("--model and --tag are required");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${tag}.jsonl`);
  // Resume: a run cut short by an engine death continues where it stopped.
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
    .map((line) => line.replace(/\.(jpg|png)$/, ""))
    .filter((id) => !onlyIds || onlyIds.includes(id));
  const gtFor = (id) => {
    const beside = join(imagesDir, `${id}.json`);
    const clean = join(gtDir, `${id}.json`);
    return JSON.parse(readFileSync(existsSync(beside) ? beside : clean, "utf8"));
  };

  for (const id of ids) {
    const gt = gtFor(id);
    const imagePath = join(imagesDir, id.startsWith("syn-") ? `${id}.jpg` : `${id}.png`);
    for (const condition of onlyConditions) {
      if (done.has(`${id}/${condition}`)) continue;
      const constrained = condition === "B" || condition === "C";
      const normalizedCondition = condition === "D"; // free text, then normalize
      const first = await extract({
        base, model, system: SYSTEM,
        prompt: constrained ? SCHEMA_PROMPT : FREE_PROMPT,
        imagePath,
        responseFormat: constrained ? SCHEMA : undefined,
        templateKwargs,
      });
      const record = {
        tag, condition, id, gtTrap: gt.trap ?? null, gtKind: gt.kind,
        calls: [{ status: first.status, wallMs: first.wallMs, usage: first.body?.usage ?? null, prompt: constrained ? "SCHEMA_PROMPT" : "FREE_PROMPT", responseFormat: constrained ? "json_schema" : null, templateKwargs: noThink ? "enable_thinking=false" : null }],
        reply: replyText(first),
      };
      let parsed = looseJson(record.reply);
      if (normalizedCondition) parsed = normalize(parsed);
      let outcome = "answer";
      let validation = null;
      if (parsed === null) {
        outcome = "malformed";
      } else if (condition === "C" || condition === "D") {
        validation = validate(parsed);
        if (validation.failures.length > 0) {
          const reask = await extract({
            base, model, system: SYSTEM, prompt: reaskPrompt(validation.failures), imagePath,
            responseFormat: constrained ? SCHEMA : undefined,
            templateKwargs,
          });
          record.calls.push({ status: reask.status, wallMs: reask.wallMs, usage: reask.body?.usage ?? null, prompt: "reask", responseFormat: constrained ? "json_schema" : null, afterFailures: validation.failures, templateKwargs: noThink ? "enable_thinking=false" : null });
          const second = looseJson(replyText(reask));
          const secondParsed = normalizedCondition ? normalize(second) : second;
          if (secondParsed === null) {
            parsed = secondParsed;
            outcome = "unsure";
            record.unsureReason = "la seconda risposta non era JSON: " + validation.failures.join("; ");
          } else {
            const secondValidation = validate(secondParsed);
            if (secondValidation.failures.length > 0) {
              parsed = secondParsed;
              validation = secondValidation;
              outcome = "unsure";
              record.unsureReason = secondValidation.failures.join("; ");
            } else {
              parsed = secondParsed;
              validation = secondValidation;
              record.reaskFixed = true;
            }
          }
        }
      }
      if (parsed !== null && typeof parsed === "object") {
        parsed.__outcome = outcome;
        if (validation?.parsed?.dataIso) parsed.__dataIso = validation.parsed.dataIso;
        if (validation?.parsed?.scadenzaIso) parsed.__scadenzaIso = validation.parsed.scadenzaIso;
      }
      record.parsed = parsed;
      record.outcome = outcome;
      appendFileSync(outPath, JSON.stringify(record) + "\n");
      const secs = (record.calls.reduce((a, c) => a + c.wallMs, 0) / 1000).toFixed(1);
      console.log(`${tag} ${condition} ${id} ${record.calls.map((c) => c.status).join("/")} ${secs}s ${outcome}${record.unsureReason ? " (" + record.unsureReason.slice(0, 70) + ")" : ""}`);
    }
  }
}

main();
