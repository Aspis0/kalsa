# REPORT - Has the lab already accepted GPU-vs-CPU token divergence on Adreno (A7X, incl. 740)?

Read-only hunt. Explorer, no sub-agents, no code, no commit. Evidence gathered with
`rg --no-ignore` (raw/ included) and direct file reads.

Our case under test: Galaxy S23, Adreno 740, driver E031.41.03.62, LFM2.5-2.6B Q4_K_M,
`-fa 0`, native llama-cli, engine build `1068eb03d`, run 2026-09-21; CPU and GPU prefill
arms diverge at the 7th generated token (new run REPORT section 4, the Q3 arm;
`scratchpad/agents/s23-native-gpu-bench/REPORT.md:380-421`).

Headline answer: **NO recorded acceptance covers our case on the divergence criterion.**
The nearest verdicts are (a) the archive's explicit NOT-ACCEPTED ruling for the V73
generation (oracle FAIL -> `GPU_PREFILL_CORRECT.V73` stays false), and (b) the owner's
2026-09-21 enablement of V73, which is an owner ruling but explicitly "not a measurement"
and says nothing about divergence, model, quant, or `-fa`. Detail per hunt item below.

---

## 1. logit-oracle PREREG.md / AUDIT.md - the logit-margin oracle

**Status: RUN, but NEVER to a PASS verdict, and R5 (sanity) was NEVER MET. There is no
acceptance here.**

- PREREG rules R1-R6: `scratchpad/agents/logit-oracle/PREREG.md:20-31`. R3 (the near-tie
  allowance) is at `:24`: "a divergence is allowed only if CPU margin < 0.03 AND B's choice
  is A's #2; at most 1 divergence per 32 steps" (mode G only).
- The cell's `AUDIT.md` (`scratchpad/agents/logit-oracle/AUDIT.md`) is the **instrument
  code audit** of app commit 28424c3 (verdict "GO for pushing and building the APK"), plus
  audits #27-#29 of follow-up commits. It contains **no run verdict**. A PREREG without a
  completed run verdict is not a finding, as the brief says; here the run verdicts exist but
  live elsewhere.
- Run verdict 1 (pre-fix, QRD8650 / Adreno 750, session 807970, 6-7/09):
  `oracle=FAIL steps=32 max_dlogp=8.7216 max_dp1=0.7166`, with **8/32 steps where the raw
  top-1 changes while the CPU is confident (margin >= 0.03, i.e. R1-class disagreements)**
  - `archived/ALIVE-2026-09-full.md:498` (row 55). Deciding line for R5:
  `scratchpad/agents/logit-oracle/PREREG.md:211` - "**R5 is NOT met**, and the sanity
  control still requires the 8 Elite. No threshold is touched." (Amendment 12,
  `PREREG.md:205-211`).
- Run verdict 2 (post-fix, same board and protocol, cell `gemm-f32-ship`, 7/09):
  raw verdict still `oracle=FAIL rule=R2 ... divergences=0`, but the continuous metrics
  collapsed (median |dp1| 0.0861 -> 0.0014; confident-CPU top-1 flips 8/32 -> 0; same-top
  94.8%) - `scratchpad/agents/gemm-f32-ship/REPORT.md:24` and `archived/ALIVE-2026-09-full.md:493`.
- Device coverage of the oracle: **QRD8650 / Adreno 750 only.** Never run on 732, 735,
  740, or the 8 Elite positive control; the fault-injected negative control never produced
  a pair (`ALIVE-2026-09-full.md:498`: "R5 sull'8 Elite e negativo col guasto ancora da fare").
- Verdict for item 1: **NOT ACCEPTED** (no PASS anywhere; both real verdicts are FAIL;
  the oracle itself was never validated under its own R5). Criterion = R1-R4 with R5 sanity
  prerequisite. Device = 750. Model = LFM2.5-2.6B **QAD-Q4_0**. Dates 6-7/09 and 7/09/2026.

## 2. ALIVE entries #52-#57 and surroundings - where GPU_PREFILL_CORRECT.V73 lives

**Status in the archive: `GPU_PREFILL_CORRECT.V73 = FALSE. The reason is BOTH conditions:
speed MET, oracle NOT met.** The archive file is frozen (mtime 21/09 10:05) and never
records the later flip.

Deciding lines (all in `archived/ALIVE-2026-09-full.md`):

- Row 52 (line 489, S5b run 9, QRD7675 / Adreno 732, 6/09): "Regola di aggiornamento
  policy (PREREG §Runs 9-11): condizione velocita SODDISFATTA (mediana <=0,85, n=2),
  condizione oracolo NO -> `GPU_PREFILL_CORRECT.V73` resta false."
- Row 54 (line 491, S5b run 10, QRD8635 / Adreno 735, 6/09): "Regola policy: velocita si,
  oracolo no -> `GPU_PREFILL_CORRECT.V73` resta false."
- The underlying pre-registered rule: `scratchpad/agents/qdc-governor-s5b/PREREG.md:291-293`
  - "a generation gets `GPU_PREFILL_CORRECT=true` only with oracle PASS on all valid pairs
  of its run; the fork's `prefill_engine()` gets a GPU rule for a generation only if its
  median B/A <= 0.85 with n >= 2 pairs." Also `PREREG.md:286-287` explicitly names our
  device class: "A FAIL on the 732/735/**740** is NEW information ... and turns the row
  descriptive."
- Row 51 (line 488, run 8, QRD8650 / 750, 5/09): the same oracle FAIL at index 7; "the
  in-app divergence at index 7 is a deterministic property of the Adreno 7xx (A7X) GPU
  prefill path" (also `qdc-governor-s5b/PREREG.md:300-304`).
- Row 53 (line 490): kernel-level gate for the 750's separate 20-FAIL defect;
  `GPU_PREFILL_CORRECT.V75` reste false at that point.
- Row 55 (line 498): the logit oracle verdict (see item 1), "nessuna promozione
  (R6)".
- Rows 56/57 (lines 497/496): the precision bisection and the f16-multiply root cause
  (see item 3).
- Row 60 (line 493, 7/09): owner promotes **V75** only; "V73 resta false" (line 3539 of
  the diary as well).

**Why the archive's reason matters for us:** in the new run the owner ORDERED V73 enabled.
That order is NOT in the archive; it happened on 2026-09-21 (see item 4). So the archive's
reason for false (speed yes + oracle no) was superseded by an owner ruling, not by any new
measurement or oracle PASS. Nothing in the archive accepts the A7X divergence; the archive
records it as the *blocking* condition.

## 3. The precision cells and the synthesis index

| source | verdict | file:line | device / model / date | covers our case? |
|---|---|---|---|---|
| `scratchpad/agents/adreno-precision-bisect/` | Root cause found: batch>1 GEMM path is unfaithful; pre-registered reading MET ("median <= 0.05 and same-top >= 90% -> the f16 GEMM path is the cause", met by 472x). Descriptive, NOT an acceptance. | REPORT.md:1-30 (table at :7-11); ALIVE row 56, `archived/ALIVE-2026-09-full.md:497` | QRD8650 / Adreno 750, LFM2.5-2.6B QAD-Q4_0, `-fa off`, 7/09 | No (750, Q4_0) |
| `scratchpad/agents/adreno-acc-type/` | f16 **product** is the cause; KLD 0.4538 -> 0.004736 (95.8x). Pre-registered conjunctive gate (median <= 0.005 AND same-top >= 95%, PREREG.md:170) **NOT satisfied** (same-top 94.826%). | REPORT.md:8-17; ALIVE row 57 `archived/ALIVE-2026-09-full.md:496` ("la congiunzione NON e soddisfatta") | same board/model, 7/09 | No; and its own gate failed |
| `scratchpad/agents/adreno-operand-b/` | Operand storage refuted; residual ~5x remains unexplained (tile geometry / summation order, unmeasured). Speed validity reading failed (harness). | ALIVE row 59 `archived/ALIVE-2026-09-full.md:494` | same, 7/09 | No |
| `scratchpad/agents/gemm-f32-ship/` | Raw verdict still `oracle=FAIL rule=R2`; metrics collapsed; owner then promotes V75 (item 4). | REPORT.md:24; DECISION.md; ALIVE row 60 `archived/ALIVE-2026-09-full.md:493` | QRD8650 / 750, LFM2.5-2.6B QAD-Q4_0, 7/09 | Model family yes, GPU no, quant no |
| `reports/moe-gdn-k22-fix.md` | "**Correctness: PASS. Speed (tg >= 1.15x): FAIL.**" and "Greedy `-ngl 99 -fa off` (no `-ot`) matches CPU token-for-token"; 740 decode 0.41x, prefill 1.29x. | `reports/moe-gdn-k22-fix.md:12`, `:20-23` | Galaxy S23 / Adreno 740, driver 0676.73, **dense Qwen3.5-2B** hitting `gemv_noshuffle_q6_k_f32`, BigMoeOnEdge fork, 2026-08-12 | **Device yes, but model/kernel/repo all different: a Q6_K GEMV decode-path token match says nothing about LFM2.5-2.6B Q4_K_M batched GEMM prefill.** |
| `reports/moe-gpu-sustained.md` | Decode/sustained verdicts only: "Correctness pre-check: greedy CPU vs GPU token-identical" (4B hybrid, :161); "The GPU dividend on A7X remains prefill/TTFT only" (:175). Energy 0.61 vs 0.79 %/1k (:142-143). | as cited | S23 / 740, Qwen3.5-2B then 4B, 12-13/08 | Speed/energy scope only; no divergence acceptance |
| `scratchpad/QDC-GPU-GOVERNOR-MAP-2026-09-16.md` | Synthesis index. Key rows: :50 quotes the k22 token-for-token line; :211 quotes the V73 rule ("condizione velocità SODDISFATTA ... condizione oracolo NO -> V73 resta false"); :308 "the 750 GPU-prefill infidelity is root-caused ... fixed ... V75 GPU prefill enabled by owner decision on effect size". | as cited | n/a (index) | Index itself accepts nothing; it faithfully records NOT ACCEPTED for V73 |

Note on the `moe/` tree: there is no separate `moe/` directory on disk now; the QDC map
explains why (`scratchpad/QDC-GPU-GOVERNOR-MAP-2026-09-16.md:20`, section 0): "moe/" in old
citations = `/Users/marco/Projects/kalsa-moe-experiments/` itself, so `moe/reports/moe-gpu-sustained.md`
= `reports/moe-gpu-sustained.md`, and `moe/docs/ALIVE.md` rows = the ledger in
`archived/ALIVE-2026-09-full.md`. Both files were found and read; nothing is NOT FOUND for
lack of the tree.

## 4. OWNER RULINGS (direct decisions by Marco)

Three exist. All three are **owner-ruling** acceptances (no numeric gate was met for any).

### Ruling A - 2026-09-07: GPU prefill ON for V75, on effect size, over a FAIL verdict

- Record: `scratchpad/agents/gemm-f32-ship/DECISION.md:1-6` - "**Decided by the owner on
  2026-09-07, on the numbers of ALIVE 60.** ... rule **R6** ... says: *'No automatic
  promotion ... enabling GPU prefill on a generation in production is the owner's decision
  on the numbers.'* This is that decision."
- Verbatim acceptance of the residual (`DECISION.md:36-41`): "**The raw oracle verdict is
  still `FAIL rule=R2`.** R2 demands |dp1| <= 0.02 at *every* one of 32 steps; same-top
  after the fix is 94.8 %, not 100 %. ... The decision is therefore explicitly made on the
  effect size, not on a green light from the binary gate."
- Scope it states against itself (`DECISION.md:44-52`): "n = 1 pair, one board, one physical
  unit"; "**Only q4_0 is measured.** ... qwen3.5-4b Q4_K_M ... **nothing about it is
  measured**"; "**732 / 735 / 8 Elite were not re-measured** ... V73 stays false."
- Code mirror: `kalsa/src/engine/governorInputs.ts:13-21` (comment block) and commit
  `523f5e3` "governor: enable the GPU prefill route on V75 (owner decision on ALIVE 60)".
- Kind: owner ruling. Device: 750. Model: LFM2.5-2.6B **Q4_0**. Date: 2026-09-07.
- Companion diary line: residual knowingly carried - "Decisione owner: si passa alla fase
  governor-nell'app col kernel corretto. Il residuo 5x (geometria del tile, ordine di somma)
  e le altre board restano in coda" (`archived/ALIVE-2026-09-full.md:3503`, 7/09).

### Ruling B - 2026-09-21: V73 enabled in production, explicitly NOT a measurement

- Record (app, uncommitted working tree): `kalsa/src/engine/governorInputs.ts:22` -
  verbatim: `V73: true, // owner decision 2026-09-21: enabled in production, never measured in-app; kalsa.bench.governor_force still exists for the other paths`
- Record (engine, committed): `kalsallama/src/llama-governor-policy.cpp:166-169` (present
  at our build `1068eb03d`, verified in `/Users/marco/Projects/kalsallama-wt-1068`) -
  verbatim: `// V73 carries the owner's 2026-09-21 enablement decision, not a measurement.`
  followed by the lane condition adding `generation == V73 || V75 || V79 && gpu_fit == Fit
  && gpu_prefill_measured`.
- Audited twice: `scratchpad/agents/gpu-gate-and-v73/REPORT.md` (app half) and
  `scratchpad/agents/gpu-probe-close-and-v73/REPORT.md` + `-audit/REPORT.md` (verdict D:
  "CONFIRMED at source level in both repos ... owner's 2026-09-21 enablement decision,
  not a measurement").
- Kind: owner ruling (enablement). It accepts **turning the lane on without measurement**.
  It does NOT accept any divergence, KLD, or same-top figure - it does not mention
  divergence at all, and its own comment says "never measured in-app". Date 2026-09-21,
  generation V73 (which includes SM8550/Adreno 740), no model, no quant, no `-fa` scope.
- Related owner decisions of the same day (not about divergence): "bring the Governor
  forward" (`PLAN.md:199-201`) and defect 5.2 measurement (`PLAN.md:222`).

### Ruling C (context, not an acceptance)

- `PLAN.md:11` - "STANDING RULE (owner, 2026-09-21 ...) NOTHING GOES UPSTREAM" (matters
  only for process).

No other owner ruling accepting a divergence/KLD/same-top figure was found anywhere in the
lab (searched ALIVE, PLAN, docs/, reports/, scratchpad/agents with `--no-ignore`).

---

## THE DECIDING QUESTION: does any recorded acceptance COVER our case
(Adreno 740, LFM2.5-2.6B Q4_K_M, `-fa 0`, build 1068eb03d)?

**No - not on the divergence criterion.** Exact scope of each candidate:

1. **Ruling B (2026-09-21 V73 enablement)** - the closest by generation and date, and it
   literally lives inside our build (`1068eb03d` *is* the commit that added V73 to the
   engine lane). Deciding line: `kalsallama/src/llama-governor-policy.cpp:166` "V73 carries
   the owner's 2026-09-21 enablement decision, not a measurement."
   What it accepts: routing V73 devices (incl. S23/740) into the production governor GPU
   prefill lane.
   What it does NOT accept: it is silent on token divergence, on LFM2.5-2.6B, on Q4_K_M,
   on `-fa 0`, and on native llama-cli runs; it labels itself "not a measurement"; and it
   is a routing decision in the *app* governor, while our measurement is a *native* kernel
   property. It cannot be read as "the divergence was judged acceptable" - the coder
   reports were forbidden from claiming more (`gpu-probe-close-and-v73/REPORT.md`, section
   2.2: "No comment, code path, or report here claims V73 was measured in-app, because it
   was not").
2. **Ruling A (2026-09-07 V75)** - right model family and the only place a divergence was
   knowingly accepted (same-top 94.8%, raw FAIL rule=R2), but wrong GPU (750, not 740),
   wrong quant (Q4_0, not Q4_K_M), n=1, and it explicitly excludes what our case is:
   "Only q4_0 is measured ... q4_K ... nothing about it is measured" and "V73 stays false"
   (`DECISION.md:39-49`).
3. **Archive rows 52/54** - right GPU family claim (A7X kernels, byte-identical GPU ids on
   732/735/750, explicitly "a deterministic property of the Adreno 7xx (A7X) GPU prefill
   path", `qdc-governor-s5b/PREREG.md:300-304`), and the pre-registered rule even names the
   740 (`qdc-governor-s5b/PREREG.md:286-287`). But the verdict there is **NOT ACCEPTED**
   (oracle FAIL x2 -> `GPU_PREFILL_CORRECT.V73` false). Criterion = oracle PASS on all
   valid pairs (never achieved) + speed median <= 0.85 (achieved, 1.63x/1.72x).
4. **k22-fix** - right device (740) and an explicit "matches CPU token-for-token", but a
   different model (Qwen3.5-2B), different kernel class (Q6_K GEMV, decode path), different
   repo (BigMoeOnEdge), 2026-08-12. A criterion met on a Q6_K GEMV with a 2B dense model
   does not cover a Q4_K_M batched-GEMM prefill with ours.

**NEAREST verdict, stated exactly:** the archive's own ruling on our generation -
`archived/ALIVE-2026-09-full.md:489` (row 52): "condizione velocita SODDISFATTA ...
condizione oracolo NO -> `GPU_PREFILL_CORRECT.V73` resta false" (`archived/ALIVE-2026-09-full.md:489`). Difference from our case: it was measured in-app on
732/735 with the ship **Q4_0** model under llama.rn, oracle FAIL at index 7; our case is
native llama-cli, **Q4_K_M**, 740, index 6, build 1068eb03d. That verdict says the
divergence was NOT acceptable. It was later superseded - not contradicted by data - by
Ruling B, an owner enablement that carries no measurement of any kind.

One relevant fact in our favor, verified on disk: build `1068eb03d` **contains the f32
product fix** (`git merge-base --is-ancestor 67c73d26c HEAD` = true in
`/Users/marco/Projects/kalsallama-wt-1068`), and the fixed kernel text is in the source
(`ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_k_f32.cl:102` `c0 += convert_float8(B) *
(float)dequantized_weights.s0;`, likewise `gemm_noshuffle_q4_0_f32.cl:66`). So our run
exercised the fixed q4_K kernel - whose fidelity has **never been measured on any device**
(`archived/ALIVE-2026-09-full.md:493`: "q4_0 misurato, q4_K no"; row 61, line 492: "il
kernel q4_K corretto non e mai stato eseguito e la sua fedelta resta ignota").

Practical consequence for the next day of work: no oracle run exists whose PASS would
"already cover" us, but equally no existing verdict ACCEPTS our divergence. The only
acceptance instrument the protocol itself designates for this decision is R6 (owner on the
numbers, `logit-oracle/PREREG.md:31-32`), already used twice (V75 7/09, V73 21/09). Whether
the 21/09 V73 order was meant to pre-accept a measured divergence is not recorded (see
WHAT WE DO NOT KNOW).

---

## COUNTING CONVENTION: archive "index 7" vs our "index 6"

**Settled by the archived artifacts, not by guesswork: the archive counted ZERO-BASED over
the generated id list, so archive index 7 = the 8th generated token; our run's index 6 =
the 7th generated token. They are DIFFERENT positions by one token (same class of event,
not the same event).**

Evidence:

- The archived counting was done over `KALSA_BENCH_TOKENS` id files, one id per line, line 1
  = first generated token (instrument contract: `scratchpad/agents/logit-oracle/AUDIT.md`,
  F3 - "`step 0` = first generated token, aligned with the KALSA_BENCH_TOKENS ids order").
- The archived reports state the base explicitly, three times:
  `scratchpad/agents/qdc-governor-s5b/REPORT.md:183` - "the first differing **zero-based
  index is 7**, where A has 14991 and B has 2352 ... [raw/sa808770/8-Gen-3_A_t1_ids.txt:**8**]";
  `:227` - "first differs at zero-based index `7` (file line 8 ...)"; `:267` (run 10) the
  same. Index 7 = file line 8 = the 8th token. Same convention in the 8 Elite row:
  `REPORT.md:121` - "differ only at index 29 ... citing `..._t1_ids.txt:30-32`".
- The PREREG line the new run quotes ("FAILs on Adreno 732/735/750 at index 7",
  `logit-oracle/PREREG.md:8`) cites exactly those runs (S5b 8/9/10, ALIVE 52-54), so its
  "index 7" is that zero-based 7.
- Our run: `s23-native-gpu-bench/REPORT.md:397-400` - "Tokens 0-5 are identical;
  divergence at the 7th generated token"; AUDIT `:143` - 'The report says "index 6 (0-based)"'.
  Index 6 = the 7th token.
- Therefore the new REPORT's speculation (`REPORT.md:413-416`, "If the archive's index is
  one-based ...") is resolved against it: the archive is zero-based and lands one token
  later than ours. (The new AUDIT `:145-147` flagged exactly this as "plausible but
  UNVERIFIED from the archived text" - it is now verified, and the two are not the same
  position.)

Caveat that stands regardless: different model (Q4_0 vs Q4_K_M), different prompt (5142-char
bench prompt vs "The capital of France is"), different runtime (llama.rn in-app vs native
llama-cli), so "same event" would be wrong even if the indices matched. The defensible
claim remains the new report's own: "same class: early near-tie divergence in greedy
CPU-vs-GPU prefill" (`s23-native-gpu-bench/REPORT.md:416-417`).

## Were the archived divergences ever shown to be ONLY near-tie flips (R3)?

**No - never established, and one measurement argues against it on the 750.**

- R3 is mode G only (`logit-oracle/PREREG.md:24`). The logit oracle only ever ran in TF
  mode on real data (driver forces TF whenever A ids are valid:
  `qdc-governor-s5b/d_run.sh:453,465`), where token divergences cannot occur because arm B
  is forced (`divergences=0` in both real verdicts). Every `divergences>=1` occurrence in
  the tree is a dryrun/audit fixture (`qdc-governor-s5b/dryrun.sh:263`,
  `AUDIT-PRERUN.md:945-946,995-996`). **R3 was never evaluated on a real divergence on any
  device.**
- On the 750 pre-fix, the TF data show the disagreement class is NOT confined to near-ties:
  8/32 steps with raw top-1 flip while the CPU margin is >= 0.03 (R1-class), worst step 23
  with CPU 0.9826 vs GPU 0.2660 (`ALIVE-2026-09-full.md:498`). Whether the *specific*
  first-divergence at index 7 in free greedy mode was a near-tie was never isolated.
- On 732/735/740: no logit/margin data exists at all. The PREREG itself opens with the
  question unanswered (`logit-oracle/PREREG.md:9-10`): "A greedy near-tie flip cannot be
  told from a real error by token equality." The archive pre-declared H2 (near-tie) vs H3
  (real A7X bug) and said they are "separabili solo con un oracolo a margine di logit"
  (`ALIVE-2026-09-full.md:489`) - an oracle that was then built, validated never (R5), and
  run only on the 750.
- The 8 Elite's single flip at idx 29 carries only an "ipotesi quasi-pareggio di logit"
  (`ALIVE-2026-09-full.md`, row 49 / `qdc-governor-s5b/REPORT.md:52`) - a hypothesis.

So: the claim "our divergence is the classic near-tie flip shape" (new REPORT `:400`) is a
shape observation only. The lab has no evidence that any archived divergence satisfied R3's
allowance (margin < 0.03 and GPU picks CPU's #2), and no evidence that it did not.

---

## WHAT WE DO NOT KNOW

1. **Whether the owner, when ordering V73 enabled on 2026-09-21, intended to accept the
   known A7X token divergence.** No verbatim owner statement about divergence exists; the
   only records are coder-written code comments ("owner decision 2026-09-21 ... never
   measured in-app"). We found the order's existence, not its reasoning.
2. **Any margin/logit measurement for 732, 735, or 740.** The logit oracle never ran there;
   R5 sanity was never completed (8 Elite positive control and fault-injected negative
   control both outstanding, `PREREG.md:211`).
3. **Whether the archived index-7 event and our index-6 event are the same phenomenon.**
   Positions differ by one (settled), and model, prompt, runtime, build and quant all
   differ; only "same class" is supportable.
4. **Whether the archived (or our) divergence is R3-legal near-tie-only.** Never measured;
   see above. R3 has never been exercised on real data.
5. **Fidelity of every fixed kernel except q4_0 on one 750 unit:** q4_K, q5_k, q6_k, q8_0
   GEMMs (our Q4_K_M file contains Q6_K/Q5_K/Q8_0 tensors too - ALIVE row 60's inventory:
   "LFM2.5-2.6B-QAD-Q4_0 = Q4_0 166, F32 99, Q6_K 1", while a Q4_K_M label mixes 60
   non-Q4_K tensors in the 4B), and the MoE `_ns` kernels: never run through any oracle or
   KLD cell.
6. **The numeric ids of our own divergence.** The new run archived the completion texts but
   not the `llama-tokenize` transcript (new REPORT `:404-409`), so ids 355/677 are
   author-asserted.
7. **Whether in-app FA state matches our `-fa 0`.** Archive rows show the GPU arm's FA was
   auto-disabled by the backend (`resolve_fused_ops: Flash Attention not supported`,
   ALIVE row 56), which is consistent with our `-fa 0`, but no cell varied `-fa` as an
   experimental factor on the divergence endpoint (adreno-precision-bisect only showed FA
   is not the *cause*, measurement 2).
8. **Driver/build transfer:** no archived divergence measurement exists on E031.41.03.62
   with build 1068eb03d; the archive's A7X numbers are from early-September APKs and QDC
   boards, not the retail S23 driver of 21/09.
9. We did not exhaustively read every file under `scratchpad/agents/qdc-governor-s5b/raw/`
   (driver logs and ids files); we searched all raw/ trees with `rg --no-ignore` for
   verdict strings (`divergences=`, `oracle=`) and read all PREREGs, REPORTs and the
   archive rows. A margin figure hiding in an unindexed raw log would be a surprise, not a
   known gap.

End of report.
