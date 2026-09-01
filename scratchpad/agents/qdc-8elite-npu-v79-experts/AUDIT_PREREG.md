# AUDIT_PREREG — hostile audit of PREREG.md @ 6432f211 (cell #44 candidate)

Auditor: independent, read-only. All claims quoted path:line. Status: CONFIRMED / PLAUSIBLE / REFUTED.

## BLOCKER (1) — Q1 criterion is guaranteed-false-negative as written

`PREREG.md:37-40`: Q1 sets env = `LD_LIBRARY_PATH` / `ADSP_LIBRARY_PATH` "of the same kit" and
SURVIVE-DISPATCH iff log contains `HTP0 execute-op MUL_MAT_ID` on `ffn_*_exps`.

The execute-op dump is DOUBLE-gated, and the prereg's env does not open either gate that matters:
- `kalsallama ggml/src/ggml-hexagon/ggml-hexagon.cpp:107`: `if (!opt_verbose) return;` before the dump;
  `:110`: `GGML_LOG_DEBUG("ggml-hex: %s execute-op %s|%s|...")`;
  `:4374`: `opt_verbose = str_verbose ? atoi(str_verbose) : 0;` fed only from `getenv("GGML_HEXAGON_VERBOSE")` (`:4331`).
- `llama-bench -v` does NOT set it: `tools/llama-bench/llama-bench.cpp:1003-1004` (`-v` → `params.verbose`),
  `:2228` (`-v` only un-silences the llama.cpp log callback), `:2302` (fit logs).
- `#43` kit env had NO verbose var: `scratchpad/agents/qdc-8elite-npu-v79/raw/run_npu_bench_793389.sh:16`
  (`LD_LIBRARY_PATH=$PWD/lib ADSP_LIBRARY_PATH=$PWD/lib` only) — and `#43` raw logs contain ZERO execute-op lines
  (grep count 0 in `raw/backend_ops_MUL_MAT_ID_HTP0.txt`, `raw/bench_N1.txt`).
- Proof the line appears when the env IS set: `scratchpad/agents/q51-f2b-v73-guard/f2b_driver.sh:65`
  `export GGML_HEXAGON_VERBOSE=1` → `q51-f2b-v73-guard/REPORT.md:45`
  `HTP0 execute-op MUL_MAT_ID|blk.13.ffn_down_exps.weight ... hmx-tiled`. q55 same: REPORT "NDEV/VERBOSE retained by launcher".

Consequence: a run that SURVIVES banks as DOES-NOT-SURVIVE (`PREREG.md:67-68`), permanently "closing" Session 1 D
with a wrong answer — the exact minutes-waste outcome the cell must avoid. CONFIRMED. FIX is mandatory before queue.

## BLOCKER (2) — load failure conflated with DOES-NOT-SURVIVE; no on-device sha check

`PREREG.md:67-68`: "DOES-NOT-SURVIVE iff Q1 fails (no MUL_MAT_ID execute-op) OR Q2 fails (non-zero exit / crash)".
A load/unsupported-tensor failure also yields "no execute-op" → banks as DOES-NOT-SURVIVE, which is a
method/coverage failure, not a survival failure. The prereg defends against vacuous ops (`PREREG.md:60-62`) but not
against load-void. Mitigant (verified here, see CONFIRMED #8): product census is HTP-safe. Still needs the gate.
Also: prereg requires PC-side sha (`PREREG.md:27`) but never re-verifies sha256 on device after a ~4 GB upload
(#43 did: `qdc-8elite-npu-v79/raw/model_sha_device_793389.txt`); a corrupt upload could fake a crash verdict. CONFIRMED.

## Product GGUF already exists (narration stale, not a gate violation)

`PREREG.md:26-27` presents the PC step as pending. The file already exists, created 23:09:30 — 7 min after the
23:02:55 lock commit (`stat` mtime; commit `6432f211` 2026-08-31 23:02:55 -0400). No QDC minutes spent, so the
"no session before audit" gate (`PREREG.md:13-14`) is not violated, but the prereg must record the product instead
of narrating the step:
- `/Users/marco/kalsa-models/OLMoE-1B-7B-0924-Instruct-Q4_0-requant-from-q4km.gguf`
- 3 928 038 208 B; sha256 `9d0b90c60a5b4732ba1faeb0b8940523173bf7e2a7f038d5753ce3ac24b98618`
- census (parsed directly): **113 Q4_0 / 81 F32 / 1 Q6_K (output.weight)**, experts = 48×Q4_0, token_embd Q4_0 —
  IDENTICAL census to the q55/q48 file (banked: `upstream-v73-report/REVIEW_FIDELITY.md:38` "3,928,037,856 bytes,
  SHA-256 43379486…, 113 Q4_0 / 81 F32 / one Q6_K output.weight"). Only 352 B (metadata) differ from the q55 file.
- Which `llama-quantize` binary produced it is UNPINNED in the prereg (`PREREG.md:26`); Mac has ≥4 candidates
  (`/opt/homebrew/bin/llama-quantize`, `kalsallama/build/bin/`, `build-snapdragon/bin/`). Must be pinned in REPORT.
CONFIRMED.

## Per-angle checklist

1. **Minutes waste** — CONFIRMED via Blocker (1) (false negative = wasted cell + wrong bank) and (2) (no on-device
   sha). Otherwise good: 20-min cap `PREREG.md:16-18`; no-retry after crash `:17-18`; upload VOID rule `:58-59`;
   PC quantize off-session `:26`; overnight queue vs Unavailable pool proven in #43 (REPORT: queued ~11.5h).
   Billing-at-Running claim: PLAUSIBLE (platform behavior, cannot be verified from the Mac; consistent with #43
   queue-then-run and with `PLAN.md` 1/09 note).
2. **Thermal gate** — REFUTED as defect: `PREREG.md:55-57` is verbatim the binding AMENDMENT-1 (#38) gate:
   `qdc-8elite-npu-v79/PREREG.md:44-45` and `qdc-8elite-governor-8b/PREREG.md:46-49,73` (same ≤60 °C, status ≤1,
   per-invocation, >15-min-cooldown clause). Gate script exists: `~/kalsa-qdc/kexp-speed-cell/thermal_gate.sh`.
   In-run excursion history known and disclosed (#43 REPORT Q3/fix #4).
3. **Vacuous backend-ops** — PLAUSIBLE minor: defense present (`PREREG.md:60-62`, #39 lesson), but `--list` is not a
   llama-bench flag — `556118a08 tools/llama-bench/llama-bench.cpp:422` has `--list-devices` and `-h` (help) does not
   enumerate devices; also hardcoded `HTP0` in the Q1 grep (:40) sits in tension with "not assumed HTP0" (:61).
4. **Wrong model (K-quant on HTP)** — REFUTED: source is only the quantize input (`PREREG.md:26`); product verified
   above to be all-HTP-safe census identical to the file that already ran dispatch-YES on v73 (q48) and PPL-PASS on
   v75 (q55). `PREREG.md:29` "HTP-supported types only" is substantiated.
5. **Overclaim vs q55** — PARTIALLY CONFIRMED: the non-comparability disclaimers are correct and honest
   (`PREREG.md:27-28` "not the q55 file and is not comparable to q55 PPL", `:69` "No comparison to q55 PPL").
   BUT "Either is a complete answer to Session 1 D" (`:68`) overclaims: PLAN-10DAYS block D
   (`docs/PLAN-10DAYS-2026-08-28.md:85`, row D) also contains "test-backend-ops (patched judge)" (never run
   patched — #43 ran the unpatched judge and banked the defect list) and "Qwen3.5-4B Q4_0 dense pp512/tg128" on v79
   (no Qwen3.5-4B found in any qdc-8elite raw dir), and the conditional "q63 candidate on HTP if passed" only goes
   moot on the DOES-NOT-SURVIVE branch. A SURVIVES verdict leaves those open.
6. **Missing stop-on-crash** — REFUTED: `PREREG.md:17-18` (one crash ends the NPU arm, no retry), `:35` (bank rc +
   tail, no re-run), `:41-42` (rc banked). Matches q55 stop-rule discipline.
7. **Upload VOID** — REFUTED as missing (rule present `:58-59`), but "kit ~22 MB" (:58) is stale: #43 banked
   10.8 MB (`qdc-8elite-npu-v79/REPORT.md` "kit 10.8 MB + model 1.59 GB"); kit tarball on disk measures
   10 796 556 B (`~/kalsa-qdc/npu-v79-cell/npu-kit-556118a08.tgz`). Conservative, but a wrong number in a prereg
   that pins numbers.
8. **Secrets in the prereg** — REFUTED: no tokens/serials/IPs; repo names in clear are the owner-approved state
   (PLAN.md 1/09 note "di nuovo in chiaro perché il branch è di nuovo pubblico").

## Verified background facts (all CONFIRMED)

- Lock: `git rev-parse origin/main HEAD` = `6432f2111658f428562b9b9a1d1c914d8a8d82ec` == lock commit; working tree clean.
- q55 GGUF byte size/sha: `PREREG.md:22-23` = 3 928 037 856 B = banked (`REVIEW_FIDELITY.md:38`).
- Original Q4_0 file absent from Mac: mdfind/find — only the requant product exists. Q4_K_M present at
  `~/kalsa-models/s23-backup-2026-08-27/` (`PREREG.md:24` — path missing the `~/`, recognizable).
- Kit present: `~/kalsa-qdc/npu-v79-cell/npu-kit-556118a08.tgz`; kit provenance `556118a08` real on
  `kalsa/governor-v0` (`git rev-parse`); branch HEAD since moved to `cff0a4a75` (PLAN.md: CI step 2) → a rebuild
  "pin the new sha" (`PREREG.md:44`) without naming the rebuild commit would silently change kit. Specify 556118a08.
- v73 catalog signatures real: dspqueue_read 0x2e (`q48-olmoe-q40-npu/REPORT.md:102`), qurt_exit
  (`q51-f2b-v73-guard/REPORT.md:69`), dspqueue_write 0x1 (`q53-v73-npu-correctness/REPORT.md:22`).
- q48 dispatch-YES then abort rc=134: `q48-olmoe-q40-npu/REPORT.md:7,66,102`.
- q55 v75 OLMoE PPL PASS 8.9214 vs 8.9233 (`q55-v75-npu-correctness/REPORT.md` Part A).
- q63 C1 PASS 5/5 → 28c conjunct dead: `PLAN.md:555` + pre-delegated rule `PLAN.md:21` ("v79 sopravvive agli
  esperti ∧ q63 FAIL ∧ GO scritto"); prereg `:71-72` states this correctly.
- Flags valid in kit @556118a08: `-p/-n/-r/--no-warmup/--device` (`llama-bench.cpp:427,657,1007`); `-n 0` valid
  (q55 CPU command used it). MUL_MAT_ID executes and is logged on HTP for `ffn_*_exps` tensors — line format proven
  (`q51 REPORT.md:45`, `ggml-hexagon.cpp:110`); #43's MUL_MAT_ID test-backend-ops produced HTP0=finite outputs
  (op runs on v79 day-0), so SURVIVES is the expected branch — which is exactly why Blocker (1) is lethal:
  the expected outcome would be mis-banked.

## VERDICT: FIX — apply the 8 edits before opening any QDC session

## Re-audit of APPLY @ 1ab98822 (2026-08-31 23:39, pushed: origin/main == HEAD == 1ab98822, tree clean)

Per-item check of the 8 requested edits (all quotes from PREREG.md on disk at 1ab98822):

1. VERBOSE env + cite — CONFIRMED. `PREREG.md:52-57`: `GGML_HEXAGON_VERBOSE=1` mandatory, gates quoted
   (`ggml-hexagon.cpp:107`, `:4331,4374`), `-v` disclaimer, q51 proof line, "#43 raw has zero execute-op lines".
2. Load = METHOD-VOID — CONFIRMED. `PREREG.md:58-60` ("precondition, not a verdict"), carried into Q2 (`:65` "after
   a successful load") and the decision rule (`:97-99` "no MUL_MAT_ID execute-op **after a successful load**").
3. On-device sha — CONFIRMED. `PREREG.md:41-44`: "Post-upload BINDING: sha256 the GGUF **on-device**; mismatch =
   METHOD-VOID", with the #43 precedent named.
4. Product recorded — CONFIRMED. `PREREG.md:30-37` (bytes 3928038208, sha 9d0b90c6…b98618, census 113 Q4_0 / 81 F32 /
   1 Q6_K, +352 B, quantize bin pinned). Cross-verified: `MODEL.txt` exists in the cell dir and matches my
   independent measurements byte-for-byte (re-hashed today: 9d0b90c60a5b4732…, 3928038208 B); bin
   `/Users/marco/Projects/kalsallama/build/bin/llama-quantize` exists, mtime 2026-08-29 07:01 (predates product
   2026-08-31 23:09 — plausible tool).
5. Kit 10.8 MB — CONFIRMED. `PREREG.md:85` (banked #43 + tgz 10 796 556 B).
6. jsonl — CONFIRMED. `PREREG.md:69-71` (`-o jsonl -oe jsonl`, mean from jsonl rows, no per-rep median in md printer).
   Honest downshift from "median" to mean.
7. --list-devices — CONFIRMED. `PREREG.md:88-89` (explicit flag-correctness note).
8. D not closed — CONFIRMED. `PREREG.md:100-103` (patched-judge + Qwen3.5-4B dense v79 OPEN; q63-on-HTP DROPPED on
   DOES-NOT-SURVIVE / deferred on SURVIVES).
9. Rebuild pinned to 556118a08 — CONFIRMED. `PREREG.md:77-80` (explicit "not from branch HEAD
   cff0a4a75/204e78259"; rebuild must still be from 556118a08).

Non-blocking nits (recorded, do not block APPLY):
- `MODEL.txt:quantize_ms: 6823.41` and `quantize_exit: 0` are asserted without a captured log artifact; the product
  itself (sha + census) is the binding evidence, so this is decoration. If a timing line exists in shell history,
  drop it in raw/ at REPORT time.
- `PREREG.md:35` "censure" is a typo for "census". Cosmetic.
- Q1 proof line quoted truncated (`…blk.13.ffn_down_exps` vs full `…ffn_down_exps.weight … hmx-tiled` at
  q51 REPORT.md:45). Cosmetic; the grep target `HTP0 execute-op MUL_MAT_ID` is what matters.

VERDICT: APPLY. No QDC session started as of this re-audit (parent statement + no new session artifacts on disk).
