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
  // awaited call must be the FIRST statement of the branch. Honest limit:
  // the pin only sees INSIDE the branch — its search starts at the branch's
  // `if`, so a guard placed AHEAD of the branch stays invisible to it (the
  // thermal hard gate, thermalHardGateRef, really does return before the
  // re-kick when armed, with this pin green). What none of this can prove is
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

  // The key is bound once at queue time: dispose nulls activeModelId before
  // the job's finally runs, and initEngine sets it a few awaits after the
  // context exists, so a key read live at either end lands under ":<hash>" and
  // is never read again — the failure silently stops counting.
  const queueGuard = regionBetween(
    "const budgetKey = prewarmBudgetKey(prefix.hash);",
    "return;\n  }",
  );
  assert(
    queueGuard ===
      "const budgetKey = prewarmBudgetKey(prefix.hash); " +
        "if (prewarmGivenUp(staticPrefixPrewarmFailures.get(budgetKey) ?? 0)) " +
        '{ logPrewarm({ op: "skip", reason: "given_up", hash: prefix.hash }); return; }',
    `the queue guard binds the key once, logs AND returns — found: ${queueGuard}`,
  );
  assert(
    (llamaSrc.match(/prewarmBudgetKey\(/g) || []).length === 2,
    "prewarmBudgetKey is called in exactly one place besides its declaration",
  );

  const budgetUpdate = regionBetween(
    "if (succeeded) {\n        staticPrefixPrewarmFailures.delete(budgetKey);",
    "+ 1,\n        );\n      }",
  );
  assert(
    budgetUpdate ===
      "if (succeeded) { staticPrefixPrewarmFailures.delete(budgetKey); } " +
        "else if (persistentFailure) { staticPrefixPrewarmFailures.set( budgetKey, " +
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
  const verdictRaw = (name, evidence) => {
    const file = path.join(outDir, `evidence-${name}.txt`);
    writeFileSync(file, evidence, "utf8");
    return spawnSync("node", [path.join(projectRoot, "scripts/restoreVerdict.mjs"), file], {
      cwd: projectRoot,
      encoding: "utf8",
    });
  };
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
  // FAIL fixtures go through verdictFail: the exit contract is that a FAIL
  // criterion prints AND exits 1, so every one of them asserts the status
  // explicitly — verdict() above stays strict on 0, which is what keeps
  // proving that the PASS fixtures really exit 0. Exit 1 (measured, broken)
  // and exit 2 (empty evidence, not a measurement) are different codes and
  // the fixtures below pin both.
  const verdictFail = (name, evidence) => {
    const r = verdictRaw(name, evidence);
    assert(
      r.status === 1,
      `${name}: a FAIL criterion must exit 1 — got ${r.status}: ${r.stderr}`,
    );
    return r.stdout;
  };

  // Golden real evidence from the S23 run. Every line was checked to carry a
  // KALSA_* tag; this build emits no KVDIVERGE ids/shared_txt conversation.
  const realEvidenceGolden = [
    `09-18 03:24:40.810 I/KALSA_RP_MARK(30795): cycle=1`,
    `09-18 03:24:47.767 I/ReactNativeJS(30901): KALSA_SESSION {"op":"init","no_extra_bufts":0}`,
    `09-18 03:24:53.771 I/ReactNativeJS(30901): KALSA_SESSION {"op":"load","ms":59,"ok":false,"tokensOnDisk":0,"stem":"<redacted>","reason":"meta_mismatch:stale_kv_completed_turn"}`,
    `09-18 03:24:53.772 I/ReactNativeJS(30901): 'KALSA_KVDIAG', '{"n_past":0,"tokens_on_disk":0,"ok":false}'`,
    `09-18 03:24:53.814 I/ReactNativeJS(30901): 'KALSA_PREWARM', '{"op":"start","hash":"3586270056","systemChars":3969,"toolCount":5}'`,
    `09-18 03:24:53.834 W/RNLlama (30901): loadPrompt:521 KALSA_KVPREFIX embd=0 text_tokens=1832 n_common=0 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb4000075034dd200`,
    `09-18 03:24:58.184 I/KALSA_RP_MARK(31085): fg_bounce_home cycle=1`,
    `09-18 03:25:18.747 I/KALSA_RP_MARK(31150): fg_kick cycle=1`,
    `09-18 03:26:43.354 I/ReactNativeJS(30901): 'KALSA_PREWARM', '{"op":"done","promptMs":109512.008,"promptN":1832,"hash":"3586270056"}'`,
    `09-18 03:26:43.355 I/ReactNativeJS(30901): KALSA_SESSION {"op":"save","ms":0,"ok":false,"estimatedBytes":0,"usedTokens":-1,"reason":"kv_not_chat"}`,
    `09-18 03:26:43.355 I/ReactNativeJS(30901): KALSA_SESSION {"op":"save","ms":0,"ok":false,"estimatedBytes":0,"usedTokens":-1,"reason":"kv_not_chat"}`,
    `09-18 03:26:44.066 I/KALSA_RP_MARK(31331): fg_settled cycle=1`,
    `09-18 03:26:48.930 I/ReactNativeJS(30901): KALSA_SESSION {"op":"save","ms":0,"ok":false,"estimatedBytes":0,"usedTokens":-1,"reason":"kv_not_chat"}`,
    `09-18 03:26:49.012 I/ReactNativeJS(30901): KALSA_SESSION {"op":"save","ms":0,"ok":false,"estimatedBytes":0,"usedTokens":-1,"reason":"kv_not_chat"}`,
    `09-18 03:27:02.395 W/RNLlama (30901): loadPrompt:521 KALSA_KVPREFIX embd=1832 text_tokens=4906 n_common=1829 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb4000075034dd200`,
    `09-18 03:27:02.395 W/RNLlama (30901): loadPrompt:539 KALSA_KVDIVERGE n_common=1829 shared_lo=1821 embd_hi=1832 text_hi=1841`,
    `09-18 03:27:02.395 W/RNLlama (30901): loadPrompt:627 KALSA_KVREUSE checkpoint n_past=1827 prompt=4906 n_common=1829`,
    `09-18 03:30:47.788 I/ReactNativeJS(30901): KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":5359,"tokensEvaluated":4906,"tokensPredicted":452,"draftTokens":0,"draftAccepted":0,"promptMs":134461.601,"predictedMs":90840.56599999999,"predictedPerSecond":4.975750591426302,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":3079,"ciswireFlags":1}`,
    `09-18 03:30:47.983 I/ReactNativeJS(30901): KALSA_SESSION {"op":"save","ms":156,"ok":true,"estimatedBytes":36116476,"usedTokens":5359,"stem":"<redacted>","tokens":5359,"hash":"3666333890","messageCount":21}`,
    `09-18 03:30:55.326 I/KALSA_RP_MARK(32395): cycle=2`,
    `09-18 03:31:02.245 I/ReactNativeJS(32497): KALSA_SESSION {"op":"init","no_extra_bufts":0}`,
    `09-18 03:31:08.635 W/RNLlama (32497): loadSession:108 KALSA_KVRESUME n_tokens=5359 pos_max=5358 mrope_media=0 is_recurrent=0 is_hybrid=1 n_swa=0 resumable=1`,
    `09-18 03:31:08.640 I/ReactNativeJS(32497): KALSA_SESSION {"op":"load","ms":129,"ok":true,"tokensOnDisk":5359,"stem":"<redacted>","tokens":5359}`,
    `09-18 03:31:08.640 I/ReactNativeJS(32497): 'KALSA_KVDIAG', '{"n_past":5359,"tokens_on_disk":5359,"ok":true}'`,
    `09-18 03:31:08.662 I/ReactNativeJS(32497): 'KALSA_PREWARM', '{"op":"skip","reason":"kv_holds_chat"}'`,
    `09-18 03:31:12.557 I/KALSA_RP_MARK(32675): fg_bounce_home cycle=2`,
    `09-18 03:31:12.956 I/ReactNativeJS(32497): KALSA_SESSION {"op":"save","ms":223,"ok":true,"estimatedBytes":36116476,"usedTokens":5359,"stem":"<redacted>","tokens":5359,"hash":"3666333890","messageCount":21}`,
    `09-18 03:31:33.148 I/KALSA_RP_MARK(  388): fg_kick cycle=2`,
    `09-18 03:31:33.307 I/ReactNativeJS(32497): KALSA_SESSION {"op":"save","ms":1,"ok":true,"estimatedBytes":36116476,"usedTokens":5359,"stem":"<redacted>","reason":"unchanged"}`,
    `09-18 03:33:47.275 I/KALSA_RP_MARK( 1029): fg_settled cycle=2`,
    `09-18 03:33:52.221 I/ReactNativeJS(32497): KALSA_SESSION {"op":"save","ms":3,"ok":true,"estimatedBytes":36116476,"usedTokens":5359,"stem":"<redacted>","reason":"unchanged"}`,
    `09-18 03:33:52.316 I/ReactNativeJS(32497): KALSA_SESSION {"op":"save","ms":2,"ok":true,"estimatedBytes":36116476,"usedTokens":5359,"stem":"<redacted>","reason":"unchanged"}`,
    `09-18 03:34:04.719 I/ReactNativeJS(32497): 'KALSA_PREWARM', '{"op":"skip","reason":"kv_holds_chat"}'`,
    `09-18 03:34:04.727 I/ReactNativeJS(32497): KALSA_SESSION {"op":"window_align","from":13,"to":6}`,
    `09-18 03:34:04.786 I/ReactNativeJS(32497): 'KALSA_PREWARM', '{"match":false,"reason":"kv_holds_chat","prewarm":null,"send":"3586270056"}'`,
    `09-18 03:34:04.828 W/RNLlama (32497): loadPrompt:521 KALSA_KVPREFIX embd=5359 text_tokens=5382 n_common=5359 mtp_draft_mem_shared=0 is_enc_dec=0 this=0xb400007512d3cd00`,
    `09-18 03:35:27.976 I/ReactNativeJS(32497): KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":5697,"tokensEvaluated":5382,"tokensPredicted":314,"draftTokens":0,"draftAccepted":0,"promptMs":725.3720000000001,"predictedMs":82325.947,"predictedPerSecond":3.8141073554853855,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":23,"ciswireFlags":1}`,
    `09-18 03:35:28.160 I/ReactNativeJS(32497): KALSA_SESSION {"op":"save","ms":128,"ok":true,"estimatedBytes":38371612,"usedTokens":5697,"stem":"<redacted>","tokens":5697,"hash":"2526768741","messageCount":23}`,
  ].join("\n");
  const sessionUnknownReason = verdictFail(
    "session-unknown-reason",
    [
      'KALSA_SESSION {"op":"load","ms":7,"ok":false,"reason":"new_refusal_reason"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(
    /SESSION: loads_ok=0 loads_refused=1 load_refused_by_reason=new_refusal_reason x1/.test(
      sessionUnknownReason,
    ),
    "an unseen session refusal reason is named instead of folded into a catch-all",
  );
  const realEvidence = verdictRaw("real-evidence-golden", realEvidenceGolden);
  assert(realEvidence.status === 1, `real evidence must exit 1 — got ${realEvidence.status}`);
  const expectedRealEvidence = [
    `PREFIX_PREWARM: restore_ok=0 restore_miss=0 prefill_done=1 snapshot_saved=0 system_only_template=0`,
    `PREWARM_PARSE: unparsed=0 PASS`,
    `PREWARM_STOPS: stale=0 no_context=0 disposing=0 kv_holds_chat=2 background=0 given_up=0 not_ready=0 in_flight=0 already_warm=0 restore_aborted=0`,
    `PREFIX_MATCH: miss=0 kv_holds_chat=1`,
    `SESSION: loads_ok=1 loads_refused=1 load_refused_by_reason=meta_mismatch:stale_kv_completed_turn x1 saves_ok=6 saves_refused=4 save_refused_by_reason=kv_not_chat x4 best_load_ms=129 best_load_tokens_on_disk=5359`,
    `KV_PREFIX: rows=2 whole_cache_reused=1 partial_reuse=1 total_loss=0 cold_start=1 cold_start_field=stale_kv_completed_turn late_cold_start=0 late_cold_start_field=none best n_common=5359 embd=5359 text_tokens=5382 min_embd=1832`,
    `KV_PER_CYCLE: cycle=1 embd=1832 text=4906 n_common=1829 promptMs=134461.601 class=partial`,
    `KV_PER_CYCLE: cycle=2 embd=5359 text=5382 n_common=5359 promptMs=725.3720000000001 class=whole`,
    `KV_PREFIX_CRITERION: FAIL (partial reuse x1)`,
    `KV_DIVERGE: rows=1 cache_ended_inside_window=1 cache_ended_after=3 x1`,
    `KV_DIVERGE_END: cache_ended_after=3 n_common=1829 embd_hi=1832`,
    `KV_FALLBACK: checkpoint_recover=1 no_usable_checkpoint=0`,
    `FG_REKICK: kicks=2 served=1 warm=0 held=0 stopped=0 no_work=0 too_early=0 silent=1`,
    `FG_REKICK_CRITERION: FAIL (re-kick produced no prewarm line x1)`,
  ].join("\n") + "\n";
  assert(realEvidence.stdout === expectedRealEvidence, "real evidence golden output changed");

  // A live row before and after foreground markers must stay in one cycle.
  // The loose KALSA_RP_MARK.*cycle= matcher would split this into two rows.
  const markerGuard = verdictRaw(
    "cycle-marker-guard",
    [
      "I/KALSA_RP_MARK(100): cycle=1",
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=900",
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      "KALSA_TELEMETRY promptMs=10",
      "I/KALSA_RP_MARK(100): fg_settled cycle=1",
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(markerGuard.status === 1, "cycle marker guard must be a measured FAIL");
  const markerGuardRows = markerGuard.stdout.match(/^KV_PER_CYCLE:.*$/gm) ?? [];
  assert(
    markerGuardRows.length === 1 &&
      markerGuardRows[0] ===
        "KV_PER_CYCLE: cycle=1 embd=1832 text=1832 n_common=1832 promptMs=n/a class=whole",
    "foreground markers do not open extra cycle windows",
  );

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
  assert(pass.includes("SESSION: no KALSA_SESSION lines"), "missing session evidence is named");
  assert(
    /whole_cache_reused=1 partial_reuse=0 total_loss=0 cold_start=0 cold_start_field=none late_cold_start=0 late_cold_start_field=none /.test(pass),
    "n_common === embd is the whole cache reused, and no loss",
  );
  assert(
    /KV_PREFIX_CRITERION: PASS/.test(pass),
    "the §4 pass shape is reported as a pass",
  );

  // React Native console.log emits KALSA_PREWARM as two quoted arguments,
  // unlike the bare wire shape used by the older fixtures. Keep this fixture
  // free of bare prewarm lines so the quoted parser contract is load-bearing.
  const realWireShape = verdict(
    "real-wire-shape",
    [
      'I ReactNativeJS: \'KALSA_PREWARM\', \'{"op":"restore","ok":true,"tokens":1832,"hash":"h"}\'',
      'I ReactNativeJS: \'KALSA_PREWARM\', \'{"op":"done","promptMs":12,"promptN":1832,"hash":"h"}\'',
      'I ReactNativeJS: \'KALSA_PREWARM\', \'{"op":"skip","reason":"kv_holds_chat"}\'',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(
    /PREFIX_PREWARM: restore_ok=1 restore_miss=0 prefill_done=1 /.test(realWireShape),
    "the real quoted prewarm restore and done shape is parsed",
  );
  assert(
    /kv_holds_chat=1 /.test(realWireShape),
    "the real quoted prewarm skip reason is parsed",
  );
  assert(
    /KV_PREFIX: rows=2 whole_cache_reused=2 partial_reuse=0 total_loss=0 /.test(realWireShape) &&
      /KV_PREFIX_CRITERION: PASS/.test(realWireShape),
    "the real KVPREFIX pair has the same pass semantics as the bare shape",
  );

  // A third React Native console.log argument must not hide a prefix miss.
  const trailingPrewarmArgument = verdictFail(
    "trailing-prewarm-argument",
    [
      'I ReactNativeJS: \'KALSA_PREWARM\', \'{"op":"restore","ok":true,"tokens":1832,"hash":"h"}\'',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      'I ReactNativeJS: \'KALSA_PREWARM\', \'{"match":false,"reason":"prefix_miss","prewarm":"h1","send":"h2"}\', \'note\'',
    ].join("\n"),
  );
  assert(
    /PREFIX_MATCH: miss=1 kv_holds_chat=0/.test(trailingPrewarmArgument) &&
      /KV_PREFIX_CRITERION: FAIL \(prefix hash miss on the send path x1\)/.test(
        trailingPrewarmArgument,
      ),
    "a trailing console.log argument cannot hide a prefix miss",
  );

  // The React Native console polyfill leaves an apostrophe escaped inside the
  // quoted JSON argument. The verdict must undo that wrapper escaping first.
  const apostrophePrewarm = verdict(
    "apostrophe-prewarm",
    [
      'I ReactNativeJS: \'KALSA_PREWARM\', \'{"op":"restore","ok":true,"tokens":1832,"hash":"h"}\'',
      `I ReactNativeJS: 'KALSA_PREWARM', '{"op":"done","err":"engine can\\'t load"}'`,
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
    ].join("\n"),
  );
  assert(
    /PREFIX_PREWARM: restore_ok=1 restore_miss=0 prefill_done=1 /.test(apostrophePrewarm) &&
      /PREWARM_PARSE: unparsed=0 PASS/.test(apostrophePrewarm),
    "an apostrophe escaped by the React Native polyfill is parsed and counted",
  );

  // A tagged line that is not parseable is evidence that the verdict did not
  // fully measure the run, so it must be named and fail the exit contract.
  const unparsedPrewarm = verdictFail(
    "unparsed-prewarm",
    [
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "KALSA_PREWARM {not-json",
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
    ].join("\n"),
  );
  assert(
    /PREWARM_PARSE: unparsed=1 FAIL/.test(unparsedPrewarm),
    "an unparsed KALSA_PREWARM line is named and counted",
  );

  // KALSA_KVDIVERGE's bounds are a fixed 12-token diagnostic window. The
  // first row saturates it, the second ends inside it and has a multi-line
  // ids record, and the third ends inside it without an ids record.
  const kvDiverge = verdict(
    "kv-diverge",
    [
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "09-17 10:00:00.000 1 2 W RNLlama : loadPrompt:519 KALSA_KVDIVERGE n_common=100 shared_lo=92 embd_hi=112 text_hi=112",
      "09-17 10:00:00.000 1 2 W RNLlama : loadPrompt:523 KALSA_KVDIVERGE ids shared=[1 2 ] embd=[90 91 ] text=[3 4 ] shared_txt=[first",
      "09-17 10:00:00.000 1 2 W RNLlama : continuation of shared_txt",
      "09-17 10:00:00.000 1 2 W RNLlama : loadPrompt:501 KALSA_KVDIVERGE n_common=10 shared_lo=2 embd_hi=13 text_hi=22",
      "09-17 10:00:00.000 1 2 W RNLlama : loadPrompt:523 KALSA_KVDIVERGE ids shared=[5 6 ] embd=[22 124900 207 ] text=[7 8 ] shared_txt=[second",
      "09-17 10:00:00.000 1 2 W RNLlama : continuation of shared_txt",
      "09-17 10:00:00.000 1 2 W RNLlama : loadPrompt:484 KALSA_KVDIVERGE n_common=5 shared_lo=0 embd_hi=10 text_hi=17",
      "",
    ].join("\n"),
  );
  assert(
    /KV_DIVERGE: rows=3 cache_ended_inside_window=2 cache_ended_after=3 x1, 5 x1/.test(kvDiverge),
    "saturated and ended-inside KVDIVERGE rows are distinguished",
  );
  assert(
    /KV_DIVERGE_END: cache_ended_after=3 n_common=10 embd_hi=13 embd=\[22 124900 207 \]/.test(kvDiverge),
    "the ended row keeps its matching embd ids verbatim",
  );
  assert(
    /KV_DIVERGE_END: cache_ended_after=5 n_common=5 embd_hi=10\n/.test(kvDiverge),
    "an ended row without ids remains legible",
  );
  assert(!kvDiverge.includes("text_hi="), "KV_DIVERGE does not report the fixed text bound");

  const kvDivergeSaturated = verdict(
    "kv-diverge-saturated",
    [
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "09-17 10:00:00.000 1 2 W RNLlama : loadPrompt:519 KALSA_KVDIVERGE n_common=100 shared_lo=92 embd_hi=112 text_hi=112",
      "",
    ].join("\n"),
  );
  assert(
    /KV_DIVERGE: rows=1 cache_ended_inside_window=0\nKV_DIVERGE: all rows saturated the 12-token window; rows carry no end-of-cache evidence/.test(
      kvDivergeSaturated,
    ),
    "a fully saturated KVDIVERGE run says it has no end-of-cache evidence",
  );

  // whole_cache_reused >= 1 IS the pass criterion, so a partial reuse must
  // never count as a whole one — a looser verdict turns a failed device run
  // into a green one. Nor is a partial reuse a total loss.
  const partial = verdictFail(
    "partial",
    [
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=900",
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=0",
      "",
    ].join("\n"),
  );
  assert(
    /rows=2 whole_cache_reused=0 partial_reuse=1 total_loss=1 cold_start=0 cold_start_field=none late_cold_start=0 late_cold_start_field=none /.test(partial),
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
  const mixed = verdictFail(
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
    /whole_cache_reused=1 partial_reuse=2 total_loss=0 cold_start=0 cold_start_field=none late_cold_start=0 late_cold_start_field=none/.test(mixed),
    "one whole cycle and two partials are reported as what they are",
  );
  assert(
    /KV_PREFIX_CRITERION: FAIL \(partial reuse x2\)/.test(mixed),
    "one good cycle out of three is a FAIL — the criterion must not be looser than stated",
  );

  // ...and a run where the numbers look perfect but no prewarm ever ran is not
  // a measurement of anything.
  const noPrewarm = verdictFail(
    "no-prewarm",
    ["KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832", ""].join("\n"),
  );
  assert(
    /KV_PREFIX_CRITERION: FAIL \(no prewarm restore or prefill happened\)/.test(noPrewarm),
    "whole reuse with no prewarm in the log proves nothing about the prewarm",
  );

  // The case the stop counters exist for: zero restores because the job kept
  // being stopped, which must NOT read as "the diagnosis is wrong".
  const blocked = verdictFail(
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
  // blocked has no live-cache row at all: with the criterion now always
  // printed, that shape must name the absence instead of ending without a
  // verdict — three sections and no criterion read like a pass-by-silence.
  assert(
    /KV_PREFIX_CRITERION: FAIL \(no live-cache measurement in this run\)/.test(blocked),
    "a run with prewarm lines but no live cache gets a criterion, not silence",
  );

  // THE fixture for the worst failure shape of the feature: the prewarm
  // reports a full success (restore_ok, done, whole-cache reuse) while the
  // send hashed a DIFFERENT prefix. The match:false payload has no "op"
  // field, so nothing else in the verdict ever counted it — before
  // PREFIX_MATCH and the criterion reason existed, this evidence PASSED.
  const prefixMiss = verdictFail(
    "prefix-miss",
    [
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h1"}',
      'KALSA_PREWARM {"op":"done"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      'KALSA_PREWARM {"match":false,"reason":"prefix_miss","prewarm":"h1","send":"h2"}',
      "",
    ].join("\n"),
  );
  assert(
    /PREFIX_MATCH: miss=1 kv_holds_chat=0/.test(prefixMiss),
    "the send-path prefix_miss is counted despite having no op field",
  );
  assert(
    /KV_PREFIX_CRITERION: FAIL \(prefix hash miss on the send path x1\)/.test(prefixMiss),
    "a perfect-looking reuse run fails on the send-path hash miss",
  );

  // match:false with kv_holds_chat is NOT a defect: the KV held a chat, so
  // the static prefix was deliberately not what was cached. Counted, and the
  // otherwise-perfect run stays a pass.
  const matchKvHolds = verdict(
    "match-kv-holds",
    [
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h1"}',
      'KALSA_PREWARM {"op":"done"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      'KALSA_PREWARM {"match":false,"reason":"kv_holds_chat","prewarm":"h1","send":"h2"}',
      "",
    ].join("\n"),
  );
  assert(
    /PREFIX_MATCH: miss=0 kv_holds_chat=1/.test(matchKvHolds),
    "a match:false kv_holds_chat line is counted without failing",
  );
  assert(
    /KV_PREFIX_CRITERION: PASS/.test(matchKvHolds),
    "the KV holding a chat is not a prefix failure",
  );

  // Evidence with prewarm lines but not a single live-cache row: the reuse
  // question was never measured, so the criterion must SAY so instead of
  // staying silent. The exit code stays 0 — criteria print; only the empty
  // evidence exits non-zero.
  const noKvPrefix = verdictFail(
    "no-kvprefix",
    [
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      'KALSA_PREWARM {"op":"done"}',
      "",
    ].join("\n"),
  );
  assert(
    /KV_PREFIX: no KALSA_KVPREFIX line with a live cache/.test(noKvPrefix),
    "the missing live cache is still reported on its own line",
  );
  assert(
    /KV_PREFIX_CRITERION: FAIL \(no live-cache measurement in this run\)/.test(noKvPrefix),
    "a run that never measured reuse fails the criterion instead of silence",
  );

  // The announced engine identity change is a cold start on cycle 1 only:
  // the old snapshot was read, rejected by its metadata, and regenerated.
  const firstColdThenWarm = verdict(
    "first-cold-then-warm",
    [
      "KALSA_RP_MARK cycle=1",
      'KALSA_PREWARM {"op":"restore","ok":false,"reason":"meta_mismatch:engineBuild","deleted":true}',
      'KALSA_PREWARM {"op":"done"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=0",
      "I/KALSA_RP_MARK(100): cycle=2",
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "I/KALSA_RP_MARK(100): cycle=3",
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(
    /rows=3 whole_cache_reused=2 partial_reuse=0 total_loss=0 cold_start=1 cold_start_field=engineBuild late_cold_start=0 late_cold_start_field=none /.test(firstColdThenWarm),
    "cycle 1 metadata mismatch is a named cold start, not a total loss",
  );
  assert(
    /KV_PREFIX_CRITERION: PASS/.test(firstColdThenWarm),
    "the announced engine identity change passes once later cycles are warm",
  );

  // A metadata mismatch after cycle 1 is an engine recreation during the run,
  // not an announced cold start. Its zero remains a total loss and fails.
  const lateColdStart = verdictFail(
    "late-cold-start",
    [
      "I/KALSA_RP_MARK(100): cycle=1",
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "I/KALSA_RP_MARK(100): cycle=2",
      'KALSA_PREWARM {"op":"restore","ok":false,"reason":"meta_mismatch:engineBuild","deleted":true}',
      'KALSA_PREWARM {"op":"done"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=0",
      "I/KALSA_RP_MARK(100): cycle=3",
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(
    /rows=3 whole_cache_reused=2 partial_reuse=0 total_loss=1 cold_start=0 cold_start_field=none late_cold_start=1 late_cold_start_field=engineBuild /.test(lateColdStart),
    "a late metadata mismatch remains a total loss and names its field",
  );
  assert(
    /KV_PREFIX_CRITERION: FAIL \(total loss x1; identity changed during run: meta_mismatch:engineBuild at cycle 2\)/.test(lateColdStart),
    "a late cold start explains the mid-run identity change",
  );

  // Rebuilding on every cycle means the engine identity never stabilizes.
  const allColdStarts = verdictFail(
    "all-cold-starts",
    [
      "I/KALSA_RP_MARK(100): cycle=1",
      'KALSA_PREWARM {"op":"restore","ok":false,"reason":"meta_mismatch:engineBuild","deleted":true}',
      'KALSA_PREWARM {"op":"done"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=0",
      "I/KALSA_RP_MARK(100): cycle=2",
      'KALSA_PREWARM {"op":"restore","ok":false,"reason":"meta_mismatch:engineBuild","deleted":true}',
      'KALSA_PREWARM {"op":"done"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=0",
      "I/KALSA_RP_MARK(100): cycle=3",
      'KALSA_PREWARM {"op":"restore","ok":false,"reason":"meta_mismatch:engineBuild","deleted":true}',
      'KALSA_PREWARM {"op":"done"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=0",
      "",
    ].join("\n"),
  );
  assert(
    /rows=3 whole_cache_reused=0 partial_reuse=0 total_loss=2 cold_start=1 cold_start_field=engineBuild late_cold_start=2 late_cold_start_field=engineBuild /.test(allColdStarts),
    "all cold cycles remain visible separately from the losses they cause",
  );
  assert(
    /all cycles were cold starts; identity never stabilized/.test(allColdStarts),
    "rebuilding every cycle fails even though cycle 1 is an allowed cold start",
  );

  // A zero without a metadata-mismatch restore is not a demonstrated cold
  // start. It remains a total loss and fails the reuse criterion.
  const zeroWithoutRestoreMiss = verdictFail(
    "zero-without-restore-miss",
    [
      "I/KALSA_RP_MARK(100): cycle=1",
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=0",
      "",
    ].join("\n"),
  );
  assert(
    /rows=1 whole_cache_reused=0 partial_reuse=0 total_loss=1 cold_start=0 cold_start_field=none late_cold_start=0 late_cold_start_field=none /.test(zeroWithoutRestoreMiss),
    "n_common=0 without a metadata mismatch is still a total loss",
  );
  assert(
    /KV_PREFIX_CRITERION: FAIL \(no cycle reused the whole cache; total loss x1\)/.test(zeroWithoutRestoreMiss),
    "an unproven cold start fails the criterion",
  );

  // A missing file does not prove an identity change: it may mean the save
  // path never produced a snapshot, so no_file must remain a total loss.
  const noFileFirstCycle = verdictFail(
    "no-file-first-cycle",
    [
      "I/KALSA_RP_MARK(100): cycle=1",
      'KALSA_PREWARM {"op":"restore","ok":false,"reason":"no_file"}',
      'KALSA_PREWARM {"op":"done"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=0",
      "",
    ].join("\n"),
  );
  assert(
    /rows=1 whole_cache_reused=0 partial_reuse=0 total_loss=1 cold_start=0 cold_start_field=none late_cold_start=0 late_cold_start_field=none /.test(noFileFirstCycle),
    "no_file on cycle 1 is not a cold start",
  );
  assert(
    /KV_PREFIX_CRITERION: FAIL \(no cycle reused the whole cache; total loss x1\)/.test(noFileFirstCycle),
    "a missing snapshot remains a measured failure",
  );

  // promptMs is displayed beside the reuse counters, but it is deliberately
  // not a criterion: this proves that a slow cold prefill and a fast warm
  // reuse leave the exact same PASS verdict and exit code as before.
  const telemetryCorrelation = verdict(
    "telemetry-correlation",
    [
      "I/KALSA_RP_MARK(100): cycle=1",
      'KALSA_PREWARM {"op":"restore","ok":false,"reason":"meta_mismatch:engineBuild","deleted":true}',
      'KALSA_PREWARM {"op":"done"}',
      'KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":0,"tokensEvaluated":2000,"tokensPredicted":229,"promptMs":41200,"predictedMs":25351.476}',
      "KALSA_KVPREFIX embd=1832 text_tokens=2000 n_common=0",
      "I/KALSA_RP_MARK(100): cycle=2",
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      'KALSA_TELEMETRY {"turnId":"2","round":0,"tokensCached":2892,"tokensEvaluated":2000,"tokensPredicted":229,"promptMs":310,"predictedMs":1200}',
      "KALSA_KVPREFIX embd=1832 text_tokens=2000 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(
    telemetryCorrelation.includes(
      "KV_PER_CYCLE: cycle=1 embd=1832 text=2000 n_common=0 promptMs=41200 class=cold_start",
    ) &&
      telemetryCorrelation.includes(
        "KV_PER_CYCLE: cycle=2 embd=1832 text=2000 n_common=1832 promptMs=310 class=whole",
      ),
    "promptMs is shown beside each cycle's reuse measurement",
  );
  assert(
    telemetryCorrelation.includes("KV_PREFIX_CRITERION: PASS\n"),
    "telemetry correlation does not change the exact PASS criterion",
  );

  // Missing telemetry is visible as n/a, not as a failure or a guessed zero.
  const telemetryMissing = verdict(
    "telemetry-missing",
    [
      "I/KALSA_RP_MARK(100): cycle=1",
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=2000 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(
    telemetryMissing.includes(
      "KV_PER_CYCLE: cycle=1 embd=1832 text=2000 n_common=1832 promptMs=n/a class=whole",
    ),
    "a cycle without telemetry reports promptMs=n/a",
  );
  assert(
    telemetryMissing.includes("KV_PREFIX_CRITERION: PASS\n"),
    "missing telemetry does not change the criterion",
  );

  // A run that produced nothing must say so, not divide by zero.
  // An empty evidence file means the capture failed. It must not print the same
  // zeros as a real run where nothing was reused — that reads like a finding.
  // Exit 2, deliberately distinct from a criterion FAIL's exit 1: "not a
  // measurement" and "a measurement that failed" are different facts.
  const noEvidence = verdictRaw("empty", "");
  assert(
    noEvidence.status === 2,
    `empty evidence must fail the run, not report it — exited ${noEvidence.status}`,
  );
  assert(
    /EVIDENCE: empty or unreadable/.test(noEvidence.stdout) &&
      /KV_PREFIX_CRITERION: FAIL \(no evidence captured/.test(noEvidence.stdout),
    "an empty evidence file says so in the verdict itself",
  );

  // ── FG_REKICK: the foreground re-kick, against fixtures ──────────────────
  // The protocol's fg bounce (rp_fg_bounce) marks every return-to-foreground
  // with an `fg_kick` marker; the verdict classifies the prewarm lines that
  // follow each marker. One fixture per classification, so a phone run is
  // never the first time the counter arithmetic executes.

  // served: the re-kick actually ran a prewarm.
  const fgServed = verdict(
    "fg-served",
    [
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      // The exit contract: a pass exits 0 only when EVERY printed criterion
      // passed, and KV_PREFIX_CRITERION is always printed. A real run has
      // this row after the send, so the pass shape carries one too.
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=1 warm=0 held=0 stopped=0 no_work=0 too_early=0 silent=0/.test(fgServed),
    "a restore after the kick is served",
  );
  assert(/FG_REKICK_CRITERION: PASS/.test(fgServed), "a served kick passes");

  // held: a live chat's KV is worth more than the static prefix, so this is
  // not a defect and must not fail the run.
  const fgHeld = verdict(
    "fg-held",
    [
      // The mount-time restore, outside the kick window: the KV criterion
      // needs a prewarm that ran, as a real run's evidence always has.
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"skip","reason":"kv_holds_chat"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=0 warm=0 held=1 stopped=0 no_work=0 too_early=0 silent=0/.test(fgHeld),
    "kv_holds_chat after the kick is held",
  );
  assert(/FG_REKICK_CRITERION: PASS/.test(fgHeld), "a held kick passes");

  // THE fixture: a marker followed by no prewarm line at all. This is the
  // shape the closed bug would have had — a re-kick that never fired — and
  // the criterion must fail by naming the silence.
  const fgSilent = verdictFail(
    "fg-silent",
    [
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      "KALSA_TELEMETRY promptMs=1234",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=0 warm=0 held=0 stopped=0 no_work=0 too_early=0 silent=1/.test(fgSilent),
    "a kick with no prewarm line is silent",
  );
  assert(
    /FG_REKICK_CRITERION: FAIL \(re-kick produced no prewarm line x1\)/.test(fgSilent),
    "the criterion names the silence",
  );

  // too_early: the re-kick queued while the app was still backgrounded — it
  // fired before the very transition it exists to serve.
  const fgTooEarly = verdictFail(
    "fg-too-early",
    [
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"skip","reason":"background"}',
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=0 warm=0 held=0 stopped=0 no_work=0 too_early=1 silent=0/.test(fgTooEarly),
    "a background skip after the kick is too_early",
  );
  assert(
    /FG_REKICK_CRITERION: FAIL \(re-kick queued while the app was still backgrounded x1\)/.test(
      fgTooEarly,
    ),
    "the criterion names the too-early kick",
  );

  // One good kick does not save a run where another went mute — same rule as
  // KV_PREFIX_CRITERION: a run is not a pass because one of its kicks was.
  const fgMixed = verdictFail(
    "fg-mixed",
    [
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"done"}',
      "I/KALSA_RP_MARK(100): fg_kick cycle=2",
      "KALSA_KVDIAG n_past=0",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=2 served=1 warm=0 held=0 stopped=0 no_work=0 too_early=0 silent=1/.test(fgMixed),
    "one served kick and one mute kick are counted separately",
  );
  assert(
    /FG_REKICK_CRITERION: FAIL \(re-kick produced no prewarm line x1\)/.test(fgMixed),
    "one good kick does not save a silent one",
  );

  // warm: the shape of the COMMON case — a background round-trip that
  // invalidated nothing. The re-kick reaches the queue gate, finds the hash
  // already warm, and logs it. Calling this FAIL was the criterion's defect
  // before the gate learned to log; it is a WEAK pass (the gate said warm —
  // whether the native KV is reusable is KV_PREFIX_CRITERION's question).
  const fgWarm = verdict(
    "fg-warm",
    [
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"skip","reason":"already_warm","hash":"h"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=0 warm=1 held=0 stopped=0 no_work=0 too_early=0 silent=0/.test(fgWarm),
    "already_warm counts in warm — the common case is not a failure",
  );
  assert(/FG_REKICK_CRITERION: PASS/.test(fgWarm), "a warm kick passes");

  // in_flight counts as warm too: a prewarm already queued is the prefix
  // being handled, not a missing re-kick.
  const fgInFlight = verdict(
    "fg-in-flight",
    [
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"skip","reason":"in_flight","hash":"h"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=0 warm=1 held=0 stopped=0 no_work=0 too_early=0 silent=0/.test(fgInFlight),
    "in_flight counts in warm",
  );
  assert(/FG_REKICK_CRITERION: PASS/.test(fgInFlight), "an in-flight kick passes");

  // No markers at all (old evidence, or FG_BOUNCE=0): the path was not
  // exercised. The verdict says so in one line, prints NO criterion, and
  // leaves KV_PREFIX_CRITERION and the exit code alone — a run that did not
  // try the foreground is not a failed run, and the pass shape must survive
  // this section untouched.
  const fgNone = verdict(
    "fg-none",
    [
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      'KALSA_PREWARM {"op":"done"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: not exercised/.test(fgNone),
    "evidence without fg_kick markers says the path was not exercised",
  );
  assert(
    !fgNone.includes("FG_REKICK_CRITERION"),
    "an unexercised path prints no FG_REKICK criterion",
  );
  assert(
    /KV_PREFIX_CRITERION: PASS/.test(fgNone),
    "the unexercised FG section leaves KV_PREFIX_CRITERION alone",
  );

  // The closed window: rp_fg_bounce emits `fg_settled` as its last line, so
  // the kick's evidence ends before the send produces prewarm lines of its
  // own. The {"op":"done"} after the settle marker simulates the send — it
  // must NOT save the kick. This fixture demonstrates the fix: without the
  // closing marker the window ran to the next cycle's marker and this shape
  // read served=1 and PASS off a mute kick.
  const fgClosedWindow = verdictFail(
    "fg-closed-window",
    [
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      "KALSA_TELEMETRY promptMs=99",
      "I/KALSA_RP_MARK(100): fg_settled cycle=1",
      'KALSA_PREWARM {"op":"done"}',
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=0 warm=0 held=0 stopped=0 no_work=0 too_early=0 silent=1/.test(fgClosedWindow),
    "the send's done after fg_settled stays out of the kick window",
  );
  assert(
    /FG_REKICK_CRITERION: FAIL \(re-kick produced no prewarm line x1\)/.test(fgClosedWindow),
    "a settled mute kick still fails — the send's done does not save it",
  );

  // A served kick inside a closed window: the restore lands before the settle
  // marker, the kv_holds_chat skip after it belongs to the send and enters no
  // classification at all.
  const fgServedSettled = verdict(
    "fg-served-settled",
    [
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "I/KALSA_RP_MARK(100): fg_settled cycle=1",
      'KALSA_PREWARM {"op":"skip","reason":"kv_holds_chat"}',
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=1 warm=0 held=0 stopped=0 no_work=0 too_early=0 silent=0/.test(fgServedSettled),
    "the restore inside the window is served",
  );
  assert(
    /FG_REKICK_CRITERION: PASS/.test(fgServedSettled),
    "a served kick inside a closed window passes",
  );

  // A stopped kick: the re-kick FIRED and the job named why it quit. The
  // physical cause is real and frequent on this app: the model is evicted
  // while backgrounded (thermal pause / onTrimMemory in kalsa-lifecycle), so
  // isEngineReady() is false at the kick. Counting this as "no prewarm line"
  // was a false motive — it sent the diagnosis hunting in AppShell instead
  // of the model lifecycle. FAIL, but naming the reason.
  const fgNotReady = verdictFail(
    "fg-not-ready",
    [
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"skip","reason":"not_ready"}',
      "I/KALSA_RP_MARK(100): fg_settled cycle=1",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=0 warm=0 held=0 stopped=1 no_work=0 too_early=0 silent=0/.test(fgNotReady),
    "a recognised skip reason is stopped, not silent",
  );
  assert(
    /FG_REKICK_CRITERION: FAIL \(re-kick stopped: not_ready x1\)/.test(fgNotReady),
    "the criterion names the stop reason, not an anonymous count",
  );

  // Two kicks, two different stop reasons: the criterion must name BOTH with
  // their counts, not just the first — the same property KV_PREFIX_CRITERION
  // already respects for its own failure reasons.
  const fgStoppedTwo = verdictFail(
    "fg-stopped-two",
    [
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"skip","reason":"not_ready"}',
      "I/KALSA_RP_MARK(100): fg_settled cycle=1",
      "I/KALSA_RP_MARK(100): fg_kick cycle=2",
      'KALSA_PREWARM {"op":"skip","reason":"given_up","hash":"h"}',
      "I/KALSA_RP_MARK(100): fg_settled cycle=2",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=2 served=0 warm=0 held=0 stopped=2 no_work=0 too_early=0 silent=0/.test(fgStoppedTwo),
    "two differently-stopped kicks count as stopped=2",
  );
  assert(
    /FG_REKICK_CRITERION: FAIL \(re-kick stopped: not_ready x1; given_up x1\)/.test(fgStoppedTwo),
    "the criterion names EVERY stop reason with its count, in evidence order",
  );

  // An aborted restore inside the window used to read served=1 PASS — the
  // auditor's false PASS: the app logs restore ok:false and exits through
  // prewarmMustStop() BEFORE any prefill, so no prefix got warmed.
  const fgAbort = verdictFail(
    "fg-abort",
    [
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"restore","ok":false,"reason":"aborted","hash":"h"}',
      "I/KALSA_RP_MARK(100): fg_settled cycle=1",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=0 warm=0 held=0 stopped=0 no_work=1 too_early=0 silent=0/.test(fgAbort),
    "an aborted restore is no_work, not served",
  );
  assert(
    /FG_REKICK_CRITERION: FAIL \(re-kick fired but warmed nothing: restore did not complete x1\)/.test(fgAbort),
    "the criterion names the aborted-restore form of no_work",
  );

  // `start` logs at QUEUE time, before the job has run one step: a kick that
  // queues and then dies proves nothing. Alone in the window it is no_work,
  // FAIL — never the served=1 PASS it used to be.
  const fgStartOnly = verdictFail(
    "fg-start-only",
    [
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"start","hash":"h","systemChars":100,"toolCount":2}',
      "I/KALSA_RP_MARK(100): fg_settled cycle=1",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=0 warm=0 held=0 stopped=0 no_work=1 too_early=0 silent=0/.test(fgStartOnly),
    "a queued-then-died kick is no_work, not served",
  );
  assert(
    /FG_REKICK_CRITERION: FAIL \(re-kick fired but warmed nothing: queued but no outcome x1\)/.test(fgStartOnly),
    "the criterion names the queued-without-outcome form of no_work",
  );

  // ...but start FOLLOWED by done is the normal served shape: the presence
  // of start must not declassify a kick that completed. It is also the
  // "long prefill, window closed right" case — done lands after a whole
  // prefill, and with the outcome-closed window it lands INSIDE.
  const fgStartDone = verdict(
    "fg-start-done",
    [
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"start","hash":"h","systemChars":100,"toolCount":2}',
      'KALSA_PREWARM {"op":"done","promptMs":12,"promptN":1832,"hash":"h"}',
      "I/KALSA_RP_MARK(100): fg_settled cycle=1",
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=1 warm=0 held=0 stopped=0 no_work=0 too_early=0 silent=0/.test(fgStartDone),
    "start followed by done is served — start does not declassify",
  );
  assert(
    /FG_REKICK_CRITERION: PASS/.test(fgStartDone),
    "a kick that queued and completed passes",
  );

  // The defect the fixed 5s window had: a ~40s prefill logs start inside the
  // window and done only AFTER fg_settled — no_work, FAIL. This is EXACTLY
  // the shape that timer produced on every slow, successful prewarm: a false
  // FAIL on the case the run wants to see succeed. The window now closes on
  // the kick's outcome (rp_fg_wait_settled), so this shape only appears when
  // the kick genuinely never completed.
  const fgSettledEarly = verdictFail(
    "fg-settled-early",
    [
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"start","hash":"h","systemChars":100,"toolCount":2}',
      "I/KALSA_RP_MARK(100): fg_settled cycle=1",
      'KALSA_PREWARM {"op":"done","promptMs":40000,"promptN":1832,"hash":"h"}',
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=0 warm=0 held=0 stopped=0 no_work=1 too_early=0 silent=0/.test(fgSettledEarly),
    "a kick whose done lands after fg_settled is no_work",
  );
  assert(
    /FG_REKICK_CRITERION: FAIL \(re-kick fired but warmed nothing: queued but no outcome x1\)/.test(fgSettledEarly),
    "the criterion names the queued-without-outcome form",
  );

  // A skip reason this verdict has never been taught: read off the line and
  // NAMED in the criterion. The app emits far more reasons than any list in
  // the verdict could track; a new one must fail saying its name, not be
  // swallowed as "no prewarm line" — the line is right there, and that
  // swallow was the auditor's false FAIL.
  const fgUnknownReason = verdictFail(
    "fg-unknown-reason",
    [
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"skip","reason":"eval-failed"}',
      "I/KALSA_RP_MARK(100): fg_settled cycle=1",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=0 warm=0 held=0 stopped=1 no_work=0 too_early=0 silent=0/.test(fgUnknownReason),
    "an unknown skip reason is stopped with the name read off the line",
  );
  assert(
    /FG_REKICK_CRITERION: FAIL \(re-kick stopped: eval-failed x1\)/.test(fgUnknownReason),
    "the criterion names a reason it was never taught",
  );

  // End-to-end: the mute AppShell learned to break in the handler itself.
  // When the thermal gate arms, the re-kick branch is never taken and the
  // window used to be silent; now the handler logs thermal_gate before it
  // returns, and the generic classifier names it. This fixture pins the
  // verdict side of that contract.
  const fgThermalGate = verdictFail(
    "fg-thermal-gate",
    [
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"skip","reason":"thermal_gate"}',
      "I/KALSA_RP_MARK(100): fg_settled cycle=1",
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=0 warm=0 held=0 stopped=1 no_work=0 too_early=0 silent=0/.test(fgThermalGate),
    "the handler's thermal_gate skip is stopped, not silent",
  );
  assert(
    /FG_REKICK_CRITERION: FAIL \(re-kick stopped: thermal_gate x1\)/.test(fgThermalGate),
    "the criterion names the handler's thermal_gate cause",
  );

  // The structural incompatibility: with MEMORY_FACTS_ON_USER_TAIL flipped to
  // false, queueStaticPrefixPrewarm's guard skips with facts_in_system (the
  // prewarm runs at boot and can never know the conversation's facts). The
  // generic classifier must name it with NO verdict change — asserted by
  // running restoreVerdict.mjs, not by construction.
  const fgFactsInSystem = verdictFail(
    "fg-facts-in-system",
    [
      'KALSA_PREWARM {"op":"restore","ok":true,"tokens":1832,"hash":"h"}',
      "I/KALSA_RP_MARK(100): fg_kick cycle=1",
      'KALSA_PREWARM {"op":"skip","reason":"facts_in_system"}',
      "I/KALSA_RP_MARK(100): fg_settled cycle=1",
      "KALSA_KVPREFIX embd=1832 text_tokens=1832 n_common=1832",
      "",
    ].join("\n"),
  );
  assert(
    /FG_REKICK: kicks=1 served=0 warm=0 held=0 stopped=1 no_work=0 too_early=0 silent=0/.test(fgFactsInSystem),
    "the facts_in_system skip is stopped, not silent",
  );
  assert(
    /FG_REKICK_CRITERION: FAIL \(re-kick stopped: facts_in_system x1\)/.test(fgFactsInSystem),
    "the criterion names the structural incompatibility",
  );

  // The warm gate must stay observable: a silent return and a re-kick that
  // never fired produce identical evidence, and only the second is a defect.
  // The gate logs which of the two it hit (in_flight outranks already_warm —
  // a queued prewarm also means "the prefix is being handled") before it
  // returns. Pinned by SHAPE, not substring: comments stripped, whitespace
  // normalised, whole region compared — reformatting is fine, un-logging it
  // is not.
  const warmGate = regionBetween(
    'logPrewarm({ op: "skip", reason: "kv_holds_chat" });',
    "const budgetKey = prewarmBudgetKey(prefix.hash);",
  );
  const warmGateExpected = [
    'logPrewarm({ op: "skip", reason: "kv_holds_chat" });',
    "return; }",
    "if ( shouldSkipStaticPrefixPrewarm(prewarmPrefixHash, prefix.hash) ||",
    "prewarmQueuedKey === prefix.hash ) {",
    "logPrewarm({",
    'op: "skip",',
    'reason: prewarmQueuedKey === prefix.hash ? "in_flight" : "already_warm",',
    "hash: prefix.hash,",
    "});",
    "return; }",
    "const budgetKey = prewarmBudgetKey(prefix.hash);",
  ].join(" ");
  assert(
    warmGate === warmGateExpected,
    `the already-warm gate must log (in_flight vs already_warm) before it returns — found: ${warmGate}`,
  );

  // The protocol must still parse, and the bounce must sit INSIDE the cycles
  // loop, between rp_wait_ready and device_share_send, under the FG_BOUNCE
  // gate: before Ready there is no fronted app to bounce, and after the send
  // the KV holds a chat so the re-kick could only ever log kv_holds_chat.
  // Region-isolated, comments stripped, whitespace normalised, positions
  // compared — not a substring wish.
  const protocolPath = path.join(projectRoot, "scripts/device-restore-protocol.sh");
  const bashParse = spawnSync("bash", ["-n", protocolPath], { encoding: "utf8" });
  assert(
    bashParse.status === 0,
    `device-restore-protocol.sh must still parse — ${bashParse.stderr}`,
  );
  const protocolSrc = readFileSync(protocolPath, "utf8");
  // The evidence filter is the verdict's input contract. Derive both tag
  // lists from source so adding a reader without adding its filter is a named
  // harness failure instead of a silent real-device blind spot.
  const verdictSrc = readFileSync(
    path.join(projectRoot, "scripts/restoreVerdict.mjs"),
    "utf8",
  );
  const verdictTags = [...new Set(verdictSrc.match(/\bKALSA_[A-Z0-9_]+\b/g) ?? [])];
  const evidenceFilterLine = protocolSrc.split("\n").find((line) =>
    line.includes('grep -E "KALSA_RP_MARK|'),
  );
  assert(evidenceFilterLine, "the protocol evidence filter line is present");
  const filterTags = [...new Set(evidenceFilterLine.match(/\bKALSA_[A-Z0-9_]+\b/g) ?? [])];
  for (const tag of verdictTags) {
    assert(
      filterTags.includes(tag),
      `evidence filter drops verdict tag: ${tag}`,
    );
  }
  const loopAt = protocolSrc.indexOf('for i in $(seq 1 "$CYCLES"); do');
  assert(loopAt >= 0, "the protocol still has its cycles loop");
  const loopDoneAt = protocolSrc.indexOf("\n  done", loopAt);
  assert(loopDoneAt > loopAt, "the cycles loop closes where expected");
  const loop = shapeOf(protocolSrc.slice(loopAt, loopDoneAt));
  const readyAt = loop.indexOf("rp_wait_ready");
  const bounceAt = loop.indexOf('if [ "$FG_BOUNCE" = "1" ]; then rp_fg_bounce "$i"; fi');
  const sendAt = loop.indexOf("device_share_send");
  assert(
    readyAt >= 0 && bounceAt > readyAt && sendAt > bounceAt,
    `the FG_BOUNCE-gated fg bounce must sit between rp_wait_ready and ` +
      `device_share_send inside the cycles loop — ready=${readyAt} bounce=${bounceAt} send=${sendAt}`,
  );
  // Inside the bounce, the settle marker must be the LAST line the function
  // emits: fg_kick → fg_settled is the evidence window the FG_REKICK
  // fixtures above pin on the verdict side. Emitted later, the send's own
  // prewarm lines would leak into the kick's classification.
  const bounceFnAt = protocolSrc.indexOf("rp_fg_bounce() {");
  assert(bounceFnAt >= 0, "rp_fg_bounce still exists");
  const bounceFnEnd = protocolSrc.indexOf("\n}", bounceFnAt);
  assert(bounceFnEnd > bounceFnAt, "rp_fg_bounce closes where expected");
  const bounceFn = shapeOf(protocolSrc.slice(bounceFnAt, bounceFnEnd));
  assert(
    bounceFn.endsWith(
      'adb shell log -p i -t KALSA_RP_MARK "fg_settled cycle=$i" </dev/null >/dev/null 2>&1',
    ),
    `the fg_settled marker must be the LAST thing rp_fg_bounce emits — ends with: …${bounceFn.slice(-100)}`,
  );
  // The window now closes on the kick's OUTCOME, not on a timer: the outcome
  // wait (rp_fg_wait_settled) runs after the relaunch and before fg_settled,
  // and the fixed post-relaunch sleep is gone — `done` lands after a whole
  // prefill (tens of seconds), so any fixed sleep classified a working
  // prewarm as no_work: a false FAIL on the success case the run exists to
  // see. Anchors counted: the settle marker line is unique in the file, and
  // the no-sleep-5 check is scoped to this function (other cycles sleep 5
  // elsewhere on purpose).
  assert(
    bounceFn.includes('rp_fg_wait_settled "$i"'),
    "rp_fg_bounce must wait for the kick's outcome via rp_fg_wait_settled",
  );
  const fgRelaunchAt = bounceFn.indexOf('am start -n "$ACTIVITY"');
  const fgWaitAt = bounceFn.indexOf('rp_fg_wait_settled "$i"');
  const fgSettledAt = bounceFn.indexOf('fg_settled cycle=$i');
  assert(
    fgRelaunchAt >= 0 && fgRelaunchAt < fgWaitAt && fgWaitAt < fgSettledAt,
    `the outcome wait must sit between the relaunch and fg_settled — ` +
      `${fgRelaunchAt} < ${fgWaitAt} < ${fgSettledAt}`,
  );
  assert(
    !bounceFn.includes("sleep 5"),
    "the fixed post-relaunch sleep must stay gone — it closed the window on a timer and failed slow, working prefills",
  );

  // ── The settle wait must survive SIGPIPE: exercise the SHELL, not the ────
  // regex. `tail -n +N file | grep -Eq` under `set -uo pipefail` is a
  // false-negative factory: grep -q exits at the first match, tail keeps
  // writing, the pipe fills, tail dies with SIGPIPE and the pipeline returns
  // 141 — the if takes the FALSE branch having found the line. Measured on
  // this host: the exit flips 0 -> 141 between 8 KB and 16 KB after the
  // match (the pipe capacity; 64 KB on Linux). Of the six kicks in the
  // 2026-09-18 captures, three were victims of exactly this (op line in the
  // capture within 0.2 s of the marker, wait burned the whole budget
  // anyway), one was a genuine timeout the old shape got right, and two
  // were detected correctly — the successes being the two kicks whose first
  // poll reached the match with sub-capacity logcat behind it. The verdict,
  // reading the file directly, counted the victims held regardless. The
  // shipped shape (awk reading the file) is extracted from the script and
  // RUN under bash against fixtures whose match sits past any pipe buffer —
  // and the old shape is run on the SAME fixture and must still reproduce
  // 141, so the fixture cannot quietly drift back inside the pipe capacity.
  assert(
    !protocolSrc.includes("| grep -q") && !protocolSrc.includes("| grep -Eq"),
    "no grep -q may remain on the consuming side of a pipe in the protocol",
  );
  const settleFnAt = protocolSrc.indexOf("rp_fg_wait_settled() {");
  assert(settleFnAt >= 0, "rp_fg_wait_settled still exists");
  const settleFnEnd = protocolSrc.indexOf("\n}", settleFnAt);
  const settleFn = protocolSrc.slice(settleFnAt, settleFnEnd);
  assert(
    settleFn.includes("if awk -v start="),
    "the settle wait must match the capture in-process (awk), not through a pipe",
  );
  const snippetStart = settleFn.indexOf("if awk -v start=");
  const snippetEnd = settleFn.indexOf("; then", snippetStart);
  assert(snippetEnd > snippetStart, "the awk settle snippet terminates where expected");
  const settleSnippet = settleFn.slice(snippetStart + 3, snippetEnd); // the condition
  const ereFromSnippet = (settleSnippet.match(/\/([^/]+)\/ \{ found/) ?? [])[1];
  assert(
    typeof ereFromSnippet === "string",
    "the ERE must be extractable from the shipped awk snippet",
  );
  // All three terminal alternatives are load-bearing: 032436 c1 settled on a
  // real {"op":"done"} 84.6 s into its prefill, and restores arrive as
  // {"op":"restore","ok":true}. A matcher narrowed to skip would keep every
  // fixture below green while real done/restore lines turn false-negative —
  // the exact class the awk shape exists to kill.
  const matcherOn = (line) => new RegExp(ereFromSnippet).test(line);
  assert(
    matcherOn('I/ReactNativeJS(30901): \'KALSA_PREWARM\', \'{"op":"done","promptMs":109512.008,"promptN":1832,"hash":"3586270056"}\''),
    "the matcher must settle on a real done line (032436 c1)",
  );
  assert(
    matcherOn('I/ReactNativeJS(1): \'KALSA_PREWARM\', \'{"op":"restore","ok":true,"tokens":1832,"hash":"h"}\''),
    "the matcher must settle on a restore ok:true line",
  );
  assert(
    matcherOn('I/ReactNativeJS(1): \'KALSA_PREWARM\', \'{"op":"skip","reason":"kv_holds_chat"}\''),
    "the matcher must settle on a skip line",
  );
  assert(
    !matcherOn('I/ReactNativeJS(1): \'KALSA_PREWARM\', \'{"op":"start","hash":"h"}\''),
    "start must not settle the wait",
  );
  // restore counts EITHER way by design ("a restore has a verdict" — the
  // function's own comment): {"op":"restore","ok":false} settles this wait
  // deliberately; only start is a non-terminal line.

  const fixtureUnit =
    "I/ReactNativeJS(1): filler line after the match, 64 bytes aaaaaaaaaaaaaaaaaaaa\n";
  const noiseLines = Array.from(
    { length: 40 },
    (_, i) => `I/ReactNativeJS(1): noise padding line ${String(i).padStart(6, "0")}\n`,
  ).join("");
  const matchLine =
    'I/ReactNativeJS(30901): \'KALSA_PREWARM\', \'{"op":"skip","reason":"kv_holds_chat"}\'\n';
  function writePipeFixture(name, padBytesAfterMatch, matchLineOverride) {
    // The shipped snippet reads "$OUT/logcat.txt", so each fixture mirrors
    // the real capture layout: <dir>/logcat.txt.
    const dir = path.join(outDir, `pipe-${name}`);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "logcat.txt");
    writeFileSync(
      file,
      noiseLines +
        (matchLineOverride ?? matchLine) +
        fixtureUnit.repeat(Math.ceil(padBytesAfterMatch / fixtureUnit.length)),
      "utf8",
    );
    return file;
  }
  function runShell(shape, file) {
    const script = [
      "#!/usr/bin/env bash",
      "set -uo pipefail",
      'line_from="$1" shape="$2" file="$3"',
      'export OUT="$(dirname "$file")"',
      'if [ "$shape" = new ]; then',
      `  if ${settleSnippet}; then exit 0; fi`,
      "  exit 1",
      "fi",
      `if tail -n +"$line_from" "$file" 2>/dev/null | grep -Eq '${ereFromSnippet}'; then`,
      "  exit 0",
      "else",
      // The false-negative proof is this branch AND its status: the match
      // exists, the then-branch did not run, and the condition died with
      // tail's SIGPIPE. An if with no else would report 0 here — the exact
      // way this shape hides its own failure.
      "  exit $?",
      "fi",
      "",
    ].join("\n");
    const scriptFile = path.join(outDir, "pipe-probe.sh");
    writeFileSync(scriptFile, script, "utf8");
    return spawnSync("bash", [scriptFile, "1", shape, file], {
      cwd: projectRoot,
      encoding: "utf8",
    }).status;
  }

  // 1 MB after the match: far past any default pipe capacity (16-64 KB).
  const farFile = writePipeFixture("far", 1024 * 1024);
  const newFar = runShell("new", farFile);
  const oldFar = runShell("old", farFile);
  assert(
    newFar === 0,
    `the shipped settle shape must find a match 1 MB from EOF — got ${newFar}`,
  );
  assert(
    oldFar === 141,
    `the fixture no longer reproduces the SIGPIPE shape (old shape exited ${oldFar}, ` +
      `expected 141): the padding is inside this machine's pipe capacity — ` +
      `grow the fixture before trusting the gate`,
  );
  // Match at EOF: the benign case both shapes must keep passing...
  const nearFile = writePipeFixture("near", 0);
  assert(
    runShell("new", nearFile) === 0 && runShell("old", nearFile) === 0,
    "a match close to EOF settles under both shapes",
  );
  // The done alternative through the SHELL, not just the regex: 032436 c1's
  // real done line, 1 MB from EOF, must settle the shipped shape.
  const farDoneFile = writePipeFixture(
    "far-done",
    1024 * 1024,
    'I/ReactNativeJS(30901): \'KALSA_PREWARM\', \'{"op":"done","promptMs":109512.008,"promptN":1832,"hash":"3586270056"}\'\n',
  );
  assert(
    runShell("new", farDoneFile) === 0,
    "the shipped settle shape must find a real done line 1 MB from EOF",
  );
  // ...and no match at all still fails: the corrected branch is not a tautology.
  const noneFile = path.join(outDir, "pipe-none.txt");
  writeFileSync(noneFile, noiseLines, "utf8");
  assert(
    runShell("new", noneFile) === 1,
    "the shipped settle shape must still fail when the region holds no terminal op",
  );
  console.log("PASS settle wait survives SIGPIPE (shell-exercised: new=0, old=141 at 1 MB)");

  // ── The wait's budget is WALL CLOCK, and its log survives the run ────────
  // "settled after ${waited}s" counted loop passes, not seconds — every pass
  // also pays the capture greps plus its 1 s sleep — so the seconds suffix
  // lied in both directions: elapsed time was reported as a poll count, and
  // the three 09-18 budget expiries took 124.6-134.1 s of wall against
  // "120". The protocol's own stdout is never persisted, so that figure
  // died with the terminal. Both are fixed in the script and pinned here by
  // RUNNING the shell: the extracted log + rp_fg_wait_settled execute under
  // a sleep stub whose per-pass cost exceeds the budget, the one case where
  // a pass counter and a clock must disagree.
  const waitFnAt = protocolSrc.indexOf("rp_fg_wait_settled() {");
  assert(waitFnAt >= 0, "rp_fg_wait_settled still exists");
  const waitFnEnd = protocolSrc.indexOf("\n}", waitFnAt);
  const waitFn = protocolSrc.slice(waitFnAt, waitFnEnd + 2);
  assert(
    waitFn.includes("t0=$(date +%s)") &&
      waitFn.includes("deadline=$((t0 + FG_SETTLE_TIMEOUT_SECONDS))") &&
      waitFn.includes("settled after $(( $(date +%s) - t0 ))s"),
    "the settle wait must take its deadline on entry and print true wall seconds",
  );
  assert(
    // bash comments are `#`, not `//` — strip those from the RAW text (they
    // must go before the whitespace collapse, or the rationale comment that
    // NAMES the old counter trips the pin).
    !shapeOf(waitFn.replace(/^[ \t]*#.*$/gm, "")).includes("${waited}"),
    "the settle wait must not count passes where seconds are meant",
  );
  const logFnAt = protocolSrc.indexOf("log() {");
  assert(logFnAt >= 0, "the protocol's log override still exists");
  const logFnEnd = protocolSrc.indexOf("\n}", logFnAt);
  const logFn = protocolSrc.slice(logFnAt, logFnEnd + 2);
  assert(
    logFn.includes('>> "$RP_LOG_FILE"'),
    "the log helper must append to the persisted protocol log",
  );
  // Scan CODE for these, not comments: the rationale comment quotes the
  // forbidden construct verbatim, and a comment saying "never do X" must
  // not trip a pin on X.
  const protocolCode = protocolSrc.replace(/^[ \t]*#.*$/gm, "");
  assert(
    protocolCode.includes('RP_LOG_FILE="$OUT/protocol.log"') &&
      !protocolCode.includes("exec > >(tee") &&
      !protocolCode.includes("> >(tee"),
    "the protocol log is written per run inside the helper, not via exec tee",
  );

  // The driver: stubs the watchdog, makes every `sleep` cost SLEEP_SECS
  // (so a pass costs more than one second), optionally appends the terminal
  // op line to the capture after the first sleep (simulating an op that
  // lands mid-wait), and runs the EXTRACTED functions unchanged.
  function runWaitShell(opts) {
    const dir = path.join(outDir, `settle-${opts.name}`);
    mkdirSync(dir, { recursive: true });
    // Marker only — no terminal op unless the append supplies one. The
    // marker can also start ABSENT and be appended mid-wait, which is how
    // the shared-deadline pin makes the marker phase spend real budget.
    writeFileSync(
      path.join(dir, "logcat.txt"),
      noiseLines + (opts.markerInBase === false ? "" : "I/KALSA_RP_MARK(1): fg_kick cycle=1\n"),
      "utf8",
    );
    let appendFile = "";
    if (opts.appendMatch || opts.appendMarker) {
      appendFile = path.join(dir, opts.appendMarker ? "marker-line.txt" : "op-line.txt");
      writeFileSync(
        appendFile,
        opts.appendMarker
          ? "I/KALSA_RP_MARK(1): fg_kick cycle=1\n"
          : 'I/ReactNativeJS(1): \'KALSA_PREWARM\', \'{"op":"skip","reason":"kv_holds_chat"}\'\n',
        "utf8",
      );
    }
    const script = [
      "#!/usr/bin/env bash",
      "set -uo pipefail",
      "rp_watchdog_stop_requested() { return 1; }",
      "SLEEPS=0",
      "sleep() {",
      "  SLEEPS=$((SLEEPS + 1))",
      '  command sleep "$SLEEP_SECS"',
      '  if [ -n "$APPEND_MATCH_FILE" ]; then',
      '    cat "$APPEND_MATCH_FILE" >> "$OUT/logcat.txt" 2>/dev/null',
      '    APPEND_MATCH_FILE=""',
      "  fi",
      "}",
      logFn,
      waitFn,
      'FG_SETTLE_TIMEOUT_SECONDS="$BUDGET"',
      "rp_fg_wait_settled 1",
      "exit $?",
      "",
    ].join("\n");
    const scriptFile = path.join(dir, "wait-probe.sh");
    writeFileSync(scriptFile, script, "utf8");
    const startedAt = Date.now();
    const r = spawnSync("bash", [scriptFile], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 60000,
      env: {
        ...process.env,
        OUT: dir,
        // rp_main's setup (which sets these) is not part of the extracted
        // region: model its SUCCESS, which is what RP_LOG_OK=1 means.
        RP_LOG_FILE: path.join(dir, "protocol.log"),
        RP_LOG_OK: "1",
        SLEEP_SECS: String(opts.sleepSecs),
        APPEND_MATCH_FILE: appendFile,
        BUDGET: String(opts.budget),
      },
    });
    return {
      status: r.status,
      wallMs: Date.now() - startedAt,
      protocolLog: readFileSync(path.join(dir, "protocol.log"), "utf8"),
    };
  }

  // Expiry is wall clock: with a 2 s budget and 3 s passes, ONE pass must
  // pass the deadline and stop — a pass counter would burn a second pass
  // (>= 6 s) before noticing, and print "within 2" either way.
  const timeout = runWaitShell({ name: "timeout", budget: 2, sleepSecs: 3 });
  assert(
    timeout.status === 1,
    `an expired settle wait must exit 1 — got ${timeout.status}`,
  );
  // The pass-counter shape's FLOOR is two 3 s passes (~6000 ms), but a sleep
  // that returns a few ms early can slide it just under any bound set at
  // 6000 — measured 6022 ms. The bound sits at 5000: comfortably above the
  // correct single pass (~3 s) and below any two-pass shape's floor.
  assert(
    timeout.wallMs >= 2000 && timeout.wallMs < 5000,
    `the budget must expire on wall clock, not after N passes — took ${timeout.wallMs} ms ` +
      `(a two-pass counter needs ~6000 ms at 3 s per pass)`,
  );
  assert(
    timeout.protocolLog.includes("did not settle within 2s"),
    "the timeout line must state the real budget in seconds",
  );

  // The settle line reports true elapsed seconds: the op lands after the
  // first pass, so wall clock says 2 s while a pass counter would print 1.
  const settled = runWaitShell({
    name: "settled",
    budget: 30,
    sleepSecs: 2,
    appendMatch: true,
  });
  assert(
    settled.status === 0,
    `a settle after the op lands must exit 0 — got ${settled.status}`,
  );
  // The printed value is floor(now) - floor(t0): a CORRECT implementation
  // reads one second high whenever the sleep straddles a boundary (measured
  // 2 of 24 runs on an idle host), so the assertion is a FLOOR — at least
  // the 2 s the stub costs — never an equality. A pass counter would print
  // 1, and 1 is the one value this pin refuses.
  const settledSeconds = Number(
    (settled.protocolLog.match(/kick settled after (\d+)s/) ?? [])[1],
  );
  assert(
    Number.isInteger(settledSeconds) && settledSeconds >= 2,
    `the settle line must report at least the stub's wall seconds (2) — ` +
      `log said: ${JSON.stringify(settled.protocolLog)}`,
  );
  assert(
    settledSeconds !== 1,
    "a pass count leaked into the settle line — the seconds suffix lied again",
  );

  // The deadline is SHARED between the marker phase and the settle phase:
  // a marker that lands mid-wait must eat the marker phase's budget, so a
  // second t0/deadline before the settle loop cannot quietly restart the
  // clock. Fixture: no marker at first (appended after the first pass), no
  // terminal op ever — expiry is due within one pass of the ORIGINAL 3 s
  // budget (~4 s at this stub's cadence); a reset second deadline needs a
  // third pass (>= 6 s).
  const markerLate = runWaitShell({
    name: "marker-late",
    budget: 3,
    sleepSecs: 2,
    markerInBase: false,
    appendMarker: true,
  });
  assert(
    markerLate.status === 1,
    `an expired wait exits 1 — got ${markerLate.status}`,
  );
  assert(
    markerLate.wallMs >= 3000 && markerLate.wallMs < 5500,
    `a late marker must consume the SHARED deadline — expiry is due within ` +
      `one pass of the 3 s budget (~4 s at this stub's cadence); got ` +
      `${markerLate.wallMs} ms (a reset second deadline needs a third pass, >= 6 s)`,
  );
  assert(
    markerLate.protocolLog.includes("did not settle within 3s"),
    "the shared-deadline expiry names the real budget",
  );
  console.log(
    "PASS settle wait is wall clock (shared deadline, floor-timed) and its log persists",
  );


  // ── The re-kick's mutes must speak ───────────────────────────────────────
  // Every exit ahead of the re-kick, and the fall-through past it, used to be
  // a bare `return`: a muted branch and a re-kick that never fired produce
  // identical evidence, and the verdict's only honest word for that window
  // was "silent" — which pointed at AppShell when the cause was the model
  // lifecycle. The mutes now name their cause via logPrewarmSkip:
  // thermal_gate / no_model ahead of the branch, not_ready / model_changed
  // in the fall-through (evicted model vs user switch — opposite ends).
  // Anchors checked against the whole file before trusting them: the branch
  // condition occurs twice in AppShell and thermalHardGateRef 26 times, so
  // the region is cut from the unique `state === "active"` branch to the
  // unique init-path memory query, and the mutes must sit in handler order.
  const fgHandlerAt = appShellSrc.indexOf('if (state === "active")');
  assert(fgHandlerAt >= 0, 'AppShell still has the AppState "active" branch');
  const fgHandlerEnd = appShellSrc.indexOf(
    "getAvailableMemoryBytesUncached()",
    fgHandlerAt,
  );
  assert(
    fgHandlerEnd > fgHandlerAt,
    "the foreground handler still reaches the init path's memory query",
  );
  const fgHandler = shapeOf(appShellSrc.slice(fgHandlerAt, fgHandlerEnd));
  assert(
    fgHandler.includes(
      'if (thermalHardGateRef.current) { logPrewarmSkip("thermal_gate"); return; }',
    ),
    "the thermal gate must log thermal_gate before it returns",
  );
  assert(
    fgHandler.includes('if (!model) { logPrewarmSkip("no_model"); return; }'),
    "the no-model return must log no_model before it returns",
  );
  assert(
    fgHandler.includes(
      'if (!isEngineReady()) { logPrewarmSkip("not_ready"); } ' +
        'else { logPrewarmSkip("model_changed"); }',
    ),
    "the fall-through must say which of not_ready / model_changed it is",
  );
  const thermalSkipAt = fgHandler.indexOf('logPrewarmSkip("thermal_gate")');
  const noModelSkipAt = fgHandler.indexOf('logPrewarmSkip("no_model")');
  const fgRekickAt = fgHandler.indexOf("await queueStaticPrefixPrewarm(");
  const fallthroughSkipAt = fgHandler.indexOf('logPrewarmSkip("not_ready")');
  assert(
    thermalSkipAt >= 0 &&
      thermalSkipAt < noModelSkipAt &&
      noModelSkipAt < fgRekickAt &&
      fgRekickAt < fallthroughSkipAt,
    `the mutes must sit in handler order: gate < model < re-kick < fall-through — ` +
      `${thermalSkipAt} < ${noModelSkipAt} < ${fgRekickAt} < ${fallthroughSkipAt}`,
  );

  // The facts-in-system incompatibility must be STRUCTURAL, not documentary:
  // with MEMORY_FACTS_ON_USER_TAIL === false the prewarm can only ever warm a
  // system prompt without facts (it runs at boot, before any conversation)
  // while every send hashes one with them — the prefix would never match, a
  // full wasted prefill per engine cycle. The guard sits FIRST, before any
  // state-dependent work, and LOGS: a disabled feature has nothing to say,
  // a contradictory configuration must name itself. Anchors counted in the
  // file before trusting them: function name, EAGER gate, background guard
  // and the skip are each unique. Whole shaped region equality — the head of
  // the queue function is small, so the contract is exact, not a wish.
  const queueFnAt = llamaSrc.indexOf(
    "export async function queueStaticPrefixPrewarm(",
  );
  assert(queueFnAt >= 0, "queueStaticPrefixPrewarm still exists");
  const queueBgGuard = 'if (AppState.currentState !== "active") {';
  const queueBgAt = llamaSrc.indexOf(queueBgGuard, queueFnAt);
  assert(
    queueBgAt > queueFnAt,
    "the background guard still opens the queue function's checks",
  );
  const queueHead = shapeOf(
    llamaSrc.slice(queueFnAt, queueBgAt + queueBgGuard.length),
  );
  const queueHeadExpected =
    "export async function queueStaticPrefixPrewarm( locale: Locale, " +
    "tools?: EngineTool[], toolChoiceMode?: ToolChoiceMode, ): Promise<void> { " +
    "if (!EAGER_PREFIX_PREWARM) return; " +
    "if (!MEMORY_FACTS_ON_USER_TAIL) { logPrewarmSkip(\"facts_in_system\"); return; } " +
    'if (AppState.currentState !== "active") {';
  assert(
    queueHead === queueHeadExpected,
    `facts-in-system must be refused before any state-dependent work, and log — found: ${queueHead}`,
  );

  // ── The jest gate must stay bounded ──────────────────────────────────────
  // e2e-emulator.yml is the workflow pushes to main actually fire, and its
  // jest step runs inside a 120-minute job: without a step-level bound, a
  // hang costs two hours of runner and produces no e2e evidence. ci.yml
  // bounds the same suite's job at 15 minutes — the step carries that
  // number, and this pin fails if it is quietly removed.
  const e2eYml = readFileSync(
    path.join(projectRoot, ".github/workflows/e2e-emulator.yml"),
    "utf8",
  );
  // Jest is its OWN step, bounded at ci.yml's number. The first cut put the
  // 15 minutes on the typecheck+harnesses step — which runs ~47 harnesses,
  // one self-timed at ~140 s — and could fail the e2e job on main before
  // the emulator ever started. The harness step stays deliberately
  // unbounded at step level (the 120-minute job timeout still applies);
  // this pin fails if the bound migrates back onto it.
  const jestStepAt = e2eYml.indexOf("- name: Jest (bounded");
  assert(jestStepAt >= 0, "the bounded Jest step still exists");
  const nextStepAt = e2eYml.indexOf("\n      - name:", jestStepAt + 10);
  const jestStep = e2eYml.slice(jestStepAt, nextStepAt < 0 ? undefined : nextStepAt);
  assert(jestStep.includes("npx jest"), "the bounded step is the one that runs jest");
  const stepTimeout = jestStep.match(/timeout-minutes:\s*(\d+)/);
  assert(
    stepTimeout !== null && Number(stepTimeout[1]) > 0 && Number(stepTimeout[1]) <= 20,
    `the jest step must declare a step-level timeout-minutes consistent with ` +
      `ci.yml (found: ${stepTimeout ? stepTimeout[1] : "none"})`,
  );
  const harnessStepAt = e2eYml.indexOf("Typecheck + logic harnesses");
  assert(harnessStepAt >= 0, "the Typecheck + logic harnesses step still exists");
  const harnessNextAt = e2eYml.indexOf("\n      - name:", harnessStepAt + 10);
  const harnessStep = e2eYml.slice(harnessStepAt, harnessNextAt < 0 ? undefined : harnessNextAt);
  assert(
    harnessStep.includes("npm run typecheck") &&
      !harnessStep.includes("npx jest") &&
      !harnessStep.includes("timeout-minutes"),
    "the harness step stays unbounded at step level and jest-free",
  );
  console.log("PASS the jest CI gate is bounded (timeout-minutes <= 20)");

  // ── The settle budget's validator must close overflow and octal ──────────
  // An all-digit monster passed the old digits-only case and wrapped the
  // bash 3.2 64-bit arithmetic (t0 + budget) into a deadline the clock can
  // never reach: the wait HANGS instead of returning 1 (the old pass-counter
  // failed closed on the same input). A leading zero reads as octal — 0120
  // is an 80 s budget that prints as 120. The pin RUNS the extracted
  // validator: the shipped rule accepts the whole 1-99999 range and refuses
  // the hostile inputs by name.
  const validateFnAt = protocolSrc.indexOf("rp_validate_bounce_flags() {");
  assert(validateFnAt >= 0, "rp_validate_bounce_flags still exists");
  const validateFnEnd = protocolSrc.indexOf("\n}", validateFnAt);
  const validateFn = protocolSrc.slice(validateFnAt, validateFnEnd + 2);
  const validateFile = path.join(outDir, "validate-probe.sh");
  writeFileSync(
    validateFile,
    [
      "#!/usr/bin/env bash",
      "set -uo pipefail",
      'die() { echo "DIE: $*"; exit 1; }',
      validateFn,
      "rp_validate_bounce_flags",
      "exit 0",
      "",
    ].join("\n"),
    "utf8",
  );
  const runValidate = (settle) =>
    spawnSync("bash", [validateFile], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        FG_BOUNCE: "1",
        FG_BOUNCE_SECONDS: "20",
        FG_SETTLE_TIMEOUT_SECONDS: settle,
      },
    });
  assert(runValidate("120").status === 0, "the shipped budget must validate");
  assert(
    runValidate("1").status === 0 && runValidate("99999").status === 0,
    "the whole accepted range 1-99999 must validate",
  );
  for (const hostile of ["99999999999999999999", "0120", "0", "", "abc", "-5"]) {
    const r = runValidate(hostile);
    assert(
      r.status === 1 && /DIE:/.test(r.stdout),
      `hostile settle budget must be refused by name: ${JSON.stringify(hostile)}`,
    );
  }
  console.log("PASS the settle budget validator closes overflow and octal");

  console.log("prefixPrewarmHarness OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
