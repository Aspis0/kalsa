/**
 * Harness for prefixPrewarm helpers (V2-2).
 * Hash stability + system-only messages builder. No llama.rn / device.
 * Compile-from-disk. Exit 1 on fail.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/prefixPrewarmHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/prefixPrewarm.ts",
      "src/engine/ttftFlags.ts",
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

function resolveBuilt(file) {
  const candidates = [
    path.join(outDir, file),
    path.join(outDir, "engine", file),
    path.join(outDir, "src/engine", file),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${file}. Tried:\n`, candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function tool(name, extra = {}) {
  return {
    type: "function",
    function: {
      name,
      description: extra.description ?? `${name} desc`,
      parameters: extra.parameters ?? {
        type: "object",
        properties: { q: { type: "string" } },
        required: ["q"],
      },
    },
  };
}

async function main() {
  console.log("Compiling prefixPrewarm.ts + ttftFlags.ts …");
  compile();
  const prewarmMod = await import(pathToFileURL(resolveBuilt("prefixPrewarm.js")).href);
  const flagsMod = await import(pathToFileURL(resolveBuilt("ttftFlags.js")).href);

  const {
    djb2,
    toolsForPrewarmHash,
    computePrewarmPrefixHash,
    buildStaticPrefixMessages,
    assembleStaticPrefix,
    shouldSkipPrewarmWhenKvHoldsChat,
    shouldSkipStaticPrefixPrewarm,
    shouldWipeKvOnPrefixInputChange,
    shouldApplyQueuedPrefixWipe,
    planPrefixInputChange,
    prewarmStopReason,
    prewarmFailureIsPersistent,
    prewarmGivenUp,
    STATIC_PREFIX_PREWARM_MAX_FAILURES,
  } = prewarmMod;

  assert(flagsMod.EAGER_PREFIX_PREWARM === true, "EAGER_PREFIX_PREWARM must default true");

  const sys = "You are Kalsa.";
  const tools = [tool("document_chat"), tool("web_search")];

  const msgs = buildStaticPrefixMessages(sys);
  assert(Array.isArray(msgs) && msgs.length === 1, "system-only messages length");
  assert(msgs[0].role === "system", "only system role");
  assert(msgs[0].content === sys, "system content byte-identical");
  assert(
    msgs.every((m) => m.role === "system"),
    "no user/assistant/tool roles",
  );
  assert(
    !JSON.stringify(msgs).includes('"user"'),
    "serialized messages must not include a user role",
  );

  const emptyMsgs = buildStaticPrefixMessages("");
  assert(emptyMsgs[0].role === "system" && emptyMsgs[0].content === "", "empty system still system-only");

  const a = computePrewarmPrefixHash("en", sys, tools);
  const b = computePrewarmPrefixHash("en", sys, tools);
  assert(a === b, "hash is stable");
  assert(typeof a === "string" && /^\d+$/.test(a), "hash is unsigned decimal");

  assert(
    computePrewarmPrefixHash("it", sys, tools) !== a,
    "locale changes hash",
  );
  assert(
    computePrewarmPrefixHash("en", sys + "!", tools) !== a,
    "systemText changes hash",
  );
  assert(
    computePrewarmPrefixHash("en", sys, [tool("document_chat")]) !== a,
    "tool count changes hash",
  );
  assert(
    computePrewarmPrefixHash("en", sys, [tool("web_search"), tool("document_chat")]) !== a,
    "tool order changes hash",
  );
  assert(
    computePrewarmPrefixHash(
      "en",
      sys,
      [tool("document_chat", { description: "other" }), tool("web_search")],
    ) !== a,
    "tool description changes hash",
  );
  assert(
    computePrewarmPrefixHash(
      "en",
      sys,
      [
        tool("document_chat", {
          parameters: { type: "object", properties: { q: { type: "number" } } },
        }),
        tool("web_search"),
      ],
    ) !== a,
    "tool schema changes hash",
  );

  const none = computePrewarmPrefixHash("en", sys, undefined);
  const empty = computePrewarmPrefixHash("en", sys, []);
  assert(none === empty, "undefined tools hash-equal empty list");

  const rows = toolsForPrewarmHash(tools);
  assert(rows.length === 2, "toolsForPrewarmHash length");
  assert(rows[0].name === "document_chat", "first tool name");
  assert(rows[0].schema && typeof rows[0].schema === "object", "schema object");

  const assembled = assembleStaticPrefix({ locale: "en", systemText: sys, tools });
  assert(assembled.hash === a, "assemble hash matches compute");
  assert(assembled.messages.length === 1 && assembled.messages[0].role === "system", "assemble system-only");
  assert(assembled.hasTools === true, "hasTools when tools present");
  assert(assembled.toolCount === 2, "toolCount");
  assert(assembled.systemChars === sys.length, "systemChars");
  assert(
    assembled.messages.every((m) => m.role === "system"),
    "assemble never injects user/facts/persona",
  );

  const noTools = assembleStaticPrefix({ locale: "en", systemText: sys });
  assert(noTools.hasTools === false && noTools.toolCount === 0, "no tools");
  assert(noTools.hash === none, "assemble without tools matches empty hash");

  assert(djb2("abc") === djb2("abc"), "djb2 stable");
  assert(djb2("abc") !== djb2("abd"), "djb2 sensitive");

  // V2-2: skip only on same-process hash match. After hybrid restore the
  // hash is null (even if kvHoldsChatSession would be true) → do not skip.
  assert(
    shouldSkipStaticPrefixPrewarm(null, assembled.hash) === false,
    "after restore (hash null) prewarm must run",
  );
  assert(
    shouldSkipStaticPrefixPrewarm(undefined, assembled.hash) === false,
    "undefined hash does not skip",
  );
  assert(
    shouldSkipStaticPrefixPrewarm(assembled.hash, assembled.hash) === true,
    "already-prewarmed / post-turn mark skips",
  );
  assert(
    shouldSkipStaticPrefixPrewarm("other", assembled.hash) === false,
    "different hash does not skip",
  );

  // Chat KV decides, not the architecture or how the KV was created. §7.29
  // measured a hybrid restore on KEXP landing at n_past=1473 with ~2 s
  // prefill, twice, which killed the old "hybrid restores are not real
  // (n_past=0)" carve-out.
  assert(
    shouldSkipPrewarmWhenKvHoldsChat(true) === true,
    "chat KV held → skip prewarm, hybrid or not",
  );
  assert(
    shouldSkipPrewarmWhenKvHoldsChat(false) === false,
    "no chat KV → prewarm",
  );
  // Extra arguments must not change the chat-KV condition.
  assert(
    shouldSkipPrewarmWhenKvHoldsChat(true, true) === true,
    "chat KV stays authoritative",
  );

  // S23 20t t4: notifyStaticPrefixInputs must not clearCache while chat KV
  // is held. Same skip boolean, inverted — do not duplicate the check.
  assert(
    shouldWipeKvOnPrefixInputChange(true) === false,
    "holds chat → do not wipe KV on prefix input change",
  );
  assert(
    shouldWipeKvOnPrefixInputChange(false) === true,
    "no chat KV → wipe+re-prewarm on prefix input change",
  );
  assert(
    shouldWipeKvOnPrefixInputChange(true) ===
      !shouldSkipPrewarmWhenKvHoldsChat(true),
    "wipe gate is the skip helper inverted (holds chat)",
  );
  assert(
    shouldWipeKvOnPrefixInputChange(false) ===
      !shouldSkipPrewarmWhenKvHoldsChat(false),
    "wipe gate is the skip helper inverted (empty KV)",
  );

  // Queued wipe-job recheck: same boolean, not a second inversion.
  assert(
    shouldApplyQueuedPrefixWipe(true) === false,
    "holds chat → queued wipe must not apply",
  );
  assert(
    shouldApplyQueuedPrefixWipe(false) === true,
    "empty KV → queued wipe may apply",
  );
  assert(
    shouldApplyQueuedPrefixWipe(true) === shouldWipeKvOnPrefixInputChange(true),
    "queued wipe helper is the planner wipe helper (holds chat)",
  );
  assert(
    shouldApplyQueuedPrefixWipe(false) === shouldWipeKvOnPrefixInputChange(false),
    "queued wipe helper is the planner wipe helper (empty KV)",
  );
  assert(
    shouldApplyQueuedPrefixWipe(true) ===
      !shouldSkipPrewarmWhenKvHoldsChat(true),
    "queued wipe helper is the skip helper inverted (holds chat)",
  );
  assert(
    shouldApplyQueuedPrefixWipe(false) ===
      !shouldSkipPrewarmWhenKvHoldsChat(false),
    "queued wipe helper is the skip helper inverted (empty KV)",
  );

  // notifyStaticPrefixInputs control flow: planner, not helper-only.
  // Order: hashSkip → kv holds → busy → wipe_and_queue.
  assert(
    planPrefixInputChange({ hashSkip: true, kvHoldsChat: false, busy: false }) ===
      "skip_hash",
    "hashSkip → skip_hash",
  );
  assert(
    planPrefixInputChange({ hashSkip: false, kvHoldsChat: true, busy: false }) ===
      "skip_kv_holds",
    "kv holds → skip_kv_holds",
  );
  assert(
    planPrefixInputChange({ hashSkip: false, kvHoldsChat: false, busy: true }) ===
      "skip_inflight",
    "busy → skip_inflight",
  );
  assert(
    planPrefixInputChange({ hashSkip: false, kvHoldsChat: false, busy: false }) ===
      "wipe_and_queue",
    "idle empty KV → wipe_and_queue",
  );
  assert(
    planPrefixInputChange({ hashSkip: false, kvHoldsChat: false, busy: true }) !==
      planPrefixInputChange({ hashSkip: false, kvHoldsChat: false, busy: false }),
    "skip_inflight is distinct from wipe_and_queue (reset cannot hide in busy path)",
  );
  assert(
    planPrefixInputChange({ hashSkip: true, kvHoldsChat: true, busy: true }) ===
      "skip_hash",
    "hashSkip wins over kv holds and busy",
  );
  assert(
    planPrefixInputChange({ hashSkip: false, kvHoldsChat: true, busy: true }) ===
      "skip_kv_holds",
    "kv holds wins over busy",
  );
  assert(
    planPrefixInputChange({ hashSkip: false, kvHoldsChat: true, busy: false }) ===
      (shouldWipeKvOnPrefixInputChange(true) ? "wipe_and_queue" : "skip_kv_holds"),
    "planner uses wipe helper — no duplicated boolean (holds chat)",
  );
  assert(
    planPrefixInputChange({ hashSkip: false, kvHoldsChat: false, busy: false }) ===
      (shouldWipeKvOnPrefixInputChange(false) ? "wipe_and_queue" : "skip_kv_holds"),
    "planner uses wipe helper — no duplicated boolean (empty KV)",
  );

  // ── Foreground re-kick contract (source assertions) ──────────────────────
  // queueStaticPrefixPrewarm refuses to run while the app is backgrounded, and
  // the only thing that made that safe was a foreground re-kick from AppShell
  // — which for one release did not exist. None of its other callers fires on
  // a foreground transition, so a slide that landed while backgrounded left
  // the prefix cold until the next slide or engine cycle.
  //
  // AppShell's AppState handler cannot be reached without rendering the shell,
  // so this pins the contract to a call site. Text presence alone was not
  // enough — `void` instead of `await`, an `if (false)` wrapper, a block
  // comment and a guard inserted ahead of the call all left it dead with the
  // gate green — so the rule here is stricter: comments are stripped and the
  // awaited call must be the FIRST statement of the branch. A guard added
  // ahead of it fails loudly on purpose: that changes WHEN the prefix is
  // re-warmed, which is the whole contract. What none of this can prove is
  // that the prefix ends up warm; that is a device run,
  // scripts/device-restore-protocol.sh (PREFIX_PREWARM restore_ok).
  const appShellSrc = readFileSync(
    path.join(projectRoot, "src/app/AppShell.tsx"),
    "utf8",
  );
  const llamaSrc = readFileSync(
    path.join(projectRoot, "src/engine/LlamaService.ts"),
    "utf8",
  );

  // Pin the refusal, not just its condition: dropping the `return;` while
  // keeping the `if` would let the prewarm run backgrounded, gate still green.
  const bgGuardAt = llamaSrc.indexOf('if (AppState.currentState !== "active") {');
  assert(bgGuardAt >= 0, "the prewarm still guards on a backgrounded AppState");
  const bgGuardEnd = llamaSrc.indexOf("\n  }", bgGuardAt);
  assert(bgGuardEnd > bgGuardAt, "the backgrounded guard block closes where expected");
  const bgGuard = llamaSrc.slice(bgGuardAt, bgGuardEnd);
  assert(
    bgGuard.includes('reason: "background"') && /\n\s*return;/.test(bgGuard),
    "the backgrounded prewarm still RETURNS — the reason the re-kick exists",
  );

  // The engine-ready line is NOT unique (ensureEngineForModel has the same
  // one), so bound the search by the foreground handler instead of trusting
  // the first hit: an anchor that drifts outside it must fail naming that,
  // not send the reader to the wrong function.
  const activeAt = appShellSrc.indexOf('if (state === "active")');
  assert(activeAt >= 0, 'AppShell has an AppState "active" branch');
  const handlerEnd = appShellSrc.indexOf("getAvailableMemoryBytesUncached()", activeAt);
  assert(handlerEnd > activeAt, "foreground handler end marker found");
  const branchAt = appShellSrc.indexOf(
    "if (isEngineReady() && getActiveModelId() === model.id) {",
    activeAt,
  );
  assert(
    branchAt > activeAt && branchAt < handlerEnd,
    "the engine-ready short-circuit is still inside the foreground handler",
  );
  const branch = appShellSrc
    .slice(branchAt, handlerEnd)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  const statements = branch
    .slice(branch.indexOf("{") + 1)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  assert(
    /^await queueStaticPrefixPrewarm\(/.test(statements[0] ?? ""),
    `the awaited prewarm must be the FIRST statement of the foreground branch — found: ${statements[0] ?? "<empty branch>"}`,
  );
  assert(
    statements.some((line) => line === "return;"),
    "the foreground branch still short-circuits with a return",
  );
  // The AppState effect mounts with [] deps: a captured `locale` would prewarm
  // the mount-time prefix and every later send would hash-miss it.
  assert(
    statements.some((line) => line.includes("localeRef.current")),
    "the re-kick reads the live locale, not the one captured at mount",
  );
  assert(
    appShellSrc.includes("localeRef.current = locale;"),
    "AppShell keeps localeRef fresh on every render",
  );

  // ── The prewarm job's stop policy ────────────────────────────────────────
  // Behaviour first: pinning the guard's text let a maintainer flip every
  // `return true` to `return false`, invert the chat-KV polarity, or comment
  // the check out, all with the gate green. The policy is pure now, so those
  // are real test failures rather than missing needles.
  const stop = (over) =>
    prewarmStopReason({
      genStale: false,
      disposing: false,
      contextChanged: false,
      kvHoldsChat: false,
      ...over,
    });
  assert(stop({}) === null, "nothing wrong → the job carries on");
  assert(stop({ genStale: true }) === "stale", "a bumped generation stops the job");
  assert(stop({ disposing: true }) === "disposing", "a dispose stops the job");
  assert(
    stop({ contextChanged: true }) === "no_context",
    "a swapped context stops the job",
  );
  assert(
    stop({ kvHoldsChat: true }) === "kv_holds_chat",
    "live chat KV stops the job — the chat is worth more than the prefix",
  );
  // Precedence, exactly as the three inline copies logged it.
  assert(
    stop({ genStale: true, disposing: true, contextChanged: true, kvHoldsChat: true }) ===
      "stale",
    "a stale generation outranks every other reason",
  );
  assert(
    stop({ disposing: true, contextChanged: true }) === "no_context",
    "context identity is the more specific fact when a dispose is also in flight",
  );
  assert(
    stop({ contextChanged: true, kvHoldsChat: true }) === "no_context",
    "context change outranks the chat hold",
  );
  assert(
    stop({ kvHoldsChat: true }) ===
      (shouldSkipPrewarmWhenKvHoldsChat(true) ? "kv_holds_chat" : null),
    "the stop policy uses the kv-holds helper — no duplicated boolean",
  );

  // Source side: the adapter must feed it the live module state, and EVERY
  // call site must survive. Three of the four used to be deletable silently.
  const adapterAt = llamaSrc.indexOf("const prewarmMustStop = (): boolean => {");
  assert(adapterAt >= 0, "the prewarm job still funnels its stops through one adapter");
  const adapterEnd = llamaSrc.indexOf("\n      };", adapterAt);
  assert(adapterEnd > adapterAt, "the adapter closes where expected");
  const adapter = llamaSrc.slice(adapterAt, adapterEnd);
  for (const needle of [
    "genStale: gen !== prewarmGeneration",
    "disposing,",
    "contextChanged: context !== engine",
    "kvHoldsChat: kvHoldsChatSession",
    "if (reason === null) return false;",
  ]) {
    assert(adapter.includes(needle), `the adapter still passes/uses ${needle}`);
  }
  const callSites = (llamaSrc.match(/if \(prewarmMustStop\(\)\) return;/g) || []).length;
  assert(
    callSites === 4,
    `every act that touches the native KV is still guarded — expected 4 call sites, found ${callSites}`,
  );
  // The restore replaces the native KV; its guard must come BEFORE it, which
  // is the whole of finding F4. Nearest preceding statement, comments stripped.
  const restoreAt = llamaSrc.indexOf("const restored = await restoreStaticPrefixSnapshot(");
  assert(restoreAt >= 0, "the snapshot restore is still called from the prewarm job");
  const beforeRestore = llamaSrc
    .slice(adapterEnd, restoreAt)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  assert(
    beforeRestore[beforeRestore.length - 1] === "if (prewarmMustStop()) return;",
    `the statement before the snapshot restore must be the stop guard — found: ${beforeRestore[beforeRestore.length - 1] ?? "<nothing>"}`,
  );

  // ...and the restore asks again immediately before the native load, because
  // everything it awaits first (stat, .bak promotion of the same 12.6 MB file,
  // .tmp delete, meta read) can outlive the context the job was called for.
  // jest covers the behaviour, but jest does not run on a push to main.
  const snapshotSrc = readFileSync(
    path.join(projectRoot, "src/engine/staticPrefixSnapshot.ts"),
    "utf8",
  );
  const loadAt = snapshotSrc.indexOf("const result = await ctx.loadSession(");
  assert(loadAt >= 0, "the snapshot restore still issues a native loadSession");
  const beforeLoad = snapshotSrc
    .slice(0, loadAt)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  assert(
    beforeLoad[beforeLoad.length - 1] ===
      'if (mustStop()) return { ok: false, stem, reason: "aborted" };',
    `the statement before the native loadSession must be the abort check — found: ${beforeLoad[beforeLoad.length - 1] ?? "<nothing>"}`,
  );

  // ── Retry budget for a prewarm that keeps failing ────────────────────────
  // The foreground re-kick made this concrete: without a budget, a model whose
  // template or engine path refuses this render pays a full ~1832-token
  // prefill on every single return to the app.
  assert(STATIC_PREFIX_PREWARM_MAX_FAILURES === 2, "two attempts, then stop");
  assert(
    prewarmFailureIsPersistent("failed") === true,
    "an engine that refuses the render will refuse it again",
  );
  assert(
    prewarmFailureIsPersistent("generated") === true,
    "a template that generates under n_predict:0 will do it again",
  );
  assert(
    prewarmFailureIsPersistent("skip") === false,
    "an interrupted completion says nothing about the model — retry it",
  );
  assert(
    prewarmFailureIsPersistent("success") === false,
    "success is not a failure",
  );
  assert(prewarmGivenUp(0) === false, "first attempt is allowed");
  assert(prewarmGivenUp(1) === false, "second attempt is allowed");
  assert(prewarmGivenUp(2) === true, "third attempt is not");
  assert(prewarmGivenUp(3) === true, "and neither is any after it");
  assert(
    prewarmGivenUp(STATIC_PREFIX_PREWARM_MAX_FAILURES) === true,
    "the cap is the cap — no off-by-one between the constant and the predicate",
  );

  // The budget has exactly one writer, in the job's finally. Two writers is
  // how a new failure exit ends up forgetting to record itself — the defect
  // this budget exists to prevent, one level up.
  // Substring pins were not a contract here either: the guard kept its log and
  // lost its `return;`, the increment became `+ 0`, the finally's branch was
  // wrapped in `if (false)`, and the success flags were deleted — all with the
  // gate green and the budget completely ineffective. These two regions are
  // load-bearing, so they are pinned by SHAPE. Whitespace is normalised and
  // comments stripped, so reformatting is fine; changing what the code does is
  // not, and if you meant it, update the expectation here and say why.
  const shapeOf = (text) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim();
  const regionBetween = (from, to) => {
    const a = llamaSrc.indexOf(from);
    assert(a >= 0, `region start not found: ${from}`);
    const b = llamaSrc.indexOf(to, a);
    assert(b > a, `region end not found after ${from}`);
    return shapeOf(llamaSrc.slice(a, b + to.length));
  };

  const queueGuard = regionBetween(
    "if (prewarmGivenUp(staticPrefixPrewarmFailures.get(",
    "return;\n  }",
  );
  assert(
    queueGuard ===
      'if (prewarmGivenUp(staticPrefixPrewarmFailures.get(prewarmBudgetKey(prefix.hash)) ?? 0)) ' +
        '{ logPrewarm({ op: "skip", reason: "given_up", hash: prefix.hash }); return; }',
    `the queue guard must log AND return, keyed on this prefix — found: ${queueGuard}`,
  );

  const budgetUpdate = regionBetween(
    "const budgetKey = prewarmBudgetKey(prefix.hash);",
    "+ 1,\n        );\n      }",
  );
  assert(
    budgetUpdate ===
      "const budgetKey = prewarmBudgetKey(prefix.hash); if (succeeded) { " +
        "staticPrefixPrewarmFailures.delete(budgetKey); } else if (persistentFailure) { " +
        "staticPrefixPrewarmFailures.set( budgetKey, " +
        "(staticPrefixPrewarmFailures.get(budgetKey) ?? 0) + 1, ); }",
    `the budget update must clear on success and increment by one otherwise — found: ${budgetUpdate}`,
  );

  const budgetWrites = (llamaSrc.match(/staticPrefixPrewarmFailures\.(set|delete|clear)\(/g) || []).length;
  assert(
    budgetWrites === 3,
    `the retry budget has exactly three writers — the job's finally (set + delete) and resetPrewarmState (clear) — found ${budgetWrites}`,
  );
  assert(
    llamaSrc.includes("persistentFailure = prewarmFailureIsPersistent(resultClass);"),
    "the completion path decides persistence with the pure classifier",
  );
  const successFlags = (llamaSrc.match(/^\s*succeeded = true;$/gm) || []).length;
  assert(
    successFlags === 2,
    `both success paths — snapshot restore and prefill — must clear the budget; found ${successFlags} of 2`,
  );
  const resetAt = llamaSrc.indexOf("function resetPrewarmState(): void {");
  assert(resetAt >= 0, "resetPrewarmState still exists");
  const resetEnd = llamaSrc.indexOf("\n}", resetAt);
  assert(
    llamaSrc.slice(resetAt, resetEnd).includes("staticPrefixPrewarmFailures.clear()"),
    "an engine cycle forgets the budget — a native failure can be transient",
  );
  // The failure that a dispose caused is not the model's fault: stopCompletion
  // rejects the completion promise, and that rejection reaches the catch
  // looking exactly like a native error.
  const catchAt = llamaSrc.indexOf("      persistentFailure =\n        prewarmStopReason({");
  assert(
    catchAt >= 0,
    "the catch decides persistence via the stop policy, not unconditionally",
  );
  assert(
    llamaSrc.slice(catchAt, catchAt + 400).includes("contextChanged: context !== jobEngine"),
    "the catch compares against the context THIS job was started for",
  );

  // ── The device run's verdict, against fixtures ───────────────────────────
  // It used to be a `node -e` string inside device-restore-protocol.sh, so the
  // only way to find out whether a counter was right was to run a phone.
  const verdict = (name, evidence) => {
    const file = path.join(outDir, `evidence-${name}.txt`);
    writeFileSync(file, evidence, "utf8");
    const r = spawnSync("node", [path.join(projectRoot, "scripts/restoreVerdict.mjs"), file], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    assert(r.status === 0, `restoreVerdict.mjs exited ${r.status} on ${name}: ${r.stderr}`);
    return r.stdout;
  };

  // The §4 pass shape: the whole prefix was reused and nothing was lost.
  const pass = verdict(
    "pass",
    [
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      'KALSA_PREWARM {"op":"done"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(/restore_ok=1 /.test(pass), "a successful restore is counted");
  assert(
    /whole_cache_reused=1 partial_reuse=0 total_loss=0 /.test(pass),
    "n_common === embd is the whole cache reused, and no loss",
  );
  assert(
    /KV_PREFIX_CRITERION: PASS/.test(pass),
    "the §4 pass shape is reported as a pass",
  );

  // whole_cache_reused >= 1 IS the pass criterion, so a partial reuse must
  // never count as a whole one — a looser verdict turns a failed device run
  // into a green one. Nor is a partial reuse a total loss.
  const partial = verdict(
    "partial",
    [
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=900",
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=0",
      "",
    ].join("\n"),
  );
  assert(
    /rows=2 whole_cache_reused=0 partial_reuse=1 total_loss=1 /.test(partial),
    "900 of 1832 reused is neither the whole cache nor a total loss",
  );
  assert(
    /best n_common=900 /.test(partial),
    "the best row is reported so a partial reuse is still legible",
  );
  assert(
    partial.includes(
      "KV_PREFIX_CRITERION: FAIL (no cycle reused the whole cache; partial reuse x1; " +
        "total loss x1; no prewarm restore or prefill happened)",
    ),
    "the criterion names EVERY reason it failed, not just the first",
  );

  // The counter-example that mattered: one whole cycle can otherwise carry a
  // run where most cycles reused a quarter of the cache. A run is not a pass
  // because ONE of its cycles was.
  const mixed = verdict(
    "mixed",
    [
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=900",
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=400",
      "",
    ].join("\n"),
  );
  assert(
    /whole_cache_reused=1 partial_reuse=2 total_loss=0/.test(mixed),
    "one whole cycle and two partials are reported as what they are",
  );
  assert(
    /KV_PREFIX_CRITERION: FAIL \(partial reuse x2\)/.test(mixed),
    "one good cycle out of three is a FAIL — the criterion must not be looser than stated",
  );

  // ...and a run where the numbers look perfect but no prewarm ever ran is not
  // a measurement of anything.
  const noPrewarm = verdict(
    "no-prewarm",
    ["KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832", ""].join("\n"),
  );
  assert(
    /KV_PREFIX_CRITERION: FAIL \(no prewarm restore or prefill happened\)/.test(noPrewarm),
    "whole reuse with no prewarm in the log proves nothing about the prewarm",
  );

  // The case the stop counters exist for: zero restores because the job kept
  // being stopped, which must NOT read as "the diagnosis is wrong".
  const blocked = verdict(
    "blocked",
    [
      'KALSA_PREWARM {"op":"skip","reason":"background"}',
      'KALSA_PREWARM {"op":"skip","reason":"kv_holds_chat"}',
      'KALSA_PREWARM {"op":"skip","reason":"given_up","hash":"h"}',
      'KALSA_PREWARM {"op":"restore","ok":false,"reason":"aborted","hash":"h"}',
      "",
    ].join("\n"),
  );
  assert(/restore_ok=0 /.test(blocked), "no restore succeeded in the blocked run");
  assert(
    /background=1 /.test(blocked) &&
      /kv_holds_chat=1 /.test(blocked) &&
      /given_up=1 /.test(blocked) &&
      /restore_aborted=1/.test(blocked),
    "every reason the job stopped is visible in PREWARM_STOPS",
  );

  // A run that produced nothing must say so, not divide by zero.
  const noEvidence = verdict("empty", "");
  assert(
    /KV_PREFIX: no KALSA_KVPREFIX line with a live cache/.test(noEvidence),
    "an empty evidence file states that, and does not crash",
  );
  assert(/restore_ok=0 /.test(noEvidence), "empty evidence counts zero restores");

  console.log("prefixPrewarmHarness OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
