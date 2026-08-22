#!/usr/bin/env node
/**
 * Quality bake-off runner. One llama-server per cell; every prompt runs inside it,
 * so a 5 GB model is loaded once per cell instead of once per prompt.
 *
 * Writes raw completions only. Scoring is a separate pass (report.mjs) so that
 * re-scoring never costs a re-run — the expensive half is the generation.
 *
 * Prompts are a bare user turn by default: no system prompt, no tools, so the race
 * measures the model rather than Kalsa's prefix. A cell may set `system` to put one
 * back — that is how the language-pinning cells test whether an instruction survives
 * the uncertainty that drives the drift.
 *
 *   node scripts/quality/run.mjs [--only <substr>] [--out <dir>]
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SERVER = "/opt/homebrew/bin/llama-server";
const PORT = 8177;
const BASE = `http://127.0.0.1:${PORT}`;

const args = process.argv.slice(2);
const argOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = argOf("--only");
const outDir = path.resolve(ROOT, argOf("--out") ?? "results/quality");

const matrix = JSON.parse(readFileSync(path.join(ROOT, "scripts/quality/matrix.json"), "utf8"));
const qdoc = JSON.parse(readFileSync(path.join(ROOT, "scripts/quality/questions.json"), "utf8"));
const LANGS = qdoc.languages;

/** Every (question, language) pair, in a fixed order so runs stay comparable. */
function allPrompts() {
  const out = [];
  for (const q of qdoc.questions) {
    for (const lang of LANGS) {
      if (q.prompts[lang]) out.push({ qid: q.id, lang, prompt: q.prompts[lang] });
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The system prompt in the language of the question. A prompt may be a plain
 * string or a map keyed by language; the map is the one that matters, because a
 * mismatched prompt does not sit quietly next to the question — it pulls the
 * answer into its own language and the drift measured is the harness's, not the
 * model's (see defaults.systemNote).
 */
function systemFor(cell, lang) {
  const src = cell.system ?? matrix.defaults.system;
  if (!src) return undefined;
  if (typeof src === "string") return src;
  const picked = src[lang];
  if (!picked) throw new Error(`no system prompt for language ${lang}`);
  return picked;
}

function startServer(cell, model, d) {
  const argv = [
    "-m", model.path,
    "--port", String(PORT), "--host", "127.0.0.1",
    "-c", String(d.nCtx), "-ngl", String(d.nGpuLayers),
    "-ctk", cell.kvK, "-ctv", cell.kvV,
    "--reasoning", "on",              // thinking is never off; the budget is the axis
    "--reasoning-format", "none",     // leave <think> inline so one parser handles every model
    "--reasoning-budget", String(cell.budget),
    "--no-webui", "-np", "1",
  ];
  const child = spawn(SERVER, argv, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (b) => { stderr += b.toString().slice(-2000); });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`  server exited ${code}: ${stderr.slice(-600)}`);
  });
  return child;
}

async function waitHealthy(child, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server died before becoming healthy (exit ${child.exitCode})`);
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error("server did not become healthy in time");
}

async function ask(prompt, d, system) {
  const started = Date.now();
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: system
        ? [{ role: "system", content: system }, { role: "user", content: prompt }]
        : [{ role: "user", content: prompt }],
      temperature: d.temp,
      top_k: d.topK,
      top_p: d.topP,
      repeat_penalty: d.repeatPenalty,
      seed: d.seed,
      max_tokens: d.maxTokens,
      stream: false,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return {
    content: j.choices?.[0]?.message?.content ?? "",
    finish: j.choices?.[0]?.finish_reason ?? null,
    timings: j.timings ?? null,
    wallMs: Date.now() - started,
  };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  for (let i = 0; i < 50 && child.exitCode === null; i++) await sleep(100);
  if (child.exitCode === null) child.kill("SIGKILL");
  await sleep(500);
}

async function runCell(cell, prompts) {
  const model = matrix.models[cell.model];
  if (!model) throw new Error(`cell ${cell.id}: unknown model ${cell.model}`);
  if (!existsSync(model.path)) {
    console.log(`SKIP ${cell.id} — model file missing: ${model.path}`);
    return;
  }
  const outFile = path.join(outDir, `${cell.id}.jsonl`);
  const done = new Set();
  if (existsSync(outFile)) {
    for (const line of readFileSync(outFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const row = JSON.parse(line); done.add(`${row.qid}:${row.lang}`); } catch { /* partial line */ }
    }
  }
  const todo = prompts.filter((p) => !done.has(`${p.qid}:${p.lang}`));
  if (todo.length === 0) {
    console.log(`SKIP ${cell.id} — already complete (${done.size} rows)`);
    return;
  }

  const d = matrix.defaults;
  console.log(`\n=== ${cell.id} (${cell.model} ${model.quant}, kv ${cell.kvK}/${cell.kvV}, budget ${cell.budget}) — ${todo.length} prompts`);
  const child = startServer(cell, model, d);
  const t0 = Date.now();
  try {
    await waitHealthy(child);
    console.log(`  loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    let n = 0;
    for (const p of todo) {
      let row;
      try {
        const res = await ask(p.prompt, d, systemFor(cell, p.lang));
        row = { cell: cell.id, model: cell.model, quant: model.quant, kvK: cell.kvK, kvV: cell.kvV,
                budget: cell.budget, system: systemFor(cell, p.lang) ?? null,
                qid: p.qid, lang: p.lang, prompt: p.prompt,
                content: res.content, finish: res.finish, timings: res.timings, wallMs: res.wallMs };
      } catch (e) {
        row = { cell: cell.id, model: cell.model, qid: p.qid, lang: p.lang, prompt: p.prompt,
                content: "", error: String(e).slice(0, 300) };
      }
      appendFileSync(outFile, JSON.stringify(row) + "\n");
      n++;
      if (n % 8 === 0 || n === todo.length) console.log(`  ${n}/${todo.length}`);
    }
  } finally {
    await stopServer(child);
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const prompts = allPrompts();
  const cells = matrix.cells.filter((c) => !only || c.id.includes(only));
  console.log(`${cells.length} cells x ${prompts.length} prompts -> ${outDir}`);
  for (const cell of cells) {
    try { await runCell(cell, prompts); }
    catch (e) { console.error(`FAIL ${cell.id}: ${e}`); }
  }
  console.log("\ndone");
}

main().catch((e) => { console.error(e); process.exit(1); });
