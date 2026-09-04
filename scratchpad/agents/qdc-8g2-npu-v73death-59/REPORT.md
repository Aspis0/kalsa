# REPORT — Cell #59: the v73 NPU death REPLICATES on reference hardware (HDK8550)

Date: 2026-09-03 night (owner full delegation). QDC job 798484 (`sa802553`),
device `f623f410`, HDK8550 (Snapdragon 8 Gen 2, Hexagon HTP v73, **Android
16** — the S23 ran Android 14; NOT in PREREG's declared-confound list, noted
here as a residual confound, audit F-Android). Session Running
22:39:54 EDT → ended via ref-click End + reload (time in "Session
accounting"). PREREG.md audited pre-run (AUDIT-PRERUN.md; F1 of that audit
refuted from the text, F2/F3 applied), driver double-audited
(AUDIT-DRIVER.md; F1/F2 applied by the writer, fallback guard broadened).

## Verdict: **G1 — REPLICATED.** Policy F6 confirmed stack-bound.

Both pp16 arms died exactly like the S23:

| arm | env | proof (from -v stderr) | exit | signature |
|---|---|---|---|---|
| A1 `exp_pp16_nohostbuf` | HOSTBUF unset, no `--no-host` (S23 original) | n_htp=484 n_mul_mat_id=48 n_exps_htp0=48 | **134** | `ggml-hexagon.cpp:1552: ggml-hex: dspqueue_read failed: 0x0000002e` |
| A2 `exp_pp16_hostbuf1` | GGML_HEXAGON_HOSTBUF=1 + `--no-host 1` (q48 mirror) | n_htp=484 n_mul_mat_id=48 n_exps_htp0=48 | **134** | identical |

The S23 record (results/htp_probe/s23_v73_olmoe_q40/hostbuf1/driver.out):
`rc_a=134 n_htp=484 n_mul_mat_id=48 n_exps_htp0=48` — **the proof counters
match to the unit** and the fatal is the same `dspqueue_read 0x2e`
(raw/exp_pp16_*_sa802553.err; 6 dspqueue lines per arm in
raw/logcat_*.txt; tombstones pulled: raw/tomb_exp_pp16_nohostbuf_sa802553/
tombstone_00, raw/tomb_exp_pp16_hostbuf1_sa802553/tombstone_01). The HTP0
v73 session opens cleanly (skel `libggml-htp-v73.so` loaded, op-queue
allocated), 48 expert MUL_MAT_ID execute-ops are dispatched, then the DSP
queue read fails and the process aborts. A3-A5 correctly did not run (gated
on A1/A2 exit 0).

Why this is the strong result (PREREG "Declared confound"): the kit is a
NEWER build than the S23's (kalsa/npu-judge-v79 incl. upstream #25968
descriptor-type check and HMX gating), on a clean reference board with a
different Android major, different device, different model bytes (allenai
Q4_0, same 113/81/1 census), and a different load path (`--mmap 0` vs the
BigMoE `--load-mode none`) — and it dies identically. The death is a
property of the **v73 HTP stack under MoE expert dispatch** — "stack" meaning
host backend (ggml-hexagon.cpp flush path, where the backtrace sits) + v73
skel + DSP firmware together; this cell does NOT separate a host-side bug
that would reproduce on any v73 device from a DSP/firmware fault (audit:
"stack-bound", not "arch-bound"). What IS excluded: the S23 unit itself, its
thermal history, the HOSTBUF setting, and the 3f545bec binary. NOT excluded:
a ROM/firmware component shared by v73 devices (the HDK's firmware version
was not compared with the S23's). **F6 (experts-on-NPU = v75-class-only)
stands, now on reference hardware.** Upstream dossier #8 gains a QDC-reproducible case (reference
board + public model + open build).

## Method notes (all declared in PREREG before data)

1. Model: allenai official Q4_0 (`361e8d83…`, sha verified on device), not
   the in-house q55 gguf (unobtainable); census identical.
2. Pre-data amendment 2: first launch was METHOD-VOID on an argument-parse
   error (`--load-mode` does not exist in this lineage) — both arms
   archived in raw/void-attempt1/ (HTP session opened, no graph ran,
   n_exps_htp0=0); relaunched with `--mmap 0`, resume guard skipped the
   pushes. No data was seen before the substitution.
3. Thermal: gate PASS on every pre/post snapshot; the HDK sat cool (vbat
   ~4.2 V readings, status 0). Zero retries.
4. Not measured here: A3-A5 (gated off by design), the `dspqueue_write 0x1`
   B′ death (needs the B′ trunk model — separate cell), qurt_exit (F2b
   configuration, non-goal).

## Session accounting

Submitted ~22:37, Running 22:39:54; driver attempt 1 22:40:29 → 22:44:30
(kit 22 MB + model 3.9 GB push 172 s, two VOID arms — timings from the
orchestrator's live read of the first /tmp/cell59.log, which the relaunch
then overwrote; not on disk, PLAUSIBLE per audit); attempt 2 22:45:45 →
22:46:54 (two arms, ~27 s each incl. gate). **Ended 23:07:44 EDT (portal
Completed, verified after reload) = 27.8 min billed** of the 8 Gen 2 pool
(974 → ~946). Honest accounting: the device work took ~7 min; ~20 min were
idle because my first End Session attempt (JS-dispatched click on the
toolbar button, then a ref-click on Yes) did not take — ops lesson 7 of #52
struck again in a new form: the ref-click on the dialog only registered on
the SECOND pass, ~15 min later. Rule tightened for the next cells: End
Session = ref-click the toolbar button AND ref-click Yes, then reload and
read "Ended On" within one minute; if still Running, repeat immediately.
