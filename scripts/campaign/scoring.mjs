/**
 * Scorer plugin API. Config lists {id, module, lexicon?}. Built-ins:
 * recall (exact-token), tool (called/ok/spurious/gate), response_profile.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractProfile } from "../responseProfile.mjs";

export function loadLexiconFile(file, repoRoot) {
  if (!file) return { hedge: [], refusal: [], apology: [] };
  const p = path.isAbsolute(file) ? file : path.join(repoRoot, file);
  return JSON.parse(readFileSync(p, "utf8"));
}

export function scoreRecall(turn) {
  const text = turn.assistant || "";
  const probes = turn.script?.probes || turn.probes || [];
  const hits = probes.filter((t) => t && text.includes(t));
  return {
    id: "recall",
    n: probes.length,
    hits: hits.length,
    rate: probes.length ? hits.length / probes.length : null,
    tokens: hits,
  };
}

export function scoreTool(turn) {
  const tel = turn.telemetry?.KALSA_TELEMETRY || [];
  const last = tel.length ? tel[tel.length - 1] : {};
  const called = Boolean(last.tool || last.toolName || last.toolCalled);
  const toolName = last.tool || last.toolName || null;
  const ok = last.toolOk === true || last.toolStatus === "ok";
  const spurious = last.toolSpurious === true || last.strategy === "echo-of-context";
  const intent = turn.script?.intent || "";
  const requested = intent === "web-request" || intent === "calendar-request";
  const gate = turn.gateAudit || null;
  return {
    id: "tool",
    requested,
    called,
    ok,
    spurious,
    toolName,
    gateBlocked: Boolean(gate?.blocked || gate?.decision === "block"),
  };
}

export function scoreProfile(turn, lexicon) {
  const planted = [
    ...(turn.script?.planted || []),
    ...(turn.script?.probes || []),
    ...(turn.plantedTokens || []),
  ];
  const profile = extractProfile(turn.assistant || "", {
    lexicon,
    plantedTokens: planted,
    userText: turn.user || "",
    priorText: turn.priorText || "",
    promptLang: turn.script?.lang || turn.promptLang,
  });
  return { id: "response_profile", ...profile };
}

const BUILTIN = {
  recall: (turn) => scoreRecall(turn),
  tool: (turn) => scoreTool(turn),
  response_profile: (turn, ctx) => scoreProfile(turn, ctx.lexicon),
};

export async function loadScorers(cfg, repoRoot) {
  const scorers = [];
  for (const spec of cfg.scorers || []) {
    const lexicon = loadLexiconFile(spec.lexicon, repoRoot);
    let fn = BUILTIN[spec.id];
    if (spec.module && !BUILTIN[spec.id]) {
      const abs = path.isAbsolute(spec.module) ? spec.module : path.join(repoRoot, spec.module);
      const mod = await import(pathToFileURL(abs).href);
      fn = mod.score || mod.default;
    }
    if (typeof fn !== "function") throw new Error(`scorer ${spec.id} has no function`);
    scorers.push({ id: spec.id, fn, lexicon });
  }
  return scorers;
}

export function runScorers(scorers, turn) {
  const scores = {};
  for (const s of scorers) {
    scores[s.id] = s.fn(turn, { lexicon: s.lexicon });
  }
  return scores;
}

async function scoreTurnCli(argv) {
  const recFile = argv[argv.indexOf("--score-turn") + 1];
  const cfgFile = argv[argv.indexOf("--config") + 1];
  const repoRoot = argv[argv.indexOf("--repo") + 1];
  const { loadCampaign } = await import("./config.mjs");
  const { writeFileSync } = await import("node:fs");
  const cfg = loadCampaign(cfgFile);
  const rec = JSON.parse(readFileSync(recFile, "utf8"));
  const scorers = await loadScorers(cfg, repoRoot);
  rec.scores = runScorers(scorers, rec);
  writeFileSync(recFile, `${JSON.stringify(rec)}\n`);
}

if (process.argv[1] && process.argv[1].endsWith("scoring.mjs") && process.argv[2] === "--score-turn") {
  scoreTurnCli(process.argv).catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
