# REPORT — cell #44 Q1/Q2 (job 795870), 2026-09-01

Hostile audit `AUDIT.md` (mimo Reviewer Doc) **SURVIVES CONFIRMED**,
FIX→APPLY on this file. Q3 not run (session ended after Q1).

## Session

- Job **795870** `npu-v79-experts-44b`
  https://qdc.qualcomm.com/reports/job/interactive/795870
- Device: QRD8750 / Snapdragon 8 Elite / Android 16 / serial `f25c433a`
- Submitted 10:52:36, Running 10:54:15, Ended 11:07:21 (page clock)
- Cap 20 min. Connect + tunnel 6037 + `q1_run.sh` in the same Running window.
- Prior empty job 795454 (no Connect) is not this cell.

## Method facts (quoted)

- On-device sha matched host (not METHOD-VOID):
  `host=9d0b90c60a5b4732ba1faeb0b8940523173bf7e2a7f038d5753ce3ac24b98618`
  `device=9d0b90c60a5b4732ba1faeb0b8940523173bf7e2a7f038d5753ce3ac24b98618`
- Kit tgz `npu-kit-556118a08.tgz` 10796556 B pushed 9.4 MB/s.
- GGUF 3928038208 B pushed 18.8 MB/s (199.349 s).
- llama-bench jsonl `build_commit` = `4c7101af4`. That commit is
  `556118a08` plus one docs-only commit (`KALSA_FORK.md`).
  `git merge-base --is-ancestor 556118a08 4c7101af4` exit 0;
  `git diff 556118a08 4c7101af4 -- '*hexagon*' '*htp*'` is empty.
  HTP/v79 code matches the PREREG pin. Tarball name stays `npu-kit-556118a08.tgz`.
- jsonl `model_size` 3926255616 is the GGUF content size the loader reports.
  `MODEL.txt` bytes 3928038208 is `stat` file size. Delta 1782592 B (0.045%)
  is alignment padding, not a sha mismatch.
- `--list-devices` **failed** (`CANNOT LINK EXECUTABLE ... libllama-bench-impl.so`)
  because `q1_run.sh` ran it without `LD_LIBRARY_PATH`. Q1 itself set the env
  and ran. Backend used: `--device HTP0`. Log: `Hexagon Arch version v79`.
- Thermal gate: `GATE_PASS` pre and post.

## Q1 SURVIVE-DISPATCH — PASS

48 lines `HTP0 execute-op MUL_MAT_ID` on `ffn_*_exps` (16 layers × gate/up/down).
Quote blk.0 gate:

```
ggml-hex: HTP0 execute-op MUL_MAT_ID|blk.0.ffn_gate_exps.weight x ffn_norm-0 (reshaped) x ffn_moe_topk-0 -> ffn_moe_gate-0|...|q4_0 x f32 x i32 -> f32|...|HTP0-REPACK x HTP0 x HTP0 -> HTP0|hmx-tiled vtcm 8235008|flags 0x0
```

All 16 layers assigned to HTP0. HTP0-REPACK model buffer 3600.02 MiB.

## Q2 survive invocation — PASS

`EXIT=0` after load. No `fail.txt`. No dspqueue/qurt_exit in the grep.

PREREG: **SURVIVES** iff Q1 and Q2 both pass. They did, same invocation.

## Q3 prefill number — NOT RUN

PREREG Q3 is a second invocation `-r 3` without `GGML_HEXAGON_VERBOSE`.
Session was ended after Q1 to stop idle burn. Report-only number from the
verbose r=1 jsonl (not the Q3 printer):

`n_prompt=512 n_gen=0 avg_ts=845.885502 samples_ts=[845.886]`
`test_time=2026-09-01T15:05:40Z` devices=HTP0 ngl=99

Do not compare to #43 ship-model 1512 t/s (different model). Do not compare
to q55 PPL (different file).

## Still OPEN (Session 1 D)

PREREG: *"It does **not** close Session 1 D: patched-judge
test-backend-ops and Qwen3.5-4B dense v79 remain **OPEN**"*.
q63-on-HTP deferred (SURVIVES). HVX 28c stays frozen. Duplicate job
795871 Canceled 11:14, Started N/A, 0 min.
