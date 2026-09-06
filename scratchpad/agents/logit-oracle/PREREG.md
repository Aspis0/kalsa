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
