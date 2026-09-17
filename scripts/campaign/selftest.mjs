/**
 * Harness selftests (no device). Exit 0 on pass.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { loadCampaign, validateCampaign, loadScript, conversationsPerVariant } from "./config.mjs";
import {
  applySchema,
  ciswireFlagsOf,
  stampTimingInvalid,
  isChargingFromDump,
} from "./telemetryParse.mjs";
import { extractProfile, profileJsonl } from "../responseProfile.mjs";
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
import {
  ANDROID_DEBUG_BUNDLE_PATH,
  assertExactBundleUrl,
  FOREGROUND_IDLE_PROTOCOL_MARKER,
  POST_FIX_IN_FLIGHT_NEEDLE,
  requestBundle,
  runMetroGate,
  verifyBundleText,
} from "./metroGate.mjs";
import {
  ANDROID_DEBUG_BUNDLE_ENTRY,
  ANDROID_DEBUG_BUNDLE_OPTIONS,
  EXPO_REWRITE_BUNDLE_OPTIONS,
  FUSEBOX_BUNDLE_OPTIONS,
  buildAndroidDebugBundlePath,
} from "./metroBundleConfig.mjs";

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
  const cli = spawnSync("node", [path.join(repo, "scripts/responseProfile.mjs"), "--lexicon", path.join(repo, "campaigns/ciswire/lexicon.json"), fx], { encoding: "utf8" });
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

const resumeTmp = mkdtempSync(path.join(os.tmpdir(), "kalsa-resume-"));
try {
  const cells = [{ arm: "R1", variant: "B" }, { arm: "R2", variant: "A" }];
  const writeTurns = (arm, conv, first, last, missing = []) => {
    const dir = path.join(resumeTmp, arm);
    mkdirSync(dir, { recursive: true });
    const rows = [];
    for (let i = first; i <= last; i++) {
      if (!missing.includes(i)) rows.push(JSON.stringify({ i, user: `turn ${i}` }));
    }
    writeFileSync(path.join(dir, `${conv}.jsonl`), `${rows.join("\n")}\n`);
  };
  writeTurns("R1", "c1-B", 1, 24);
  writeTurns("R1", "c2-B", 1, 24, [11]);
  const plan = resumePlan({
    cells,
    checkpoint: { arm: "R1", variant: "B", conv: "c2-B", turn: 10 },
    nPerVariant: 3,
    nTurns: 24,
    root: resumeTmp,
  });
  check(plan.filter((r) => r.action === "skip" && r.conv === "c1-B").length === 1, "resume skips c1-B");
  check(
    plan.some((r) => r.conv === "c2-B" && r.action === "resume" && r.startTurn === 11),
    "resume checkpoint hole at c2-B turn 11",
  );
  check(plan.some((r) => r.arm === "R2" && r.action === "new"), "later cell is new");
  writeTurns("R1", "c1-B", 1, 24, [7]);
  const priorHolePlan = resumePlan({
    cells,
    checkpoint: { arm: "R1", variant: "B", conv: "c2-B", turn: 10 },
    nPerVariant: 3,
    nTurns: 24,
    root: resumeTmp,
  });
  const priorHole = priorHolePlan.find((r) => r.conv === "c1-B");
  check(
    priorHole?.action === "invalid" && priorHole.startTurn === 1,
    "resume prior-cell hole is invalid from turn 1",
  );
  const dryPlan = resumePlan({
    cells,
    checkpoint: { arm: "R1", variant: "B", conv: "dry-1", turn: 10 },
    nPerVariant: 3,
    nTurns: 24,
    root: resumeTmp,
  });
  check(dryPlan.every((r) => r.action === "new"), "resume dry checkpoint starts every cell new");
  try {
    resumePlan({ cells, checkpoint: null, nPerVariant: 3, nTurns: 24 });
    check(false, "resume rejects missing root");
  } catch (error) {
    check(String(error.message).includes("existing directory"), "resume rejects missing root");
  }
  const invalidRoot = path.join(resumeTmp, "not-a-directory");
  writeFileSync(invalidRoot, "not a directory\n");
  try {
    resumePlan({ cells, checkpoint: null, nPerVariant: 3, nTurns: 24, root: invalidRoot });
    check(false, "resume rejects invalid root");
  } catch (error) {
    check(String(error.message).includes("not a directory"), "resume rejects invalid root");
  }
} finally {
  rmSync(resumeTmp, { recursive: true, force: true });
}

const validBundleFixture = [
  FOREGROUND_IDLE_PROTOCOL_MARKER,
  `function shouldRunForegroundIdleDispose(args) { ${POST_FIX_IN_FLIGHT_NEEDLE} return true; }`,
].join("\n");
const staleBundleFixture = [
  FOREGROUND_IDLE_PROTOCOL_MARKER,
  "const FOREGROUND_STUCK_INFLIGHT_MS = 900000;",
  "function shouldRunForegroundIdleDispose(args) { if (args.inFlight) return args.idleMs >= 900000; }",
].join("\n");
const missingMarker = verifyBundleText(POST_FIX_IN_FLIGHT_NEEDLE);
check(!missingMarker.ok && !missingMarker.marker.present, "Metro gate rejects missing revision marker");
const missingSemantics = verifyBundleText(FOREGROUND_IDLE_PROTOCOL_MARKER);
check(!missingSemantics.ok && !missingSemantics.inFlightSemantics.present, "Metro gate rejects missing in-flight semantics");
const staleCheck = verifyBundleText(staleBundleFixture);
check(!staleCheck.ok && staleCheck.forbidden.some((item) => item.present), "Metro gate rejects stale idle symbols");
const staleExpiryCheck = verifyBundleText(
  `${FOREGROUND_IDLE_PROTOCOL_MARKER}\n${POST_FIX_IN_FLIGHT_NEEDLE}\nstuckExpired`,
);
check(
  !staleExpiryCheck.ok && staleExpiryCheck.forbidden.some((item) => item.needle === "stuckExpired" && item.present),
  "Metro gate rejects stale expiry symbol",
);
check(verifyBundleText(validBundleFixture).ok, "Metro gate accepts marker and post-fix semantics");

const appSource = readFileSync(path.join(repo, "App.tsx"), "utf8");
const provenanceSource = readFileSync(
  path.join(repo, "src/app/foregroundIdleProvenance.ts"),
  "utf8",
);
const logcatSource = readFileSync(path.join(here, "logcat.sh"), "utf8");
const gateSource = readFileSync(path.join(here, "metroGate.mjs"), "utf8");
const markerLiteral = provenanceSource.match(
  /FOREGROUND_IDLE_PROTOCOL_MARKER\s*=\s*"([^"]+)"/,
)?.[1];
const logcatDerivesMarker =
  logcatSource.includes("src/app/foregroundIdleProvenance.ts") &&
  logcatSource.includes("FOREGROUND_IDLE_PROTOCOL_MARKER");
const gateDerivesMarker =
  gateSource.includes("src/app/foregroundIdleProvenance.ts") &&
  gateSource.includes("readProtocolMarker");
check(
  markerLiteral === FOREGROUND_IDLE_PROTOCOL_MARKER && logcatDerivesMarker && gateDerivesMarker,
  "startup marker source is shared by logcat and gate",
);
check(
  appSource.includes("\nconsole.info(FOREGROUND_IDLE_PROTOCOL_MARKER);") &&
    !appSource.includes("if (__DEV__) {\n  console.info(FOREGROUND_IDLE_PROTOCOL_MARKER);"),
  "App startup marker is emitted unguarded, so a release APK can be identified",
);
check(!/192[.]168[.]1[.]50/.test(gateSource), "gate has no hidden Metro host assumption");

const missingUrlEvidence = mkdtempSync(path.join(os.tmpdir(), "kalsa-metro-gate-no-url-"));
const savedBundleUrl = process.env.CAMPAIGN_METRO_BUNDLE_URL;
delete process.env.CAMPAIGN_METRO_BUNDLE_URL;
try {
  const result = await runMetroGate({ evidenceDir: missingUrlEvidence });
  check(
    !result.ok && /CAMPAIGN_METRO_BUNDLE_URL is required/.test(result.error || ""),
    "missing Metro URL fails closed with an explicit host message",
  );
  check(existsSync(path.join(missingUrlEvidence, "result.json")), "missing Metro URL result is persisted");
} finally {
  if (savedBundleUrl === undefined) delete process.env.CAMPAIGN_METRO_BUNDLE_URL;
  else process.env.CAMPAIGN_METRO_BUNDLE_URL = savedBundleUrl;
  rmSync(missingUrlEvidence, { recursive: true, force: true });
}

const baseBundleUrl = `http://fixture.invalid:8081${ANDROID_DEBUG_BUNDLE_PATH}`;
const baseBundleQuery = new URL(baseBundleUrl).searchParams;
check(
  new URL(baseBundleUrl).pathname === ANDROID_DEBUG_BUNDLE_ENTRY &&
  Object.entries(ANDROID_DEBUG_BUNDLE_OPTIONS).every(
    ([key, value]) => baseBundleQuery.get(key) === value,
  ),
  "virtual-entry URL contains the complete device option set including lazy=true",
);
const fuseboxPath = buildAndroidDebugBundlePath({ fusebox: true });
const fuseboxQuery = new URL(`http://fixture.invalid:8081${fuseboxPath}`).searchParams;
check(
  Object.entries(FUSEBOX_BUNDLE_OPTIONS).every(
    ([key, value]) => fuseboxQuery.get(key) === value,
  ),
  "Fusebox bundle URL contains both device Fusebox options",
);
const rewrittenPath = buildAndroidDebugBundlePath({ fusebox: true, rewrite: true });
const rewrittenQuery = new URL(`http://fixture.invalid:8081${rewrittenPath}`).searchParams;
check(
  Object.entries(EXPO_REWRITE_BUNDLE_OPTIONS).every(
    ([key, value]) => rewrittenQuery.get(key) === value,
  ),
  "virtual-entry URL permits the complete Expo rewrite option set",
);
check(
  assertExactBundleUrlForSelftest(baseBundleUrl, false, false) &&
    assertExactBundleUrlForSelftest(`http://fixture.invalid:8081${fuseboxPath}`, true, false) &&
    assertExactBundleUrlForSelftest(`http://fixture.invalid:8081${rewrittenPath}`, true, true),
  "gate accepts base, Fusebox, and Expo-rewritten virtual-entry variants",
);

for (const [label, keys] of [
  ["engine-only", ["engine"]],
  ["bytecode-only", ["bytecode"]],
  ["engine-and-profile", ["engine", "unstable_transformProfile"]],
]) {
  const partialUrl = new URL(baseBundleUrl);
  for (const key of keys) partialUrl.searchParams.set(key, EXPO_REWRITE_BUNDLE_OPTIONS[key]);
  let rejected = false;
  try {
    assertExactBundleUrl(partialUrl.toString(), { fuseboxEnabled: false });
  } catch (error) {
    rejected = /incomplete Expo rewrite/.test(error.message || "");
  }
  check(rejected, `gate rejects Expo rewrite ${label} fixture`);
}

function assertExactBundleUrlForSelftest(url, fuseboxEnabled, rewrite) {
  try {
    // Keep this wrapper local so the test also checks the exported URL parser below.
    const result = assertExactBundleUrl(url, { fuseboxEnabled });
    return (
      result.fuseboxEnabled === fuseboxEnabled &&
      Object.keys(result.rewriteOptions).length === (rewrite ? 4 : 0)
    );
  } catch {
    return false;
  }
}

async function metroFixtureGate(bundle, expected, label) {
  const evidenceDir = mkdtempSync(path.join(os.tmpdir(), "kalsa-metro-gate-"));
  let requestedPath = "";
  try {
    const result = await runMetroGate({
      url: baseBundleUrl,
      evidenceDir,
      fuseboxEnabled: false,
      timeoutMs: 10_000,
      requestFn: async (url) => {
        const parsed = new URL(url);
        requestedPath = `${parsed.pathname}${parsed.search}`;
        return {
          statusCode: 200,
          headers: {},
          responseMetadata: {
            statusCode: 200,
            headers: { "x-fixture": "virtual-entry" },
            finalUrl: url,
            rewrittenUrl: ANDROID_DEBUG_BUNDLE_ENTRY,
          },
          chunks: [Buffer.from([0xff, 0xfe]), Buffer.from(bundle, "utf8")],
        };
      },
    });
    check(result.ok === expected, `${label} result=${result.ok}`);
    check(requestedPath === ANDROID_DEBUG_BUNDLE_PATH, `${label} exact Android bundle URL`);
    check(existsSync(path.join(evidenceDir, "bundle.sha256")), `${label} bundle hash persisted`);
    check(existsSync(path.join(evidenceDir, "result.json")), `${label} verification result persisted`);
    check(!existsSync(path.join(evidenceDir, "bundle.js")), `${label} does not persist raw bundle`);
    const resultJson = JSON.parse(readFileSync(path.join(evidenceDir, "result.json"), "utf8"));
    const expectedBytes = Buffer.byteLength(bundle, "utf8") + 2;
    const expectedHash = createHash("sha256")
      .update(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(bundle, "utf8")]))
      .digest("hex");
    check(
      resultJson.requestedUrl === baseBundleUrl &&
        resultJson.expectedBundlePath === ANDROID_DEBUG_BUNDLE_PATH &&
        resultJson.bundleBytes === expectedBytes &&
        resultJson.sha256 === expectedHash,
      `${label} hashes raw wire bytes and counts raw bytes`,
    );
    check(
      JSON.stringify(resultJson).length < 10_000 &&
        resultJson.checks?.marker?.excerpt?.length <= 160,
      `${label} evidence is bounded to checks and excerpts`,
    );
    check(
      resultJson.responseMetadata?.rewrittenUrl === ANDROID_DEBUG_BUNDLE_ENTRY,
      `${label} persists observable response rewrite metadata`,
    );
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true });
  }
}

await metroFixtureGate(validBundleFixture, true, "Metro gate valid fixture");
await metroFixtureGate(staleBundleFixture, false, "Metro gate stale fixture");
const wrongUrlEvidence = mkdtempSync(path.join(os.tmpdir(), "kalsa-metro-gate-wrong-url-"));
let wrongUrlFetched = false;
try {
  const wrongUrlResult = await runMetroGate({
    url: "http://fixture.invalid:8081/not-the-android-debug-bundle",
    evidenceDir: wrongUrlEvidence,
    fuseboxEnabled: false,
    requestFn: async () => {
      wrongUrlFetched = true;
      return { statusCode: 200, headers: {}, body: validBundleFixture };
    },
  });
  check(!wrongUrlResult.ok && !wrongUrlFetched, "Metro gate rejects a non-exact bundle URL");
  check(existsSync(path.join(wrongUrlEvidence, "result.json")), "Metro gate records wrong-URL failure");
} finally {
  rmSync(wrongUrlEvidence, { recursive: true, force: true });
}

const oldEntryEvidence = mkdtempSync(path.join(os.tmpdir(), "kalsa-metro-gate-old-entry-"));
let oldEntryFetched = false;
try {
  const oldEntryPath = ANDROID_DEBUG_BUNDLE_PATH.replace(
    ANDROID_DEBUG_BUNDLE_ENTRY,
    "/node_modules/expo/AppEntry.bundle",
  );
  const oldEntryResult = await runMetroGate({
    url: `http://fixture.invalid:8081${oldEntryPath}`,
    evidenceDir: oldEntryEvidence,
    fuseboxEnabled: false,
    requestFn: async () => {
      oldEntryFetched = true;
      return { statusCode: 200, body: validBundleFixture };
    },
  });
  check(
    !oldEntryResult.ok && !oldEntryFetched && /virtual entry path/.test(oldEntryResult.error || ""),
    "gate rejects the old AppEntry sibling variant",
  );
} finally {
  rmSync(oldEntryEvidence, { recursive: true, force: true });
}

const http500Evidence = mkdtempSync(path.join(os.tmpdir(), "kalsa-metro-gate-http500-"));
try {
  const result = await runMetroGate({
    url: baseBundleUrl,
    evidenceDir: http500Evidence,
    fuseboxEnabled: false,
    requestFn: async () => ({
      statusCode: 500,
      headers: {},
      chunks: [Buffer.from("server failure", "utf8")],
    }),
  });
  check(!result.ok && result.httpStatus === 500, "Metro gate rejects HTTP 500");
  check(existsSync(path.join(http500Evidence, "result.json")), "HTTP 500 result is persisted");
} finally {
  rmSync(http500Evidence, { recursive: true, force: true });
}

function fixtureRequester(mode) {
  return (_url, onResponse) => {
    const request = new EventEmitter();
    request.destroy = () => undefined;
    request.end = () => {
      setImmediate(() => {
        if (mode === "connect-error") {
          request.emit("error", new Error("connect ECONNREFUSED fixture"));
          return;
        }
        const response = new EventEmitter();
        response.statusCode = 200;
        response.headers = {};
        onResponse(response);
        response.emit("data", Buffer.from([0xff, 0xfe, 0x00, 0x01]));
        if (mode === "response-error") {
          response.emit("error", new Error("fixture response error"));
        } else if (mode === "aborted") {
          response.emit("aborted");
        }
      });
    };
    return request;
  };
}

const refusalUrl = `http://fixture.invalid:8081${ANDROID_DEBUG_BUNDLE_PATH}`;
const networkEvidence = mkdtempSync(path.join(os.tmpdir(), "kalsa-metro-gate-network-"));
try {
  const result = await runMetroGate({
    url: refusalUrl,
    evidenceDir: networkEvidence,
    fuseboxEnabled: false,
    timeoutMs: 500,
    requestFn: (url, timeoutMs) => requestBundle(url, timeoutMs, fixtureRequester("connect-error")),
  });
  check(!result.ok && /ECONNREFUSED|connect/i.test(result.error || ""), "connection refusal fails closed");
  check(existsSync(path.join(networkEvidence, "result.json")), "connection refusal result is persisted");
} finally {
  rmSync(networkEvidence, { recursive: true, force: true });
}

const abortEvidence = mkdtempSync(path.join(os.tmpdir(), "kalsa-metro-gate-abort-"));
try {
  const result = await runMetroGate({
    url: refusalUrl,
    evidenceDir: abortEvidence,
    fuseboxEnabled: false,
    timeoutMs: 1_000,
    requestFn: (url, timeoutMs) => requestBundle(url, timeoutMs, fixtureRequester("aborted")),
  });
  check(!result.ok && result.partialBody && result.bundleBytes === 4, "mid-stream abort preserves partial-byte evidence");
  check(existsSync(path.join(abortEvidence, "result.json")), "mid-stream abort result is persisted");
} finally {
  rmSync(abortEvidence, { recursive: true, force: true });
}

const deadlineEvidence = mkdtempSync(path.join(os.tmpdir(), "kalsa-metro-gate-deadline-"));
try {
  const result = await runMetroGate({
    url: refusalUrl,
    evidenceDir: deadlineEvidence,
    fuseboxEnabled: false,
    timeoutMs: 30,
    requestFn: (url, timeoutMs) => requestBundle(url, timeoutMs, fixtureRequester("deadline")),
  });
  check(!result.ok && result.partialBody && /deadline/i.test(result.error || ""), "total deadline settles and fails partial body");
  check(existsSync(path.join(deadlineEvidence, "result.json")), "deadline partial-body result is persisted");
} finally {
  rmSync(deadlineEvidence, { recursive: true, force: true });
}

const overwriteEvidence = mkdtempSync(path.join(os.tmpdir(), "kalsa-metro-gate-overwrite-"));
const preservedResult = "previous result must survive\n";
const preservedHash = "previous hash must survive\n";
writeFileSync(path.join(overwriteEvidence, "result.json"), preservedResult);
writeFileSync(path.join(overwriteEvidence, "bundle.sha256"), preservedHash);
let overwriteResult;
try {
  overwriteResult = await runMetroGate({
    url: baseBundleUrl,
    evidenceDir: overwriteEvidence,
    fuseboxEnabled: false,
    requestFn: async () => ({ statusCode: 200, chunks: [Buffer.from(validBundleFixture)] }),
  });
  check(!overwriteResult.ok && overwriteResult.failureEvidenceDir !== overwriteEvidence, "overwrite refusal fails in a unique sibling");
  check(
    readFileSync(path.join(overwriteEvidence, "result.json"), "utf8") === preservedResult &&
      readFileSync(path.join(overwriteEvidence, "bundle.sha256"), "utf8") === preservedHash,
    "overwrite refusal preserves existing evidence",
  );
  check(
    existsSync(path.join(overwriteResult.failureEvidenceDir, "result.json")) &&
      JSON.parse(readFileSync(path.join(overwriteResult.failureEvidenceDir, "result.json"), "utf8")).error.includes("refusing"),
    "overwrite refusal writes bounded failure evidence",
  );
} finally {
  rmSync(overwriteEvidence, { recursive: true, force: true });
  if (overwriteResult?.failureEvidenceDir) rmSync(overwriteResult.failureEvidenceDir, { recursive: true, force: true });
}

const responseErrorEvidence = mkdtempSync(path.join(os.tmpdir(), "kalsa-metro-gate-response-error-"));
try {
  const result = await runMetroGate({
    url: baseBundleUrl,
    evidenceDir: responseErrorEvidence,
    fuseboxEnabled: false,
    requestFn: (url, timeoutMs) => requestBundle(url, timeoutMs, fixtureRequester("response-error")),
  });
  check(!result.ok && result.partialBody && /response error/.test(result.error || ""), "response error fails with partial evidence");
  check(existsSync(path.join(responseErrorEvidence, "result.json")), "response error result is persisted");
} finally {
  rmSync(responseErrorEvidence, { recursive: true, force: true });
}

const pidFixture = bash([
  "-c",
  `set -euo pipefail
source '${path.join(here, "conversation.sh")}'
log() { :; }
current_pid=123
next_pid=789
forced=0
launched=0
ready=0
campaign_pidof() { printf '%s\\n' "$current_pid"; }
campaign_force_stop() { forced=$((forced + 1)); current_pid=""; }
campaign_launch() { launched=$((launched + 1)); current_pid="$next_pid"; CAMPAIGN_LAUNCHED_PID="$current_pid"; }
campaign_wait_ready() { ready=$((ready + 1)); }
CAMPAIGN_LAUNCHED_PID=123
campaign_ensure_launch_pid
[ "$forced" -eq 0 ] && [ "$launched" -eq 0 ] && [ "$ready" -eq 0 ]
CAMPAIGN_LAUNCHED_PID=""
current_pid=""
next_pid=456
campaign_ensure_launch_pid
[ "$forced" -eq 1 ] && [ "$launched" -eq 1 ] && [ "$ready" -eq 1 ] && [ "$CAMPAIGN_LAUNCHED_PID" = 456 ]
CAMPAIGN_LAUNCHED_PID=456
current_pid=""
next_pid=567
campaign_ensure_launch_pid
[ "$forced" -eq 2 ] && [ "$launched" -eq 2 ] && [ "$ready" -eq 2 ] && [ "$CAMPAIGN_LAUNCHED_PID" = 567 ]
CAMPAIGN_LAUNCHED_PID=""
current_pid=567
next_pid=678
campaign_ensure_launch_pid
[ "$forced" -eq 3 ] && [ "$launched" -eq 3 ] && [ "$ready" -eq 3 ] && [ "$CAMPAIGN_LAUNCHED_PID" = 678 ]
current_pid=999
next_pid=789
campaign_ensure_launch_pid
[ "$forced" -eq 4 ] && [ "$launched" -eq 4 ] && [ "$ready" -eq 4 ] && [ "$CAMPAIGN_LAUNCHED_PID" = 789 ]
`,
]);
check(pidFixture.status === 0, "share PID fixture rejects empty and changed PID cases");
const deviceShareSource = readFileSync(path.join(repo, "scripts/device-share-send.sh"), "utf8");
check(
  (deviceShareSource.match(/campaign_ensure_launch_pid/g) || []).length >= 2 &&
    deviceShareSource.indexOf("campaign_ensure_launch_pid") < deviceShareSource.indexOf("adb shell am start -a"),
  "share intent and send check the launch PID before device actions",
);

const delayedPidFixture = bash([
  "-c",
  `set -euo pipefail
source '${path.join(here, "conversation.sh")}'
log() { :; }
adb() { :; }
CAMPAIGN_STARTUP_MARKER_TIMEOUT_S=5
pid_calls_file=$(mktemp)
printf '%s\\n' 0 > "$pid_calls_file"
trap 'rm -f "$pid_calls_file"' EXIT
campaign_logcat_offset() { printf '%s\\n' 17; }
campaign_pidof() {
  local n
  n=$(cat "$pid_calls_file")
  n=$((n + 1))
  printf '%s\\n' "$n" > "$pid_calls_file"
  if [ "$n" -lt 3 ]; then printf '%s\\n' ''; else printf '%s\\n' 321; fi
}
marker_calls=0
marker_pid=""
marker_budget=0
campaign_logcat_require_startup_marker() {
  marker_calls=$((marker_calls + 1))
  marker_pid="$2"
  marker_budget="$3"
  [ "$marker_pid" = 321 ]
}
campaign_launch
[ "$(cat "$pid_calls_file")" -ge 3 ]
[ "$marker_calls" -eq 1 ] && [ "$marker_pid" = 321 ]
  [ "$marker_budget" -ge 1 ] && [ "$marker_budget" -le 5 ]
[ "$CAMPAIGN_LAUNCHED_PID" = 321 ]
`,
]);
check(
  delayedPidFixture.status === 0,
  `campaign launch polls until delayed PID then verifies marker status=${delayedPidFixture.status} stderr=${JSON.stringify(delayedPidFixture.stderr)}`,
);

const noPidFixture = bash([
  "-c",
  `set -euo pipefail
source '${path.join(here, "conversation.sh")}'
log() { :; }
adb() { :; }
CAMPAIGN_STARTUP_MARKER_TIMEOUT_S=1
campaign_logcat_offset() { printf '%s\\n' 0; }
campaign_pidof() { printf '%s\\n' ''; }
marker_calls=0
campaign_logcat_require_startup_marker() { marker_calls=$((marker_calls + 1)); return 0; }
if campaign_launch; then exit 10; fi
[ "$marker_calls" -eq 0 ]
`,
]);
check(noPidFixture.status === 0, "campaign launch fails on PID timeout without marker verification");

const logcatFixture = bash([
  "-c",
  `set -euo pipefail
source '${path.join(here, "logcat.sh")}'
log() { :; }
CAMPAIGN_STARTUP_MARKER_TIMEOUT_S=1
fixture_logcat=$(mktemp)
trap 'rm -f "$fixture_logcat"' EXIT
CAMPAIGN_LOGCAT_FILE="$fixture_logcat"
printf '%s\\n' '09-16 00:00:00.000 111 222 I ReactNativeJS: ${FOREGROUND_IDLE_PROTOCOL_MARKER}' > "$fixture_logcat"
offset=$(campaign_logcat_offset)
printf '%s\\n' '09-16 00:00:01.000 999 222 I ReactNativeJS: ${FOREGROUND_IDLE_PROTOCOL_MARKER}' >> "$fixture_logcat"
if campaign_logcat_require_startup_marker "$offset" 123; then
  exit 10
fi
offset=$(campaign_logcat_offset)
printf '%s\\n' '09-16 00:00:02.000 123 222 I ReactNativeJS: ${FOREGROUND_IDLE_PROTOCOL_MARKER}' >> "$fixture_logcat"
campaign_logcat_require_startup_marker "$offset" 123
`,
]);
check(logcatFixture.status === 0, "logcat startup marker rejects wrong PID and accepts launched PID");

const supervisorSource = readFileSync(path.join(here, "supervisor.sh"), "utf8");
check(
  supervisorSource.indexOf("campaign_metro_preflight") < supervisorSource.indexOf("campaign_ensure_device") &&
    !supervisorSource.includes("export CAMPAIGN_METRO_GATE_DIR") &&
    supervisorSource.includes("metro-gate-evidence.txt"),
  "campaign gate runs before device access and records discoverable evidence",
);
const conversationSource = readFileSync(path.join(here, "conversation.sh"), "utf8");
check(
  conversationSource.includes('campaign_logcat_require_startup_marker "$logcat_offset" "$launched_pid"') &&
    conversationSource.includes('CAMPAIGN_LAUNCHED_PID="$launched_pid"'),
  "campaign launch records the PID only after marker proof",
);

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
for (const f of ["supervisor.sh", "flags.sh", "conversation.sh", "logcat.sh", "watchdog.sh", "recovery.sh", "turn.sh", "phase0.sh", "oneTurn.sh", "../device-share-send.sh"]) {
  const r = bash(["-n", path.join(here, f)]);
  check(r.status === 0, `bash -n ${f} exit=${r.status} ${r.stderr}`);
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("selftest ok");
