# qdc-8elite-heat-arms — pre-registration

Written 2026-09-27, BEFORE any QDC session for this cell. Locked once the
session starts; any later change goes in a dated amendment block with the old
value quoted.

## Question

Which prefill backend heats the Snapdragon 8 Elite (QRD8750: Adreno 830,
Hexagon HTP v79) least **per prompt**, for the Kalsa per-phase governor? And
does using fewer CPU decode threads cut skin heat materially?

Context: on the Galaxy S23 (Adreno 740 / HTP v73) one ~1000–2000-token GPU
prefill turn in the app drove Android to thermal status SEVERE. Every number
this cell produces is an **8 Elite fact**. It is not transferable to the S23 or
to any other chip.

## Fixed inputs (verified on the Mac before the session)

| item | identity |
|---|---|
| model | `LFM2.5-2.6B-QAD-Q4_0.gguf` ("ship"), sha256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`, from `/Users/marco/kalsa-models/mac/` |
| prompt | `governor-thermal-ladder/raw/protocol-v2/prompt-v2.txt`, sha256 `f516905dd5a86926279b3bf08999539557aee3af6467c84a9df99a9323d4ba0a`, 5195 B, 962 tokens by the host tokenizer (includes BOS). The device `prompt_n` is recorded per arm. |
| kit | `~/kalsa-qdc/qdc-8elite-heat-arms/kit-8e.tgz`, sha256 `8a9a5ce2e541aff55e766af138785b69bf63db1776ed39f10a6617c57868050e`; per-file shas in `kit.SHA256SUMS` |

**Kit provenance.** `bin/` and `lib/` are byte-identical to the S23 heat-3way
kit (`npu-kit-f25f0c1c5.tgz`, sha `dccf0865…`, engine `f25f0c1c5`, built with
`GGML_OPENCL=ON GGML_HEXAGON=ON`, Hexagon SDK 6.6.0.0, per
`npu-spec-verify/STEP0-V73-PREP.md`). That kit shipped only the v73 skel. The
added `lib/libggml-htp-v79.so` (sha `a387cb5f…`, unstripped) comes from the
**same build directory and the same build pass**
(`kalsallama-wt-oom/build-s23-step0-v73`: v73 01:38, v75 01:42, **v79 01:47**,
v81 01:52, `llama-completion` 02:34 on 2026-09-26). No new build was needed.

**Deviation, stated.** The brief says kalsallama `main`. `f25f0c1c5` is **not**
an ancestor of `main` (`git merge-base --is-ancestor` → 1). I chose it because
(a) it already exists with v79, so nothing needs building, and (b) it is the exact
engine behind the S23 three-way run 6, so the engine is the same across the two
chips. A `main` build would need the Snapdragon docker toolchain (about 1.5 h
last time) and would give a different engine from the S23 numbers.

## Arms (15, run in this order)

Common flags for every P arm (the S23 driver's flags, `arm.sh:109`, except `-n`,
the prompt and the CPU device flag):

```
./bin/llama-completion -m ship.gguf -lm none -f prompt.txt -n 16 --ignore-eos
  --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1
  --no-warmup --perf --simple-io --no-display-prompt -lv 4 <backend> </dev/null
```

| backend | flags |
|---|---|
| P-CPU | `-dev none -ngl 0` (the S23 used only `-ngl 0`. `-dev none` also rules out op offload of large-batch matmuls to OpenCL/HTP) |
| P-GPU | `-dev GPUOpenCL -ngl 99` |
| P-NPU | `-dev HTP0 -ngl 99 -nkvo` |

D arms (decode-only, CPU):
`./bin/llama-bench -m ship.gguf -p 0 -n 256 -r 1 -t <T> -ngl 0 -dev none -fa 1 --no-warmup -o md`

Order (alternated):
1 P-CPU r1 · 2 P-GPU r1 · 3 P-NPU r1 · 4 P-CPU r2 · 5 P-GPU r2 · 6 P-NPU r2 ·
7 P-CPU r3 · 8 P-GPU r3 · 9 P-NPU r3 · 10 D-t6 r1 · 11 D-t4 r1 · 12 D-t2 r1 ·
13 D-t6 r2 · 14 D-t4 r2 · 15 D-t2 r2.

Env for every run: `LD_LIBRARY_PATH=<kit>/lib` **only** (never `/vendor/lib64`),
`ADSP_LIBRARY_PATH=<kit>/lib`, `GGML_HEXAGON_NDEV=1`.

## Per-arm procedure (on-device script `sess.sh`)

1. P-NPU only: **proof run** before the cooldown:
   `GGML_HEXAGON_VERBOSE=1`, the same flags but `-p " " -n 4 -lv 5`.
2. **Cooldown**: poll HAL skin (`dumpsys thermalservice`, section "Current
   temperatures from HAL", `mName=skin`) every 15 s until ≤ 36.0 °C, with a cap of
   600 s. On timeout the arm is **VOID `hot`**. It still runs and is recorded, but it
   is excluded from the medians, and the session continues.
3. **Measured run**, with a hard timeout of 300 s. Epoch start and end are recorded.
4. **Tail**: 60 s idle, still sampled (skin lags the silicon).
5. Deadline guard: if `now + 150 s` passes the session deadline, the arm is **VOID
   `deadline`** and it does not run.

Sampler: an on-device 1 s loop over the `cpu*`, `gpuss*` and `nsp*` thermal zones
plus HAL skin, for the whole session. **Watchdog** (in the sampler): skin ≥ 45.0 °C
→ `pkill` the running `bin/llama-*` and write a `K` line. The arm is then **VOID
`watchdog`**. The screen is kept on (wizard "Screen Always On"), and a
`/sys/power/wake_lock` is held so that cooldown sleeps cannot suspend the SoC.

## Proof of backend (per arm; missing → VOID `proof`)

- P-CPU: `EXIT=0`. The measured log's model buffers are only `CPU`/`CPU_REPACK`,
  with no `OpenCL` or `HTP0` model buffer.
- P-GPU: the measured log contains `selected platform: 'QUALCOMM` **or**
  `ggml_opencl: OpenCL driver: OpenCL 3.0 QUALCOMM`, AND an `OpenCL model buffer
  size` line. Without the platform line, it is a silent CPU fallback.
  *Why two forms (found before the session):* engine f25's logs never print
  `selected platform:`. It has 0 hits in all 21 S23 run-6 logs, including the -lv 5
  proofs, while the driver line and `using device GPUOpenCL (QUALCOMM
  Adreno(TM))` are present. The driver line only exists once the QUALCOMM
  platform has been opened, which is the same fact.
- P-NPU: the proof log has ≥ 1 `HTP0 execute-op MUL_MAT` line and a
  `libggml-htp-v79` reference. The measured log has an `HTP0 model buffer size`
  line.
- D arms: `EXIT=0` plus a parsed `tg256` row. `-dev none` means CPU only.

## Metrics (per arm)

- **P arms, primary window** `W = [prefill_start, run_end + 60 s]`. Here
  `prefill_start = run_start + t(generate:)`, read from the log's relative
  timestamp. `skin_start` is the last skin sample ≤ `prefill_start`.
- **D arms**: `W = [run_start, run_end + 60 s]`, with `skin_start` taken at `run_start`.
- Recorded: `duration` (prefill_start→run_end for P; wall for D), `skin Δ` =
  peak skin in W − skin_start, `peak skin`, **skin area** = ∫ max(0,
  skin − skin_start) dt over W (trapezoid on the real sample times, °C·s), the
  peak of the max CPU/GPU zone over the run, prefill ms and tok/s (P), and tg tok/s (D).
- Table: the **median of the non-VOID reps** per arm type.
- **No energy data**: battery voltage/current is stubbed on the QDC rack. Skin
  area is the heat proxy.

## Decision rules (pre-registered)

- **Coolest prefill backend per prompt** = the lowest median skin area. The margin
  is quoted as an absolute (°C·s) and relative (%) difference. The winner is
  called "material" only if its worst rep is below the runner-up's best rep, i.e. the
  reps do not overlap. Otherwise the verdict is "not separable at n=3".
- **Decode threads**: "fewer threads cut skin heat materially" if the median skin
  area of t2 (or t4) is ≥ 25 % below t6 **and** the reps do not overlap. Heat per
  token is also reported (area / 256), because fewer threads decode more slowly.

## Priors (8 Elite, recorded before the session)

- `qdc-8elite-skin-thermal`: idle skin ≈ 33 °C. An app CPU turn with ~900 prefill tokens
  plus 60 s of typing → 42.5 °C. It cools to 36 in ~3.5 min, then ~0.5 °C/min.
  App GPU turns ended at 44.6–45.3 °C.
- S23 CLI run 6 (**Adreno 740/v73, not transferable**): prefill of 1010 tokens:
  CPU 19.0/10.4 s, GPU 7.3 s, NPU 1.6 s. The skin rise per arm was ≤ 4 °C.

## Budget (the cap is billed in full, so this is the minimum)

| phase | estimate |
|---|---|
| tunnel, preflight, push (model 1.52 GiB at ~22 MiB/s ≈ 75 s; kit and prompt ≈ 10 s), `--list-devices` | 5 min |
| initial cooldown to 36.0 | 0–3 min |
| 9 P arms × (NPU proof ~0.3 for 3 of them + cooldown ~2 + run ≤0.5 + tail 1) | ~31 min |
| 6 D arms × (cooldown ~2 + run ~0.5 + tail 1) | ~21 min |
| pull, restore | 2 min |
| **total** | **~60 min** |

**Requested cap: 70 min.** The `sess.sh` deadline is the session start plus 64 min,
so the driver finishes cleanly before the cap. If the deadline cuts the cell, the
remaining arms are VOID `deadline`, run in order, so the D arms get cut first.

## Stop rules

Stop an arm only on: the watchdog (skin ≥ 45.0), the 300 s timeout, or the
substrings `CDSP0 CRASHED`, `dspqueue_read failed`, `dspqueue_write failed`,
`ggml_abort`, `GGML_ASSERT`, `Segmentation`. These are recorded as the VOID reason.
The session always proceeds to the next arm.
