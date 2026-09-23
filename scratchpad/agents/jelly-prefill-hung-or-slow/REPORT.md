# Jelly Star, ~8k context: prefill SLOW or HUNG?

Cell: `jelly-prefill-hung-or-slow`. Explorer map, read-only. Scope: the PHONE line only —
the app at `/Users/marco/Projects/kalsa` (`main`, HEAD `e5788cf`) and the binding fork
`Aspis0/kalsa.rn` as the app consumes it (installed under
`/Users/marco/Projects/kalsa/node_modules/llama.rn`, pin
`0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2` = engine `4ccef2f85`). The desktop/brain line is
out of scope and is not opened, read or mentioned.

The single question: at a realistic context (`textEst` ~8.3k), the watchdog aborts the turn
after 739 s with ZERO tokens (`KALSA_STALL {"tokens":0,"reason":"prefill","tokPerSec":null}` at
+739.04 s, then `Decoding Interrupted` at +790 s, app CPU ~7 cores). Is that prefill
**slow** (progressing; it would have finished) or **hung** (not progressing)?

Sources read first, not re-derived: `scratchpad/agents/meter-close/REPORT.md` (the cell that
closed today) and `scratchpad/agents/handover-2026-09-21/RECON.md`. Both are treated as given
and are not re-audited here.

Labels used throughout: **READ IN THE CODE** (the quoted line was read in the file),
**INFERRED** (a conclusion drawn from code plus the existing artefacts),
**NEEDS MEASUREMENT** (not decidable from what exists).

---

## 1. THE ABORT PATH, exactly

### 1.1 The deadline function

`src/engine/prefillDeadline.ts` (READ IN THE CODE). Constants:

```
prefillDeadline.ts:1  /** Minimum time allowed for the first-token prefill watchdog. */
prefillDeadline.ts:2  export const MIN_PREFILL_DEADLINE_MS = 180_000;
prefillDeadline.ts:3  /** Cold-start (no EMA) assume at least this many prefill tok/s. */
prefillDeadline.ts:4  export const NO_EMA_PREFILL_TOK_PER_SEC = 10;
prefillDeadline.ts:7  export const MAX_NO_EMA_PREFILL_DEADLINE_MS = 900_000;
```

Two branches (`prefillDeadline.ts:19-39`, READ IN THE CODE):

```
prefillDeadline.ts:24    if (
prefillDeadline.ts:25      input.prefillTokPerSec === null ||
prefillDeadline.ts:26      !Number.isFinite(input.prefillTokPerSec) ||
prefillDeadline.ts:27      input.prefillTokPerSec <= 0
prefillDeadline.ts:28    ) {
prefillDeadline.ts:29      const promptTokens = Math.max(0, input.promptTokensEstimate);
prefillDeadline.ts:30      const scaled = Math.ceil(promptTokens / NO_EMA_PREFILL_TOK_PER_SEC) * 1000;
prefillDeadline.ts:31      return Math.min(
prefillDeadline.ts:32        MAX_NO_EMA_PREFILL_DEADLINE_MS,
prefillDeadline.ts:33        Math.max(input.minMs, scaled),
prefillDeadline.ts:34      );
prefillDeadline.ts:35    }
prefillDeadline.ts:36    const promptTokens = Math.max(0, input.promptTokensEstimate);
prefillDeadline.ts:37    const minMs = Math.max(0, input.minMs);
prefillDeadline.ts:38    const estimatedSeconds = Math.ceil(promptTokens / input.prefillTokPerSec);
prefillDeadline.ts:39    return Math.max(minMs, 5 * estimatedSeconds * 1000);
```

So branch 1 (no EMA) = `min(900_000, max(180_000, ceil(est/10)*1000))`; branch 2 (EMA) =
`max(180_000, 5*ceil(est/rate)*1000)`. Note (INFERRED, arithmetic on the above): for any
measured rate below 50 tok/s, branch 2 yields a **longer** deadline than branch 1 at the same
estimate. Today's 739 s is branch 1 (`tokPerSec:null` in the `KALSA_STALL` line); Step B's
1355 s was branch 2 with the 29.33 tok/s EMA — matching meter-close REPORT section (d).

### 1.2 Where the deadline is armed, and what feeds it

`armPrefillDeadline` is defined once, `src/engine/LlamaService.ts:4152-4198` (READ IN THE CODE):

```
LlamaService.ts:4152  const armPrefillDeadline = () => {
LlamaService.ts:4155    const charsPerTokenEstimate = Math.ceil(
LlamaService.ts:4156      JSON.stringify(currentMessages).length / 4,
LlamaService.ts:4157    );
LlamaService.ts:4158    const lastPromptTokens = activeModel
LlamaService.ts:4159      ? getLastPromptTokens(activeModel.id)
LlamaService.ts:4160      : null;
LlamaService.ts:4161    const promptTokensEstimate = Math.max(
LlamaService.ts:4162      charsPerTokenEstimate,
LlamaService.ts:4163      lastPromptTokens ?? 0,
LlamaService.ts:4164    );
LlamaService.ts:4165    const prefillTokPerSec = activeModel
LlamaService.ts:4166      ? getPrefillTokPerSec(activeModel.id)
LlamaService.ts:4167      : null;
LlamaService.ts:4168    const deadlineMs = prefillDeadlineMs({
LlamaService.ts:4169      promptTokensEstimate,
LlamaService.ts:4170      prefillTokPerSec,
LlamaService.ts:4171      minMs: MIN_PREFILL_DEADLINE_MS,
LlamaService.ts:4172    });
LlamaService.ts:4173    prefillTimer = turnTimer.setTimeout(() => {
```

`promptTokensEstimate` = max(chars/4 of the assembled `currentMessages`, last accepted native
`prompt_n`). `prefillTokPerSec` = the per-model in-memory EMA. Both getters are in
`src/engine/prefillSpeed.ts:53-60` (READ IN THE CODE):

```
prefillSpeed.ts:53  export function getPrefillTokPerSec(modelId: string): number | null {
prefillSpeed.ts:54    return tokPerSecByModel.get(modelId) ?? null;
prefillSpeed.ts:55  }
prefillSpeed.ts:57  /** Last accepted native prompt size, including chat-template overhead. */
prefillSpeed.ts:58  export function getLastPromptTokens(modelId: string): number | null {
prefillSpeed.ts:59    return lastPromptTokensByModel.get(modelId) ?? null;
prefillSpeed.ts:60  }
```

The stores are module-level `Map`s, in-memory only (`prefillSpeed.ts:19-20`, READ IN THE CODE),
i.e. they die with the JS process. Two writers:

* `recordPrefillSample` — `prefillSpeed.ts:35-50`, with `EMA_ALPHA = 0.3` (`:12`) and
  `MIN_ACCEPTED_PROMPT_TOKENS = 64` (`:17`); `const tokPerSec = (promptN / promptMs) * 1000;`
  (`:41`).
* Called from a completed chat turn's telemetry:
  `LlamaService.ts:1634  recordPrefillSample(model.id, r.promptN > 0 ? r.promptN : 0, result.timings?.prompt_ms ?? -1);`
* And from a completed static-prefix prewarm:
  `LlamaService.ts:1388  recordPrefillSample(` / `:1390  result.timings?.prompt_n ?? 0,` /
  `:1391  result.timings?.prompt_ms ?? -1,` (the `op:"done"` path; a skipped prewarm does not
  reach it).

`armPrefillDeadline` is called at exactly two sites (READ IN THE CODE):

```
LlamaService.ts:4840  armPrefillDeadline();          // main round, immediately before engine.completion()
LlamaService.ts:5266  armPrefillDeadline();          // tool-exhausted fallback round
```

Both are inside `streamAssistantTurn` → `withEngineJob` and both sit right above the
`engine.completion(...)` call (`:4841-4870` and `:5267-5304`).

### 1.3 What the timer does when it fires

`LlamaService.ts:4173-4197` (READ IN THE CODE):

```
LlamaService.ts:4173    prefillTimer = turnTimer.setTimeout(() => {
LlamaService.ts:4174      prefillTimer = null;
LlamaService.ts:4175      if (finished || aborted) return;
LlamaService.ts:4177        console.log(
LlamaService.ts:4178          `KALSA_STALL ${JSON.stringify({
LlamaService.ts:4179            gapMs: 0,
LlamaService.ts:4180            tokens: stallTokenCount,
LlamaService.ts:4181            turnId,
LlamaService.ts:4182            reason: "prefill",
LlamaService.ts:4183            tokPerSec: prefillTokPerSec,
LlamaService.ts:4184          })}`,
LlamaService.ts:4189      abort(
LlamaService.ts:4190        new Error(
LlamaService.ts:4191          strings.errors.prefillStalled.replace(
LlamaService.ts:4192            "{seconds}",
LlamaService.ts:4193            String(Math.max(1, Math.round(deadlineMs / 1000))),
```

The `{seconds}` interpolated here is the **deadline**, not the elapsed time — which is why the
persisted notice reads `entro 739 s` and `entro 1355 s` in the two runs (READ IN THE CODE;
string at `src/i18n/it.ts:694-695`, English at `src/i18n/en.ts:695-696`).

`turnTimer` is a **background/pause-proof** timer, `LlamaService.ts:4053`
(`const turnTimer = createBackgroundTimer();`), with the rationale at `:4050-4052` (READ IN THE
CODE): "these watchdogs must fire while the Android host is paused, where plain RN timers are
suspended".

### 1.4 The abort

`LlamaService.ts:4077-4116` (READ IN THE CODE):

```
LlamaService.ts:4077  const abort = (error?: Error) => {
LlamaService.ts:4078    assembleOutcome = markAssembleOutcome(assembleOutcome, "aborted");
LlamaService.ts:4079    aborted = true;
LlamaService.ts:4080    stopStallWatchdog();
LlamaService.ts:4081    finishOnce(() => {
             ... partial thinking / raw accumulation / abort marker ...
LlamaService.ts:4105    if (error) callbacks.onError(error);
LlamaService.ts:4106    else callbacks.onDone();
LlamaService.ts:4113    if (engine === context) {
LlamaService.ts:4114      void engine.stopCompletion().catch(() => undefined);
LlamaService.ts:4115    }
```

`stopStallWatchdog` (`:4062-4066`) stops the 2 s repeat timer and clears the prefill timer:
`stallTimer.stop(); clearPrefillDeadline(); stallWatchdog.reset();`. `finishOnce` (`:4070-4075`)
latches `finished`.

`engine.stopCompletion()` is the binding's `llamaStopCompletion`, which sets the native flag
(`node_modules/llama.rn/cpp/jsi/RNLlamaJSI.cpp:1343-1345`, READ IN THE CODE):

```
1337  auto stopCompletion = jsi::Function::createFromHostFunction(runtime,
1340  [callInvoker](... ) -> jsi::Value {
1341    int contextId = (int)arguments[0].asNumber();
1342    auto ctx = getContextOrThrow(contextId);
1343    if (ctx->completion) {
1344      ctx->completion->is_interrupted = true;
1345    }
```

That flag is the source of the `Decoding Interrupted` log — see section 3(c), which is where the
slow/hung discriminator turns out to live.

### 1.5 Can anything ELSE abort the prefill? — No.

* **The 45 s gap watchdog cannot fire before the first token.** `checkStall`
  (`LlamaService.ts:4117-4141`) reads `stallWatchdog.check()`; `createStallWatchdog` returns
  `stalled:false` whenever no token has been noted (`src/engine/stallWatchdog.ts:55-58`, READ IN
  THE CODE):

  ```
  stallWatchdog.ts:55    check: () => {
  stallWatchdog.ts:56      if (tokenAt.length === 0) {
  stallWatchdog.ts:57        return { stalled: false, reason: "gap", gapMs: 0, tokPerSec: 0 };
  stallWatchdog.ts:58      }
  ```

  `noteToken` is only called from the token callback (`LlamaService.ts:4885`, `:5289`). The
  stall timer is additionally not started until then (`startStallWatchdog` at `:4888`, `:5292`);
  it is stopped at the round top (`:4783`) and at abort.
* **The foreground-idle backstop never disposes a pre-first-token turn.**
  `src/app/foregroundIdleDispose.ts:37-42` returns `undefined` when no raw token of this turn has
  arrived, and `shouldRunForegroundIdleDispose` returns false for `tokenSilenceMs === undefined`
  (`:61-66`, READ IN THE CODE), with the explicit comment at `:47-51`: "pre-first-token turns are
  never app-disposed (a cold 5441-token prefill legitimately exceeds 900 s, so no fixed bound may
  exist here)".
* The `AbortSignal` path (`LlamaService.ts:4199-4205`) aborts only on an external signal
  (user stop, background discard, model change), not on elapsed time.

**Conclusion (READ IN THE CODE):** during the prefill window, the prefill deadline is the ONLY
watchdog that can abort the turn. The 739 s number is therefore exactly the deadline function's
output, and it is emitted with `gapMs:0`, `tokens:0`.

### 1.6 The full chain, SEND → abort

READ IN THE CODE, in order:

| # | step | file:line |
|---|---|---|
| 1 | user send → `handleSend` | `src/screens/AiChatPage.tsx:2177` |
| 2 | `KALSA_SEND` (send-state breadcrumb) | `src/screens/AiChatPage.tsx:2197` |
| 3 | pre-send fit gate → `KALSA_SEND {phase:"fit"}` | `src/screens/AiChatPage.tsx:2063` |
| 4 | `handleSend` calls the injected stream callback | `src/screens/AiChatPage.tsx:2563` (`onSendStream`, prop typed at `:327`) |
| 5 | AppShell implements it as `handleSendStream` | `src/app/AppShell.tsx:5363`, wired at `:7022` (`onSendStream={handleSendStream}`) |
| 6 | window assembly → `KALSA_WINDOW {... "textEst":8292}` | `src/app/AppShell.tsx:6525` |
| 7 | `await streamAssistantTurn(...)` | `src/app/AppShell.tsx:6628` |
| 8 | `streamAssistantTurn` entry | `src/engine/LlamaService.ts:3989` |
| 9 | single FIFO engine job | `src/engine/LlamaService.ts:4009` (`withEngineJob`) |
| 10 | `KALSA_THINKING {...}` | `src/engine/LlamaService.ts:4234` |
| 11 | **`armPrefillDeadline()`** | `src/engine/LlamaService.ts:4840` |
| 12 | `engine.completion(params, tokenCallback)` | `src/engine/LlamaService.ts:4841-4905` |
| 13 | deadline fires → **`KALSA_STALL {"reason":"prefill","tokens":0}`** | `src/engine/LlamaService.ts:4177-4185` |
| 14 | **`abort(new Error(prefillStalled))`** | `src/engine/LlamaService.ts:4189` |
| 15 | `abort` → `stopStallWatchdog()` (stops both timers) | `src/engine/LlamaService.ts:4080` |
| 16 | `abort` → `callbacks.onError(error)` | `src/engine/LlamaService.ts:4105` |
| 17 | `abort` → `engine.stopCompletion()` → native `is_interrupted = true` | `src/engine/LlamaService.ts:4113-4114` → `RNLlamaJSI.cpp:1344` |
| 18 | AppShell `onError` persists `⚠️ ${error.message}` (the `entro 739 s` notice), marks the turn failed, calls `finish()` | `src/app/AppShell.tsx:6658-6677` (delta at `:6671`) |
| 19 | native prompt-decode loop observes the flag → `LOG_INFO("Decoding Interrupted")` | `node_modules/llama.rn/cpp/rn-completion.cpp:1791-1796` |

Steps 11-14 are the abort mechanism; step 19 is the observation that decides the question and is
analysed in section 3.

---

## 2. IS THERE A KNOB ALREADY?

### 2.1 Every `kalsa.bench.*` key the app reads

All READ IN THE CODE. Definitions are the `BENCH_*_KEY` constants; the effect column is what the
getter's callers do with the value.

| key | defined at | read at | what it does |
|---|---|---|---|
| `kalsa.bench.thinking` | `src/bench/benchConfig.ts:52` | `:374` (`getThinkingMode`) | thinking-budget mode `default`/`budget256`/`budget512`; feeds `resolveThinkingParams` → `n_predict` and the thinking fields of the completion. |
| `kalsa.bench.format` | `:53` | `:385` (`getBlockFormat`) | operative-block placement `none`/`system-end`/`user-prefix`/`user-note`; changes the assembled prompt bytes. |
| `kalsa.bench.speculative` | `:54` | `:594` (`getSpeculativeOverride`) | JSON speculative/MTP/draft config applied at ENGINE INIT. |
| `kalsa.bench.engine` | `:55` | `:746` (`getEngineOverride`) | JSON engine-init override `{nGpuLayers, nThreads, nThreadsPrefill, nUbatch, flashAttn, moeStream, useMmap}`; applied at init (`LlamaService.ts:2386-2402`). |
| `kalsa.bench.toolchoice` | `:56` | `:396` (`getToolChoiceMode`) | `auto`/`required`/`none` tool_choice. |
| `kalsa.bench.toolgate` | `:57` | `:509` (`getToolGateEnabled`) | **dev build only** (`isDevBuild()` guard, `:507`); disables the echo-of-context gate. |
| `kalsa.bench.nctx` | `:58` | `:412` (`getBenchNCtx`) | bench `n_ctx` override, floor 8192; changes the window and therefore the prompt size. |
| `kalsa.bench.winbudget` | `:59` | `:427` (`getBenchWindowBudget`) | verbatim-window char budget → how much history is assembled. |
| `kalsa.bench.legacywindow` | `:60` | `:443` (`getBenchLegacyWindow`) | legacy sliding-window depth. |
| `kalsa.bench.ranking` | `:61` | `:479` (`getBenchRanking`) | digest retriever ranking `bm25`/`hybrid`. |
| `kalsa.bench.digestcadence` | `:62` | `:458` (`getBenchDigestCadence`) | digest injection cadence K. |
| `kalsa.bench.norepack` | `:64` | `:540` (`getBenchNoRepack`) | tri-state ARM weight-repack lever, ENGINE INIT only. |
| `kalsa.bench.devmodels` | `:65` | `:80` (`getDevModelsEnabled`) | DEV model catalog switch; restart required. |
| `kalsa.bench.sampling` | `src/engine/benchSampling.ts:3` | `:30` (`readBenchSampling`) | `"greedy"` forces deterministic sampling + `n_predict>=48`. |
| `kalsa.bench.probs` | `:4` | `:41` (inside `readBenchOracleParams`) | `"1"` → `bench_raw_probs` (per-token probability dump). |
| `kalsa.bench.force_ids` | `:5` | `:42` (inside `readBenchOracleParams`) | JSON array of forced token ids. |
| `kalsa.bench.energy_trace` | `src/engine/governorBatterySampler.ts:11` | `:26` (`readBenchEnergyTraceEnabled`) | `"1"` starts the 1 Hz battery CSV. Observational only. |
| `kalsa.bench.thermo` | `src/engine/governorInputs.ts:9` | `:192` (`readGovernorThermo`) | JSON fake thermal profile (`thermo_source:"bench-skin"`) that bypasses the battery. |
| `kalsa.bench.governor_force` | `src/engine/governorInputs.ts:10` | `:148` (`readBenchGovernorForce`) | `"1"` forces the governor path on. |

Keys on the device today (from meter-close REPORT, section (f)): `thinking|default`, `format|none`,
`toolgate|1`, `winbudget|6451`, `devmodels|1`, `engine|{"useMmap":false}`. **Observation:** the
device also carries `kalsa.bench.kvtranscript|1`, but a repo-wide search finds that string only in
`scripts/` and in comments (`scripts/device-share-send.sh:14`, `scripts/campaign/flags.sh:76`) —
**no `src/` file reads it**. It is a dead key: the app ignores it (READ IN THE CODE).

### 2.2 Other AsyncStorage keys that change timing

READ IN THE CODE; these are not in the `kalsa.bench.*` namespace but they move the same levers:

| key | defined at | read at | timing effect |
|---|---|---|---|
| `kalsa.governor.enabled` | `src/engine/governorRuntime.ts:3` | `:17` | turns the per-phase governor off/on → engine routing (GPU-prefill vs CPU) and thread pools. |
| `kalsa.context.size` | `src/engine/contextSizePref.ts:14` | `:38` | user context-size preference → `n_ctx`, hence window/prompt size. |
| `kalsa.kv.cache` | `src/engine/kvCachePref.ts:19` | `:47` | KV cache quantisation → memory and speed. |
| `kalsa.device.bandwidth.v1` | `src/engine/deviceThroughputStore.ts:8` | `:14` | stored device bandwidth fed to load policy/tuning. |
| `kalsa.context.compaction` | `src/context/compactor.ts:275` | `AppShell.tsx:5791` | compaction on/off. |
| `kalsa.context.compaction.choice` | `src/context/compactor.ts:297` | `AppShell.tsx:5792` | context mode (`ciswire`/`off`/`anchored`) → window strategy. |
| `kalsa.ciswire.toolhelp` | `src/context/compactor.ts:278` | `AppShell.tsx:5793` | digest tool-help block. |
| `kalsa.memory.enabled` / `kalsa.memory.facts` | `src/memory/MemoryStore.ts:50` / `:49` | `:406`,`:452` / `:250` | memory facts injected into the prompt. |
| `kalsa.kbDebug` | literal, `src/screens/AiChatPage.tsx:882` | `:882` | UI/debug only (no engine timing path found). |

### 2.3 Verdict: is there a knob for the prefill deadline or the stall abort?

**No AsyncStorage key, bench or otherwise, can raise or disable the prefill deadline.** READ IN
THE CODE, by exhaustion:

* `prefillDeadlineMs` has exactly one production caller (`LlamaService.ts:4168`); its inputs are
  `currentMessages` (prompt bytes), the in-memory EMA and the module constant
  `MIN_PREFILL_DEADLINE_MS` (`LlamaService.ts:4171`). No storage read appears anywhere in that
  chain (`prefillDeadline.ts` imports nothing).
* `MIN_PREFILL_DEADLINE_MS`, `NO_EMA_PREFILL_TOK_PER_SEC`, `MAX_NO_EMA_PREFILL_DEADLINE_MS` are
  module constants (`prefillDeadline.ts:2,4,7`), never read from storage.
* `GENERATION_STALL_GAP_MS = 45_000` (`src/engine/stallWatchdog.ts:15`) is likewise a constant and
  is not storage-driven.

**But there IS an existing, build-free lever on which BRANCH runs — and branch 2 is longer.**
The deadline is `max(180s, 5*ceil(est/rate)*1000)` when an EMA exists versus
`min(900s, max(180s, ceil(est/10)*1000))` when it does not; for any `rate < 50 tok/s` the EMA
branch is larger. The EMA is seeded by `recordPrefillSample` (`prefillSpeed.ts:35`) from either a
completed chat turn with `prompt_n >= 64` (`LlamaService.ts:1634`) or a completed static-prefix
prewarm (`LlamaService.ts:1388-1392`). This is not a key: it is in-memory process state
(`prefillSpeed.ts:19-20`), and it is exactly what separated the two observed deadlines — the
meter-close report records Step B with `tokPerSec:29.332381873019724` (branch 2, 1355 s) and
today's real-conversation run with `tokPerSec:null` (branch 1, 739 s), the latter preceded by
`KALSA_PREWARM op skip already_warm`, the former by a real `op done promptMs=73195.556`.

**INFERRED (from the above + the meter-close report):** the 739 s vs 1355 s difference is the
branch difference, and the branch was selected by whether a prefill sample had been recorded in
that process — not by anything the operator set. This is the closest thing to a "knob" that
exists, and it does not require a build (section 4a).

The `kalsa.bench.engine` override can make the prefill faster (`nThreadsPrefill`, `nUbatch`) but
cannot extend the deadline; `kalsa.bench.winbudget`/`legacywindow`/`nctx` shrink the prompt and so
shrink both the estimate and the work.

---

## 3. WHAT IS OBSERVABLE DURING PREFILL TODAY?

### 3(a) The verbosity the app sets for the native engine

READ IN THE CODE. The app enables the native log with the binding's default layer, no level
argument:

```
LlamaService.ts:493  async function ensureNativeLogCapture(): Promise<void> {
LlamaService.ts:494    if (nativeLogSetupDone) return;
LlamaService.ts:495    try {
LlamaService.ts:496      await toggleNativeLog(true);
LlamaService.ts:497      addNativeLogListener((level, text) => {
LlamaService.ts:498        const line = `${level} ${text}`;
             ...
LlamaService.ts:514        console.log(`KALSA_NATIVE ${level} ${text}`);
LlamaService.ts:515      });
```

The binding maps `toggleNativeLog(true)` onto `llama_log_set(logToJsCallback, nullptr)`
(`node_modules/llama.rn/cpp/jsi/RNLlamaJSI.cpp:1353-1385`), and `logToJsCallback` forwards every
level it receives (`:253-288`), labelling `ERROR`/`WARN`/`INFO` explicitly and everything else as
`"info"` (`:270-276`). Two independent channels therefore reach the phone's logcat:

1. the fork's own `rnllama::log` macros (`LOG_INFO`/`LOG_WARNING`/`LOG_ERROR`), tag `RNLlama`;
2. ggml/llama-core output via `llama_log_set`, mirrored by the app to tag `ReactNativeJS` as
   `KALSA_NATIVE <level> <text>`.

**The operative limitation is compile-time, not a level:** `LOG_VERBOSE` expands to nothing unless
`RNLLAMA_VERBOSE == 1` (`cpp/rn-llama.h:286-297`, READ IN THE CODE), and the comment at
`cpp/rn-completion.cpp:495-498` states it plainly: *"Upstream dumps every prompt token id here, and
rnllama::log reaches logcat ungated in release builds (only LOG_VERBOSE is compiled out)"*. So in
the shipped release APK, `LOG_INFO` and `LOG_WARNING` always reach logcat, and `LOG_VERBOSE` never
does.

### 3(b) Does the token callback fire during prefill? — No.

The completion runs as: `llamaCompletion` → `ctx->completion->loadPrompt(...)` then the generation
loop (READ IN THE CODE):

```
RNLlamaJSI.cpp:1236    ctx->completion->loadPrompt(mediaPaths);
RNLlamaJSI.cpp:1249    while (ctx->completion->has_next_token && !ctx->completion->is_interrupted) {
RNLlamaJSI.cpp:1250      const rnllama::completion_token_output token_with_probs = ctx->completion->doCompletion();
RNLlamaJSI.cpp:1296              callInvoker->invokeAsync([onToken, tokenResult, contextId, runtime]() {
RNLlamaJSI.cpp:1302                onToken->call(rt, fromJson(rt, tokenResult));
```

`onToken` is invoked only inside that post-`loadPrompt` loop. The prompt decode itself happens in
`nextToken()` (`cpp/rn-completion.cpp:1205`, called from `doCompletion` at `:2000-2002`) inside the
loop at `cpp/rn-completion.cpp:1564`: `while (n_past < embd.size())`. Nothing in that loop invokes
the JS callback. The app relies on this: it treats the first callback as proof prefill finished and
disarms the deadline there (`LlamaService.ts:4871-4884`):

```
LlamaService.ts:4871              (data: TokenData) => {
LlamaService.ts:4875                promptAdopted = true;
LlamaService.ts:4883                if (finished || aborted) return;
LlamaService.ts:4884                clearPrefillDeadline();
LlamaService.ts:4885                stallWatchdog.noteToken();
```

So **no JS-visible signal of any kind is produced during prefill.**

### 3(c) Any counter observable while the prefill runs? — Nothing per-chunk.

READ IN THE CODE. The plain-text path emits at `loadPrompt` time, all before the decode loop:

```
rn-completion.cpp:499  LOG_INFO("%s: prompt_n=%zu n_ctx=%d embd=%zu",
rn-completion.cpp:500      __func__, num_prompt_tokens, parent_ctx->n_ctx, embd.size());
rn-completion.cpp:533  rnllama::log("WARNING", __func__, __LINE__,
rn-completion.cpp:534      "KALSA_KVPREFIX embd=%zu text_tokens=%zu n_common=%zu mtp_draft_mem_shared=%d is_enc_dec=%d this=%p", ...);
rn-completion.cpp:551  rnllama::log("WARNING", __func__, __LINE__,
rn-completion.cpp:552      "KALSA_KVDIVERGE n_common=%zu shared_lo=%zu embd_hi=%zu text_hi=%zu", ...);
rn-completion.cpp:639  rnllama::log("WARNING", __func__, __LINE__,
rn-completion.cpp:640      "KALSA_KVREUSE checkpoint n_past=%d prompt=%zu n_common=%zu", ...);
```

Inside the decode loop (`rn-completion.cpp:1564-1808`) there is **no** `LOG_INFO` or `LOG_WARNING`
per batch. The loop advances `n_past += n_eval;` at `:1695` silently. The only per-iteration
logging is `LOG_VERBOSE` (`:710` "prompt ingested, n_past: %d ...", `:2037` "next token, ..."), which
is compiled out in release.

`n_past`/`cache_n` are not exposed to JS during a plain completion either. `llamaGetParallelStatus`
exists (`RNLlamaJSI.cpp:1704-1724`) but requires `parallel_mode_enabled`, which the app never
enables, and it reports slot state transitions (`queued` / `processing_prompt` / `generating`), not
prompt progress — and the app does not use `queueCompletion` at all (READ IN THE CODE; no `src/`
reference to `enableParallelMode`, `queueCompletion`, `getStatus`).

**Direct evidence from a preserved artefact** (READ). The ladder's raw logcat
(`scratchpad/agents/meter-close/raw/coder-artifacts/ladder.logcat`, covering 12:48:12-13:26:10) shows
the entire engine-side output around two completed prefills:

* turn 4, prefill 108.4 s: four lines, all at `12:51:44.962-963`
  (`loadPrompt:500 prompt_n=3872 n_ctx=16384 embd=3279`, `KALSA_KVPREFIX`, `KALSA_KVDIVERGE`,
  `KALSA_KVREUSE checkpoint n_past=2384 prompt=3872 n_common=2491`), then nothing until telemetry.
* turn 5, prefill 312.8 s: two lines, both at `12:55:31.653`
  (`loadPrompt:500 prompt_n=6328 n_ctx=16384 embd=4034`, `KALSA_KVPREFIX`), then nothing.

Filtering that window for `RNLlama` or `KALSA_NATIVE` returns **0 lines** for the 312.8 s prefill
window (`12:55:32.000`-`13:00:44.800`). The first native output after the prefill is the
decode-phase `KALSA_NATIVE info Grammar still awaiting trigger after token ...` burst starting
`13:01:32.527`, i.e. inside decoding, not prefill.

Note on the meter-close phrasing: its `realconv.log` is the **watcher log**, not a raw logcat (0
`KALSA_NATIVE` lines by construction), so "no KALSA_NATIVE output observed" for the reproduced
stall is not evidence from a raw capture. The ladder logcat is the artefact that establishes the
absence of per-chunk output.

**Conclusion (READ IN THE CODE):** during prefill the phone logs exactly what it logs before the
prefill. Nothing distinguishes "n_past = 400" from "n_past = 7000" while the turn is stuck.

### 3(d) Can the existing artefacts distinguish slow from hung? — The four listed signals cannot;
one extra line they already contain partially can.

Plainly, **the four signals named in the question — 739 s elapsed, zero tokens, ~7 cores busy, no
KALSA_NATIVE output — cannot distinguish slow from hung.** A prefill crawling at ~1 token/s and a
pathological busy-spin both burn multiple cores, produce no tokens and print nothing; "no
output" is expected in both cases because the code prints nothing per chunk (3c). A hung process
blocked in a mutex would show low CPU, so ~7 cores argues against a simple deadlock, but it does not
prove forward progress — a thrash/spin loop is pegged too.

**However, one artefact already carries a weak discriminator: the `Decoding Interrupted` line.**
On the reproduction it was logged at `+790.0 s`, 51 s after the abort (READ in
`realconv-markers.txt`; format from `rn-completion.cpp:1791-1796`):

```
09-21 13:51:00.336 I/RNLlama ( 3538): nextToken:1792 Decoding Interrupted
```

That `LOG_INFO` sits **inside** the prompt-decode loop — `rn-completion.cpp:1791` is at the loop
body's indentation, inside the `while (n_past < embd.size())` opened at `:1564` and closed at
`:1808` — and is reached only after the in-flight `llama_decode` returns:

```
rn-completion.cpp:1791          if(is_interrupted) {
rn-completion.cpp:1792              LOG_INFO("Decoding Interrupted");
rn-completion.cpp:1793              embd.resize(n_past);
rn-completion.cpp:1794              has_next_token = false;
rn-completion.cpp:1795              return result;
rn-completion.cpp:1796          }
```

Consequently (INFERRED): at +790 s the engine thread **returned from a `llama_decode` and reached
the loop's interrupt check**, so the prompt-decode loop was alive, not deadlocked in a
never-returning call. The 51 s gap between the abort (+739 s) and that log is the tail of the
in-flight batch — consistent with one `n_batch = 512` chunk (`LlamaService.ts:2399`
`n_batch: 512`) at roughly 10 tok/s, i.e. exactly the `NO_EMA_PREFILL_TOK_PER_SEC = 10` assumption.
What this does **not** give is a count: it proves at least one chunk advanced, not how many of the
~16 chunks were done at +739 s. It is therefore consistent with SLOW and hard to reconcile with a
permanent hang, but it is not a progress trace, and it says nothing about whether the prefill would
have finished in product-acceptable time.

**Verdict for section 3 (INFERRED):** the existing artefacts lean "slow/active compute, not
deadlock", but they do not decide it. A quantified answer requires the one missing signal — a
progress line — or the branch-2 extension experiment in section 4a.

---

## 4. THE CHEAPEST DECISIVE EXPERIMENT

### 4(a) A knob-equivalent exists: select the longer deadline branch, no rebuild

Section 2 found no key that disables the deadline, but it found the **branch selector**: an
in-memory prefill EMA makes `armPrefillDeadline` take branch 2
(`max(180s, 5*ceil(est/rate)*1000)`), which is longer than branch 1's `ceil(est/10)*1000` for any
`rate < 50 tok/s`. Step B is the proof: same conversation, same class of build, `tokPerSec:
29.332381873019724` in the `KALSA_STALL` line and a 1355 s deadline instead of 739 s.

The seed is a completed sample: `recordPrefillSample` is fed by a completed chat turn with
`prompt_n >= 64` (`LlamaService.ts:1634` + `prefillSpeed.ts:17`) or a completed static-prefix
prewarm (`LlamaService.ts:1388-1392`). Nothing on the device reads or writes this — it is process
state (`prefillSpeed.ts:19-20`), so the entire sequence must stay in **one app process**.

Sequence (Jelly `192.168.1.82:5555`, next coder; no build, no uninstall, `install -r` not needed):

1. Preflight as in the meter-close cell: discharging (`AC/USB/Wireless false`, level >= 30 %),
   verify the installed `base.apk` sha256, app force-stopped, then launched.
2. **Seed the EMA in a throwaway chat.** Open a new conversation and send a ONE-SENTENCE prompt
   long enough that the telemetry records `prompt_n >= 64` (the ladder's rung 1a, 41 chars, logged
   `prompt_n 84`; rung 0's `prompt_n 34` is BELOW the 64 floor, so `2+2` does not seed). Wait for
   the answer and confirm the `KALSA_TELEMETRY` line carries `prompt_n >= 64`.
3. **Do not restart the app and do not switch model.** The JS process must survive; a force-stop
   or a JS reload wipes the EMA. Switching conversation is fine (the EMA is keyed by model id).
4. Open the real ~8k conversation (`conv-1789854932144-696fm3wu`) and send the tiny prompt (`2+2`).
   Start a bounded wall-clock watcher on `adb logcat -s ReactNativeJS RNLlama`, and read the first
   of: a token callback, `KALSA_TELEMETRY`, or `Decoding Interrupted`.
5. Record the wall time of the first token and, if the turn finishes, `promptMs` / `prompt_n` from
   `KALSA_TELEMETRY`.

Why this is decisive, and its limit (INFERRED, arithmetic on the read constants): with a seeded
rate of, say, the ladder's 13.7 tok/s (turn 4's `prompt_n 1488` / `108413 ms`), branch 2 gives
`5*ceil(est/13.7)`; at the observed `est ≈ 7390` that is ~2700 s — comfortably past the point where
an 8k prefill at the ladder's measured 7-20 tok/s would have produced its first token. Predictions:

* **SLOW** → the first token appears at a wall time `T` consistent with `prompt_n / rate` for the
  ladder's measured rates (turn 5's 6328 evaluated / 312.8 s ≈ 20 tok/s, or 2294 new / 312.8 s ≈
  7.3 tok/s); the eventual `promptMs` is in the same band.
* **HUNG** → nothing at all, CPU still pegged, until the (now much later) deadline fires with zero
  tokens.

The limit, stated plainly: this settles the question only if the true rate is above roughly
`est / deadline_extended ≈ 6 tok/s`. Below that the run still ends in a stall and the answer stays
open — which is exactly why 4(b) is the instrument of record.

### 4(b) Minimal instrumentation if the branch-2 run is not enough

The smallest change that proves progress is **one throttled `LOG_INFO` inside the prompt-decode
loop, in the binding fork** `Aspis0/kalsa.rn`, file `cpp/rn-completion.cpp`. The phone vendors that
fork at pin `0288dc27` and occupies this file (the app's `node_modules/llama.rn/cpp/rn-completion.cpp`
is the same tree).

**Exact spot:** immediately after `n_past += n_eval;` at `cpp/rn-completion.cpp:1695`, inside the
`while (n_past < embd.size())` loop opened at `:1564`. Suggested minimal line (one `if`, one log,
no new state, no new file, no refactor):

```cpp
        n_past += n_eval;
        if ((n_past / 1024) != ((n_past - n_eval) / 1024)) {
            LOG_INFO("KALSA_PREFILL n_past=%d/%zu n_eval=%d", (int) n_past, embd.size(), n_eval);
        }
```

`LOG_INFO`, never `LOG_VERBOSE`: `LOG_VERBOSE` is compiled out of release builds
(`cpp/rn-llama.h:286-297`), which is the whole reason the current 739 s window is blank. `n_eval` is
in scope there (declared at `:1583`), and `n_past` is the value the loop itself treats as progress.

**Why that spot is right:** `n_past` is incremented there only after `llama_decode` returns
(`:1680-1695`), so the line is a monotonic proof of evaluated prompt tokens; it is in the same loop
as the interrupt check (`:1791`), so it also covers the chunk in flight at the abort; and a stride
throttle (every 1024 tokens, ~2 lines at 8k) costs two log lines per turn, so it does not perturb
the measurement it reports.

What its presence/absence over 739 s would mean:

* **lines with growing `n_past`** → prefill is progressing; the slope is the real prefill tok/s and
the product story is "too slow", with a number.
* **one or two lines then silence** → the loop advanced a chunk or two and then stopped: hung after
partial progress (a thrash/lock after some work).
* **no line after `loadPrompt:500`** → the first chunk's `llama_decode` never returned in 739 s:
hung before any progress.

The one-line change is native, so it does require one APK rebuild — that is unavoidable; there is no
JS-visible signal during prefill because the token callback does not fire (3b) and no counter is
exposed (3c).

### Falsifiable predictions, both branches

| observation | SLOW | HUNG |
|---|---|---|
| `KALSA_PREFILL` lines over the window | monotone `n_past`, slope = measured tok/s | flat/absent |
| first token wall time `T` | `T` ≈ `prompt_n / rate`, rate inside the ladder's band | never |
| CPU | pegged (7 cores) while `n_past` climbs | pegged with no `n_past` movement, or low |
| eventual `promptMs` / `prompt_n` | consistent with the ladder's per-token rates | no telemetry, `reason:"prefill"` again |
| branch-2 (EMA) run | first token before the extended deadline | still zero tokens |

### 4(c) The one thing I would NOT do

Do not read the `0.15 core` idle + `Tocca per ricaricare` signature as a discriminator: that is the
engine AFTER disposal. Disposal is not evidence about prefill progress. Likewise, the 51 s
abort-to-`Decoding Interrupted` gap is suggestive but must not be published as a measurement of
per-chunk time until the progress line exists.

---

## 5. UNKNOWN LIST

What I could not establish, and what would settle each item:

1. **The true prefill tok/s at ~8k on the Jelly.** Not measured: the ladder's largest completed
   input was `prompt_n 2294` / `tokensEvaluated 6328` at turn 5, and no completed run exists at
   `textEst ~8.3k`. Settled by 4(a) or 4(b).
2. **Whether the rate collapse with context is monotone or pathological** (e.g. attention cost,
   KV/recurrent-state rework, or a per-chunk repack). No engine-side timings exist for the failing
   size. Settled by the `KALSA_PREFILL` slope across the whole 8k run (does it stay linear, or does
   it bend?).
3. **Whether the 51 s abort-to-`Decoding Interrupted` gap is exactly one `n_batch = 512` chunk.**
   INFERRED from `LlamaService.ts:2399` (`n_batch: 512`) plus ~10 tok/s; not measured. Settled by
   the progress line's `n_eval` and timestamps.
4. **Whether the shipped/loaded `n_batch`/`n_ubatch` is 512 or a device-tuning value.**
   `LlamaService.ts:2399` sets `n_batch: 512`, but `deviceTuning.ts:731-738` computes `n_ubatch`
   and `:2402` passes it; the effective chunk size was not confirmed on-device. Settled by logging
   `n_eval` (4b) or by reading back the tuning on the Jelly.
5. **Whether the turn was on a knife edge** — i.e. whether it would have produced a token shortly
   after 739 s. The two rate bases in the meter-close report imply ~410 s (evaluated basis) or
   ~1136 s (new-tokens basis) for 8k; the deadline landed at 739 s between them. Settled by a
   single branch-2 run (4a).
6. **The exact `promptTokensEstimate` fed to the deadline.** Not preserved (meter-close REPORT,
   corrections item 2); today's 739 s only constrains it to 7381-7390. Settled by logging `est`
   and `deadlineMs` at arming time (a JavaScript one-liner in `armPrefillDeadline`, but that is
   another rebuild).
7. **Process health during the 739 s** beyond CPU jiffies (no `ps`/`proc` RSS, swap, GC or thread
   dump was preserved). Settled by sampling `/proc/<pid>/status` and `dumpsys meminfo` during a
   branch-2 run.
8. **Whether the reproduced real-conversation stall printed any native line at all.** The run has
   no raw logcat (`realconv.log` is the watcher log, 0 `KALSA_NATIVE` lines by construction).
   Settled by the progress line plus an unfiltered logcat capture on the next run.
9. **Whether a JS-visible prefill signal can be made without a native rebuild** (e.g. making the
   app subscribe to binding status or poll a native accessor while the completion runs). I found
   none in the code (3c). Settled only by a new binding accessor, i.e. a rebuild anyway.

No file was edited except this report; no `adb` write, install, app-data change, build, commit,
push or tag was performed. Scope was held to the phone line (the app plus the binding fork as the
phone consumes it); no other repository or checkout was opened or read.
