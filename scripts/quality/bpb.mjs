#!/usr/bin/env node
/**
 * The Wikipedia half of the bake-off: bits per byte on the multi5 corpus.
 *
 * Why bytes and not tokens: 7.34 measured that tok/s is tokenizer-blind, so a
 * per-token score flatters whichever model chops the language into fewer pieces.
 * bpb is the same number for every tokenizer, which is the only way a cross-model
 * cross-language comparison means anything. moe-experiments used bpb for exactly
 * this reason; its scorer drove bmoe-cli, which is not built on this Mac, so this
 * derives the same quantity from llama-perplexity instead:
 *
 *   bpb = log2(PPL) * tokens_evaluated / bytes_evaluated
 *
 * Coverage assumption, stated because it is an assumption: perplexity evaluates
 * whole chunks, so it stops a little short of the file's end. We scale by the
 * whole-file fertility (tokens/byte), which is exact only if the evaluated prefix
 * has the same tokens-per-byte ratio as the file. On 50 kB of homogeneous prose
 * that holds to well under a percent, and the coverage fraction is reported so a
 * reader can see how much of the file the number rests on.
 *
 *   node scripts/quality/bpb.mjs [--only <substr>] [--langs en,it,es,fr]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CORPUS = "/Users/marco/Projects/kalsa-moe-experiments/corpus/multi5";
const PPL = "/opt/homebrew/bin/llama-perplexity";
const TOKENIZE = "/opt/homebrew/bin/llama-tokenize";
const N_CTX = 512;

const args = process.argv.slice(2);
const argOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const only = argOf("--only");
const langs = (argOf("--langs") ?? "en,it,es,fr").split(",");

const matrix = JSON.parse(readFileSync(path.join(ROOT, "scripts/quality/matrix.json"), "utf8"));

function run(bin, argv) {
  try {
    return execFileSync(bin, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    return `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
  }
}

/**
 * Total tokens the model's own tokenizer makes of the file. llama-tokenize prints
 * one `<id> -> '<piece>'` per line; the added BOS is not part of the bytes, so it
 * does not count. Loud on failure — a silently wrong token count would corrupt
 * every bpb downstream and still look like a plausible number.
 */
function countTokens(modelPath, file) {
  const out = run(TOKENIZE, ["-m", modelPath, "-f", file, "-ngl", "0"]);
  const lines = out.split("\n").filter((l) => /^\s*\d+ -> /.test(l));
  const body = lines.filter((l) => !/-> '<\|.*\|>'$/.test(l.trim()));
  if (body.length === 0) throw new Error(`llama-tokenize produced no tokens; tail was:\n${out.slice(-500)}`);
  return body.length;
}

function perplexity(modelPath, file, kvK, kvV) {
  const out = run(PPL, [
    "-m", modelPath, "-f", file, "-c", String(N_CTX), "-ngl", "99",
    "-ctk", kvK, "-ctv", kvV, "--no-warmup",
  ]);
  const ppl = out.match(/Final estimate:\s*PPL\s*=\s*([\d.]+)/i);
  if (!ppl) throw new Error(`could not read PPL; tail was:\n${out.slice(-700)}`);
  const chunks = out.match(/(\d+)\s+chunks,\s*(?:n_ctx|batch_size)/i);
  return { ppl: Number(ppl[1]), chunks: chunks ? Number(chunks[1]) : null };
}

const rows = [];
for (const [id, model] of Object.entries(matrix.models)) {
  if (only && !id.includes(only)) continue;
  if (!existsSync(model.path)) { console.log(`SKIP ${id} — missing ${model.path}`); continue; }
  for (const lang of langs) {
    const file = path.join(CORPUS, `${lang}.txt`);
    if (!existsSync(file)) { console.log(`SKIP ${id}/${lang} — missing corpus`); continue; }
    const bytes = statSync(file).size;
    try {
      const tokens = countTokens(model.path, file);
      const { ppl, chunks } = perplexity(model.path, file, "f16", "f16");
      const evaluated = chunks ? chunks * N_CTX : tokens;
      const fertility = tokens / bytes;
      const bpb = Math.log2(ppl) * fertility;   // bits/token x tokens/byte
      rows.push({ model: id, quant: model.quant, lang, bytes, tokens, chunks, evaluated,
                  coverage: +(evaluated / tokens).toFixed(3),
                  fertility: +fertility.toFixed(4), ppl: +ppl.toFixed(4), bpb: +bpb.toFixed(4) });
      console.log(`${id}/${lang}: ppl=${ppl.toFixed(3)} fertility=${fertility.toFixed(4)} tok/B bpb=${bpb.toFixed(4)} coverage=${(100 * evaluated / tokens).toFixed(1)}%`);
    } catch (e) {
      console.error(`FAIL ${id}/${lang}: ${e.message}`);
    }
  }
}

const outFile = path.join(ROOT, "results/quality/bpb.json");
writeFileSync(outFile, JSON.stringify({ nCtx: N_CTX, corpus: CORPUS, rows }, null, 2));
console.log(`\nwrote ${outFile}`);

console.log("\n| model | quant | " + langs.join(" | ") + " |");
console.log("|---|---|" + langs.map(() => "---").join("|") + "|");
for (const id of [...new Set(rows.map((r) => r.model))]) {
  const mine = langs.map((l) => {
    const r = rows.find((x) => x.model === id && x.lang === l);
    return r ? r.bpb.toFixed(3) : "—";
  });
  const q = rows.find((x) => x.model === id)?.quant ?? "";
  console.log(`| ${id} | ${q} | ${mine.join(" | ")} |`);
}
