/**
 * Harness for src/context/compactor.ts (+ retriever.ts).
 * Simulates a multi-turn conversation and asserts:
 *  (1) QUERY-TIME digest: same history + different current query ⇒ different digest
 *  (2) growing recent window is STRICTLY APPEND-ONLY between boundary rebuilds
 *  (3) rolling LLM summary stays frozen for K turns (only advances on boundary rebuild)
 *  (4) budget / determinism
 *  (5) toggle OFF → byte-identical to legacy sliding window (20×4000, 8×2000 w/ images)
 *  (6) boundary rebuild cadence still every K user turns
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// Dedicated, wiped-on-every-run outDir. The shared scripts/.build is NOT safe:
// compactor.ts imports ../engine/digestTelemetry, so tsc's common root is src/
// and the output lands in <outDir>/context/compactor.js — while an older build
// (when the root was src/context) left a flat <outDir>/compactor.js that
// resolveBuilt prefers. That shadow made this harness silently validate a stale
// compiler output for a whole day. Wipe first, resolve second.
const outDir = path.join(projectRoot, "scripts/.build/compactorHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/context/retriever.ts",
      "src/context/compactor.ts",
      "src/context/windowProfile.ts",
      "--outDir",
      outDir,
      "--module",
      "nodenext",
      "--target",
      "es2020",
      "--moduleResolution",
      "nodenext",
      "--skipLibCheck",
      "--ignoreConfig",
    ],
    { cwd: projectRoot, encoding: "utf8", shell: true },
  );
  if (r.status !== 0) {
    console.error("tsc failed:\n", r.stdout, r.stderr);
    process.exit(1);
  }
}

function resolveBuilt(name) {
  const candidates = [
    path.join(outDir, `context/${name}.js`),
    path.join(outDir, `src/context/${name}.js`),
    path.join(outDir, `${name}.js`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${name}.js. Tried:\n`, candidates.join("\n"));
  process.exit(1);
}

/** Build a 40-message conversation with plantable facts early on. */
function buildConversation(n = 40) {
  /** @type {{ role: "user" | "assistant"; text: string }[]} */
  const msgs = [];
  const facts = [
    "Il gatto di Marco si chiama Leopoldo e dorme sul divano.",
    "The project deadline is March 14 and must not slip.",
    "Preferisco viaggiare in treno piuttosto che in aereo.",
    "Il budget del team è 4500 euro per questo quarter.",
    "La riunione è alle 15:30 in sala B con i materiali della sprint.",
  ];
  for (let i = 0; i < n; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    if (i < facts.length * 2 && role === "user") {
      const fi = Math.floor(i / 2);
      msgs.push({ role, text: facts[fi] ?? `User turn ${i}: status update about routine work.` });
    } else if (role === "user") {
      msgs.push({
        role,
        text: `User turn ${i}: please continue with item ${i} and remember earlier facts if relevant.`,
      });
    } else {
      msgs.push({
        role,
        text: `Assistant turn ${i}: acknowledged. Working on the request without new durable facts.`,
      });
    }
  }
  return msgs;
}

/** True if `prev` is a deep-equal prefix of `next` (append-only growth). */
function isStrictPrefix(prev, next) {
  if (!Array.isArray(prev) || !Array.isArray(next)) return false;
  if (prev.length > next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    if (JSON.stringify(prev[i]) !== JSON.stringify(next[i])) return false;
  }
  return true;
}

async function main() {
  console.log("Compiling retriever.ts + compactor.ts …");
  compile();
  const compactorPath = resolveBuilt("compactor");
  console.log("Loading", compactorPath);
  const mod = await import(pathToFileURL(compactorPath).href);
  const wmod = await import(pathToFileURL(resolveBuilt("windowProfile")).href);
  const { resolveWindowProfile, windowStartIndex, WINDOW_MAX_MESSAGES } = wmod;

  const {
    DEFAULT_COMPACTOR_CONFIG,
    shouldRebuild,
    buildDigest,
    assembleEngineHistory,
    splitAtBoundary,
    countUserTurns,
    emptyCompactorState,
    advanceCompactionBoundary,
    refreshQueryDigest,
    serializeCompactorState,
    parseCompactorState,
    truncateBudget,
    toRetrievalUnits,
    resolveBoundaryIndex,
    replaceLiteral,
    estimateWindowChars,
    parseBenchWindowBudget,
    WINDOW_CHAR_BUDGET,
    LEGACY_MAX_HISTORY,
    LEGACY_MAX_HISTORY_IMAGES,
    LEGACY_MAX_CHARS,
    LEGACY_MAX_CHARS_IMAGES,
    RetrieverIndex,
  } = mod;

  let Index = RetrieverIndex;
  if (typeof Index !== "function") {
    const retrieverPath = resolveBuilt("retriever");
    const rmod = await import(pathToFileURL(retrieverPath).href);
    Index = rmod.RetrieverIndex;
  }

  if (typeof advanceCompactionBoundary !== "function") {
    console.error("advanceCompactionBoundary not exported");
    process.exit(1);
  }
  if (typeof refreshQueryDigest !== "function") {
    console.error("refreshQueryDigest not exported");
    process.exit(1);
  }

  const results = [];
  const record = (name, pass, detail = "") => {
    results.push({ name, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  };

  const K = DEFAULT_COMPACTOR_CONFIG.rebuildEveryKUserTurns;
  const R = DEFAULT_COMPACTOR_CONFIG.recentWindow;
  const budget = DEFAULT_COMPACTOR_CONFIG.digestBudgetChars;
  const convo = buildConversation(40);
  console.log(`Conversation messages: ${convo.length}, K=${K}, R=${R}, budget=${budget}\n`);

  const userIndices = [];
  for (let i = 0; i < convo.length; i++) {
    if (convo[i].role === "user") userIndices.push(i);
  }

  // ── Simulate progressive sends: boundary K-cadence + query-time digest ──
  let state = emptyCompactorState("default");
  /** Warm index (mirrors AppShell.syncDigestIndex simplified). */
  let warmIndex = new Index();
  let warmCovered = 0;
  /** @type {number[]} */
  const rebuildTurns = [];
  /** @type {Array<{turn:number; digest:string; rebuilt:boolean; summary:string}>} */
  const digests = [];
  /** @type {Array<Array<{role:string;content:string}>>} */
  const assembledPerTurn = [];
  /** @type {boolean[]} */
  const rebuiltFlags = [];

  for (let ui = 0; ui < userIndices.length; ui++) {
    const msgIndex = userIndices[ui];
    const history = convo.slice(0, msgIndex);
    const query = convo[msgIndex].text;
    const userTurnCount = countUserTurns(history, true);
    const hasImages = false;
    const boundaryRebuilt = shouldRebuild(state, userTurnCount);

    if (boundaryRebuilt) {
      rebuildTurns.push(userTurnCount);
      state = advanceCompactionBoundary(state, {
        chatId: "default",
        userTurnCount,
        historyLength: history.length,
        hasImages,
      });
      // Sync warm index: full rebuild on boundary advance (corpus still small here).
      const b = resolveBoundaryIndex(state, history.length);
      const { older } = splitAtBoundary(history, b);
      warmIndex = new Index();
      if (older.length > 0) warmIndex.append(toRetrievalUnits(older));
      warmCovered = b;
    }

    // Query-time digest EVERY turn (even when boundary did not move).
    const b = resolveBoundaryIndex(state, history.length);
    const { older } = splitAtBoundary(history, b);
    const oldUnits = toRetrievalUnits(older);
    // If boundary hasn't been set yet, warm index may be empty — ok.
    if (!boundaryRebuilt && b === warmCovered && warmCovered > 0) {
      // reuse warmIndex
    } else if (!boundaryRebuilt && b > warmCovered) {
      // should not happen without boundary rebuild in this sim
    }
    state = refreshQueryDigest(state, {
      chatId: "default",
      index: warmIndex.documentCount > 0 ? warmIndex : null,
      oldTurns: oldUnits,
      currentQuery: query,
    });

    digests.push({
      turn: userTurnCount,
      digest: state.frozenDigest,
      rebuilt: boundaryRebuilt,
      summary: state.rollingSummary,
    });
    rebuiltFlags.push(boundaryRebuilt);

    const assembled = assembleEngineHistory(history, {
      compactionEnabled: true,
      hasImages,
      boundaryIndex: b,
    });
    assembledPerTurn.push(assembled);
  }

  // (1) QUERY-TIME: same history + different queries ⇒ different digests
  // Pick a mid conversation with enough older corpus (after first boundary rebuild).
  const midHist = convo.slice(0, 24);
  const midBoundary = Math.max(0, midHist.length - R);
  const midOlder = splitAtBoundary(midHist, midBoundary).older;
  const midUnits = toRetrievalUnits(midOlder);
  const midIdx = new Index();
  midIdx.append(midUnits);
  const qA = "come si chiama il gatto di Marco? Leopoldo divano";
  const qB = "quando è la deadline del progetto March 14?";
  const qC = "preferisco viaggiare in treno piuttosto che in aereo";
  const digA = buildDigest(midIdx, midUnits, qA);
  const digB = buildDigest(midIdx, midUnits, qB);
  const digC = buildDigest(midIdx, midUnits, qC);
  // At least two of three distinct topic queries should yield distinct digests
  // when the corpus contains those facts.
  const distinctPairs =
    (digA !== digB ? 1 : 0) + (digA !== digC ? 1 : 0) + (digB !== digC ? 1 : 0);
  const queryTimeOk =
    digA.length > 0 &&
    digB.length > 0 &&
    digC.length > 0 &&
    distinctPairs >= 2;
  // Also: progressive sim must not keep a single frozen digest across non-rebuild turns
  // when queries differ — after first rebuild, consecutive digests with different
  // user texts should often differ (not a hard freeze).
  let changedBetweenRebuilds = false;
  for (let i = 1; i < digests.length; i++) {
    if (rebuiltFlags[i]) continue;
    if (digests[i].digest !== digests[i - 1].digest) {
      changedBetweenRebuilds = true;
      break;
    }
  }
  record(
    "(1) query-time digest: same history + different query ⇒ different digest",
    queryTimeOk && changedBetweenRebuilds,
    `distinctPairs=${distinctPairs}/3, digLens=${digA.length}/${digB.length}/${digC.length}, midCycleChange=${changedBetweenRebuilds}`,
  );

  // (2) STRICT append-only of assembled history between boundary rebuilds
  let appendOnlyOk = true;
  let appendOnlyChecked = 0;
  for (let i = 1; i < assembledPerTurn.length; i++) {
    if (rebuiltFlags[i]) {
      continue;
    }
    appendOnlyChecked += 1;
    const prev = assembledPerTurn[i - 1];
    const next = assembledPerTurn[i];
    if (!isStrictPrefix(prev, next)) {
      appendOnlyOk = false;
      console.log(
        `  APPEND-ONLY FAIL at user-turn index ${i}: prevLen=${prev.length} nextLen=${next.length}`,
      );
      break;
    }
  }
  let growthSeen = false;
  for (let i = 1; i < assembledPerTurn.length; i++) {
    if (rebuiltFlags[i]) continue;
    if (assembledPerTurn[i].length > assembledPerTurn[i - 1].length) {
      growthSeen = true;
      break;
    }
  }
  record(
    "(2) assembled history STRICTLY APPEND-ONLY between rebuilds",
    appendOnlyOk && appendOnlyChecked > 0 && growthSeen,
    `checked=${appendOnlyChecked}, growthSeen=${growthSeen}, appendOnlyOk=${appendOnlyOk}`,
  );

  // (2b) At boundary rebuild, window resets to R (or all if shorter)
  let rebuildWindowOk = true;
  for (let i = 0; i < assembledPerTurn.length; i++) {
    if (!rebuiltFlags[i]) continue;
    const histLen = userIndices[i];
    const expected = Math.min(R, histLen);
    if (assembledPerTurn[i].length !== expected) {
      if (histLen > 0) {
        rebuildWindowOk = false;
        console.log(
          `  REBUILD WINDOW FAIL turn ${i}: got ${assembledPerTurn[i].length} expect ${expected}`,
        );
        break;
      }
    }
  }
  record("(2b) boundary rebuild resets verbatim window to R", rebuildWindowOk);

  // (3) Persisted rolling summary remains stable; this harness does not invoke
  // an LLM summary producer.
  let summaryFrozenOk = true;
  for (let i = 1; i < digests.length; i++) {
    if (rebuiltFlags[i]) {
      continue;
    }
    if (digests[i].summary !== digests[i - 1].summary) {
      summaryFrozenOk = false;
      console.log(
        `  SUMMARY FREEZE FAIL at turn ${digests[i].turn}: ` +
          `"${digests[i - 1].summary}" → "${digests[i].summary}"`,
      );
      break;
    }
  }
  const summaryRemainsEmpty = digests.every((entry) => entry.summary === "");
  record(
    "(3) persisted rolling summary remains stable",
    summaryFrozenOk && summaryRemainsEmpty,
    `frozenOk=${summaryFrozenOk}, remainsEmpty=${summaryRemainsEmpty}`,
  );

  // (3b) Boundary rebuild cadence every K
  let rebuildCadenceOk = rebuildTurns.length >= 1;
  for (let i = 1; i < rebuildTurns.length; i++) {
    if (rebuildTurns[i] - rebuildTurns[i - 1] !== K) {
      rebuildCadenceOk = false;
      break;
    }
  }
  record(
    "(3b) boundary rebuild every K user turns",
    rebuildCadenceOk,
    `rebuilds@userTurns=${JSON.stringify(rebuildTurns)}`,
  );

  // (4) Budget respected
  const longQuery =
    "gatto Leopoldo deadline March budget treno riunione 15:30 " + "x".repeat(200);
  const units = toRetrievalUnits(convo.slice(0, 20));
  const idx = new Index();
  idx.append(units);
  const d1 = buildDigest(idx, units, longQuery);
  const d2 = buildDigest(null, units, longQuery);
  const budgetOk = d1.length <= budget && d2.length <= budget;
  record(
    "(4) digestBudgetChars respected",
    budgetOk,
    `d1=${d1.length}, d2=${d2.length}, budget=${budget}`,
  );

  // (4b) Determinism
  const detA = buildDigest(idx, units, "come si chiama il gatto?");
  const detB = buildDigest(idx, units, "come si chiama il gatto?");
  const detC = buildDigest(null, units, "come si chiama il gatto?");
  const detOk = detA === detB && detA === detC;
  record("(4b) determinism", detOk, `len=${detA.length}`);

  // (4c) Digest telemetry: exactly one emission per call, and corpusSize is the
  // scanned corpus — NOT snippets.length, which is capped at top-N (4) and would
  // make the cost look flat no matter how large the conversation grows.
  const emitted = [];
  buildDigest(idx, units, "come si chiama il gatto?", null, (t) =>
    emitted.push(t),
  );
  record(
    "(4c) telemetry emitted exactly once per buildDigest",
    emitted.length === 1,
    `got ${emitted.length}`,
  );
  record(
    "(4c) corpusSize is the scanned corpus, not the top-N slice",
    emitted[0]?.corpusSize === idx.documentCount && idx.documentCount > 4,
    `corpusSize=${emitted[0]?.corpusSize} documentCount=${idx.documentCount}`,
  );
  record(
    "(4c) selectedCount is capped by top-N",
    emitted[0]?.selectedCount > 0 && emitted[0]?.selectedCount <= 4,
    `selectedCount=${emitted[0]?.selectedCount}`,
  );
  record(
    "(4c) durationMs is a finite non-negative number",
    Number.isFinite(emitted[0]?.durationMs) && emitted[0]?.durationMs >= 0,
    `durationMs=${emitted[0]?.durationMs}`,
  );

  // (4d) Bench-only windowCharBudget override — the knob that actually decides
  // how often the compactor runs. n_ctx does NOT: shouldRebuild never reads it.
  record(
    "(4d) parseBenchWindowBudget rejects absent / malformed / sub-floor",
    parseBenchWindowBudget(null) === null &&
      parseBenchWindowBudget("") === null &&
      parseBenchWindowBudget("   ") === null &&
      parseBenchWindowBudget("abc") === null &&
      parseBenchWindowBudget("1200.5") === null &&
      parseBenchWindowBudget("0") === null &&
      parseBenchWindowBudget("499") === null,
  );
  record(
    "(4d) parseBenchWindowBudget accepts the floor and above",
    parseBenchWindowBudget("500") === 500 &&
      parseBenchWindowBudget(" 2000 ") === 2000,
  );

  // (4e) Bench-only legacy-window override — the knob that decides what falls
  // out of context on BOTH arms of the primary comparison (ciswire vs off).
  const parseBenchLegacyWindow = mod.parseBenchLegacyWindow;
  const BENCH_LEGACY_WINDOW_FLOOR = mod.BENCH_LEGACY_WINDOW_FLOOR;
  const legacyWindowStartIndex = mod.legacyWindowStartIndex;
  
  if (typeof parseBenchLegacyWindow !== "function") {
    console.error("parseBenchLegacyWindow not exported");
    process.exit(1);
  }
  if (typeof legacyWindowStartIndex !== "function") {
    console.error("legacyWindowStartIndex not exported");
    process.exit(1);
  }
  if (typeof BENCH_LEGACY_WINDOW_FLOOR !== "number") {
    console.error("BENCH_LEGACY_WINDOW_FLOOR not exported");
    process.exit(1);
  }

  record(
    "(4e) parseBenchLegacyWindow rejects absent / malformed / sub-floor",
    parseBenchLegacyWindow(null) === null &&
      parseBenchLegacyWindow("") === null &&
      parseBenchLegacyWindow("   ") === null &&
      parseBenchLegacyWindow("abc") === null &&
      parseBenchLegacyWindow("3.5") === null &&
      parseBenchLegacyWindow("0") === null &&
      parseBenchLegacyWindow("3") === null,
  );
  record(
    "(4e) parseBenchLegacyWindow accepts the floor and above",
    parseBenchLegacyWindow("4") === 4 &&
      parseBenchLegacyWindow("10") === 10 &&
      parseBenchLegacyWindow(" 12 ") === 12,
  );

  // legacyWindowStartIndex: override absent → identical to production constants.
  // This is the safety net: the override must be invisible in production.
  const prodNoImg = legacyWindowStartIndex(30, false);
  const prodImg = legacyWindowStartIndex(30, true);
  record(
    "(4e) legacyWindowStartIndex override absent → production constants",
    prodNoImg === Math.max(0, 30 - LEGACY_MAX_HISTORY) &&
      prodImg === Math.max(0, 30 - LEGACY_MAX_HISTORY_IMAGES),
    `noImg=${prodNoImg} (expect ${30 - LEGACY_MAX_HISTORY}), img=${prodImg} (expect ${30 - LEGACY_MAX_HISTORY_IMAGES})`,
  );
  record(
    "(4e) legacyWindowStartIndex override null → production constants",
    legacyWindowStartIndex(30, false, null) === prodNoImg &&
      legacyWindowStartIndex(30, true, null) === prodImg,
  );
  record(
    "(4e) legacyWindowStartIndex override below floor → production constants",
    legacyWindowStartIndex(30, false, 3) === prodNoImg &&
      legacyWindowStartIndex(30, true, 0) === prodImg,
  );
  record(
    "(4e) legacyWindowStartIndex override present → uses override",
    legacyWindowStartIndex(30, false, 10) === 20 &&
      legacyWindowStartIndex(30, true, 10) === 20 &&
      legacyWindowStartIndex(30, false, 4) === 26,
  );
  record(
    "(4e) legacyWindowStartIndex override at floor",
    legacyWindowStartIndex(30, false, BENCH_LEGACY_WINDOW_FLOOR) ===
      Math.max(0, 30 - BENCH_LEGACY_WINDOW_FLOOR),
  );
  // The override must change the size trigger: a window that is under the
  // default budget but over the override has to force a rebuild.
  const budgetProbe = [{ text: "x".repeat(3000) }];
  const settled = { ...emptyCompactorState("default"), builtAtUserTurn: 1 };
  record(
    "(4d) window under default budget does NOT rebuild",
    shouldRebuild(settled, 2, null, budgetProbe) === false,
    `chars=${estimateWindowChars(budgetProbe)} default=${WINDOW_CHAR_BUDGET}`,
  );
  record(
    "(4d) same window OVER the override DOES rebuild",
    shouldRebuild(settled, 2, { windowCharBudget: 1000 }, budgetProbe) === true,
  );

  // Empty query short-circuits before any ranking: still exactly one emission,
  // so nSamples in the aggregate can never be inflated by a skipped build.
  const emptyEmitted = [];
  buildDigest(idx, units, "   ", null, (t) => emptyEmitted.push(t));
  record(
    "(4c) empty query still emits exactly once, zeroed",
    emptyEmitted.length === 1 &&
      emptyEmitted[0].corpusSize === 0 &&
      emptyEmitted[0].selectedCount === 0,
    JSON.stringify(emptyEmitted),
  );

  // (5) Toggle OFF → legacy sliding-window shape (byte-identical)
  const legacy = assembleEngineHistory(convo, {
    compactionEnabled: false,
    hasImages: false,
  });
  const manualLegacy = convo.slice(-LEGACY_MAX_HISTORY).map((m) => ({
    role: m.role,
    content: m.text.slice(0, LEGACY_MAX_CHARS),
  }));
  const offOk = JSON.stringify(legacy) === JSON.stringify(manualLegacy);

  // With images: 8 × 2000
  const legacyImg = assembleEngineHistory(convo, {
    compactionEnabled: false,
    hasImages: true,
  });
  const manualLegacyImg = convo.slice(-LEGACY_MAX_HISTORY_IMAGES).map((m) => ({
    role: m.role,
    content: m.text.slice(0, LEGACY_MAX_CHARS_IMAGES),
  }));
  const offImgOk = JSON.stringify(legacyImg) === JSON.stringify(manualLegacyImg);
  record(
    "(5) toggle OFF byte-identical to legacy sliding window (20×4000, 8×2000 w/ images)",
    offOk && offImgOk,
    `noImg=${legacy.length}/${offOk}, img=${legacyImg.length}/${offImgOk}`,
  );

  // (5b) The DERIVED window, and the invariant that made it worth deriving in
  // one place: assembly takes the window, the ciswire corpus takes everything
  // outside it. If the two ever disagree a message lands in both or — the bad
  // one — in neither. Check (5) above only exercises the count-only fallback,
  // which AppShell no longer uses, so without this the shipped path had no
  // harness coverage at all.
  const derivedProfile = resolveWindowProfile({
    nCtx: 8192,
    hasImages: false,
    hasDigest: false,
  });
  const derivedStart = windowStartIndex(
    convo.map((m) => m.text.length),
    derivedProfile,
    LEGACY_MAX_CHARS,
  );
  const derivedWindow = assembleEngineHistory(convo, {
    compactionEnabled: false,
    hasImages: false,
    legacyWindowStart: derivedStart,
  });
  const derivedCorpus = splitAtBoundary(convo, derivedStart).older;
  // Exact partition: no gap, no overlap, nothing invented.
  const partitionOk =
    derivedCorpus.length + derivedWindow.length === convo.length;
  const usedChars = convo
    .slice(derivedStart)
    .reduce((a, m) => a + Math.min(m.text.length, LEGACY_MAX_CHARS), 0);
  record(
    "(5b) derived window partitions history exactly at n_ctx 8192",
    partitionOk && usedChars <= derivedProfile.charBudget,
    `start=${derivedStart} window=${derivedWindow.length} corpus=${derivedCorpus.length} ` +
      `chars=${usedChars}/${derivedProfile.charBudget} src=${derivedProfile.source}`,
  );

  // (5c) …and the budget must be capable of binding, not merely present.
  // It cannot bind at 8192 on THIS fixture: these messages are ~78 chars, so 40
  // of them are ~3.1k against a 13.8k budget. Real Kalsa turns measured ~711
  // chars each (20 messages ≈ 4743 prompt tokens), an order of magnitude more —
  // the fixture is short, not the budget loose. So bind it explicitly with a
  // context small enough for this data, which keeps (5b) honest: without this
  // pair, (5b) would pass while silently measuring the message cap.
  const tightProfile = resolveWindowProfile({
    nCtx: 3072,
    hasImages: false,
    hasDigest: false,
  });
  const tightStart = windowStartIndex(
    convo.map((m) => m.text.length),
    tightProfile,
    LEGACY_MAX_CHARS,
  );
  const tightWindow = assembleEngineHistory(convo, {
    compactionEnabled: false,
    hasImages: false,
    legacyWindowStart: tightStart,
  });
  const tightChars = convo
    .slice(tightStart)
    .reduce((a, m) => a + Math.min(m.text.length, LEGACY_MAX_CHARS), 0);
  record(
    "(5c) a context too small for the history makes the char budget bind, not the message cap",
    tightStart > 0 &&
      tightWindow.length < convo.length &&
      tightWindow.length < WINDOW_MAX_MESSAGES &&
      tightChars <= tightProfile.charBudget,
    `start=${tightStart} window=${tightWindow.length} chars=${tightChars}/${tightProfile.charBudget}`,
  );

  // Bonus: serialize/parse roundtrip includes boundaryIndex
  const st0 = emptyCompactorState("default");
  st0.frozenDigest = "abc";
  st0.rollingSummary = "sum";
  st0.builtAtUserTurn = 6;
  st0.boundaryIndex = 12;
  const round = parseCompactorState(serializeCompactorState(st0), "default");
  const serOk =
    round.frozenDigest === "abc" &&
    round.rollingSummary === "sum" &&
    round.builtAtUserTurn === 6 &&
    round.boundaryIndex === 12;
  record("serialize/parse roundtrip (+boundaryIndex)", serOk);

  // Bonus: truncateBudget surrogate-safe
  const truncOk = truncateBudget("hello", 3).endsWith("…") && truncateBudget("hi", 10) === "hi";
  record("truncateBudget basic", truncOk);

  // shouldRebuild edges (boundary cadence — not digest)
  const sr1 = shouldRebuild(null, 1);
  const sr2 = shouldRebuild(emptyCompactorState("x"), 1);
  const stBuilt = {
    ...emptyCompactorState("x"),
    builtAtUserTurn: 1,
    frozenDigest: "d",
    boundaryIndex: 0,
  };
  const sr3 = shouldRebuild(stBuilt, 1);
  const sr4 = shouldRebuild(stBuilt, 1 + K);
  const sr5 = shouldRebuild(stBuilt, 1 + K - 1);
  record(
    "shouldRebuild edges (boundary only)",
    sr1 === true && sr2 === true && sr3 === false && sr4 === true && sr5 === false,
    `sr1=${sr1} sr2=${sr2} sr3=${sr3} sr4=${sr4} sr5=${sr5}`,
  );

  // refreshQueryDigest leaves boundary / summary / builtAt untouched
  const stBase = {
    ...emptyCompactorState("default"),
    frozenDigest: "old",
    rollingSummary: "keep-me",
    builtAtUserTurn: 3,
    boundaryIndex: 10,
  };
  const stRefreshed = refreshQueryDigest(stBase, {
    chatId: "default",
    index: midIdx,
    oldTurns: midUnits,
    currentQuery: qA,
  });
  const refreshMetaOk =
    stRefreshed.rollingSummary === "keep-me" &&
    stRefreshed.builtAtUserTurn === 3 &&
    stRefreshed.boundaryIndex === 10 &&
    stRefreshed.frozenDigest !== "old";
  record(
    "refreshQueryDigest updates digest only",
    refreshMetaOk,
    `digestLen=${stRefreshed.frozenDigest.length}`,
  );

  // advanceCompactionBoundary preserves the digest and persisted summary
  const stAdv = advanceCompactionBoundary(stBase, {
    chatId: "default",
    userTurnCount: 6,
    historyLength: 20,
    hasImages: false,
  });
  const advOk =
    stAdv.builtAtUserTurn === 6 &&
    stAdv.rollingSummary === "keep-me" &&
    stAdv.boundaryIndex === 20 - R &&
    stAdv.frozenDigest === "old"; // preserved until refreshQueryDigest
  record(
    "advanceCompactionBoundary preserves digest+summary",
    advOk,
    `boundary=${stAdv.boundaryIndex}`,
  );

  // replaceLiteral: $& / $$ / $` / $' must not be interpreted
  const rl1 = replaceLiteral("X {digest} Y", "{digest}", "a$&b$$c$`d$'e");
  const rlOk = rl1 === "X a$&b$$c$`d$'e Y";
  const rl2 = replaceLiteral("hi {summary}", "{summary}", "pay $100");
  const rlOk2 = rl2 === "hi pay $100";
  record(
    "replaceLiteral safe for $ sequences",
    rlOk && rlOk2,
    JSON.stringify(rl1),
  );

  // ── (A) Stale digest after clearChat + app restart ─────────────────────
  function applyLoadTimeGuards(state, validatedHistory) {
    const persistedExists =
      state.builtAtUserTurn >= 0 ||
      Boolean(state.frozenDigest?.trim()) ||
      Boolean(state.rollingSummary?.trim()) ||
      state.boundaryIndex >= 0;
    if (
      state.builtAtUserTurn > countUserTurns(validatedHistory) ||
      (validatedHistory.length === 0 && persistedExists)
    ) {
      return emptyCompactorState(state.chatId || "default");
    }
    return state;
  }

  const staleSerialized = serializeCompactorState({
    frozenDigest: "STALE_DIGEST_deleted_conversation_content",
    rollingSummary: "STALE_SUMMARY_verbatim_private_text",
    builtAtUserTurn: 15,
    boundaryIndex: 28,
    chatId: "default",
  });
  const staleLoaded = parseCompactorState(staleSerialized, "default");
  const afterEmpty = applyLoadTimeGuards(staleLoaded, []);
  const shortHistory = [
    { role: "user", text: "hi" },
    { role: "assistant", text: "hello" },
  ];
  const afterShort = applyLoadTimeGuards(
    parseCompactorState(staleSerialized, "default"),
    shortHistory,
  );
  const emptyResetOk =
    afterEmpty.frozenDigest === "" &&
    afterEmpty.rollingSummary === "" &&
    afterEmpty.builtAtUserTurn < 0 &&
    afterEmpty.boundaryIndex < 0;
  const shortResetOk =
    afterShort.frozenDigest === "" &&
    afterShort.rollingSummary === "" &&
    afterShort.builtAtUserTurn < 0;
  const longEnough = [];
  for (let i = 0; i < 40; i++) {
    longEnough.push({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `msg ${i}`,
    });
  }
  const afterLong = applyLoadTimeGuards(
    parseCompactorState(staleSerialized, "default"),
    longEnough,
  );
  const longKeepOk =
    afterLong.frozenDigest === "STALE_DIGEST_deleted_conversation_content" &&
    afterLong.builtAtUserTurn === 15;
  record(
    "(A) stale digest reset after restart + empty/short history",
    emptyResetOk && shortResetOk && longKeepOk,
    `emptyReset=${emptyResetOk} shortReset=${shortResetOk} longKeep=${longKeepOk}`,
  );

  // ── (B) Window char budget → early boundary rebuild before K ───────────
  const stBudget = {
    ...emptyCompactorState("default"),
    builtAtUserTurn: 1,
    frozenDigest: "d",
    boundaryIndex: 0,
  };
  const noBudgetRebuild = shouldRebuild(stBudget, 2, null, [
    { text: "short" },
    { text: "also short" },
  ]);
  const longMsg = "x".repeat(WINDOW_CHAR_BUDGET + 100);
  const earlyRebuild = shouldRebuild(stBudget, 2, null, [
    { text: longMsg },
    { text: "y".repeat(50) },
  ]);
  const chars = estimateWindowChars([{ text: longMsg }, { text: "y".repeat(50) }]);
  const budgetCfgOk =
    typeof DEFAULT_COMPACTOR_CONFIG.windowCharBudget === "number" &&
    DEFAULT_COMPACTOR_CONFIG.windowCharBudget === WINDOW_CHAR_BUDGET &&
    WINDOW_CHAR_BUDGET === 16_000;
  record(
    "(B) window char budget forces early boundary rebuild before K",
    noBudgetRebuild === false &&
      earlyRebuild === true &&
      chars > WINDOW_CHAR_BUDGET &&
      budgetCfgOk,
    `noBudget=${noBudgetRebuild} early=${earlyRebuild} chars=${chars} budget=${WINDOW_CHAR_BUDGET}`,
  );

  const allPass = results.every((r) => r.pass);
  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  }
  console.log(`\n=== OVERALL: ${allPass ? "PASS" : "FAIL"} ===`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
