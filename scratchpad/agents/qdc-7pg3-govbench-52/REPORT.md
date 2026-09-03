# REPORT — Cell #52: Snapdragon 7+ Gen 3 (QRD7675) first contact

Date: 2026-09-03. QDC job 797795 (`sa801864`), device `f6d5d957`, session
05:22–05:57 CEST, ~36 min billed of the 1000 free 7+ Gen 3 minutes unlocked
this morning. PREREG.md in this folder; raw evidence in raw/.

## Device (raw/recon_sa801864.txt)

- SoC `SM7675` (getprop ro.soc.model, recon line 2), platform `pineapple`,
  Android 14 userdebug. GPU: **Adreno 732**, from the OpenCL banner in every
  bench output ("QUALCOMM Adreno(TM) 732", e.g. raw/bench_gpu_sa801864.out:1).
- 8 cores: cpu0-2 @1.9008 GHz, cpu3-6 @2.6112 GHz, cpu7 @2.8032 GHz (recon
  lines 8-15). CPU_MASK `f0` = cpu4-7 (three 2.61 + the 2.80 prime).
- RAM 11,594,996 kB (~11.1 GiB usable of 12 GB). /vendor/lib64/libOpenCL.so
  present.

## Q1 — OpenCL kernel correctness on Adreno 732: **ALL PASS**

Binary: test-backend-ops from gov-kit-5c3979438 (kalsa/governor-v0, OpenCL ON,
Adreno kernels ON, sha `36ddd5ae…`, verified on device via SHA256SUMS).

- MUL_MAT: **925/925 tests passed, 2/2 backends passed**
  (raw/tbo_mm_sa801864.out, "925/925 tests passed"), exit=0.
- MUL_MAT_ID: **407/407 tests passed** (raw/tbo_mmid_sa801864.out), exit=0.
  Same 407/407 count as the 740/750 campaigns — the MoE kernel surface
  transfers intact to the 732.

### Q1 exception — FLASH_ATTN kernels do NOT compile on Adreno 732

Not part of the preregistered op set, found via the first (crashed) load
probe (raw/loadprobe_FAcrash_sa801864.out, preserved):

```
ggml_opencl: kernel compile error (err=-11) building fa f32_f16
error: implicit declaration of function 'sub_group_shuffle_xor'
```

The 732's OpenCL 3.0 driver lacks `sub_group_shuffle_xor` (or the required
subgroup-shuffle extension). Every FA-enabled context init then fell into an
OpenCL buffer alloc failure (1,804,626,176 bytes ≈ 1.68 GiB) and a segfault. **Router consequence: the
FA lane must be capability-probed per GPU, not assumed per-vendor** — fa=0 is
mandatory on this tier with the current kernels.

## Q2 — ship config (LFM2.5-2.6B QAD-Q4_0, sha `a247afd6…`, app-pinned HF rev)

llama-bench, 3 reps, -t 4, taskset f0, thermal-gated (every pre-arm gate
returned 0; the therm_* snapshots show max HAL temp ≤ 54.8 °C and Thermal
Status 0 throughout; board is plugged by nature — comparative numbers only
per the RTL/QDC convention).

| arm | flags | pp512 t/s | tg128 t/s | file |
|---|---|---|---|---|
| GPU full offload | -ngl 99 -fa 0 | **151.78 ± 1.12** | **17.26 ± 0.02** | raw/bench_gpu_sa801864.out |
| CPU pure | -dev none -ngl 0 | 13.77 ± 0.23 | 10.27 ± 0.09 | raw/bench_cpu_pure_sa801864.out |
| CPU-weights hybrid | -ngl 0 (OpenCL registered) | 14.37 ± 0.17 | 11.02 ± 0.10 | raw/bench_cpu_sa801864.out |

## Grid interpretation (PREREG binding)

**G1 fires**: Q1 all-PASS and GPU pp512 (151.8) ≫ CPU pp512 (13.8-14.4).
On the 7+ Gen 3 the GPU behaves like the 750-class ("GPU flies"), NOT like
the Adreno 740 cool-mode-only regime: GPU prefill is ~11× this build's CPU
prefill and GPU decode 17.3 t/s beats CPU decode 10.3 t/s by 1.68×.
Router: the GPU prefill lane is admissible on this tier, with fa=0.

### Honest caveats (bound to this bank)

1. **The CPU lane number is build-suspect.** pp512 13.8 t/s at 4 big cores is
   far below what a tuned CPU build should do on Cortex-A720/X4; the kit's
   BUILD_NOTE records no aarch64 arch flags (i8mm/dotprod repack paths may be
   absent). The G1 verdict rests on the GPU side being fast in absolute terms
   (151.8 pp512 approaches useful interactive prefill), not on the exact
   CPU/GPU ratio. A follow-up cell with the app's own engine build (or a
   -march-tuned CPU build) must re-measure the CPU lane before any router
   crossover constant is calibrated from this cell.
2. Decode (tg128) recorded but not gridded, per PREREG.
3. Single session, plateau not characterized (llama-bench 3-rep means only).
4. The hybrid arm shows OpenCL-at-ngl0 contamination is ≈ neutral here
   (14.37 vs 13.77), but the two arms also differ by run order; not gridded.

## Ops lessons (banked for every future QDC cell)

1. **adb background launch (T4 pattern)**: over the QDC tunnel,
   `adb shell "A && B && nohup sh -c '...' ... &"` hangs — the backgrounded
   list's subshell holds the adb socket. Only
   `adb shell "nohup sh -c '...' </dev/null >/dev/null 2>&1 & echo OK"`
   (nohup as the only backgrounded word, cd inside the sh -c) returns
   immediately. Probed live with T1-T5 variants.
2. **toybox taskset wants bare hex** (`taskset: bad mask '0xf0'`) — the
   audit's F8 "add 0x" fix was wrong; verified on device.
3. **llama-cli is not a load probe**: with -p/-n 1/-no-cnv and stdin at
   /dev/null it looped on the interactive prompt and wrote 106 MB of "> "
   (raw/loadprobe_interactive-loop_evidence.txt). llama-bench is the probe.
4. `pkill -f` self-matches its own adb shell (exit 143) — bracket the
   pattern (`'slee[p] 20'`).
5. No `timeout` on the QDC Android images AND none on this Mac —
   perl `alarm`+exec is the portable cap wrapper.
6. llama-bench defaults to -ngl 99: a "CPU bench" without explicit
   -dev none/-ngl 0 is a GPU bench.
7. **Portal End/Cancel dialogs ignore JS-dispatched clicks** — only real
   input clicks (browser ref-clicks) land, and the SPA shows no error when a
   JS click is swallowed. ALWAYS re-load the job page and read Session
   Status after any End/Cancel; this session idled 45 min because the check
   was skipped. (Same swallow bit the #54 Create attempt.)

## Session accounting

Job 797795: created 05:21, Running 05:22:17, ended **06:42:22 → ~80 min
billed** (the measurement work ended 05:57; the first End-Session attempt was
a JS-dispatched click that silently did nothing and the session idled 45 min
until a real ref-click ended it — ops lesson 7 below). Seven
driver launches: v1-v2 died on the adb background-launch hang (ops lesson 1),
v3 ran R1 + the FA-crash probe, v4 hit the llama-cli interactive loop
(lesson 3), v5 burned two 20-s taskset failures (lesson 2), v6 ran the two
real bench arms, v7 the pure-CPU arm. Re-entrant arm skipping kept re-runs
cheap. Remaining 7+ Gen 3 budget ≈ 920 min.
