# qdc-8elite-hopping-heat — pre-registration

Written 2026-09-28, BEFORE the QDC session. It mirrors
`s23-backend-hopping-heat/PREREG.md` (lab 95943658) on the Snapdragon 8 Elite
(QRD8750: Adreno 830, HTP v79). Locked at session start; changes go in a dated
amendment. Every number is an **8 Elite fact**, never an S23 (740/v73) fact.

## Questions (S23 questions 1–2; S23 question 3 is out of scope)

- **A.** Across a sustained block of 12 back-to-back 962-token prefills, does the
  HTP v79 heat up locally (NSP zones) or raise skin until it loses its thermal
  advantage over OpenCL? After how many prefills does that happen, if ever?
- **B.** Decode heat per token (°C·s/token) and tok/s for CPU, OpenCL and HTP.
- S23 question 3 (app visibility / headroom API) is **not** mirrored: Kalsa is not
  installed on the QDC board and the owner asked for A and B only.

## Differences from the S23 PREREG (forced by the rack, or asked by the owner)

| S23 | 8 Elite | why |
|---|---|---|
| battery ≤ 33.0 °C + status 0 gate | **HAL skin ≤ 36.0 °C** + thermal status 0 | battery stubbed on QDC (AC powered, level 100); owner's gate |
| battery / plugged / 30 % stops | none | stubbed |
| stop at battery 43 °C | watchdog: skin ≥ 45.0 °C → kill the binary (VOID `watchdog`, rest of block void); status ≥ 3 → stop session | skin is the only body sensor |
| app force-stop, traced gate | not applicable (no app, stock QRD) | — |
| B CPU `-t 5` | **`-t 6` for all B arms** (host threads for GPU/HTP too) | owner: "CPU (t6)" |
| B measured bench without `-v` | measured bench **with `-v`** | without it llama-bench prints no model-buffer lines, so the proof could not be read |
| order bias (last night's caveat) | B uses the S23's rotated order (each backend once in each position) | owner |

Everything else is copied: prompt, `COMMON` flags, block sizes, windows, crossover
definition, and proof rules.

## Fixed inputs

The same as `qdc-8elite-heat-arms` (lab 335fc965):
- **Model**: sha `a247afd6…`.
- **Prompt**: `prompt-v2.txt`, sha `f516905d…`, 962 tokens on the device.
- **Kit**: `kit-8e.tgz`, sha `8a9a5ce2…`. It is engine f25f0c1c5 plus `libggml-htp-v79.so`.
- **Env**: `LD_LIBRARY_PATH` = kit `lib` only, `ADSP_LIBRARY_PATH` = kit `lib`,
  `GGML_HEXAGON_NDEV=1`. Device dir: `/data/local/tmp/h8h`.

## Sampling (one sampler, whole session)

Every 1 s:
- The epoch.
- Every `cpu*`, `cpuss*`, `gpuss*` and `nsp*` thermal zone. The full zone list is
  written to the raw output, including unreadable zones.
- The HAL skin and the Android `Thermal Status`, both from one `dumpsys thermalservice`.
- The screen: "Screen Always On" is set in the wizard and `/sys/power/wake_lock` is held.
- Zone families: **CPU** = `cpu-*`/`cpuss-*`, **GPU** = `gpuss-*`, **NSP** = `nsphvx-*`/`nsphmx-*`.

## A. Sustained prefill blocks

Order **P-CPU ×6 → P-NPU ×12 → P-GPU ×12** (the S23 order).

Before each block:
- Cool to skin ≤ 36.0 °C and status 0, polling every 15 s with a 10-min cap.
- If the cap is hit, the block is **VOID `hot`** and is not run.

Within a block:
- No cooldown and no pause: each process starts as soon as the previous one exits.
- There is a 60 s sampled tail after each block.
- One invocation is one unit.

```
COMMON='-m ship.gguf -lm none -f prompt.txt -n 16 --ignore-eos --seed 1 --temp 0 --no-conversation -c 2048 -b 2048 -ub 1024 -t 5 -fa 1 --no-warmup --perf --simple-io --no-display-prompt'
CPU: ./bin/llama-completion $COMMON -dev none -ngl 0 -lv 4
HTP: ./bin/llama-completion $COMMON -dev HTP0 -ngl 99 -nkvo -lv 4
GPU: ./bin/llama-completion $COMMON -dev GPUOpenCL -ngl 99 -lv 4
```

Recorded per unit:
- Start and end epochs, rc, prompt-eval ms and tok/s.
- Whole-process wall time.
- The nearest skin, CPU-max, GPU-max and NSP-max readings at the unit's start and end, raw and block-relative.

**Skin crossover** (descriptive, n=1 block per backend): the first unit index `k` at
which the NPU's block-relative skin rise at unit end exceeds the GPU's at the same
`k`, for two consecutive `k`. If there is none, the result is "no crossover observed
through 12 prefills". The analysis also reports:
- the NSP absolute and block-relative trajectory;
- whether skin and NSP rise monotonically;
- the largest single-unit rise.

**Proof, every unit** (a missing proof or a nonzero exit voids the unit):

| backend | proof |
|---|---|
| CPU | model buffers `CPU`/`CPU_REPACK` only |
| GPU | `OpenCL 3.0 QUALCOMM` driver line (or `selected platform: 'QUALCOMM`) plus an `OpenCL` model buffer |
| HTP | an `HTP0` model buffer |

## B. Decode heat per token

The order is the S23's rotated order: **CPU, GPU, HTP, GPU, HTP, CPU, HTP, CPU, GPU**.
Each backend takes each of the three positions once, and order bias is reported.
Before every arm, cool to skin ≤ 36.0 °C and status 0 (15 s poll, 10-min cap →
VOID `hot`, not run).

```
CPU: ./bin/llama-bench -m ship.gguf -p 0 -n 256 -r 1 -t 6 -ngl 0  -dev none      -fa 1 --no-warmup -o md -v
GPU: ./bin/llama-bench -m ship.gguf -p 0 -n 256 -r 1 -t 6 -ngl 99 -dev GPUOpenCL -fa 1 --no-warmup -o md -v
HTP: ./bin/llama-bench -m ship.gguf -p 0 -n 256 -r 1 -t 6 -ngl 99 -dev HTP0      -fa 1 --no-warmup -o md -v
```

- **HTP load failure.** If an HTP arm exits nonzero with no `tg256` row, it is
  retried **once** with `-nkvo 1` (a fastrpc KV mmap failure is not a crash; see the
  S23 rule). The retry is labelled `nkvo`.
- **Window**: from arm start to process exit + 60 s sampled tail.
- **Skin area**: ∫ max(0, skin − skin_start) dt, trapezoids on real timestamps,
  in °C·s. Dividing by 256 gives **°C·s/token**.
- Also reported: `tg256` tok/s; start, peak and end skin; peak status; the
  CPU/GPU/NSP peak by family. A missing sensor is `NA`.
- **Measured-arm proof**:

  | backend | proof |
  |---|---|
  | GPU | QUALCOMM driver line plus an `OpenCL` model buffer |
  | HTP | an `HTP0` model buffer |
  | CPU | `-dev none`, CPU buffers only, and a `tg256` row |

- **HTP dispatch proof**, once, before the first HTP arm and outside the summaries:
  `GGML_HEXAGON_VERBOSE=1 llama-bench -p 0 -n 4 -r 1 -t 6 -ngl 99 -dev HTP0 -fa 1
  --no-warmup -v`. It passes with ≥ 1 `HTP0 execute-op MUL_MAT` line and a
  `libggml-htp-v79` reference. If it fails, the HTP arms are VOID `proof`.

## Stop rules

- **Watchdog, skin ≥ 45.0 °C**: kill the binary. The unit or arm is VOID
  `watchdog`, and the rest of that block is void.
- **Thermal status ≥ 3**: stop the session. Unfinished work is VOID `stop`.
- **Accelerator crash**: substrings `CDSP0 CRASHED`, `dspqueue_read failed`,
  `dspqueue_write failed`, `ggml_abort`, `GGML_ASSERT`, `Segmentation` in a log void
  that unit.
- **Deadline**: `now + 150 s` past the deadline → VOID `deadline`.

## Budget (the cap is billed in full: last night 70 billed for 22 used)

| phase | estimate |
|---|---|
| tunnel, preflight, push (model 1.49 GiB ≈ 70 s) | 4 min |
| A: 3 cooldowns (~0–3 min each) + CPU 6×~6.5 s + NPU 12×~3 s + GPU 12×~6 s + 3 tails of 60 s | ~10 min |
| B: HTP proof ~0.5 min + 9 × (cooldown ~0.5–2 + run ~0.2–0.5 + tail 1) | ~18 min |
| pull, end | 2 min |
| **total** | **~34 min** |

**Requested cap: 45 min.** The deadline in `sess.sh` is session start + 40 min.
The risk is that cooldowns bind in B, because last night the skin was ~35.9 °C by
the end, and ≥ 36 cools at ~0.5 °C/min. Arms cut by the deadline are VOID
`deadline`, and B runs last.
