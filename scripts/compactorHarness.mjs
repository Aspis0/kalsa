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
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function compile() {
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/context/retriever.ts",
      "src/context/compactor.ts",
      "--outDir",
      "scripts/.build",
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
    path.join(projectRoot, `scripts/.build/${name}.js`),
    path.join(projectRoot, `scripts/.build/context/${name}.js`),
    path.join(projectRoot, `scripts/.build/src/context/${name}.js`),
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
    rebuildFrozenDigest,
    serializeCompactorState,
    parseCompactorState,
    truncateBudget,
    toRetrievalUnits,
    resolveBoundaryIndex,
    replaceLiteral,
    estimateWindowChars,
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
        // Promote a deterministic "pending" summary only on boundary rebuild.
        nextSummary: `summary-at-user-turn-${userTurnCount}`,
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

  // (3) Rolling summary frozen for K turns (only changes on boundary rebuild)
  let summaryFrozenOk = true;
  for (let i = 1; i < digests.length; i++) {
    if (rebuiltFlags[i]) {
      // On rebuild we inject nextSummary — must change (after first non-empty).
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
  // And summary must actually update on at least one boundary rebuild after the first.
  let summaryAdvancedOnRebuild = false;
  for (let i = 1; i < digests.length; i++) {
    if (!rebuiltFlags[i]) continue;
    if (digests[i].summary !== digests[i - 1].summary) {
      summaryAdvancedOnRebuild = true;
      break;
    }
  }
  record(
    "(3) rolling summary frozen between boundary rebuilds (K-cadence)",
    summaryFrozenOk && summaryAdvancedOnRebuild,
    `frozenOk=${summaryFrozenOk}, advancedOnRebuild=${summaryAdvancedOnRebuild}`,
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

  // advanceCompactionBoundary does not require / change digest from query
  const stAdv = advanceCompactionBoundary(stBase, {
    chatId: "default",
    userTurnCount: 6,
    historyLength: 20,
    hasImages: false,
    nextSummary: "new-sum",
  });
  const advOk =
    stAdv.builtAtUserTurn === 6 &&
    stAdv.rollingSummary === "new-sum" &&
    stAdv.boundaryIndex === 20 - R &&
    stAdv.frozenDigest === "old"; // preserved until refreshQueryDigest
  record(
    "advanceCompactionBoundary preserves digest, updates boundary+summary",
    advOk,
    `boundary=${stAdv.boundaryIndex}`,
  );

  // rebuildFrozenDigest convenience still works (boundary + digest)
  const stCombo = rebuildFrozenDigest(stBase, {
    chatId: "default",
    userTurnCount: 9,
    historyLength: 20,
    hasImages: false,
    index: midIdx,
    oldTurns: midUnits,
    currentQuery: qA,
    nextSummary: "combo-sum",
  });
  const comboOk =
    stCombo.builtAtUserTurn === 9 &&
    stCombo.rollingSummary === "combo-sum" &&
    stCombo.frozenDigest.length > 0;
  record("rebuildFrozenDigest convenience (boundary+digest)", comboOk);

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
