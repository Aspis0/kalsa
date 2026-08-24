# q45 — #29 v1 acceptance arm: the 464 s exam (protocol handoff to the app)

**Who runs it:** the app-Claude, in-app on the S23 (their harness, their 16-turn plan).
**What it decides (for the kernel side):** whether the repack kernel's GEMV
optimization is post-v1 polish or critical path. Oracle ceiling = **armB-kexp-nommap:
464 s total, 21.27→15.67 t/s monotone, 16/16 turns** (their 23/08 run, banked).

## Arm definition

ONE arm, identical to armB-kexp-nommap in every respect except the delta under test:

| | armB-nommap (oracle) | armK (this run) |
|---|---|---|
| model | LFM2.5-8B-A1B-KEXP (same gguf, sha recorded) | same file, same sha |
| plan | the 16-turn plan, same prompts, same order | identical |
| mmap | `use_mmap=false` | **`use_mmap=true` + repack kernel ON** |
| build | their APK | APK that compiles kalsallama `main` (verified in .so: `lm_ggml_gemv_q2_K_8x4_q8_K`, `q3_K`) |
| device | S23, unplugged, cool start | same, declared |

The kernel path must be PROVEN active, not assumed: log the repack buffer creation
(the q2_K/q3_K 8x4 traits allocating) or assert `ggml_repack_q23k_8x4_nbytes > 0`
for the loaded model, once, at load. A run without this proof is not the exam.

## Measurement rules (binding — each one is a banked lesson)

1. **Paired generation lengths**: record `tokensPredicted` per turn in the data row.
   Per-turn tok/s comparisons are only valid at comparable lengths
   (corr(tok/s, tokens) is negative in every arm — the 18-21/8-11 "bimodality" was
   length, not eviction). The primary metric is **wall-clock of the whole plan**.
2. **majflt within-arm only**: per-turn majflt traces collapse INSIDE an arm;
   never compare cumulative majflt across differently-backed arms.
3. **Per turn, sampled from /proc/<app-pid>/status and /proc/meminfo**:
   `RssAnon`, `RssFile`, `VmSwap`, majflt (from /proc/<pid>/stat), **and
   `MemAvailable` (NEW — q43/q31 addition)**. The `MemAvailable − RssFile` series
   is the validation payload for the GPU fit-gate work (#31): S23 (evicting) vs
   Jelly (non-evicting) is the contrast that proves or kills that estimator.
4. RLIMIT_MEMLOCK note stands: read limits from `/proc/<app-pid>/limits`, never
   from an adb/run-as shell (per-device: S23 64MB hard, Jelly unlimited).
5. Cool start declared (batt level + temp), unplugged, no charger mid-run.
6. Context-growth decay (~1/3 over 16 turns, ALL arms) is NOT the kernel's to fix:
   never judge the kernel on total decay %. Judge it on the 464 s ceiling and on
   the absence of the eviction collapse (no 0.4–1.0 t/s turns, no majflt storm).

## Verdict rule (pre-declared)

- **armK wall-clock ≈ 464 s (within ~10 %)**: kernel v1 accepted as the shippable
  residency answer; GEMV optimization is post-v1 refinement. (Expected: armK may
  even beat 464 s — mmap load is faster than the nommap full-read and RssAnon
  stays lower; report load time separately from plan time.)
- **Well above 464 s** (e.g. > 1.25×): GEMV/packing cost is on the critical path —
  kernel-side work reopens before ship (bench trio: kernel-only, packing cost,
  amortization break-even — already on file).
- **Collapse reappears** (eviction signature): the kernel's residency premise
  failed on device — STOP and report raw; that outcome contradicts M0–M5 and
  needs forensics, not tuning.

## Deliverables back to us

Per-turn CSV (turn, tokensPredicted, wall_s, tok/s, majflt, RssAnon, RssFile,
VmSwap, MemAvailable), load-time, plan wall-clock total, battery delta, the
kernel-active proof line, gguf sha, APK/build identifier. We bank the verdict in
PLAN #29 and it feeds #31's estimator series for free.
