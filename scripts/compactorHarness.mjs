/**
 * Harness for src/context/compactor.ts (+ retriever.ts).
 * Simulates a 40-turn conversation and asserts:
 *  (1) digest rebuilt every K user turns + frozen between
 *  (2) growing recent window is STRICTLY APPEND-ONLY between rebuilds
 *      (previous assembled array is a deep-equal prefix of the next)
 *  (3) budget respected
 *  (4) determinism
 *  (5) toggle OFF → output equals legacy sliding-window shape
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
    LEGACY_MAX_CHARS,
    RetrieverIndex,
  } = mod;

  let Index = RetrieverIndex;
  if (typeof Index !== "function") {
    const retrieverPath = resolveBuilt("retriever");
    const rmod = await import(pathToFileURL(retrieverPath).href);
    Index = rmod.RetrieverIndex;
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

  // ── Simulate progressive sends with boundary-anchored window ───────────
  let state = emptyCompactorState("default");
  /** @type {number[]} */
  const rebuildTurns = [];
  /** @type {import("type").any[]} */
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
    const rebuilt = shouldRebuild(state, userTurnCount);

    if (rebuilt) {
      rebuildTurns.push(userTurnCount);
      // Boundary so remaining = most recent R
      const boundary =
        history.length <= R ? 0 : history.length - R;
      const { older } = splitAtBoundary(history, boundary);
      const oldUnits = toRetrievalUnits(older);
      const idx =
        oldUnits.length > 0
          ? (() => {
              const t = new Index();
              t.append(oldUnits);
              return t;
            })()
          : null;
      state = rebuildFrozenDigest(state, {
        chatId: "default",
        userTurnCount,
        historyLength: history.length,
        hasImages,
        index: idx,
        oldTurns: oldUnits,
        currentQuery: query,
      });
    }

    digests.push({ turn: userTurnCount, digest: state.frozenDigest, rebuilt });
    rebuiltFlags.push(rebuilt);

    const boundary = resolveBoundaryIndex(state, history.length);
    const assembled = assembleEngineHistory(history, {
      compactionEnabled: true,
      hasImages,
      boundaryIndex: boundary,
    });
    assembledPerTurn.push(assembled);
  }

  // (1) Rebuild cadence + frozen digest between rebuilds
  let rebuildCadenceOk = rebuildTurns.length >= 1;
  for (let i = 1; i < rebuildTurns.length; i++) {
    if (rebuildTurns[i] - rebuildTurns[i - 1] !== K) {
      rebuildCadenceOk = false;
      break;
    }
  }
  let frozenDigestOk = true;
  for (let i = 1; i < digests.length; i++) {
    if (!digests[i].rebuilt && digests[i].digest !== digests[i - 1].digest) {
      frozenDigestOk = false;
      break;
    }
  }
  record(
    "(1) digest rebuild every K user turns + frozen between",
    rebuildCadenceOk && frozenDigestOk,
    `rebuilds@userTurns=${JSON.stringify(rebuildTurns)}, frozenOk=${frozenDigestOk}`,
  );

  // (2) STRICT append-only of assembled history between rebuilds
  // Between rebuilds, previous assembled array MUST be a deep-equal prefix of next.
  // At rebuild, window may shrink (boundary moves forward) — no append-only req.
  let appendOnlyOk = true;
  let appendOnlyChecked = 0;
  for (let i = 1; i < assembledPerTurn.length; i++) {
    if (rebuiltFlags[i]) {
      // Rebuild resets the window — not required to be append-only across boundary.
      continue;
    }
    appendOnlyChecked += 1;
    const prev = assembledPerTurn[i - 1];
    const next = assembledPerTurn[i];
    // Next must be strictly longer OR equal with identical content (same history
    // edge case); for real growth after a user turn with new prior msgs, history
    // grows so next.length >= prev.length and prev is prefix.
    if (!isStrictPrefix(prev, next)) {
      appendOnlyOk = false;
      console.log(
        `  APPEND-ONLY FAIL at user-turn index ${i}: prevLen=${prev.length} nextLen=${next.length}`,
      );
      break;
    }
  }
  // Also: within a non-rebuild stretch, window must grow (not slide)
  // After first rebuild with enough history, between-rebuild windows grow.
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

  // (2b) At rebuild, boundary leaves exactly R (or all if shorter) verbatim
  let rebuildWindowOk = true;
  for (let i = 0; i < assembledPerTurn.length; i++) {
    if (!rebuiltFlags[i]) continue;
    const histLen = userIndices[i]; // history length at that user turn
    const expected = Math.min(R, histLen);
    if (assembledPerTurn[i].length !== expected) {
      // Only when history is non-empty
      if (histLen > 0) {
        rebuildWindowOk = false;
        console.log(
          `  REBUILD WINDOW FAIL turn ${i}: got ${assembledPerTurn[i].length} expect ${expected}`,
        );
        break;
      }
    }
  }
  record(
    "(2b) rebuild resets verbatim window to R",
    rebuildWindowOk,
  );

  // (3) Budget respected
  const longQuery =
    "gatto Leopoldo deadline March budget treno riunione 15:30 " + "x".repeat(200);
  const units = toRetrievalUnits(convo.slice(0, 20));
  const idx = new Index();
  idx.append(units);
  const d1 = buildDigest(idx, units, longQuery);
  const d2 = buildDigest(null, units, longQuery);
  const budgetOk = d1.length <= budget && d2.length <= budget;
  record(
    "(3) digestBudgetChars respected",
    budgetOk,
    `d1=${d1.length}, d2=${d2.length}, budget=${budget}`,
  );

  // (4) Determinism
  const detA = buildDigest(idx, units, "come si chiama il gatto?");
  const detB = buildDigest(idx, units, "come si chiama il gatto?");
  const detC = buildDigest(null, units, "come si chiama il gatto?");
  const detOk = detA === detB && detA === detC;
  record("(4) determinism", detOk, `len=${detA.length}`);

  // (5) Toggle OFF → legacy sliding-window shape (unchanged)
  const legacy = assembleEngineHistory(convo, {
    compactionEnabled: false,
    hasImages: false,
  });
  const manualLegacy = convo.slice(-LEGACY_MAX_HISTORY).map((m) => ({
    role: m.role,
    content: m.text.slice(0, LEGACY_MAX_CHARS),
  }));
  const offOk = JSON.stringify(legacy) === JSON.stringify(manualLegacy);
  record(
    "(5) toggle OFF equals legacy sliding window",
    offOk,
    `legacyLen=${legacy.length}, offMatch=${offOk}`,
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

  // shouldRebuild edges
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
    "shouldRebuild edges",
    sr1 === true && sr2 === true && sr3 === false && sr4 === true && sr5 === false,
    `sr1=${sr1} sr2=${sr2} sr3=${sr3} sr4=${sr4} sr5=${sr5}`,
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
  // Simulate: long conversation state persisted → process restart (fresh maps
  // = re-parse only) → empty/short history → load-time guards must reset.
  // Mirrors AppShell handleSendStream guards (not AiChatPage clearChat).
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
  // "Restart": only re-parse from disk string — no lastHistoryLenByChat.
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
  // Empty first send → full reset
  const emptyResetOk =
    afterEmpty.frozenDigest === "" &&
    afterEmpty.rollingSummary === "" &&
    afterEmpty.builtAtUserTurn < 0 &&
    afterEmpty.boundaryIndex < 0;
  // Short history: builtAtUserTurn(15) > countUserTurns(short) → reset
  // countUserTurns(shortHistory) default includeCurrent=true → 2 users in hist + 1 = 3
  const shortResetOk =
    afterShort.frozenDigest === "" &&
    afterShort.rollingSummary === "" &&
    afterShort.builtAtUserTurn < 0;
  // Control: long enough history must NOT reset (no stale injection needed)
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
  // countUserTurns(longEnough)=20+1=21; builtAt=15 → 15 > 21 is false → keep
  const longKeepOk =
    afterLong.frozenDigest === "STALE_DIGEST_deleted_conversation_content" &&
    afterLong.builtAtUserTurn === 15;
  record(
    "(A) stale digest reset after restart + empty/short history",
    emptyResetOk && shortResetOk && longKeepOk,
    `emptyReset=${emptyResetOk} shortReset=${shortResetOk} longKeep=${longKeepOk}`,
  );

  // ── (B) Window char budget → early rebuild before K ────────────────────
  const stBudget = {
    ...emptyCompactorState("default"),
    builtAtUserTurn: 1,
    frozenDigest: "d",
    boundaryIndex: 0,
  };
  // Without long recent: at turn 2 (builtAt=1) should NOT rebuild (K=3)
  const noBudgetRebuild = shouldRebuild(stBudget, 2, null, [
    { text: "short" },
    { text: "also short" },
  ]);
  // With recent exceeding WINDOW_CHAR_BUDGET: force early rebuild
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
    "(B) window char budget forces early rebuild before K",
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
