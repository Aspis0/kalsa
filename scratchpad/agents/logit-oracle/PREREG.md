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

### Amendment 9 (6/09 17:00 EDT, before any oracle verdict was read — no oracle_logit value other than the VOID
### DESCRIPTIVE rows has ever been produced)
The negative control also lost its B turn to the deadline (`END deadline_33_min`; A1 valid 5,48 s, `app_foreground`
fired again and re-raised the app). Real cost per pair on QRD8750 is ≈ 35-40 min, and the 8 Elite budget is down to
**89 min** — not enough for the ≥ 2 pairs a PASS requires, let alone both controls. R5 therefore moves to **QRD8650**
(Snapdragon 8 Gen 3, 623 min left), with both controls in one session: positive `ABABAB 85` (APK 19b67b6), negative
`ABABAB 50` (APK e54f529). Justification: what R5 tests is whether the oracle catches a corrupted GPU prefill, and the
injected fault is in the Q4_0 GPU GEMM (`gemm_noshuffle_q4_0_f32.cl`), which is on the forced-GPU prefill path of every
Adreno; run 8 already forced GPU prefill on this exact board (1,98×), so the B arm is known to work there. What is
explicitly NOT covered by this move, and stays open: the 8 Elite's own 1-token flip at idx 29 (the case that motivated
the oracle) — it needs its own session when the 8 Elite budget refills. Readings unchanged.

### Amendment 10 (6/09 20:05 EDT, before any oracle verdict was read)
Two harness parameters declared for the next R5 session, both from measurements, neither touching what is measured:
1. **`TYPE_LADDER=100`** on QRD8650 with the APKs from 19b67b6 on. The 200-char rung of the typing ladder lost
   characters on 3/3 turns of session 807954 and burned ~300 s per turn before the 100-char rung typed the same text
   (`8-Gen-3_*_type_prompt.txt`: `attempt=1 chunk_size=200 seconds≈300 rc=1`, then `chunk_size=100 seconds≈510 rc=0`).
   The composer content check is unchanged (exact 5142 characters before any send tap), so the prompt actually sent is
   identical; TTFT is timed from the send tap. Implemented as a launch parameter (`TYPE_LADDER`, default "200 100"),
   deliberately NOT as adaptive state — an adaptive version leaked across the dry-run's independent cases, which is a
   warning about hidden state in the harness. dryrun.sh output is byte-identical to the pre-change baseline.
2. **Deadline ≥ 110 min for a 2-pair positive control** on QRD8650 (measured: A turn ≈ 19 min, cooldown to 37,0 °C
   ≈ 9,5 min, B turn ≈ 19 min → ≈ 48 min per pair with the 200-rung waste, ≈ 38 min without it).
APK for the next attempt: **8b6d548** (positive) and **aa4ddf2** (negative), i.e. the builds with the SIGSEGV guards
restored `llama_synchronize`. Readings unchanged.

### Amendment 11 (6/09 21:00 EDT, before any oracle verdict was read)
Fourth blocker, this one introduced by my own fix chain: APK 8b6d548 produced a valid generation (272 `KALSA_BENCH_PROBS`
steps, `tokensPredicted:271`, no crash) but the JS branch that emits `KALSA_TOOLCALL`, `KALSA_BENCH_TOKENS` and the
governor telemetry never ran, and `[TypeError: Cannot read property 'catch' of undefined]` appeared twice. Correlation
over four builds (A1 logcats, same driver, same prefs): TypeError 2 / TOOLCALL 0 / TOKENS 0 with 9200f23 (=8b6d548);
0 / 1 / 1 with c6d24bb (=19b67b6) in two independent sessions. Verified on disk: llama.rn's wrapper is
`stopCompletion(): Promise<void> { return llamaStopCompletion(this.id) }` — NOT async — so a native host function
returning `jsi::Value::undefined()` makes `engine.stopCompletion().catch(…)` (LlamaService.ts:2790 and six sibling abort
paths) throw. Fixed in 8269aa2 / 5243755 (host function returns a resolved Promise; synchronous interruption preserved).
**Open question, declared rather than hidden:** the native `llamaStopCompletion` was never patched by any of these
builds, so its return value is identical in 19b67b6 and 8b6d548; what differs is that the abort path FIRED under
8b6d548. Why it fired is not established. With the fix the throw disappears, so the next run must be checked for the
abort itself (`KALSA_` telemetry present AND no unexplained interruption) before its numbers are used. If the abort
turns out to interrupt generation rather than being the documented late no-op, any pair from that run is VOID.

### Amendment 12 (7/09 00:10 EDT — written WITH the pair-1 verdict in hand; everything below is post hoc and labelled)
The positive control on QRD8650 returned **FAIL**. That is my design error, not an instrument failure, and I am recording
it rather than re-fitting: the positive control's premise ("a normal build must PASS") only holds on a board where GPU
prefill is believed output-preserving — the 8 Elite (V79). On QRD8650 (V75) the strict token oracle had ALREADY failed
on this very board in run 8 (ALIVE 51) and on 732/735 in runs 9/10 (ALIVE 52/54, "oracolo FAIL ×2 con ids GPU"), so a FAIL here was expected before the run started.
Amendment 9 moved the controls to this board for budget reasons and did not carry that expectation over. Consequence:
**R5 is NOT met**, and the sanity control still requires the 8 Elite. No threshold is touched.
What the run does establish, and what is banked as descriptive:
- The oracle produces a quantified verdict on real device data (32 comparable steps, both arms).
- CPU-vs-CPU control, free from archived data: the A arms of the positive (APK 8269aa2) and of the negative (APK
  5243755) runs — different sessions, different installs, different builds — are bit-identical over all 936 steps
  (`oracle=PASS steps=936 max_dlogp=0.0000 max_dp1=0.0000`). The same instrument that reads 0.0000 on CPU-vs-CPU reads a
  median 3.44 on CPU-vs-GPU, so the divergence is not measurement noise.
Open item found while reading the verdict (NOT changed after the fact): `record()` builds `(step, priority, rule)` and
the script reports `min(violations)[2]`, which orders by STEP, not by severity — pair 1 is labelled R2 (earliest
violation, step 3) although it also violates R1 at EIGHT steps (3, 15, 18, 20, 22, 23, 25, 28: different raw top-1 while A's margin is ≥ 0.03). The earliest violation is in fact step 0 (R2, |Δp1| = 0.077), not step 3. The
FAIL verdict is unaffected. Any change to that ordering must be made and audited BEFORE the next verdict is read.
