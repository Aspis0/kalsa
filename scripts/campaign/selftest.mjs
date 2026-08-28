/**
 * Harness selftests (no device). Exit 0 on pass.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import { loadCampaign, validateCampaign, loadScript, conversationsPerVariant } from "./config.mjs";
import {
  applySchema,
  ciswireFlagsOf,
  stampTimingInvalid,
  isChargingFromDump,
} from "./telemetryParse.mjs";
import { extractProfile, profileJsonl } from "../device/responseProfile.mjs";
import {
  primaryContrasts,
  holmAlphas,
  HOLM_M,
  HOLM_FIRST_ALPHA,
  provisionalFloors,
  delta80,
  Z80_A05,
  Z80_HOLM_FIRST,
  floorsFromR1,
} from "./prereg.mjs";
import { loadPrereg } from "./prereg.mjs";
import { shuffleCells, isMonotoneArms, cellsFrom } from "./runOrder.mjs";
import { collectTurn } from "./collector.mjs";
import { loadScorers, runScorers } from "./scoring.mjs";
import { resumePlan } from "./resume.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
let failed = 0;

function check(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed += 1;
  } else {
    console.log(`ok: ${msg}`);
  }
}

function bash(args) {
  return spawnSync("bash", args, { encoding: "utf8" });
}

const cfgPath = path.join(repo, "campaigns/ciswire.json");
const cfg = loadCampaign(cfgPath);
check(cfg.arms.length === 8, "8 arms");
check(cfg.arms.every((a) => ["off", "anchored", "ciswire"].includes(a.flags["kalsa.context.compaction"])), "compaction literals");
check(
  cfg.arms.filter((a) => a.flags["kalsa.context.compaction"] === "ciswire").length === 4,
  "4 ciswire arms",
);
check(cfg.arms.every((a) => a.flags["kalsa.context.compaction"] !== "on"), "no compaction=on");
check(cfg.runOrder === "random", "runOrder random");
check(cfg.variants[0].params["kalsa.bench.winbudget"] === "PHASE0", "variant A PHASE0 sentinel");
check(Object.keys(cfg.variants[1].params || {}).length === 0, "variant B empty params");
check((cfg.recovery.thermalPause || 0) >= 3, "thermalPause>=3");

const clone = JSON.parse(JSON.stringify(cfg));
clone.arms[1].flags["kalsa.context.compaction"] = "on";
check(validateCampaign(clone).some((e) => e.includes("ciswire")), "reject compaction on");
clone.arms[1].flags["kalsa.context.compaction"] = "1";
check(validateCampaign(clone).some((e) => e.includes("ciswire")), "reject compaction 1");
clone.arms[1].flags["kalsa.context.compaction"] = "true";
check(validateCampaign(clone).some((e) => e.includes("ciswire")), "reject compaction true");
clone.arms[1].flags["kalsa.context.compaction"] = "anchored";
check(validateCampaign(clone).length === 0, "accept anchored");
clone.arms[1].flags["kalsa.context.compaction"] = "off";
check(validateCampaign(clone).length === 0, "accept off");
clone.arms[1].flags["kalsa.context.compaction"] = "ciswire";
check(validateCampaign(clone).length === 0, "accept ciswire");

const parsed = applySchema({}, { absentZero: ["ciswireFlags"] });
check(parsed.ciswireFlags === 0, "omitted ciswireFlags → 0");
check(ciswireFlagsOf({}) === 0, "ciswireFlagsOf missing → 0");
check(ciswireFlagsOf({ ciswireFlags: 5 }) === 5, "ciswireFlagsOf present");

const stamped = stampTimingInvalid({ promptMs: 10, predictedPerSecond: 7, durationMs: 3 }, true, [
  "promptMs",
  "predictedPerSecond",
  "durationMs",
]);
check(stamped.timingValid === false, "timingValid false when charging");
check(stamped.promptMsValid === false, "promptMs stamped invalid");
check(isChargingFromDump("  AC powered: true\n  USB powered: false\n") === true, "AC charging");
check(isChargingFromDump("  AC powered: false\n  USB powered: false\n  Wireless powered: false\n") === false, "not charging");

try {
  collectTurn({
    logText: 'KALSA_TELEMETRY {"turnId":"t","tokensEvaluated":1}',
    telemetry: [{ prefix: "KALSA_TELEMETRY", absentZero: ["ciswireFlags"] }],
    declaredCompactionBit: 1,
    charging: false,
    messages: [],
  });
  check(false, "guard must fail when bit0=0 on ciswire arm");
} catch (e) {
  check(String(e.message).includes("TELEMETRY GUARD FAIL"), `guard loud: ${e.message}`);
}

const interrupted = collectTurn({
  logText: "",
  telemetry: [{ prefix: "KALSA_TELEMETRY", absentZero: ["ciswireFlags"] }],
  declaredCompactionBit: 1,
  interrupted: true,
  charging: false,
  messages: [],
});
check(interrupted.telemetry.KALSA_TELEMETRY.length === 0, "interrupted turn permits missing telemetry");

const lex = JSON.parse(readFileSync(path.join(repo, "campaigns/ciswire/lexicon.json"), "utf8"));
const hedge = extractProfile("Forse potrebbe funzionare, credo.", { lexicon: lex });
check(hedge.hedgeCount >= 3 && hedge.hedgePer100 > 0, "profile hedge + per100");
const echo = extractProfile("Elisabetta Quirino beve caffè d'orzo.", {
  plantedTokens: ["Elisabetta Quirino", "caffè d'orzo"],
});
check(echo.echoTokens.length === 2, "profile echo");
const drift = extractProfile("This is the job you have and what that means from the start.", {
  userText: "Qual è il mio lavoro, una frase?",
});
check(drift.languageDrift === true, "profile drift EN vs IT");
const num = extractProfile("costo 999", { priorText: "niente cifre", userText: "quanto?" });
check(num.numericAbsentFromContext.includes("999"), "numeric absent-from-context");

const prereg = loadPrereg(path.join(repo, "campaigns/ciswire/prereg.json"));
const contrasts = primaryContrasts(prereg.primaryFamily.factors, prereg.primaryFamily.axes);
check(contrasts.length === 15 && HOLM_M === 15, "15 primary contrasts");
check(Math.abs(HOLM_FIRST_ALPHA - 0.05 / 15) < 1e-12, "Holm first α=0.05/15");
check(holmAlphas()[0].alpha === 0.05 / 15, "holmAlphas rank1");
const floors = provisionalFloors(prereg);
check(floors.recall.status === "PENDING_PHASE0", "floors PENDING_PHASE0");
check(Math.abs(floors["echo-rate"].sigma - 0.082) < 1e-9, "binary σ=0.082");
check(Math.abs(floors.recall.sigma - 0.35) < 1e-9, "recall σ=0.35");

const script = loadScript(path.join(repo, "campaigns/ciswire/script.json"));
const intents = script.turns.map((t) => t.intent);
const need = ["plant-fact", "filler", "echo-probe", "recall-probe", "cite-probe", "drift-probe", "web-request", "calendar-request", "degrade-probe"];
for (const n of need) check(intents.includes(n), `script intent ${n}`);
check(script.turns.length === 24, "24 turns");
const plants = script.turns.filter((t) => t.intent === "plant-fact");
check(plants.length >= 4 && plants.length <= 6, "4–6 planted facts");
check(script.turns.filter((t) => t.intent === "web-request").length >= 1, "≥1 web-request");
check(script.turns.filter((t) => t.intent === "calendar-request").length >= 3, "≥3 calendar");
check(script.turns.filter((t) => t.overlap).length >= 2, "≥2 calendar overlap planted fact");
const drifts = script.turns.filter((t) => t.intent === "drift-probe");
check(drifts.some((t) => t.lang === "en") && drifts.some((t) => t.lang === "fr"), "drift EN+FR");
const recalls = script.turns.filter((t) => t.intent === "recall-probe");
check(recalls.some((t) => t.when === "early") && recalls.some((t) => t.when === "late"), "early+late recall");
const dry = loadScript(path.join(repo, "campaigns/ciswire/script-dry.json"));
check(dry.turns.length === 3, "script-dry 3 turns");

const monotone = isMonotoneArms(cellsFrom(cfg), cfg.arms.map((a) => a.id));
check(monotone === true, "unshuffled cells are monotone (control)");
const shuf = shuffleCells(cfg, 42);
check(!isMonotoneArms(shuf, cfg.arms.map((a) => a.id)), "shuffle seed=42 not monotone");
check(shuf.length === cfg.arms.length * cfg.variants.length, "arm×variant cells");

const nPer = conversationsPerVariant(cfg);
check(nPer === 3, `conversationsPerVariant=${nPer} (want 3)`);
check(cfg.arms.length * cfg.variants.length * nPer === 48, "8×2×3=48 conv");
check(Z80_HOLM_FIRST === 3.777, `Z80_HOLM_FIRST=${Z80_HOLM_FIRST}`);
check(Math.abs(delta80(1, 24) - 0.81) < 0.005, `delta80(1,24)=${delta80(1, 24)}`);
check(Math.abs(delta80(1, 24, Z80_HOLM_FIRST) - 1.09) < 0.005, "holm pooled 1.09σ");
check(Math.abs(delta80(1, 12, Z80_HOLM_FIRST) - 1.54) < 0.005, "holm variant 1.54σ");
check(Math.abs(Z80_A05 - 2.802) < 1e-9, "Z80_A05");

const scorers = await loadScorers(cfg, repo);
const fakeTurn = {
  user: "Come mi chiamo?",
  assistant: "Forse ti chiami Elisabetta Quirino, credo.",
  script: { probes: ["Elisabetta Quirino"], planted: ["Elisabetta Quirino"], intent: "recall-probe" },
};
const scores = runScorers(scorers, fakeTurn);
check((scores.recall?.hits || 0) > 0, `scores.recall.hits=${scores.recall?.hits}`);
check((scores.response_profile?.hedgeCount || 0) > 0, `hedgeCount=${scores.response_profile?.hedgeCount}`);

const tmp = mkdtempSync(path.join(os.tmpdir(), "kalsa-harness-"));
try {
  const fx = path.join(tmp, "hedge.jsonl");
  writeFileSync(
    fx,
    JSON.stringify({
      i: 1,
      user: "x",
      assistant: "Forse potrebbe, credo.",
      script: { planted: [] },
    }) + "\n",
  );
  const withLex = profileJsonl(fx, { lexicon: lex });
  check(withLex.turns[0].profile.hedgeCount > 0, "profileJsonl lexicon hedgeCount>0");
  const cli = spawnSync("node", [path.join(repo, "scripts/device/responseProfile.mjs"), "--lexicon", path.join(repo, "campaigns/ciswire/lexicon.json"), fx], { encoding: "utf8" });
  check(cli.status === 0, `profile --lexicon exit=${cli.status}`);
  const convA = path.join(tmp, "a.jsonl");
  const convB = path.join(tmp, "b.jsonl");
  const mk = (echo, hedge) =>
    JSON.stringify({
      i: 1,
      scores: {
        response_profile: { echoRate: echo, hedgePer100: hedge, languageDrift: false },
        tool: { requested: true, called: false },
        recall: { rate: 0.5 },
      },
    });
  writeFileSync(convA, mk(0.1, 10) + "\n");
  writeFileSync(convB, mk(0.3, 30) + "\n");
  const fl = floorsFromR1([convA, convB], prereg);
  check(fl.status === "FROM_R1", `floors status=${fl.status}`);
  check(fl.nConversations === 2, "floors n=2");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const plan = resumePlan({
  cells: [{ arm: "R1", variant: "B" }, { arm: "R2", variant: "A" }],
  checkpoint: { arm: "R1", variant: "B", conv: "c2-B", turn: 10 },
  nPerVariant: 3,
  nTurns: 24,
});
check(plan.filter((r) => r.action === "skip" && r.conv === "c1-B").length === 1, "resume skips c1-B");
check(plan.some((r) => r.conv === "c2-B" && r.action === "resume" && r.startTurn === 11), "resume c2-B turn 11");
check(plan.some((r) => r.arm === "R2" && r.action === "new"), "later cell is new");
const dryPlan = resumePlan({
  cells: [{ arm: "R1", variant: "B" }, { arm: "R2", variant: "A" }],
  checkpoint: { arm: "R1", variant: "B", conv: "dry-1", turn: 10 },
  nPerVariant: 3,
  nTurns: 24,
});
check(dryPlan.every((r) => r.action === "new"), "resume dry checkpoint starts every cell new");

const guard = spawnSync(
  "node",
  [path.join(here, "collector.mjs"), "--arm-compaction", "ciswire", "--out", path.join(os.tmpdir(), "kalsa-col.json")],
  { encoding: "utf8" },
);
check(guard.status === 2, `collector ciswire no-tel exit=${guard.status}`);

const resumeBad = spawnSync("node", [path.join(here, "resume.mjs")], { encoding: "utf8" });
check(resumeBad.status !== 0, `resume.mjs missing args exit=${resumeBad.status}`);
const prod = bash([
  "-c",
  'set -euo pipefail; f=$(mktemp); node -e "process.exit(7)" >"$f" || { echo CAUGHT:$?; rm -f "$f"; exit 0; }; echo AFTER; exit 1',
]);
check(
  /CAUGHT:7/.test(prod.stdout || "") && !/AFTER/.test(prod.stdout || ""),
  `failed producer not silent stdout=${JSON.stringify(prod.stdout)}`,
);

const shFlags = bash([path.join(here, "flags.sh"), "--selftest"]);
check(shFlags.status === 0, `flags.sh --selftest exit=${shFlags.status} ${shFlags.stderr}`);
for (const f of ["supervisor.sh", "flags.sh", "conversation.sh", "logcat.sh", "watchdog.sh", "recovery.sh", "turn.sh", "phase0.sh", "oneTurn.sh"]) {
  const r = bash(["-n", path.join(here, f)]);
  check(r.status === 0, `bash -n ${f} exit=${r.status} ${r.stderr}`);
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("selftest ok");
