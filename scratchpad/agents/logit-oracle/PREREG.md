# PREREG — logit-margin oracle for GPU-vs-CPU prefill correctness in the app (cell logit-oracle, 6/09)

Owner 6/09: "l'importante è che non facciamo passare una cosa che poi è sbagliata e generare cose sbagliate".
Design principle, binding: the new oracle must be at least as strict as the token oracle wherever the CPU is
confident, and stricter than it where the token oracle is blind (equal tokens with drifted probabilities).

## Why
The strict token oracle (32 greedy ids, CPU-prefill vs GPU-prefill) FAILs on Adreno 732/735/750 at index 7 with a
byte-identical GPU sequence on the three GPUs, while the 732 passes all kernel tests. A greedy near-tie flip cannot
be told from a real error by token equality. Evidence: S5b runs 8/9/10, ALIVE 52-54, PREREG post hoc run 9.

## What is measured
For each of the 32 continuation steps, in BOTH arms, the pre-sampling top-5 (token id, logprob) after the prompt
(A = CPU prefill, B = GPU prefill, decode on CPU in both). Two modes:
- **TF (teacher-forced, primary):** arm B is constrained (literal grammar) to emit exactly arm A's 32 tokens, so all
  32 steps are comparable; the logged probabilities must be the PRE-grammar distribution (otherwise the mode is
  invalid and only mode G counts).
- **G (free greedy, secondary):** as today; comparable steps = those before the first divergence.

## Rules (PASS requires ALL; any violation = FAIL)
R1 Confident disagreement = FAIL: at any comparable step where CPU margin p1−p2 ≥ 0.03, B's top-1 must equal A's top-1.
R2 Distribution agreement: at every comparable step, for every token in A's top-5 with pA ≥ 0.02, the token is in
   B's top-5 and |logpB − logpA| ≤ 0.10 nats; and |pB(top1) − pA(top1)| ≤ 0.02.
R3 Divergences (mode G only): a divergence is allowed only if CPU margin < 0.03 AND B's choice is A's #2; at most 1
   divergence per 32 steps.
R4 Coverage: mode TF must yield 32 comparable steps on ≥ 2 same-turn pairs per board; otherwise the result is
   descriptive only.
R5 Sanity (before any board is judged): the 8 Elite (known-good GPU) must PASS R1–R4 on ≥ 2 pairs; a deliberately
   broken kernel build (e.g., the baseline 750 kit's failing path exercised, or a fault-injected build) must FAIL.
   If either sanity check does not hold, the oracle is rejected and the token oracle stays.
R6 No automatic promotion: a PASS is reported; enabling GPU prefill on a generation in production is the owner's
   decision on the numbers.
Thresholds (0.03 / 0.02 / 0.10 nats) are fixed here before any data; they may be tightened after the sanity runs,
never loosened.

## Implementation (to be studied first, then built)
App (feat/governor-in-app): the bench path emits `KALSA_BENCH_PROBS {"turnId","step","top":[[id,logp]×5]}` per
step when `kalsa.bench.sampling=greedy` (existing) and a new bench key `kalsa.bench.probs=1`; teacher forcing via a
bench key `kalsa.bench.force_ids` (the 32 ids from arm A) applied as a literal grammar in arm B; both bench-only.
Feasibility questions (Luna): does llama.rn 0.12.8 expose per-step `n_probs`/`completion_probabilities` with
pre-sampling (pre-grammar) probabilities, or `post_sampling_probs` toggles; is a grammar per completion supported
through the patched API; cost per step. Driver: parse the probs from logcat, compute R1–R3 per pair, oracle column
becomes PASS/FAIL/DESCRIPTIVE with the failing rule named.

## Implementation status (6/09 09:15)
- App: commit 28424c3 on feat/governor-in-app (native hook in the llama.rn patch: `benchRawTopProbs` = softmax over
  `llama_get_logits_ith(ctx,-1)` before `common_sampler_sample`; `bench_force_ids` consumed one id per step through
  the normal accept path; exhaustion = clean stop; bench keys only under `kalsa.bench.sampling=greedy`). Audit #26 GO;
  minor F6 accepted as mitigated: the governor-fallback completion path would re-emit a prob stream under the same
  turnId, but a fallback B row is VOID (`governor_fallback`) and the helper never runs on it; to be gated in a
  later cleanup.
- Driver: `ORACLE_MODE=logit` + `oracle_logit.py` (R1–R4); audit #25 NO-GO (DESCRIPTIVE masked FAIL in TF) → fix in
  progress: all steps evaluated, FAIL dominates, DESCRIPTIVE only with zero violations and defective coverage.

## Amendment 1 — the R5 negative control, pre-registered 6/09 09:20 (before any build)
"A deliberately broken kernel build must FAIL" cannot be served by the pre-gate baseline APK on the 750: the 20-FAIL
family is n=1 batched GEMV (decode-shaped) and in-app decode runs on CPU, so that defect is not on the in-app prefill
path (runs 8–10: identical GPU ids on 732/735/750 regardless). The negative control is therefore a **fault-injected
build**: fork branch `kalsa/bench-fault-inject` (throwaway, from `kalsa/governor-v0.3-on-2f3b24dee` @3bec271fd) with
ONE deliberate defect in the Adreno f16×f32 prefill GEMM path that is exercised by ubatch-128 prefill: the kernel
result for the LAST K-block of each tile is dropped (or scaled by 0.5) — a real, systematic numerical corruption of
the GPU prefill, guarded by a compile-time define `KALSA_BENCH_FAULT_INJECT=1` so it cannot exist in any normal build.
App: throwaway branch `bench/fault-inject-apk` = feat/governor-in-app @28424c3 + pin bump to the faulty fork commit,
APK debuggable, never merged. Expected reading on the 8 Elite (known-good GPU otherwise): arm B in TF mode must FAIL
R1 or R2 on ≥ 2 pairs; if the oracle PASSes a corrupted prefill, the oracle is rejected (R5). Positive control on the
same board with the normal APK (28424c3): must PASS. Both controls run before any A7X board is judged.

## Amendment 2 — TF comparability, pre-registered 6/09 09:40 (from audits #25/#25b, before any data)
In TF mode the emitted token is forced, so R1 compares the RAW top-1 of B against the raw top-1 of A (never the
emitted token). A forced step whose emitted token ≠ A's token is a harness failure, but its raw distribution was
captured before forcing on the same prefix: that step IS evaluated under R1/R2, then comparison stops (the prefix has
diverged) and coverage is defective (R4). Same for an unforced step (force list ended early). Precedence: any R1/R2/R3
violation → FAIL (earliest step's rule); DESCRIPTIVE R4 only with zero violations and defective coverage; PASS only
with zero violations and 32 comparable steps. This closes the "DESCRIPTIVE hides a high-margin disagreement" hole.

## Session plan for R5 (pre-registered 6/09 10:00)
One QRD8750 (8 Elite) session, two runs back to back with the S5b driver and `ORACLE_MODE=logit`:
1. **Positive control** — APK 28424c3 (governor + gate + oracle hook), `ABAB 40` (2 same-turn pairs; B forced with A's
   ids; both arms log KALSA_BENCH_PROBS). Expected: `oracle_logit=PASS` on both pairs (rule=none, steps=32). The
   strict token oracle is reported alongside (the 8 Elite showed a 1-token flip at idx 29 in run 6: with TF that step
   is judged by R1/R2 — a near-tie flip must be within thresholds; if R2 fails there, the thresholds are NOT loosened:
   the case is reported and the oracle judged on the fault control too).
2. **Negative control** — APK ca3b1b3 (fault-injected Q4_0 GEMM, ×0.5 on the accumulators), same `ABAB 40`.
   Expected: `oracle_logit=FAIL` with rule R1 or R2 on both pairs (a 0.5 scaling of every Q4_0 GEMM output during
   GPU prefill corrupts the KV state and the logits massively). Also expected: strict oracle FAIL and a visibly wrong
   B/A TTFT (reported, not judged).
Readings: (PASS, FAIL) → oracle validated (R5 met) → proceed to TF on 750/732/735 with APK 28424c3.
(PASS, PASS) → oracle rejected (blind to a corrupted prefill) → token oracle stays; investigate thresholds/hook.
(FAIL, FAIL) → hook or driver defect (or the 8 Elite flip violates R2) → investigate before any A7X judgement.
(FAIL, PASS) → nonsensical → harness error.
Budget: 8 Elite ≈ 263 min left; two runs ≈ 2 × 40 min + setup.

### Amendment 3 (6/09 12:56 EDT, before any R5 result was read)
The session plan said `ABAB 40`; `d_run.sh` line 20 only accepts `ABABAB` or `ABABABAB` (my error: the plan was written
without checking the validator). Executed instead: positive control `ABABAB 50` (deadline checked at every turn start, so
2–3 pairs; the oracle is judged per pair, R4 needs ≥2 comparable pairs), then the negative control `ABABAB` with the
minutes left in the 150-min session (≥20; one complete pair suffices for FAIL, since FAIL dominates DESCRIPTIVE). Session
807948, host sa812017, serial b4bd0901, board `sun`, **Android 16** (previous QRD sessions were Android 14: harness
probes live; any trap is reported, not silently patched). Readings unchanged.

### Amendment 4 (6/09 13:22 EDT, before any oracle verdict was read)
First positive-control attempt (raw `qdc-governor-s5b/raw/sa812017-toolcall-void/`): A1 VOID `void_reason=toolcall`
(`KALSA_TOOLCALL … "toolNames":["document_chat"]`, no KALSA_BENCH_TOKENS; 406 KALSA_BENCH_PROBS lines were logged, so the
hook itself works). `document_chat` is always in the tool list (AppShell "document_chat always stays available") and is
not covered by the three prefs the driver turns off; it was in the runs 8–10 APKs too and was never called there, so this
is a greedy-path difference on this board/build, not a new tool. Driver killed mid-B1 (pair 1 void anyway), and
`set_prefs` now also writes `('kalsa.bench.toolchoice','none')` (app key `kalsa.bench.toolchoice`, benchConfig.ts:28,
read fresh per turn) for BOTH arms — consistent with the standing "tools OFF in bench cells" rule. Relaunched
`ABABAB 45` under the same session. Consequence declared: any turn with `tool_calls>0` after this is a harness defect,
not a data point. Readings unchanged.

### Amendment 5 (6/09 13:40 EDT, before any oracle verdict was read)
Second positive-control attempt (raw `qdc-governor-s5b/raw/sa812017/`): A1 valid thermally and `structuredCalls:0`, but
`KALSA_TOOLCALL {"toolChoice":"none","structuredCalls":0,"fallbackCalls":1,"fallbackDialect":"lfm","executed":1}` and no
`KALSA_BENCH_TOKENS` → driver PREREQUISITE exit 3 (correct behaviour). Root cause read in the app (LlamaService.ts
~3205: `...(hasTools ? { tools, tool_choice: toolChoice } : {})` — tools are still rendered into the template with
tool_choice "none"; ~3290: `if (!toolCalls.length && options?.executeTool) parseFallbackToolCalls(rawText)` — the
text-dialect call is executed regardless of tool choice). So `kalsa.bench.toolchoice=none` was never tool-free.
Session 807948 ended at ~13:38 (≈48 min used) to save 8 Elite budget. Fix dispatched (Luna, bench-only: with bench
mode "none" pass no tools and skip the fallback parser); both APKs (normal and fault-injected) are rebuilt from the
fixed commits; R5 restarts from scratch in a new session. Declared consequence: the prompt prefix of every R5/TF run
no longer contains tool schemas (≈60 fewer cached tokens than runs 8–10; irrelevant within a run, noted for TTFT
comparisons across runs). Readings unchanged. Both attempts so far are archived, not data.

### Amendment 6 (6/09 15:05 EDT, before any oracle verdict was read)
Third attempt (APK 19b67b6, session 807952, raw `qdc-governor-s5b/raw/sa812021-newtokens-void/`): A1 clean on the tool
side (`KALSA_TOOLCALL … "toolChoice":"none","structuredCalls":0,"fallbackCalls":0,"executed":0`, one KALSA_BENCH_TOKENS,
`KALSA_KVPREFIX embd=546 text_tokens=1474 n_common=546`, i.e. the prewarmed prefix now matches the turn exactly) but the
row was VOID by d_run.sh:394 (`new_tokens_a` outside 938±10%) because `new_tokens_a` was `na`: the driver derived it
only from the native rollback line `restored state checkpoint: reusing N/M prompt tokens` (parse.sh `last_reuse_after`),
which is printed only when the KV diverges from the prompt. Every earlier run diverged by a few tokens (tool-bearing
prefix ≠ prewarm), so the line was always there; with the fixed app the prefix matches and the line is absent. Driver
fix (parse.sh `last_kvprefix_after`, d_run.sh:392): when the reuse line is missing, `new_tokens_a = text_tokens −
n_common` from the last KALSA_KVPREFIX after the send anchor (same anchor). Checked on the real A1 logcat: 1474−546=928
(in range); on run 8's logcat the reuse line still wins (841/1766 → 925 vs 1766−843=923, 2-token checkpoint granularity).
dryrun rc=0. Relaunched `ABABAB 45` in the same session. Readings unchanged. Note for the record: the prompt is now
~620 tokens shorter than in runs 8–10 (tool schemas + web-search system prompt gone), not ~60 as guessed in Amendment 5.

### Amendment 7 (6/09 15:40 EDT, before any oracle verdict was read)
Fourth attempt (raw `qdc-governor-s5b/raw/sa812021-foreground-void/`, END deadline_45_min): **both A turns valid**
(A1 928 new tokens / TTFT 5,43 s, A2 5,54 s, `tool_calls=0`, ids_sha 558522c0…) and **both B turns VOID `composer`**.
Cause read in the B logcats: after `poll_load` the driver calls `device_wake` → `wake_sequence` (`wm dismiss-keyguard`
+ tap), and on this Android 16 board that brings `com.android.launcher3…QuickstepLauncher` to the top
(`wm_on_top_resumed_gained_called` 26 s after `Displayed com.kalsa.app/.MainActivity`); the UI dump then captures the
launcher, `bounds_edit` is empty, `dump_fail stage=edit` → VOID. No native crash, no LMKD kill, the model had loaded.
This is a harness/board interaction, not an app or oracle property, and it hits only B because only B is reached after
the 8,5-min cooldown + reinstall sequence in this ordering. Fix (d_run.sh `app_foreground`, called between
`ime_suspend` and `ui_send`): read `topResumedActivity` from `dumpsys activity activities` (content-based, rc ignored —
QDC trap 8), and if it is not `com.kalsa.app`, re-issue `am start -n com.kalsa.app/.MainActivity` and re-check, twice;
failure ⇒ `void_reason=foreground` (a VOID row, never a silent pass). dryrun.sh stubs the new dumpsys and registers the
function; rc=0. Relaunched `ABABAB 40` in the same session (expires ~17:03 EDT). Readings unchanged.

### Amendment 8 (6/09 16:20 EDT, before any oracle verdict was read)
Fifth attempt (raw `qdc-governor-s5b/raw/sa812021/`): the `app_foreground` guard WORKS — B1 logged
`attempt=1 top=com.android.launcher3/.uioverrides.QuickstepLauncher` → `am start` → `attempt=2 top=com.kalsa.app/.MainActivity`
— but the 40-min deadline cut B1 mid-turn (A1 valid, TTFT 5,485 s; END deadline_40_min, no B row). Measured cost per
pair on this board: A ≈ 11 min (reinstall + model copy + load + typing + generation) + cooldown to 38,5 °C ≈ 8,5 min +
B ≈ 12 min ≈ 32 min. Two pairs (needed for a PASS under R4) therefore need ≈ 65 min in ONE run.
Session 807952 had 44 min left, so the order of the two controls is swapped: the **negative control runs now**
(APK e54f529, `ABABAB 33`, job tag `sa812021-fault` for a separate raw dir on the same host), and the positive control
gets its own ≈ 70-min session next. One pair suffices for the negative (FAIL dominates; declared in Amendment 3); the
positive still requires ≥ 2 pairs. Order is irrelevant to the pre-declared readings, which are unchanged.
