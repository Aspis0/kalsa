# qdc-8elite-hopping-heat — report

**8 Elite facts only** (QRD8750: SM8750, Adreno 830, HTP v79, Android 16). This
mirrors `s23-backend-hopping-heat` (95943658), and the numbers must not be read as S23 numbers.

- QDC session **853216** (aspis). Board `sa857285`, serial `f3b4a4c5`: a different
  unit from 852687.
- Started 08:37:27, ended 09:16:41 EDT on 2026-09-28 (39m14s). The portal shows
  **Completed / Ended**.
- **Minutes**: the device card went 718 → **673**, a 45-min hold at the cap, read right
  after End Session. Last night's session settled from its cap hold (671) to its
  actual use (718, i.e. 23 min) by the next morning, so this one is expected to
  settle near **~40 min**. That figure needs a re-read later; see the correction in
  `../qdc-8elite-heat-arms/REPORT.md`.
  - The PREREG line "last night 70 billed" was written from that provisional hold and is wrong.
- PREREG `73e230df`, locked before the session. Kit f25f0c1c5 plus v79. The model and
  kit shas were verified on push (9/9 OK); prompt_n = 962.
- The sampler read 88 zones, all readable (`I` lines in `raw/device-out/samples.txt`).
- 0 watchdog kills, thermal status 0 throughout.
- **No energy data** (battery stubbed); skin is the proxy.

## A. Sustained prefill: 6 CPU, 12 NPU, 12 GPU back-to-back

All 30 units are OK. Every unit passed its backend proof:

| block | proof per unit |
|---|---|
| CPU | `CPU,CPU_REPACK` only |
| GPU | `OpenCL 3.0 QUALCOMM` plus an `OpenCL` model buffer |
| NPU | `HTP0` model buffer |

| block | units | wall s | start skin | skin rise at block end | peak skin (block+60 s) | skin area block+tail °C·s | **area per prefill** | prefill ms first/median/last | NSP zone start→end | GPU zone start→end | CPU zone start→end |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CPU ×6 | 6/6 | 40 | 29.3 | +5.96 | 36.1 | 451 | **75.1** | 4742/5222/5376 | 32→58 | 33→64 | 39→78 |
| NPU ×12 | 12/12 | 38 | 33.9 | **+4.16** | 38.7 | 277 | **23.1** | 907/918/924 | 37→57 | 38→59 | 41→65 |
| GPU ×12 | 12/12 | 127 | 35.7 | **+7.97** | **44.0** | 948 | **79.0** | 3324/3329/3330 | 41→64 | 42→75 | 67→85 |

Block-relative skin rise at the end of unit k:

| k | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NPU | −0.11 | −0.11 | 0.16 | 0.61 | 0.95 | 1.48 | 1.83 | 2.38 | 2.72 | 3.24 | 3.71 | 4.16 |
| GPU | 1.04 | 2.07 | 3.07 | 3.92 | 4.55 | 5.18 | 5.77 | 6.24 | 6.72 | 7.23 | 7.65 | 7.97 |
| CPU | 0.16 | 1.26 | 2.36 | 3.69 | 4.91 | 5.96 | — | — | — | — | — | — |

**Verdict A**
- **No skin crossover through 12 prefills.** The NPU's rise stays below the GPU's at
  every k, and the gap *widens*: from 1.2 °C at k=1 to 3.8 °C at k=12.
- The NPU never loses its thermal advantage within the block. Its prefill does not
  slow either: 907 ms at the first unit, 924 ms at the last, +2 %. The GPU is flat at
  ~3.33 s, while the CPU slows 4742 → 5376 ms (+13 %) in only 6 units.
- **Per prefill**, the sustained NPU costs 23 °C·s of skin, against 79 on the GPU and
  75 on the CPU: about 3.4× less.
- The GPU block took the skin to **44.0 °C**, 1 °C short of the watchdog, from a
  35.7 °C start.
- The NSP zone is a local sensor. Its per-unit samples swing 15–41 °C above the block
  start, because it heats and cools within each ~1 s dispatch. At block end it reads
  57 °C on the NPU block, against 58–64 °C on the other blocks. The NPU skin rise is
  close to monotonic, and its largest single-unit step is +0.55 °C.

## B. Decode heat per token (tg256, t6)

Rotated order: CPU, GPU, NPU, GPU, NPU, CPU, NPU, (CPU, GPU).

| arm | pos | tok/s | skin start | skin peak | °C·s | **°C·s/token** | CPU / GPU / NSP zone peak |
|---|---:|---:|---:|---:|---:|---:|---:|
| B1 CPU | 1 | 39.2 | 36.0 | 37.7 | 80 | 0.314 | 105.0 / 70.2 / 59.6 |
| B2 GPU | 2 | 30.3 | 36.0 | 37.8 | 84 | 0.328 | 102.3 / 73.3 / 53.4 |
| B3 NPU | 3 | 28.9 | 36.0 | 37.2 | 58 | 0.226 | 67.5 / 54.8 / 74.6 |
| B4 GPU | 1 | 30.3 | 36.0 | 37.8 | 83 | 0.325 | 101.1 / 72.9 / 54.2 |
| B5 NPU | 2 | 29.1 | 36.0 | 37.3 | 59 | 0.229 | 96.5 / 54.4 / 74.6 |
| B6 CPU | 3 | 38.9 | 36.0 | 37.7 | 81 | 0.315 | 105.4 / 71.0 / 59.9 |
| B7 NPU | 1 | 29.1 | 36.0 | 37.2 | 59 | 0.229 | 66.8 / 54.8 / 74.6 |
| B8 CPU | 2 | VOID `deadline` | | | | | |
| B9 GPU | 3 | VOID `deadline` | | | | | |

| backend | n | median tok/s | **median °C·s/token** (reps) | median skin Δ |
|---|---:|---:|---:|---:|
| CPU | 2 | **39.0** | 0.315 (0.314/0.315) | 1.72 |
| GPU | 2 | 30.3 | 0.326 (0.328/0.325) | 1.82 |
| NPU | 3 | 29.1 | **0.229** (0.226/0.229/0.229) | 1.26 |

Proofs:

| backend | proof |
|---|---|
| GPU | `OpenCL 3.0 QUALCOMM build: 0800.70` plus an `OpenCL` buffer of 1512 MiB |
| NPU | `HTP0` buffer of 1526 MiB. The HTP dispatch proof has 484 `HTP0 execute-op MUL_MAT` lines, the `libggml-htp-v79.so` session URI and EXIT=0 |
| CPU | `-dev none`, with buffers `CPU_Mapped,CPU_REPACK` |

**Verdict B**
- The NPU decode is the coolest per token: **0.229 °C·s/token**, 27 % below the CPU
  (0.315) and 30 % below the GPU (0.326).
  - The reps are tight and never overlap (NPU max 0.229 < CPU min 0.314).
  - Its CPU-zone peak is 67 °C (one rep 96.5), against ~105 °C on the CPU and ~102 °C on the GPU.
- It is also the **slowest**: 29.1 tok/s, against 39.0 on the CPU (−25 %) and 30.3 on the GPU.
- **The GPU is the worst decode backend here**: hotter per token than the CPU *and*
  22 % slower. On the 8 Elite, GPU decode buys nothing.
- Order bias: each backend ran in all three positions (NPU in 3/2/1, GPU in 2/1,
  CPU in 1/3), and every skin start was 35.95–36.00 °C. The rotation plus the binding
  cooldown removed last night's baseline drift from B.

## Caveats

- **The cooldown gate did not bind in A but did bind in B.** A's blocks started at
  29.3, 33.9 and 35.7 °C. The NPU and GPU blocks started warmer because the gate is
  36 °C and a block plus its 60 s tail does not fall below that. Rises are therefore
  block-relative, as the S23 PREREG defines. The GPU block's +7.97 °C came from the
  warmest start; that start does not create the gap, which is present from k=1.
- In B, every arm had to cool from > 36 °C, taking 106–437 s. That cost the
  deadline and voided B8/B9. CPU and GPU are n=2 and NPU is n=3.
- **Analyzer fix, disclosed.** The first pass voided the CPU decode arms on proof,
  because llama-bench names its mmap host buffer `CPU_Mapped`, which was missing from
  the analyzer's CPU buffer set. The PREREG rule is "CPU buffers only", so
  `CPU_Mapped` was added. No measured value changed.
- Single-process CLI prefills include model load. The unit wall time is ~6.5 s on the CPU, ~3.2 s on the NPU and ~10.6 s on the GPU (GPU includes OpenCL setup), against 5.2 / 0.92 / 3.3 s of prefill.
- n=1 block per backend in A, so the crossover result is descriptive, as in the S23 PREREG.

Raw data:
- `raw/device-out/`: markers, samples, per-unit and per-arm logs. The HTP proof log is gzipped.
- `raw/units.tsv` and `raw/decode.tsv`: per-unit and per-arm rows.
- `raw/analyze.out`: the analyzer output.
